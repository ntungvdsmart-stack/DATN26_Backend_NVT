require('dotenv').config();
const pool = require('../src/config/database');
require('../src/config/ensureSchema')().then(summary => {
    console.log(JSON.stringify({ success: true, ...summary }, null, 2));
}).catch(error => {
    console.error('Migration thất bại:', error.code || '', error.message);
    process.exitCode = 1;
}).finally(() => pool.end());
