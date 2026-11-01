const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const quoteId = value => '`' + String(value).replace(/`/g, '``') + '`';
const constraintName = value => value.length <= 64 ? value : value.slice(0, 47) + '_' + crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);

// Split table definitions only at top-level commas; ENUM/DECIMAL/comments may contain commas.
function splitDefinitions(body) {
    const parts = [];
    let start = 0, depth = 0, quote = null;
    for (let i = 0; i < body.length; i++) {
        const char = body[i];
        if (quote) {
            if (char === '\\') i++;
            else if (char === quote && body[i + 1] === quote) i++;
            else if (char === quote) quote = null;
        } else if (["'", '"', '`'].includes(char)) quote = char;
        else if (char === '(') depth++;
        else if (char === ')') depth--;
        else if (char === ',' && depth === 0) { parts.push(body.slice(start, i).trim()); start = i + 1; }
    }
    parts.push(body.slice(start).trim());
    return parts.filter(Boolean);
}
const columnsIn = value => value.split(',').map(column => column.trim().replace(/`/g, ''));
function loadDefinition() {
    const sql = fs.readFileSync(path.join(__dirname, '../../sql/schema.source.sql'), 'utf8')
        .replace(/^\s*--.*$/gm, '').replace(/;\s*--[^\n]*/g, ';');
    const tables = [];
    for (const match of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)\s*\(([\s\S]*?)\)\s*ENGINE=InnoDB\s*;/gi)) {
        const table = { name: match[1], columns: [], indexes: [], foreignKeys: [], checks: [], createParts: [] };
        for (const definition of splitDefinitions(match[2])) {
            let part = definition;
            if (/^FOREIGN KEY/i.test(part)) {
                const fk = part.match(/^FOREIGN KEY\s*\(([^)]+)\)\s+REFERENCES\s+(\w+)\s*\(([^)]+)\)/i);
                if (!fk) throw new Error(`Cannot parse foreign key: ${table.name}`);
                const columns = columnsIn(fk[1]), refColumns = columnsIn(fk[3]);
                const name = constraintName(`fk_${table.name}_${columns.join('_')}`);
                table.foreignKeys.push({ name, columns, refTable: fk[2], refColumns, definition: `CONSTRAINT ${quoteId(name)} ${part}` });
            } else if (/^CHECK\s*\(/i.test(part)) {
                const name = constraintName(`chk_${table.name}_${table.checks.length + 1}`);
                table.checks.push({ name, expression: part.slice(part.indexOf('(')), definition: `CONSTRAINT ${quoteId(name)} ${part}` });
            } else if (/^(?:UNIQUE\s+(?:KEY|INDEX)|FULLTEXT\s+(?:KEY|INDEX)|SPATIAL\s+(?:KEY|INDEX)|INDEX|KEY|PRIMARY KEY)\b/i.test(part)) {
                const index = part.match(/^(UNIQUE\s+(?:KEY|INDEX)|FULLTEXT\s+(?:KEY|INDEX)|SPATIAL\s+(?:KEY|INDEX)|INDEX|KEY|PRIMARY KEY)\s*(\w+)?\s*\(([^)]+)\)/i);
                if (!index) throw new Error(`Cannot parse index: ${table.name}`);
                table.indexes.push({ name: /^PRIMARY/i.test(index[1]) ? 'PRIMARY' : index[2], columns: columnsIn(index[3]), unique: /UNIQUE|PRIMARY/i.test(index[1]), type: /^FULLTEXT/i.test(index[1]) ? 'FULLTEXT' : /^SPATIAL/i.test(index[1]) ? 'SPATIAL' : 'BTREE', definition: part });
                table.createParts.push(part);
            } else {
                const name = part.match(/^(\w+)\s+/)?.[1];
                if (!name || !/^(?:TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL|BIT|BOOL|BOOLEAN|CHAR|VARCHAR|BINARY|VARBINARY|TEXT|TINYTEXT|MEDIUMTEXT|LONGTEXT|BLOB|TINYBLOB|MEDIUMBLOB|LONGBLOB|ENUM|SET|DATE|DATETIME|TIMESTAMP|TIME|YEAR|JSON|GEOMETRY|POINT|LINESTRING|POLYGON)\b/i.test(part.slice(name.length).trim())) throw new Error(`Cannot parse column: ${table.name}`);
                // Existing staff accounts may predate username; do not invent usernames for them.
                if (table.name === 'accounts' && name === 'username') part = part.replace(/NOT NULL/i, 'NULL');
                table.columns.push({ name, definition: part, safeOnPopulated: !/\bNOT NULL\b|\bPRIMARY KEY\b|\bAUTO_INCREMENT\b/i.test(part) || /\bDEFAULT\b/i.test(part) });
                table.createParts.push(part);
                if (/\bPRIMARY KEY\b/i.test(part)) table.indexes.push({ name: 'PRIMARY', columns: [name], unique: true, definition: `PRIMARY KEY (${quoteId(name)})` });
                else if (/\bUNIQUE\b/i.test(part)) table.indexes.push({ name, columns: [name], unique: true, definition: `UNIQUE KEY ${quoteId(name)} (${quoteId(name)})` });
            }
        }
        table.create = `CREATE TABLE IF NOT EXISTS ${quoteId(table.name)} (\n${table.createParts.map(part => '  ' + part).join(',\n')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
        tables.push(table);
    }
    for (const [tableName, name, columns] of [['orders', 'idx_orders_staff_created', ['staff_id', 'created_at']], ['customers', 'idx_customers_phone', ['phone']]]) {
        tables.find(table => table.name === tableName).indexes.push({ name, columns, unique: false, definition: `INDEX ${quoteId(name)} (${columns.map(quoteId).join(', ')})` });
    }
    const triggers = [...sql.matchAll(/CREATE TRIGGER\s+(\w+)\s+[\s\S]*?END\$\$/gi)].map(match => ({ name: match[1], sql: match[0].slice(0, -2) }));
    const views = [...sql.matchAll(/CREATE OR REPLACE VIEW\s+(\w+)\s+AS[\s\S]*?;/gi)].map(match => ({ name: match[1], sql: match[0].replace(/CREATE OR REPLACE VIEW/i, 'CREATE VIEW').slice(0, -1) }));
    if (tables.length < 30 || triggers.length < 6 || views.length < 5) throw new Error('Incomplete portable schema definition');
    return { tables, triggers, views };
}
module.exports = { loadDefinition, quoteId };
