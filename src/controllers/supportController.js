const pool = require('../config/database');
const { normalizeHistory } = require('../services/chatbotPrompt');

const SupportController = {
  chatWithGemini: async (req, res) => {
    const historyService = require('../services/aiChatHistoryService');
    const customerId = req.user?.role === 'customer' ? req.user.id : null;
    const respond = async payload => {
      let historySaved = false;
      if (customerId && typeof req.body.message === 'string' && req.body.message.trim() && req.body.message.length <= 2000) {
        try {
          await historyService.saveExchange(customerId, req.body.message.trim(), payload.reply);
          historySaved = true;
        } catch { console.error('[AI history] Could not save exchange'); }
      }
      return res.status(200).json({ ...payload, history_saved: historySaved });
    };
    try {
      const { message } = req.body;
      
      if (typeof message !== 'string' || message.trim() === '') {
        return respond({ success: true, source: 'unavailable', available: false, reply: "Bạn cần hỗ trợ gì ạ? Xin hãy nhập câu hỏi để mình tư vấn nhé!" });
      }
      if (message.length > 2000) return res.status(400).json({ success: false, message: 'Câu hỏi tối đa 2000 ký tự' });
      const history = customerId ? (await historyService.history(customerId, { limit: 10 })).rows.map(row => ({ sender: row.sender_type === 'customer' ? 'user' : 'bot', text: row.content })) : req.body.history;
      const [faqs] = await pool.query('SELECT question, answer FROM faqs WHERE is_active = 1 ORDER BY faq_id LIMIT 100');
      const normalized = message.toLocaleLowerCase('vi').trim();
      const faq = faqs.find(item => normalized === item.question.toLocaleLowerCase('vi').trim());
      if (faq) return respond({ success: true, source: 'faq', available: true, reply: faq.answer });

      if (!require('../services/geminiService').hasApiKeys()) {
        return respond({ 
          success: true, source: 'unavailable', available: false,
          reply: "Trợ lý AI chưa sẵn sàng. Bạn hãy chọn Chat với nhân viên trong khung hỗ trợ để được tư vấn nhé!"
        });
      }

      const [settings] = await pool.query("SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('store_name','store_address','store_phone','store_email','shipping_fee','free_shipping_threshold')");
      const previousQuestion = normalizeHistory(history).filter(item => item.role === 'customer').at(-1)?.text || '';
      const terms = [...new Set(`${message} ${previousQuestion}`.trim().split(/\s+/).map(term => term.replace(/[\\%_]/g, '')).filter(term => term.length >= 2))].slice(0, 20);
      const productFilter = terms.length ? `AND (${terms.map(() => 'p.product_name LIKE ?').join(' OR ')})` : '';
      const [products] = await pool.query(`SELECT p.product_id, p.product_name, p.base_price,
          v.variant_id, v.price, v.size_description, s.size_value, c.color_name,
          COALESCE((SELECT SUM(i.quantity) FROM inventory i JOIN branches b ON b.branch_id = i.branch_id AND b.is_active = 1 WHERE i.variant_id = v.variant_id), 0) AS stock
          FROM products p JOIN product_variants v ON v.product_id = p.product_id AND v.is_active = 1
          LEFT JOIN sizes s ON s.size_id = v.size_id LEFT JOIN colors c ON c.color_id = v.color_id
          WHERE p.is_active = 1 ${productFilter} ORDER BY p.product_id DESC, v.variant_id LIMIT 30`, terms.map(term => `%${term.replace(/[\\%_]/g, '')}%`));
      const [branches] = await pool.query('SELECT branch_name, address, phone FROM branches WHERE is_active = 1 ORDER BY branch_id LIMIT 30');
      const context = {
        branches,
        settings: Object.fromEntries(settings.map(row => [row.setting_key, row.setting_value])),
        faqs: faqs.slice(0, 30).map(row => ({ question: String(row.question).slice(0, 500), answer: String(row.answer).slice(0, 1500) })),
        products: products.map(row => ({ ...row, url: `/store/products/${row.product_id}`, size_description: row.size_description?.slice(0, 1000) })),
        scope: 'Danh sách sản phẩm là kết quả giới hạn, không phải toàn bộ kho. Không có dữ liệu đơn hàng cá nhân.'
      };
      const text = await require('../services/geminiService').generateAdvice({ message: message.trim(), history, context });
      return respond({ success: true, source: 'ai', available: true, reply: text });
    } catch (error) {
      console.error("Lỗi AI:", error.status || error.name || 'provider_error', error.code || '');
      const reply = error.status === 429
        ? 'Trợ lý AI đang đạt giới hạn lượt sử dụng. Bạn vui lòng thử lại sau hoặc chọn Chat với nhân viên nhé!'
        : error.code === 'CONTENT_BLOCKED'
          ? 'Mình chưa thể trả lời nội dung này. Bạn hãy hỏi về sản phẩm, chọn size hoặc chính sách mua hàng nhé!'
          : 'Trợ lý AI tạm thời chưa kết nối được. Bạn hãy thử lại hoặc chọn Chat với nhân viên để được hỗ trợ nhé!';
      return respond({ success: true, source: 'unavailable', available: false, reply });
    }
  },
  getSessions: async (req, res) => {
    try {
      const role = req.user.role;
      const staffId = req.user.id;
      
      let query = `
        SELECT 
          cs.conversation_id as id,
          cs.conversation_type as status,
          cs.started_at as created_at,
          (SELECT COUNT(*) FROM chat_messages unread WHERE unread.conversation_id=cs.conversation_id AND unread.sender_type='customer' AND unread.message_id>COALESCE(rr.last_read_message_id,0)) AS unread_count,
          c.full_name as customer_name,
          c.email as customer_email, cs.staff_id, a.full_name AS staff_name, b.branch_name,
          (SELECT message_content FROM chat_messages cm WHERE cm.conversation_id = cs.conversation_id ORDER BY message_id DESC LIMIT 1) as last_message,
          (SELECT sent_at FROM chat_messages cm WHERE cm.conversation_id = cs.conversation_id ORDER BY message_id DESC LIMIT 1) as last_message_time
        FROM chat_conversations cs
        LEFT JOIN chat_read_receipts rr ON rr.conversation_id=cs.conversation_id AND rr.account_id=?
        LEFT JOIN customers c ON cs.customer_id = c.customer_id
        LEFT JOIN accounts a ON a.account_id = cs.staff_id
        LEFT JOIN branches b ON b.branch_id = a.branch_id
      `;
      const params = [staffId];
      
      if (role === 'staff') {
          query += ' WHERE cs.staff_id = ?';
          params.push(staffId);
      }
      
      query += ' ORDER BY last_message_time DESC';
      
      const [rows] = await pool.query(query, params);
      res.status(200).json({ success: true, data: rows });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  },

  getMessages: async (req, res, next) => {
    try {
      const history = await require('../services/chatHistoryService').getChatHistory(req.params.id, req.query);
      res.json({ success: true, data: history.rows, pagination: history.pagination });
    } catch (error) { next(error); }
  },

  sendMessage: async (req, res, next) => {
    try {
      const { content } = req.body;
      if (typeof content !== 'string' || !content.trim() || content.length > 4000) return res.status(400).json({ success: false, message: 'Tin nhắn cần nội dung, tối đa 4000 ký tự' });
      await require('../services/chatAssignmentService').replyToConversation(req.params.id, req.user, content);
      res.status(201).json({ success: true });
    } catch (error) { next(error); }
  },

  updateSessionStatus: async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body; 
      if (!['bot', 'human'].includes(status)) return res.status(400).json({ success: false, message: 'Trạng thái hội thoại không hợp lệ' });
      const [updated] = await pool.query('UPDATE chat_conversations SET conversation_type = ? WHERE conversation_id = ? AND (? = \'admin\' OR staff_id = ?)', [status, id, req.user.role, req.user.id]);
      if (!updated.affectedRows) return res.status(403).json({ success: false, message: 'Hội thoại đã chuyển cho nhân viên khác. Vui lòng tải lại' });
      res.status(200).json({ success: true, message: 'Cập nhật thành công' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  },

  getBranchSuggestions: async (req, res) => {
    try {
      const sessionId = req.params.id;
      const [chats] = await pool.query('SELECT customer_id FROM chat_conversations WHERE conversation_id = ?', [sessionId]);
      if (!chats.length) return res.status(404).json({ success: false, message: 'Không tìm thấy cuộc hội thoại' });
      
      const customerId = chats[0].customer_id;
      let lat = null, lon = null;
      if (customerId) {
        const [addrs] = await pool.query('SELECT latitude, longitude FROM customer_addresses WHERE customer_id = ? AND is_default = 1 LIMIT 1', [customerId]);
        if (addrs.length) {
          lat = addrs[0].latitude;
          lon = addrs[0].longitude;
        }
      }
      
      const [branches] = await pool.query('SELECT branch_id, branch_name, address, latitude, longitude FROM branches WHERE is_active = 1');
      const R = 6371; 
      const deg2rad = (deg) => deg * (Math.PI / 180);
      
      const suggestions = branches.map(b => {
          let distance = null;
          if (lat && lon && b.latitude && b.longitude) {
              const dLat = deg2rad(b.latitude - lat);
              const dLon = deg2rad(b.longitude - lon);
              const a = 
                  Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(deg2rad(lat)) * Math.cos(deg2rad(b.latitude)) * 
                  Math.sin(dLon / 2) * Math.sin(dLon / 2); 
              const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); 
              distance = R * c; 
          }
          return {
              ...b,
              distance,
              hasEnoughStock: true
          };
      });
      
      suggestions.sort((a, b) => {
          if (a.distance === null) return 1;
          if (b.distance === null) return -1;
          return a.distance - b.distance;
      });
      
      for (let i = 0; i < suggestions.length; i++) {
          const [staffs] = await pool.query("SELECT account_id, full_name, email FROM accounts WHERE branch_id = ? AND is_active = 1 AND role_id = 2 AND EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.permission_id = rp.permission_id WHERE rp.role_id = accounts.role_id AND p.permission_code = 'support.manage')", [suggestions[i].branch_id]);
          suggestions[i].staff = staffs; 
      }

      res.status(200).json({ success: true, data: suggestions });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  },

  assignSession: async (req, res, next) => {
    try {
      await require('../services/chatAssignmentService').assignConversation(req.params.id, req.body.branch_id, req.body.staff_id, req.user.id);
      res.json({ success: true });
    } catch (error) { next(error); }
  }

};

module.exports = SupportController;
