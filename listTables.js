require('dotenv').config();
const mysql = require('mysql2/promise');

async function listTables() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });

  try {
    const [rows] = await pool.query('SHOW TABLES');
    console.log(rows);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

listTables();
