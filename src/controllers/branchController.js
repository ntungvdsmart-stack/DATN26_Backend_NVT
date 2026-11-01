const pool = require('../config/database');
const { sendResponse } = require('../utils/responseHelper');
const validBranch = data => ((data.latitude == null || data.latitude === '') === (data.longitude == null || data.longitude === '')) && typeof data.branch_name === 'string' && data.branch_name.trim().length >= 2 && data.branch_name.length <= 150 && (!data.address || (typeof data.address === 'string' && data.address.length <= 255)) && (!data.phone || (typeof data.phone === 'string' && /^(0\d{9}|\+84\d{9})$/.test(data.phone))) && [['latitude',90],['longitude',180]].every(([key,max]) => data[key] == null || data[key] === '' || (['number','string'].includes(typeof data[key]) && String(data[key]).trim() !== '' && Number.isFinite(Number(data[key])) && Math.abs(Number(data[key])) <= max));

const BranchController = {
    getAllBranches: async (req, res, next) => {
        try {
            const [rows] = await pool.query('SELECT branch_id, branch_name, address, latitude, longitude, phone, is_active FROM branches ORDER BY branch_id ASC');
            sendResponse(res, 200, true, 'Lấy danh sách chi nhánh thành công', rows);
        } catch (error) {
            next(error);
        }
    },

    createBranch: async (req, res, next) => {
        try {
            const { branch_name, address, phone, latitude, longitude } = req.body;
            if (!validBranch(req.body)) {
                return sendResponse(res, 400, false, 'Tên chi nhánh là bắt buộc');
            }
            const [result] = await pool.query(
                'INSERT INTO branches (branch_name, address, phone, latitude, longitude, is_active) VALUES (?, ?, ?, ?, ?, 1)',
                [branch_name.trim(), address || null, phone || null, latitude === '' ? null : latitude ?? null, longitude === '' ? null : longitude ?? null]
            );
            sendResponse(res, 201, true, 'Tạo chi nhánh thành công', { branch_id: result.insertId });
        } catch (error) {
            next(error);
        }
    },

    updateBranch: async (req, res, next) => {
        try {
            const { id } = req.params;
            const { branch_name, address, phone, latitude, longitude } = req.body;
            if (!validBranch(req.body)) {
                return sendResponse(res, 400, false, 'Tên chi nhánh là bắt buộc');
            }
            const [result] = await pool.query(
                'UPDATE branches SET branch_name = ?, address = ?, phone = ?, latitude = ?, longitude = ? WHERE branch_id = ?',
                [branch_name.trim(), address || null, phone || null, latitude === '' ? null : latitude ?? null, longitude === '' ? null : longitude ?? null, id]
            );
            if (!result.affectedRows) return sendResponse(res, 404, false, 'Không tìm thấy chi nhánh');
            sendResponse(res, 200, true, 'Cập nhật chi nhánh thành công');
        } catch (error) {
            next(error);
        }
    },

    toggleStatus: async (req, res, next) => {
        try {
            const { id } = req.params;
            const { is_active } = req.body;
            if (![true,false,0,1].includes(is_active)) return sendResponse(res, 400, false, 'Trạng thái không hợp lệ');
            const [result] = await pool.query(
                'UPDATE branches SET is_active = ? WHERE branch_id = ?',
                [is_active ? 1 : 0, id]
            );
            if (!result.affectedRows) return sendResponse(res, 404, false, 'Không tìm thấy chi nhánh');
            sendResponse(res, 200, true, 'Cập nhật trạng thái thành công');
        } catch (error) {
            next(error);
        }
    }
};

module.exports = BranchController;
