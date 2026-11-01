const pool = require('../config/database');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const safeUrl = (value, httpsOnly = false) => {
    try { const url = new URL(value); return (httpsOnly ? url.protocol === 'https:' : ['http:', 'https:'].includes(url.protocol)) ? url.href : ''; } catch { return ''; }
};
async function getBrand() {
    let settings = {};
    try {
        const [rows] = await pool.query("SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('store_name','store_phone','store_email','store_address','store_logo_url')");
        settings = Object.fromEntries(rows.map(row => [row.setting_key, row.setting_value]));
    } catch { /* Email can still be rendered if settings storage is unavailable. */ }
    return {
        name: settings.store_name?.trim() || process.env.BRAND_NAME || 'FashionOS',
        logo: safeUrl(settings.store_logo_url || process.env.MAIL_LOGO_URL, true),
        phone: settings.store_phone || '', address: settings.store_address || '',
        support: settings.store_email || process.env.MAIL_REPLY_TO || '',
        website: (safeUrl(process.env.FRONTEND_URL) || 'http://localhost:5173/').replace(/\/$/, '')
    };
}
module.exports = { getBrand, escapeHtml, safeUrl };
