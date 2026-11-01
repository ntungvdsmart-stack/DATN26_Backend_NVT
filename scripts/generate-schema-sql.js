const fs = require('node:fs');
const path = require('node:path');
const { loadDefinition, quoteId } = require('../src/config/schemaDefinition');
const { PERMISSIONS, DEFAULT_GRANTS } = require('../src/config/permissions');
const str = value => "'" + String(value).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
const schema = loadDefinition();
const lines = [
    '-- GENERATED: edit backend/sql/schema.source.sql, then run npm run db:generate in backend.',
    '-- Direct SQL import: MySQL 8.0.29+. Backend auto-migration supports earlier MySQL 8.0 via metadata checks.',
    '-- Adds missing structure only. No data reset, sample accounts/passwords, or disabled foreign-key checks.',
    '-- Back up before upgrading. MySQL DDL commits implicitly; rerunning resumes missing objects.',
    '-- For a different database name, change the next two lines. Backend uses DB_NAME from its .env instead.',
    'CREATE DATABASE IF NOT EXISTS fashion_multichannel CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;',
    'USE fashion_multichannel;',
    'SET NAMES utf8mb4;',
    'DROP PROCEDURE IF EXISTS fashion_apply_schema_v3;',
    'DELIMITER $$',
    'CREATE PROCEDURE fashion_apply_schema_v3()', 'BEGIN',
    '  DECLARE acquired INT DEFAULT 0;', '  DECLARE occupied INT DEFAULT 0;', '  DECLARE schema_lock VARCHAR(64);',
    '  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN DO RELEASE_LOCK(schema_lock); RESIGNAL; END;',
    "  SET schema_lock = CONCAT('fashion_schema_', LEFT(SHA2(DATABASE(), 256), 32));",
    '  SELECT GET_LOCK(schema_lock, 60) INTO acquired;',
    "  IF acquired IS NULL OR acquired <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Schema update is busy. Try again later.'; END IF;",
    '\n  -- 1. All tables first, foreign keys later.'
];
for (const table of schema.tables) lines.push(`  IF NOT EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${str(table.name)}) THEN`, '    ' + table.create + ';', '  END IF;');
lines.push('\n  -- 2. Missing columns only; refuse unsafe historical backfills.');
for (const table of schema.tables) for (const column of table.columns) {
    lines.push(`  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${str(table.name)} AND COLUMN_NAME = ${str(column.name)}) THEN`);
    if (!column.safeOnPopulated) lines.push(`    SELECT EXISTS(SELECT 1 FROM ${quoteId(table.name)} LIMIT 1) INTO occupied;`, `    IF occupied = 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = ${str(`Backfill required: ${table.name}.${column.name} (mandatory column).`)}; END IF;`);
    lines.push(`    ALTER TABLE ${quoteId(table.name)} ADD COLUMN ${column.definition};`, '  END IF;');
}
lines.push("  INSERT INTO roles (role_id, role_name) SELECT 1, 'Admin' WHERE NOT EXISTS (SELECT 1 FROM roles WHERE role_id = 1 OR role_name = 'Admin');", "  INSERT INTO roles (role_id, role_name) SELECT 2, 'Staff' WHERE NOT EXISTS (SELECT 1 FROM roles WHERE role_id = 2 OR role_name = 'Staff');", '\n  -- 3. Recognize equivalent indexes/FKs even under different names.');
for (const table of schema.tables) {
    for (const index of table.indexes) lines.push(
        `  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${str(table.name)} GROUP BY INDEX_NAME, NON_UNIQUE, INDEX_TYPE HAVING INDEX_TYPE = ${str(index.type || 'BTREE')} AND NON_UNIQUE = ${index.unique ? 0 : 1} AND GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') = ${str(index.columns.join(','))}) THEN`,
        `    ALTER TABLE ${quoteId(table.name)} ADD ${index.definition};`, '  END IF;');
    for (const fk of table.foreignKeys) lines.push(
        `  IF NOT EXISTS (SELECT 1 FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${str(table.name)} AND REFERENCED_TABLE_NAME = ${str(fk.refTable)} GROUP BY CONSTRAINT_NAME HAVING GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION SEPARATOR ',') = ${str(fk.columns.join(','))} AND GROUP_CONCAT(REFERENCED_COLUMN_NAME ORDER BY ORDINAL_POSITION SEPARATOR ',') = ${str(fk.refColumns.join(','))}) THEN`,
        `    ALTER TABLE ${quoteId(table.name)} ADD ${fk.definition};`, '  END IF;');
    for (const check of table.checks) lines.push(
        `  IF NOT EXISTS (SELECT 1 FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME WHERE tc.TABLE_SCHEMA = DATABASE() AND tc.TABLE_NAME = ${str(table.name)} AND tc.CONSTRAINT_TYPE = 'CHECK' AND REGEXP_REPLACE(LOWER(cc.CHECK_CLAUSE), '[[:space:]\u0060()]+', '') = ${str(check.expression.replace(/[\s`()]/g, '').toLowerCase())}) THEN`,
        `    ALTER TABLE ${quoteId(table.name)} ADD ${check.definition};`, '  END IF;');
}
for (const view of schema.views) lines.push(`  IF NOT EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${str(view.name)}) THEN`, `    SET @fashion_view_ddl = ${str(view.sql)};`, '    PREPARE fashion_view_stmt FROM @fashion_view_ddl;', '    EXECUTE fashion_view_stmt;', '    DEALLOCATE PREPARE fashion_view_stmt;', '  END IF;');
for (const [code, description] of Object.entries(PERMISSIONS)) lines.push(`  INSERT INTO permissions (permission_code, description) SELECT ${str(code)}, ${str(description)} WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_code = ${str(code)});`);
lines.push("  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE migration_key = 'role-permissions-v1') THEN");
for (const [role, codes] of Object.entries(DEFAULT_GRANTS)) lines.push(`    INSERT IGNORE INTO role_permissions (role_id, permission_id) SELECT r.role_id, p.permission_id FROM roles r CROSS JOIN permissions p WHERE r.role_name = ${str(role)} AND p.permission_code IN (${codes.map(str).join(',')});`);
lines.push("    INSERT INTO schema_migrations (migration_key) VALUES ('role-permissions-v1');", '  END IF;', 'END$$', 'DELIMITER ;', 'CALL fashion_apply_schema_v3();', 'DROP PROCEDURE fashion_apply_schema_v3;', '\n-- 4. Preserve existing triggers. Conditional CREATE requires MySQL 8.0.29+.', 'DELIMITER $$');
for (const trigger of schema.triggers) lines.push(trigger.sql.replace('CREATE TRIGGER ', 'CREATE TRIGGER IF NOT EXISTS ') + '$$');
lines.push('DELIMITER ;', "DO RELEASE_LOCK(CONCAT('fashion_schema_', LEFT(SHA2(DATABASE(), 256), 32)));", "SELECT 'Schema synchronized. Start backend for versioned data migrations.' AS migration_status;", '');
fs.writeFileSync(path.resolve(__dirname, '../../DoAnMo/fashion_database.sql'), lines.join('\n'), 'utf8');
console.log(`Generated ${schema.tables.length} tables, ${schema.triggers.length} triggers, ${schema.views.length} views. No database was modified.`);
