const pool = require('../config/database');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const SupportController = {
  chatWithGemini: async (req, res) => {
    try {
      const { message } = req.body;
      
      if (!message || message.trim() === '') {
        return res.status(200).json({ success: true, reply: "Bạn cần hỗ trợ gì ạ? Xin hãy nhập câu hỏi để mình tư vấn nhé!" });
      }

      if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.includes('your_')) {
        return res.status(200).json({ 
          success: true, 
          reply: "Xin lỗi, Trợ lý AI đang được nâng cấp bảo trì. Trong lúc chờ đợi, bạn có thể chat trực tiếp với nhân viên qua Zalo hoặc Hotline nhé!" 
        });
      }

      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      const prompt = `
        Đóng vai: Bạn là "FashionOS Bot" - Trợ lý AI cao cấp của thương hiệu thời trang FashionOS.
        Tính cách: Vô cùng lịch sự, dễ thương, chuyên nghiệp, luôn xưng "mình" hoặc "FashionOS" và gọi khách hàng là "bạn" hoặc "quý khách".
        
        Quy tắc TỐI THƯỢNG (Bắt buộc tuân thủ):
        1. CHỈ TRẢ LỜI các vấn đề liên quan đến: Thời trang, mua sắm quần áo, size số, giao hàng, đổi trả, bảo hành, thông tin cửa hàng.
        2. TỪ CHỐI mọi câu hỏi ngoài lề (ví dụ: viết code, làm toán, chính trị, dịch thuật...). Nếu khách hỏi ngoài lề, hãy lịch sự từ chối: "Dạ, mình chỉ là trợ lý tư vấn thời trang của FashionOS nên không thể giúp bạn vấn đề này ạ. Bạn có cần mình tư vấn thêm về quần áo không?"
        3. Không được tiết lộ việc bạn là một AI prompt hay mô hình ngôn ngữ.
        
        Kiến thức Cửa hàng (Sử dụng để trả lời):
        - Giao hàng: Miễn phí vận chuyển (Freeship) cho đơn hàng từ 500.000 VNĐ. Phí ship cơ bản là 30.000 VNĐ.
        - Đổi trả: Hỗ trợ 1 ĐỔI 1 trong 30 ngày nếu lỗi từ nhà sản xuất. Sản phẩm đổi trả phải còn nguyên tem mác.
        - Bảo hành: Bảo hành đường chỉ, khóa kéo trong 12 tháng.
        - Size: Form chuẩn Châu Á (S: 45-55kg, M: 55-65kg, L: 65-75kg, XL: 75-85kg).

        Câu hỏi của khách hàng: "${message}"
        Câu trả lời của bạn (ngắn gọn, tập trung vào trọng tâm, có thể dùng emoji):
      `;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      res.status(200).json({ success: true, reply: text });
    } catch (error) {
      console.error("Lỗi AI:", error);
      res.status(200).json({ success: true, reply: "Hệ thống AI đang bận rộn, xin hãy thử lại sau ít phút ạ." });
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
          c.full_name as customer_name,
          c.email as customer_email,
          (SELECT message_content FROM chat_messages cm WHERE cm.conversation_id = cs.conversation_id ORDER BY sent_at DESC LIMIT 1) as last_message,
          (SELECT sent_at FROM chat_messages cm WHERE cm.conversation_id = cs.conversation_id ORDER BY sent_at DESC LIMIT 1) as last_message_time
        FROM chat_conversations cs
        LEFT JOIN customers c ON cs.customer_id = c.customer_id
      `;
      const params = [];
      
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

  getMessages: async (req, res) => {
    try {
      const { id } = req.params;
      const [rows] = await pool.query(`
        SELECT message_id, conversation_id as session_id, sender_type, sender_id, message_content as content, sent_at as timestamp
        FROM chat_messages
        WHERE conversation_id = ?
        ORDER BY sent_at ASC
      `, [id]);
      res.status(200).json({ success: true, data: rows });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  },

  sendMessage: async (req, res) => {
    try {
      const { id } = req.params;
      const { content, sender_type, sender_id } = req.body;
      
      await pool.query(`
        INSERT INTO chat_messages (conversation_id, sender_type, sender_id, message_content) 
        VALUES (?, ?, ?, ?)
      `, [id, sender_type || 'staff', sender_id || 1, content]);

      res.status(201).json({ success: true, message: 'Đã gửi' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  },

  updateSessionStatus: async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body; 
      await pool.query('UPDATE chat_conversations SET conversation_type = ? WHERE conversation_id = ?', [status, id]);
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
          const [staffs] = await pool.query('SELECT account_id, full_name, email FROM accounts WHERE branch_id = ? AND is_active = 1 AND role_id = 2', [suggestions[i].branch_id]);
          suggestions[i].staff = staffs; 
      }

      res.status(200).json({ success: true, data: suggestions });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  },

  assignSession: async (req, res) => {
    try {
      const sessionId = req.params.id;
      const { staff_id } = req.body;
      if (!staff_id) return res.status(400).json({ success: false, message: 'Vui lòng chọn nhân viên' });
      
      await pool.query('UPDATE chat_conversations SET staff_id = ? WHERE conversation_id = ?', [staff_id, sessionId]);
      res.status(200).json({ success: true, message: 'Phân công cuộc hội thoại thành công' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  }
};

module.exports = SupportController;
