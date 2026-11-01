const mysql = require('mysql2/promise');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

async function createFixture() {
    const options = { host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASS, connectionLimit: 3 };
    const source = await mysql.createConnection({ ...options, database: process.env.DB_NAME });
    const name = `fashion_test_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    let ownsDatabase = false;
    let db;
    try {
        await source.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        ownsDatabase = true;
        db = mysql.createPool({ ...options, database: name });
        const setup = await db.getConnection();
        try {
            await setup.query('SET FOREIGN_KEY_CHECKS = 0');
            const [tables] = await source.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'");
            for (const table of tables) {
                const [[ddl]] = await source.query(`SHOW CREATE TABLE \`${table.name.replace(/`/g, '``')}\``);
                await setup.query(ddl['Create Table']);
            }
            await setup.query('SET FOREIGN_KEY_CHECKS = 1');
        } finally { setup.release(); }
        const password = 'FixturePass123!';
        const hash = await bcrypt.hash(password, 4);
        await db.query("INSERT INTO roles (role_id,role_name) VALUES (1,'Admin'),(2,'NV_Online'),(3,'NV_POS'),(4,'NV_Kho')");
        await db.query("INSERT INTO branches (branch_id,branch_name,address,is_active) VALUES (1,'Test branch 1','Test address',1),(2,'Test branch 2','Other address',1)");
        for (const role of [1,2,3,4]) await db.query('INSERT INTO accounts (account_id,username,password_hash,full_name,email,role_id,branch_id) VALUES (?, ?, ?, ?, ?, ?, ?)', [role, `fixture${role}`, hash, `Fixture role ${role}`, `role${role}@example.invalid`, role, role === 1 ? null : 1]);
        for (const id of [1,2]) await db.query("INSERT INTO customers (customer_id,full_name,email,phone,password_hash,customer_type) VALUES (?, ?, ?, ?, ?, 'online')", [id, `Fixture customer ${id}`, `customer${id}@example.invalid`, `090000000${id}`, hash]);
        await db.query("INSERT INTO categories (category_id,category_name) VALUES (1,'Test category')");
        await db.query("INSERT INTO brands (brand_id,brand_name) VALUES (1,'Test brand')");
        await db.query("INSERT INTO sizes (size_id,size_value) VALUES (1,'S'),(2,'M')");
        await db.query("INSERT INTO colors (color_id,color_name) VALUES (1,'Black')");
        await db.query("INSERT INTO products (product_id,product_name,category_id,brand_id,base_price) VALUES (1,'Fixture shirt',1,1,100000)");
        await db.query("INSERT INTO product_variants (variant_id,product_id,sku,size_id,color_id,price) VALUES (1,1,'FIXTURE-S',1,1,100000),(2,1,'FIXTURE-M',2,1,100000)");
        await db.query('INSERT INTO inventory (inventory_id,variant_id,branch_id,quantity) VALUES (1,1,1,30),(2,2,1,30),(3,1,2,5),(4,2,2,5)');
        return {
            name, db, password,
            cleanup: async () => {
                await db.end();
                if (!ownsDatabase || !/^fashion_test_\d+_[a-f0-9]{8}$/.test(name) || name === process.env.DB_NAME) throw new Error('Refusing unsafe test database cleanup');
                await source.query(`DROP DATABASE \`${name}\``);
                await source.end();
            }
        };
    } catch (error) {
        if (db) await db.end();
        if (ownsDatabase && /^fashion_test_\d+_[a-f0-9]{8}$/.test(name)) await source.query(`DROP DATABASE \`${name}\``);
        await source.end();
        throw error;
    }
}
module.exports = { createFixture };
