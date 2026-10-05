const pool = require('../config/database');
const { sendResponse } = require('../utils/responseHelper');

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
            if (!branch_name) {
                return sendResponse(res, 400, false, 'Tên chi nhánh là bắt buộc');
            }
            const [result] = await pool.query(
                'INSERT INTO branches (branch_name, address, phone, latitude, longitude, is_active) VALUES (?, ?, ?, ?, ?, 1)',
                [branch_name, address || null, phone || null, latitude || null, longitude || null]
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
            if (!branch_name) {
                return sendResponse(res, 400, false, 'Tên chi nhánh là bắt buộc');
            }
            await pool.query(
                'UPDATE branches SET branch_name = ?, address = ?, phone = ?, latitude = ?, longitude = ? WHERE branch_id = ?',
                [branch_name, address || null, phone || null, latitude || null, longitude || null, id]
            );
            sendResponse(res, 200, true, 'Cập nhật chi nhánh thành công');
        } catch (error) {
            next(error);
        }
    },

    toggleStatus: async (req, res, next) => {
        try {
            const { id } = req.params;
            const { is_active } = req.body;
            await pool.query(
                'UPDATE branches SET is_active = ? WHERE branch_id = ?',
                [is_active ? 1 : 0, id]
            );
            sendResponse(res, 200, true, 'Cập nhật trạng thái thành công');
        } catch (error) {
            next(error);
        }
    }
};

module.exports = BranchController;
