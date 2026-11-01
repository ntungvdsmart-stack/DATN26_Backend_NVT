const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const fail = () => Object.assign(new Error('OTP không đúng, đã hết hạn hoặc đã dùng. Vui lòng yêu cầu mã mới nếu cần.'), { statusCode: 400 });

module.exports = {
    forgot: async (req, res, next) => {
        const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        if (email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, message: 'Email không hợp lệ' });
        const requestId = crypto.randomBytes(32).toString('hex');
        let expiresAt = Date.now() + 60000;
        let connection;
        try {
            const user = await require('../models/accountModel').findUserByEmail(email);
            if (!user) return res.status(404).json({ success: false, message: 'Email ch\u01b0a \u0111\u0103ng k\u00fd trong h\u1ec7 th\u1ed1ng' });
            if (!user.password_hash || !user.is_active) return res.status(400).json({ success: false, message: 'T\u00e0i kho\u1ea3n kh\u00f4ng h\u1ed7 tr\u1ee3 kh\u00f4i ph\u1ee5c m\u1eadt kh\u1ea9u' });
            {
                const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
                const codeHash = await bcrypt.hash(code, 10);
                const column = user.source === 'account' ? 'account_id' : 'customer_id';
                const table = user.source === 'account' ? 'accounts' : 'customers';
                connection = await pool.getConnection();
                await connection.beginTransaction();
                await connection.query(`SELECT ${column} FROM ${table} WHERE ${column} = ? FOR UPDATE`, [user.id]);
                const [[recent]] = await connection.query(`SELECT request_id FROM password_reset_otps WHERE ${column} = ? AND created_at > DATE_SUB(NOW(), INTERVAL 60 SECOND) LIMIT 1`, [user.id]);
                if (recent) {
                    await connection.rollback();
                    return res.status(429).json({ success: false, message: 'Vui l\u00f2ng ch\u1edd 60 gi\u00e2y gi\u1eefa hai l\u1ea7n g\u1eedi OTP' });
                }
                if (!recent) {
                    await connection.query(`UPDATE password_reset_otps SET used_at = NOW() WHERE ${column} = ? AND used_at IS NULL`, [user.id]);
                    expiresAt = Date.now() + 60000;
                    await connection.query('INSERT INTO password_reset_otps (request_id, code_hash, account_id, customer_id, expires_at) VALUES (?, ?, ?, ?, ?)', [requestId, codeHash, column === 'account_id' ? user.id : null, column === 'customer_id' ? user.id : null, new Date(expiresAt)]);
                }
                await connection.commit(); connection.release(); connection = null;
                if (!recent) {
                    try { await require('../utils/mailHelper').sendBrandedEmail(email, brand => require('../utils/emailTemplates').passwordOtp(brand, code), { idempotencyKey: `password-otp-${requestId}`, throwOnError: true });
                    } catch (error) {
                        await pool.query('UPDATE password_reset_otps SET used_at = NOW() WHERE request_id = ?', [requestId]);
                        throw error;
                    }
                }
            }
            res.json({ success: true, message: '\u0110\u00e3 g\u1eedi OTP v\u1ec1 email c\u1ee7a b\u1ea1n. Vui l\u00f2ng ki\u1ec3m tra c\u1ea3 th\u01b0 r\u00e1c', data: { request_id: requestId, expires_at: new Date(expiresAt).toISOString(), resend_after: 60 } });
        } catch (error) {
            if (connection) await connection.rollback();
            next(error);
        } finally { connection?.release(); }
    },
    verify: async (req, res, next) => {
        const { request_id, otp } = req.body;
        if (typeof request_id !== 'string' || !/^[a-f0-9]{64}$/.test(request_id) || typeof otp !== 'string' || !/^\d{6}$/.test(otp)) return next(fail());
        let connection;
        try {
            connection = await pool.getConnection();
            await connection.beginTransaction();
            const [[reset]] = await connection.query('SELECT *, expires_at > NOW() AS valid FROM password_reset_otps WHERE request_id = ? FOR UPDATE', [request_id]);
            if (!reset || reset.used_at || reset.verified_at || !reset.valid || reset.attempts >= 5) throw fail();
            if (!await bcrypt.compare(otp, reset.code_hash)) {
                await connection.query('UPDATE password_reset_otps SET attempts = attempts + 1, used_at = IF(attempts >= 5, NOW(), used_at) WHERE request_id = ?', [request_id]);
                await connection.commit();
                return next(fail());
            }
            const token = crypto.randomBytes(32).toString('hex');
            const [verified] = await connection.query('UPDATE password_reset_otps SET verified_at = NOW(), reset_token_hash = ?, reset_expires_at = DATE_ADD(NOW(), INTERVAL 5 MINUTE) WHERE request_id = ? AND expires_at > NOW()', [crypto.createHash('sha256').update(token).digest('hex'), request_id]);
            if (!verified.affectedRows) throw fail();
            await connection.commit();
            res.json({ success: true, message: 'OTP h\u1ee3p l\u1ec7. H\u00e3y t\u1ea1o m\u1eadt kh\u1ea9u m\u1edbi.', data: { reset_token: token } });
        } catch (error) { if (connection) await connection.rollback(); next(error); }
        finally { connection?.release(); }
    },
    reset: async (req, res, next) => {
        const { reset_token, password } = req.body;
        if (typeof reset_token !== 'string' || !/^[a-f0-9]{64}$/.test(reset_token)) return next(fail());
        if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 72) return res.status(400).json({ success: false, message: 'M\u1eadt kh\u1ea9u c\u1ea7n t\u1eeb 8 k\u00fd t\u1ef1, t\u1ed1i \u0111a 72 byte' });
        let connection;
        try {
            const hash = crypto.createHash('sha256').update(reset_token).digest('hex');
            const passwordHash = await bcrypt.hash(password, 10);
            connection = await pool.getConnection();
            await connection.beginTransaction();
            const [[reset]] = await connection.query('SELECT * FROM password_reset_otps WHERE reset_token_hash = ? AND verified_at IS NOT NULL AND used_at IS NULL AND reset_expires_at > NOW() FOR UPDATE', [hash]);
            if (!reset) throw fail();
            const table = reset.account_id ? 'accounts' : 'customers';
            const column = reset.account_id ? 'account_id' : 'customer_id';
            const id = reset.account_id || reset.customer_id;
            const [result] = await connection.query(`UPDATE ${table} SET password_hash = ?, auth_version = auth_version + 1 WHERE ${column} = ? AND is_active = 1`, [passwordHash, id]);
            if (!result.affectedRows) throw fail();
            await connection.query('UPDATE password_reset_otps SET used_at = NOW() WHERE request_id = ?', [reset.request_id]);
            await connection.query(`UPDATE password_reset_tokens SET used_at = NOW() WHERE ${column} = ? AND used_at IS NULL`, [id]);
            await connection.commit();
            res.json({ success: true, message: '\u0110\u00e3 \u0111\u1ed5i m\u1eadt kh\u1ea9u. Vui l\u00f2ng \u0111\u0103ng nh\u1eadp l\u1ea1i.' });
        } catch (error) { if (connection) await connection.rollback(); next(error); }
        finally { connection?.release(); }
    }
};
