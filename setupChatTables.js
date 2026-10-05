const pool = require('./src/config/database');

async function createTables() {
  try {
    console.log('Creating chat_sessions...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
          session_id INT AUTO_INCREMENT PRIMARY KEY,
          customer_id INT NULL,
          status ENUM('open', 'closed') DEFAULT 'open',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE SET NULL
      ) ENGINE=InnoDB;
    `);

    console.log('Creating chat_messages...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
          message_id INT AUTO_INCREMENT PRIMARY KEY,
          session_id INT NOT NULL,
          sender_type ENUM('customer', 'staff', 'bot') NOT NULL,
          sender_id INT NULL,
          content TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (session_id) REFERENCES chat_sessions(session_id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    // Insert dummy data
    console.log('Inserting dummy chat session...');
    const [sessResult] = await pool.query(`
        INSERT INTO chat_sessions (customer_id) VALUES (1);
    `);
    const sessionId = sessResult.insertId;

    await pool.query(`
        INSERT INTO chat_messages (session_id, sender_type, sender_id, content) VALUES
        (?, 'customer', 1, 'Cho mình hỏi về đơn hàng gần đây.'),
        (?, 'staff', 1, 'Dạ vâng, FashionOS có thể giúp gì cho bạn?');
    `, [sessionId, sessionId]);

    console.log('Done creating tables and dummy data.');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

createTables();
