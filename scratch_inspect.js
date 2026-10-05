require('dotenv').config();
const pool = require('./src/config/database');
(async () => {
  try {
    const [trg] = await pool.query("SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()");
    console.log('TRIGGERS', trg);
    for (const t of ['orders', 'payments', 'notifications', 'order_status_history', 'promotions', 'customers', 'inventory', 'branches', 'accounts']) {
      const [cols] = await pool.query(`SHOW COLUMNS FROM ${t}`);
      console.log(t, cols.map(c => `${c.Field}:${c.Type}${c.Null === 'YES' ? '?' : ''}`).join(', '));
    }
    const [n] = await pool.query('SELECT notification_id, customer_id, account_id, notif_type, LEFT(content,60) c FROM notifications ORDER BY notification_id DESC LIMIT 5');
    console.log(n);
    const [acc] = await pool.query('SELECT a.account_id, a.username, a.branch_id, r.role_name FROM accounts a JOIN roles r ON a.role_id=r.role_id');
    console.log(acc);
    const [o] = await pool.query('SELECT o.order_id, o.order_code, o.channel, o.order_status, o.customer_id, o.branch_id, p.payment_method, p.payment_status FROM orders o LEFT JOIN payments p ON p.order_id=o.order_id ORDER BY o.order_id DESC LIMIT 8');
    console.log(o);
  } catch (e) { console.error(e.message); }
  process.exit(0);
})();
