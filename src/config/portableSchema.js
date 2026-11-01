const mysql = require('mysql2/promise');
const crypto = require('node:crypto');
const pool = require('./database');
const { loadDefinition, quoteId } = require('./schemaDefinition');
const normalize = value => String(value).replace(/[\s`()]/g, '').toLowerCase();

async function acquireSchemaConnection() {
    try { return await pool.getConnection(); }
    catch (error) {
        if (error.code !== 'ER_BAD_DB_ERROR') throw error;
        const name = process.env.DB_NAME;
        if (!name || !/^[A-Za-z0-9_]{1,64}$/.test(name)) throw new Error('DB_NAME must contain 1-64 letters, digits or underscores');
        const bootstrap = await mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASS });
        try { await bootstrap.query(`CREATE DATABASE IF NOT EXISTS ${quoteId(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); }
        finally { await bootstrap.end(); }
        return pool.getConnection();
    }
}

// Return the held advisory lock so legacy data migrations also execute under the same lock.
async function ensurePortableSchema() {
    const connection = await acquireSchemaConnection();
    let lockName, locked = false;
    const summary = { tables: [], columns: [], indexes: [], foreignKeys: [], checks: [], triggers: [], views: [] };
    try {
        const [[database]] = await connection.query('SELECT DATABASE() AS name');
        lockName = 'fashion_schema_' + crypto.createHash('sha256').update(database.name).digest('hex').slice(0, 32);
        const [[lock]] = await connection.query('SELECT GET_LOCK(?, 60) AS acquired', [lockName]);
        if (Number(lock.acquired) !== 1) throw new Error('Một tiến trình khác đang cập nhật schema. Vui lòng thử khởi động lại sau.');
        locked = true;
        const definition = loadDefinition();
        const [existingTables] = await connection.query('SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
        const tableNames = new Map(existingTables.map(row => [row.name, row.type]));
        for (const table of definition.tables) {
            if (tableNames.has(table.name) && tableNames.get(table.name) !== 'BASE TABLE') throw new Error(`${table.name} is not a base table; manual migration required`);
            if (!tableNames.has(table.name)) {
                // Foreign keys are installed later: all referenced tables and columns must exist first.
                await connection.query(table.create);
                summary.tables.push(table.name);
            }
        }
        for (const table of definition.tables) {
            const [existing] = await connection.query('SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [table.name]);
            const columns = new Set(existing.map(row => row.name));
            for (const column of table.columns) {
                if (columns.has(column.name)) continue;
                if (!column.safeOnPopulated) {
                    const [rows] = await connection.query(`SELECT 1 FROM ${quoteId(table.name)} LIMIT 1`);
                    if (rows.length) throw new Error(`Không tự thêm ${table.name}.${column.name}: cột bắt buộc không có giá trị mặc định nhưng bảng đã có dữ liệu. Cần bổ sung dữ liệu đúng nghiệp vụ trước.`);
                }
                await connection.query(`ALTER TABLE ${quoteId(table.name)} ADD COLUMN ${column.definition}`);
                summary.columns.push(`${table.name}.${column.name}`);
            }
        }
        // Essential identity roles only. Never insert sample branches, users, products or orders.
        const [roles] = await connection.query('SELECT role_id, role_name FROM roles');
        for (const [id, name] of [[1, 'Admin'], [2, 'Staff']]) {
            if (!roles.some(role => role.role_id === id || role.role_name === name)) await connection.query('INSERT INTO roles (role_id, role_name) VALUES (?, ?)', [id, name]);
        }
        for (const table of definition.tables) {
            const [indexRows] = await connection.query('SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, INDEX_TYPE AS type, COLUMN_NAME AS col FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX', [table.name]);
            const indexes = new Map();
            for (const row of indexRows) {
                if (!indexes.has(row.name)) indexes.set(row.name, { columns: [], unique: !Number(row.nonUnique), type: row.type });
                indexes.get(row.name).columns.push(row.col);
            }
            for (const index of table.indexes) {
                if ([...indexes.values()].some(existing => existing.unique === index.unique && existing.type === (index.type || 'BTREE') && existing.columns.join(',') === index.columns.join(','))) continue;
                if (indexes.has(index.name)) throw new Error(`Index ${table.name}.${index.name} khác cấu trúc chuẩn; cần xử lý thủ công, không ghi đè index cũ`);
                await connection.query(`ALTER TABLE ${quoteId(table.name)} ADD ${index.definition}`);
                indexes.set(index.name, index);
                summary.indexes.push(`${table.name}.${index.name}`);
            }
            const [fkRows] = await connection.query('SELECT CONSTRAINT_NAME AS name, COLUMN_NAME AS col, REFERENCED_TABLE_NAME AS refTable, REFERENCED_COLUMN_NAME AS refCol FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION', [table.name]);
            const fks = new Map();
            for (const row of fkRows) {
                if (!fks.has(row.name)) fks.set(row.name, { columns: [], refColumns: [], refTable: row.refTable });
                fks.get(row.name).columns.push(row.col); fks.get(row.name).refColumns.push(row.refCol);
            }
            for (const fk of table.foreignKeys) {
                if ([...fks.values()].some(existing => existing.refTable === fk.refTable && existing.columns.join(',') === fk.columns.join(',') && existing.refColumns.join(',') === fk.refColumns.join(','))) continue;
                await connection.query(`ALTER TABLE ${quoteId(table.name)} ADD ${fk.definition}`);
                summary.foreignKeys.push(`${table.name}.${fk.name}`);
            }
            if (table.checks.length) {
                const [checks] = await connection.query(`SELECT cc.CHECK_CLAUSE AS expression FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME WHERE tc.TABLE_SCHEMA = DATABASE() AND tc.TABLE_NAME = ? AND tc.CONSTRAINT_TYPE = 'CHECK'`, [table.name]);
                for (const check of table.checks) {
                    if (checks.some(existing => normalize(existing.expression) === normalize(check.expression))) continue;
                    await connection.query(`ALTER TABLE ${quoteId(table.name)} ADD ${check.definition}`);
                    summary.checks.push(`${table.name}.${check.name}`);
                }
            }
        }
        const [triggers] = await connection.query('SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()');
        for (const trigger of definition.triggers) {
            if (triggers.some(existing => existing.name === trigger.name)) continue;
            await connection.query(trigger.sql); summary.triggers.push(trigger.name);
        }
        for (const view of definition.views) {
            if (tableNames.has(view.name)) continue;
            await connection.query(view.sql); summary.views.push(view.name);
        }
        return { summary, release: async () => {
            try { await connection.query('SELECT RELEASE_LOCK(?)', [lockName]); } finally { connection.release(); }
        } };
    } catch (error) {
        try { if (locked) await connection.query('SELECT RELEASE_LOCK(?)', [lockName]); } finally { connection.release(); }
        throw error;
    }
}
module.exports = { ensurePortableSchema };
