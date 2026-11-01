const pool = require('../config/database');
exports.get = async(req,res,next)=>{
 if(!req.user.branch_id)return res.status(403).json({success:false,message:'Tài khoản chưa được phân công chi nhánh'});
 let connection;
 try{
  connection=await pool.getConnection();await connection.beginTransaction();
  const [[branch]]=await connection.query('SELECT branch_name FROM branches WHERE branch_id=?',[req.user.branch_id]);
  const [rows]=await connection.query(`SELECT 'mine' scope,order_status,COUNT(*) count,SUM(channel='online') online,SUM(channel='pos') pos FROM orders WHERE branch_id=? AND staff_id=? GROUP BY order_status UNION ALL SELECT 'branch' scope,order_status,COUNT(*) count,SUM(channel='online') online,SUM(channel='pos') pos FROM orders WHERE branch_id=? GROUP BY order_status`,[req.user.branch_id,req.user.id,req.user.branch_id]);
  const empty=()=>({total:0,online:0,pos:0,pending:0,confirmed:0,processing:0,shipping:0,completed:0,cancelled:0,returned:0});
  const result={mine:empty(),branch:empty(),branch_name:branch?.branch_name||'',period:'all'};
  for(const row of rows){const group=result[row.scope];group[row.order_status]=Number(row.count);group.total+=Number(row.count);group.online+=Number(row.online);group.pos+=Number(row.pos);}
  const [[actions]]=await connection.query("SELECT COUNT(DISTINCT CASE WHEN h.status IN ('confirmed','processing','shipping','completed') THEN h.order_id END) handled,COUNT(DISTINCT CASE WHEN h.status='completed' THEN h.order_id END) completed FROM order_status_history h JOIN orders o ON o.order_id=h.order_id WHERE o.branch_id=? AND h.changed_by=?",[req.user.branch_id,req.user.id]);
  result.mine.handled_by_me=Number(actions.handled);
  result.mine.completed_by_me=Number(actions.completed);
  await connection.commit();res.json({success:true,data:result});
 }catch(error){if(connection)await connection.rollback();next(error);}finally{connection?.release();}
};
