const pool = require('../config/database');
const NET_REVENUE = `GREATEST(0, o.total_amount - COALESCE((SELECT SUM(r.amount) FROM payment_refunds r JOIN payments rp ON rp.payment_id = r.payment_id WHERE rp.order_id = o.order_id AND r.status = 'completed'), 0))`;
const NET_QUANTITY = `GREATEST(0, oi.quantity - COALESCE((SELECT SUM(ri.quantity) FROM order_return_items ri JOIN order_returns ret ON ret.return_id = ri.return_id WHERE ri.order_item_id = oi.order_item_id AND ret.status = 'completed' AND ret.return_type = 'return'),0))`;
const NET_LINE_REVENUE = `(${NET_QUANTITY}) * oi.unit_price * GREATEST(0, o.subtotal_amount - o.discount_amount - COALESCE(o.loyalty_discount,0)) / NULLIF(o.subtotal_amount,0)`;

const StatsController = {
  getKPIs: async (req, res) => {
    try {
      const [revResult] = await pool.query(`
        SELECT SUM(${NET_REVENUE}) as totalRevenue 
        FROM orders o 
        WHERE order_status IN ('completed', 'shipping', 'returned')
      `);
      
      const [orderResult] = await pool.query(`
        SELECT COUNT(*) as totalOrders 
        FROM orders o
      `);

      const [customerResult] = await pool.query(`
        SELECT COUNT(*) as totalCustomers 
        FROM customers
      `);

      const [returnResult] = await pool.query(`
        SELECT 
          (SELECT COUNT(*) FROM orders WHERE order_status IN ('returned', 'cancelled')) * 100.0 / 
          (SELECT COUNT(*) FROM orders) as returnRate
      `);

      res.status(200).json({
        success: true,
        data: {
          revenue: Number(revResult[0].totalRevenue) || 0,
          orders: Number(orderResult[0].totalOrders) || 0,
          customers: Number(customerResult[0].totalCustomers) || 0,
          returnRate: Number(returnResult[0].returnRate) || 0
        }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  },

  getRevenueChart: async (req, res) => {
    try {
      const { mode } = req.query; // 'week' or 'month'
      let data = [];

      if (mode === 'week') {
        // Lấy 7 ngày gần nhất
        const [rows] = await pool.query(`
          SELECT DATE(created_at) as date, SUM(${NET_REVENUE}) as revenue, COUNT(order_id) as orders
          FROM orders o
          WHERE order_status IN ('completed', 'shipping', 'returned') 
            AND created_at >= DATE(NOW()) - INTERVAL 6 DAY
          GROUP BY DATE(created_at)
          ORDER BY date ASC
        `);
        // Fill missing days
        const last7Days = Array.from({length: 7}, (_, i) => {
          const d = new Date();
          d.setDate(d.getDate() - (6 - i));
          return d.toISOString().split('T')[0];
        });
        
        data = last7Days.map(dateStr => {
          const found = rows.find(r => {
             const rd = new Date(r.date);
             rd.setMinutes(rd.getMinutes() - rd.getTimezoneOffset());
             return rd.toISOString().split('T')[0] === dateStr;
          });
          const dObj = new Date(dateStr);
          return {
            day: `T${dObj.getDay() + 1}`, // T2, T3... (CN là T1, fix lại)
            revenue: found ? Number(found.revenue) : 0,
            orders: found ? Number(found.orders) : 0
          };
        });
        // Fix Sunday = CN
        data.forEach(d => { if (d.day === 'T1') d.day = 'CN'; });

      } else {
        // Lấy 12 tháng gần nhất
        const [rows] = await pool.query(`
          SELECT DATE_FORMAT(created_at, '%Y-%m') as month, SUM(${NET_REVENUE}) as revenue, COUNT(order_id) as orders
          FROM orders o
          WHERE order_status IN ('completed', 'shipping', 'returned')
            AND created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
          GROUP BY month
          ORDER BY month ASC
        `);
        // Fill missing months
        const last12Months = Array.from({length: 12}, (_, i) => {
          const d = new Date();
          d.setDate(1);
          d.setMonth(d.getMonth() - (11 - i));
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        });

        data = last12Months.map(monthStr => {
          const found = rows.find(r => r.month === monthStr);
          const [yyyy, mm] = monthStr.split('-');
          return {
            month: `T${parseInt(mm)}`,
            revenue: found ? Number(found.revenue) : 0,
            orders: found ? Number(found.orders) : 0
          };
        });
      }

      res.status(200).json({ success: true, data });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  },

  getTopProducts: async (req, res) => {
    try {
      const channel = ['online','pos'].includes(req.query.channel) ? req.query.channel : null;
      const [rows] = await pool.query(`
        SELECT 
          p.product_id as id,
          p.product_name as name,
          (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.product_id ORDER BY pi.is_primary DESC, pi.image_id LIMIT 1) as image,
          SUM(${NET_QUANTITY}) as sold,
          SUM(${NET_LINE_REVENUE}) as revenue
        FROM order_items oi
        JOIN product_variants pv ON oi.variant_id = pv.variant_id
        JOIN products p ON pv.product_id = p.product_id
        JOIN orders o ON oi.order_id = o.order_id
        WHERE o.order_status IN ('completed', 'shipping', 'returned')
          AND (? IS NULL OR o.channel = ?)
        GROUP BY p.product_id
        ORDER BY sold DESC
        LIMIT 5
      `, [channel, channel]);

      res.status(200).json({ success: true, data: rows });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  },

  getCategoryStats: async (req, res) => {
    try {
      const [rows] = await pool.query(`
        SELECT 
          c.category_name as name,
          SUM(${NET_LINE_REVENUE}) as revenue
        FROM order_items oi
        JOIN product_variants pv ON oi.variant_id = pv.variant_id
        JOIN products p ON pv.product_id = p.product_id
        JOIN categories c ON p.category_id = c.category_id
        JOIN orders o ON oi.order_id = o.order_id
        WHERE o.order_status IN ('completed', 'shipping', 'returned')
        GROUP BY c.category_id
        ORDER BY revenue DESC
        LIMIT 6
      `);
      res.status(200).json({ success: true, data: rows });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  },

  getPaymentStats: async (req, res) => {
    try {
      const [rows] = await pool.query(`
        SELECT 
          payment_method as name,
          COUNT(payment_id) as count
        FROM payments
        WHERE payment_status = 'success'
        GROUP BY payment_method
        ORDER BY count DESC
      `);
      
      const formatName = (method) => {
        if (method === 'vnpay') return 'VNPay';
        if (method === 'momo') return 'MoMo';
        if (method === 'cash') return 'Tiền mặt';
        if (method === 'stripe') return 'Stripe';
        if (method === 'bank_transfer') return 'Chuyển khoản';
        return method;
      };

      const data = rows.map(r => ({
        name: formatName(r.name),
        count: r.count
      }));

      res.status(200).json({ success: true, data });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  },

  getChannelStats: async (req, res) => {
    try {
      const [rows] = await pool.query(`
        SELECT 
          channel as name,
          COUNT(order_id) as orders,
          SUM(${NET_REVENUE}) as revenue
        FROM orders o
        WHERE order_status IN ('completed', 'shipping', 'returned')
        GROUP BY channel
      `);
      
      const formatChannelName = (channel) => {
        if (channel === 'online') return 'Online';
        if (channel === 'pos') return 'Tại quầy (POS)';
        return channel;
      };

      const data = rows.map(r => ({
        name: formatChannelName(r.name),
        orders: r.orders,
        revenue: r.revenue
      }));

      res.status(200).json({ success: true, data });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  },

  getStaffDailyStats: async (req, res) => {
    try {
      const staffId = req.user.id;
      const [rows] = await pool.query(`
        SELECT 
          COUNT(DISTINCT o.order_id) as totalOrders,
          SUM(CASE WHEN p.payment_method = 'cash' THEN GREATEST(0, p.amount - COALESCE((SELECT SUM(r.amount) FROM payment_refunds r WHERE r.payment_id = p.payment_id AND r.status = 'completed'),0)) ELSE 0 END) as totalCash,
          SUM(CASE WHEN p.payment_method != 'cash' THEN GREATEST(0, p.amount - COALESCE((SELECT SUM(r.amount) FROM payment_refunds r WHERE r.payment_id = p.payment_id AND r.status = 'completed'),0)) ELSE 0 END) as totalTransfer
        FROM orders o
        JOIN payments p ON o.order_id = p.order_id
        WHERE o.staff_id = ? 
          AND o.channel = 'pos'
          AND DATE(o.created_at) = CURDATE()
          AND o.order_status != 'cancelled'
          AND p.payment_status IN ('success','refunded')
      `, [staffId]);

      res.status(200).json({
        success: true,
        data: {
          totalOrders: Number(rows[0].totalOrders) || 0,
          totalCash: Number(rows[0].totalCash) || 0,
          totalTransfer: Number(rows[0].totalTransfer) || 0
        }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  }
};

module.exports = StatsController;
