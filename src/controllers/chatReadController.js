const pool = require('../config/database');
const { getIO, ROOMS } = require('../config/socket');
exports.unread = async(req,res,next)=>{
 try{
  const args=[req.user.id];
  const scope=req.user.role==='staff'?' AND cs.staff_id=?':'';
  if(scope)args.push(req.user.id);
  const [[row]]=await pool.query(`SELECT COUNT(*) unread_count,COUNT(DISTINCT cs.conversation_id) conversations FROM chat_conversations cs JOIN chat_messages cm ON cm.conversation_id=cs.conversation_id LEFT JOIN chat_read_receipts rr ON rr.conversation_id=cs.conversation_id AND rr.account_id=? WHERE cm.sender_type='customer' AND cm.message_id>COALESCE(rr.last_read_message_id,0) ${scope}`,args);
  res.json({success:true,data:{unread_count:Number(row.unread_count),conversations:Number(row.conversations)}});
 }catch(error){next(error);}
};
exports.markRead=async(req,res,next)=>{
 const value=req.body.last_message_id;
 if(!['number','string'].includes(typeof value)||!/^[1-9]\d*$/.test(String(value))||!Number.isSafeInteger(Number(value)))return res.status(400).json({success:false,message:'Mã tin nhắn không hợp lệ'});
 let connection;
 try{
  connection=await pool.getConnection();await connection.beginTransaction();
  const [[session]]=await connection.query('SELECT staff_id FROM chat_conversations WHERE conversation_id=? FOR UPDATE',[req.params.id]);
  if(!session||(req.user.role==='staff'&&Number(session.staff_id)!==Number(req.user.id)))throw Object.assign(new Error('Không có quyền đọc hội thoại này'),{statusCode:403});
  const [[message]]=await connection.query('SELECT message_id FROM chat_messages WHERE conversation_id=? AND message_id=?',[req.params.id,value]);
  if(!message)throw Object.assign(new Error('Tin nhắn không thuộc hội thoại'),{statusCode:400});
  await connection.query('INSERT INTO chat_read_receipts (conversation_id,account_id,last_read_message_id) VALUES (?,?,?) ON DUPLICATE KEY UPDATE last_read_message_id=GREATEST(last_read_message_id,VALUES(last_read_message_id))',[req.params.id,req.user.id,value]);
  // Read only through the message actually displayed; a newer concurrent message stays unread.
  const [[row]]=await connection.query("SELECT COUNT(*) unread_count FROM chat_messages cm JOIN chat_read_receipts rr ON rr.conversation_id=cm.conversation_id AND rr.account_id=? WHERE cm.conversation_id=? AND cm.sender_type='customer' AND cm.message_id>rr.last_read_message_id",[req.user.id,req.params.id]);
  await connection.query("UPDATE notifications SET is_read=1 WHERE account_id=? AND target_url=? AND is_read=0 AND ((notif_type='CHAT_MESSAGE' AND related_message_id<=?) OR notif_type='CHAT_ASSIGNED')",[req.user.id,`/support?conversation=${req.params.id}`,value]);
  await connection.commit();
  getIO()?.to(ROOMS.account(req.user.id)).emit('chat_read',{conversation_id:req.params.id,unread_count:Number(row.unread_count)});
  res.json({success:true,data:{unread_count:Number(row.unread_count)}});
 }catch(error){if(connection)await connection.rollback();next(error);}finally{connection?.release();}
};
