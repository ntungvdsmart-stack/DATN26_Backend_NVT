const pool = require('../config/database');
exports.list = async (req,res,next) => {
 try {
  const page=Number(req.query.page||1), rating=req.query.rating, review=req.query.review;
  const search=typeof req.query.search==='string'?req.query.search.trim():'';
  if(!Number.isSafeInteger(page)||page<1||page>1000000||search.length>150||(rating&&(typeof rating!=='string'||!/^[1-5]$/.test(rating)))||(review&&(typeof review!=='string'||!/^[1-9]\d*$/.test(review)||!Number.isSafeInteger(Number(review))))) return res.status(400).json({success:false,message:'Bộ lọc đánh giá không hợp lệ'});
  const filters=[],params=[];
  if(req.user.role==='staff') {filters.push('o.staff_id=?');params.push(req.user.id);}
  if(rating){filters.push('r.rating=?');params.push(Number(rating));}
  if(review){filters.push('r.review_id=?');params.push(Number(review));}
  if(search){filters.push('(p.product_name LIKE ? OR c.full_name LIKE ? OR o.order_code LIKE ?)');const term=`%${search.replace(/[\\%_]/g,'\\$&')}%`;params.push(term,term,term);}
  const joins='FROM customer_reviews r JOIN product_variants v ON v.variant_id=r.variant_id JOIN products p ON p.product_id=v.product_id JOIN customers c ON c.customer_id=r.customer_id LEFT JOIN orders o ON o.order_id=r.order_id';
  const where=filters.length?' WHERE '+filters.join(' AND '):'';
  const [[stats]]=await pool.query(`SELECT COUNT(*) total,COALESCE(ROUND(AVG(r.rating),1),0) average ${joins}${where}`,params);
  const total=Number(stats.total),totalPages=Math.max(1,Math.ceil(total/20)),current=Math.min(page,totalPages);
  const [items]=await pool.query(`SELECT r.review_id,r.rating,r.comment,r.created_at,p.product_name,c.full_name customer_name,o.order_code,s.size_value,col.color_name ${joins} LEFT JOIN sizes s ON s.size_id=v.size_id LEFT JOIN colors col ON col.color_id=v.color_id ${where} ORDER BY r.created_at DESC,r.review_id DESC LIMIT 20 OFFSET ?`,[...params,(current-1)*20]);
  res.json({success:true,data:{items,stats:{total,average:Number(stats.average)},pagination:{page:current,total,totalPages,limit:20}}});
 }catch(error){next(error);}
};
