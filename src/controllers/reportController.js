const pool = require('../config/database');
const net = `GREATEST(0,o.total_amount-COALESCE(pay.refunded,0))`;
const recognized = `CASE WHEN o.order_status IN ('shipping','completed','returned') THEN ${net} ELSE 0 END`;
const paid = `COALESCE(pay.collected,0)`;
const paymentJoin = `LEFT JOIN (
 SELECT p.order_id,SUM(CASE WHEN p.payment_status IN ('success','refunded') THEN GREATEST(0,p.amount-COALESCE(r.amount,0)) ELSE 0 END) collected,SUM(COALESCE(r.amount,0)) refunded
 FROM payments p LEFT JOIN (SELECT payment_id,SUM(amount) amount FROM payment_refunds WHERE status='completed' GROUP BY payment_id) r ON r.payment_id=p.payment_id GROUP BY p.order_id
) pay ON pay.order_id=o.order_id`;
const qty = `GREATEST(0,oi.quantity-COALESCE((SELECT SUM(ri.quantity) FROM order_return_items ri JOIN order_returns rt ON rt.return_id=ri.return_id WHERE ri.order_item_id=oi.order_item_id AND rt.status='completed' AND rt.return_type='return'),0))`;
const lineNet = `${qty}*oi.unit_price*GREATEST(0,o.subtotal_amount-o.discount_amount-COALESCE(o.loyalty_discount,0))/NULLIF(o.subtotal_amount,0)`;
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
const numericRows = rows => rows.map(row => Object.fromEntries(Object.entries(row).map(([key,value]) => [key, ['orders','revenue','collected','sold','amount','count','orderValue','cancelled','completed','processing','shipping','customers','refunded'].includes(key) ? Number(value || 0) : value])));

exports.getReport = async (req, res, next) => {
 let connection;
 try {
  const { start, end, channel, branch_id } = req.query;
  if ((start && !validDate(start)) || (end && !validDate(end)) || Boolean(start) !== Boolean(end) || (start && (start > end || (Date.parse(end)-Date.parse(start))/86400000 > 3660))) return res.status(400).json({ success:false,message:'Khoảng ngày không hợp lệ, tối đa 10 năm' });
  if (channel && !['online','pos'].includes(channel)) return res.status(400).json({success:false,message:'Kênh bán không hợp lệ'});
  if (branch_id && (typeof branch_id !== 'string' || !/^[1-9]\d*$/.test(branch_id) || !Number.isSafeInteger(Number(branch_id)))) return res.status(400).json({success:false,message:'Chi nhánh không hợp lệ'});
  const clauses=[], args=[];
  if (start) { clauses.push('o.created_at >= ? AND o.created_at < DATE_ADD(?,INTERVAL 1 DAY)'); args.push(start,end); }
  if (channel) { clauses.push('o.channel=?'); args.push(channel); }
  if (branch_id) { clauses.push('o.branch_id=?'); args.push(branch_id); }
  const where=clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const soldWhere=where ? `${where} AND o.order_status IN ('shipping','completed','returned')` : "WHERE o.order_status IN ('shipping','completed','returned')";
  connection=await pool.getConnection();
  await connection.beginTransaction();
  const [[bounds]]=await connection.query(`SELECT DATE_FORMAT(MIN(o.created_at),'%Y-%m-%d') firstDate,DATE_FORMAT(MAX(o.created_at),'%Y-%m-%d') lastDate FROM orders o ${where}`,args);
  const from=start||bounds.firstDate, to=end||bounds.lastDate;
  const monthly=from&&to&&(Date.parse(to)-Date.parse(from))/86400000>90;
  const format=monthly?'%Y-%m':'%Y-%m-%d';
  const [summary]=await connection.query(`SELECT COUNT(*) orders,COALESCE(SUM(${recognized}),0) revenue,COALESCE(SUM(${paid}),0) collected,COALESCE(SUM(CASE WHEN o.order_status!='cancelled' THEN o.total_amount ELSE 0 END),0) orderValue,COUNT(DISTINCT o.customer_id) customers,COALESCE(SUM(o.order_status='cancelled'),0) cancelled,COALESCE(SUM(o.order_status='completed'),0) completed,COALESCE(SUM(o.order_status IN ('pending','confirmed','processing')),0) processing,COALESCE(SUM(o.order_status='shipping'),0) shipping,COALESCE(SUM(pay.refunded),0) refunded FROM orders o ${paymentJoin} ${where}`,args);
  const [seriesRows]=await connection.query(`SELECT DATE_FORMAT(o.created_at,'${format}') period,COUNT(*) orders,COUNT(DISTINCT o.customer_id) customers,SUM(${recognized}) revenue,SUM(${paid}) collected FROM orders o ${paymentJoin} ${where} GROUP BY period ORDER BY period`,args);
  const seriesMap=new Map(numericRows(seriesRows).map(row=>[row.period,row]));
  const series=[];
  if(from&&to) {
   const cursor=new Date(`${monthly?from.slice(0,7)+'-01':from}T00:00:00Z`);
   while(cursor.toISOString().slice(0,10)<=to){const period=cursor.toISOString().slice(0,monthly?7:10);series.push(seriesMap.get(period)||{period,orders:0,customers:0,revenue:0,collected:0});if(monthly)cursor.setUTCMonth(cursor.getUTCMonth()+1);else cursor.setUTCDate(cursor.getUTCDate()+1);}
  }
  const [statuses]=await connection.query(`SELECT o.order_status status,COUNT(*) count FROM orders o ${where} GROUP BY o.order_status ORDER BY count DESC`,args);
  const [channels]=await connection.query(`SELECT o.channel channel,COUNT(*) orders,SUM(${recognized}) revenue,SUM(${paid}) collected FROM orders o ${paymentJoin} ${where} GROUP BY o.channel`,args);
  const [branchStats]=await connection.query(`SELECT o.branch_id,COALESCE(b.branch_name,'Chưa phân chi nhánh') name,COUNT(*) orders,SUM(${recognized}) revenue,SUM(${paid}) collected FROM orders o LEFT JOIN branches b ON b.branch_id=o.branch_id ${paymentJoin} ${where} GROUP BY o.branch_id,b.branch_name ORDER BY revenue DESC,collected DESC`,args);
  const [products]=await connection.query(`SELECT p.product_id id,p.product_name name,(SELECT image_url FROM product_images WHERE product_id=p.product_id ORDER BY is_primary DESC,image_id LIMIT 1) image,SUM(${qty}) sold,SUM(${lineNet}) revenue FROM orders o JOIN order_items oi ON oi.order_id=o.order_id JOIN product_variants v ON v.variant_id=oi.variant_id JOIN products p ON p.product_id=v.product_id ${soldWhere} GROUP BY p.product_id HAVING sold>0 ORDER BY sold DESC,p.product_id LIMIT 10`,args);
  const [categories]=await connection.query(`SELECT COALESCE(c.category_name,'Chưa phân loại') name,SUM(${lineNet}) revenue FROM orders o JOIN order_items oi ON oi.order_id=o.order_id JOIN product_variants v ON v.variant_id=oi.variant_id JOIN products p ON p.product_id=v.product_id LEFT JOIN categories c ON c.category_id=p.category_id ${soldWhere} GROUP BY c.category_id,c.category_name HAVING revenue>0 ORDER BY revenue DESC LIMIT 10`,args);
  const [payments]=await connection.query(`SELECT p.payment_method method,COUNT(*) count,SUM(GREATEST(0,p.amount-COALESCE(r.amount,0))) amount FROM payments p JOIN orders o ON o.order_id=p.order_id LEFT JOIN (SELECT payment_id,SUM(amount) amount FROM payment_refunds WHERE status='completed' GROUP BY payment_id) r ON r.payment_id=p.payment_id ${where?where+' AND':'WHERE'} p.payment_status IN ('success','refunded') GROUP BY p.payment_method ORDER BY amount DESC`,args);
  const [branches]=await connection.query('SELECT branch_id,branch_name FROM branches ORDER BY branch_name');
  await connection.commit();
  res.json({success:true,data:{summary:numericRows(summary)[0],series,statuses:numericRows(statuses),channels:numericRows(channels),branchStats:numericRows(branchStats),products:numericRows(products),categories:numericRows(categories),payments:numericRows(payments),branches,meta:{start:from,end:to,group:monthly?'month':'day',generated_at:new Date().toISOString(),channel:channel||null,branch_id:branch_id?Number(branch_id):null}}});
 }catch(error){if(connection)await connection.rollback();next(error);}finally{connection?.release();}
};
