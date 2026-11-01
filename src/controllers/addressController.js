const addressModel = require('../models/addressModel');

const addressController = {
  get: async (req, res) => {
    try {
      const items = await addressModel.getAddresses(req.user.user_id || req.user.id);
      res.json({ success: true, data: items });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  },
  add: async (req, res, next) => {
    try {
      const data = { ...req.body };
      if (req.params.id && (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id)))) return res.status(400).json({ success: false, message: 'Mã địa chỉ không hợp lệ' });
      for (const key of ['ward','district','city']) if (data[key] != null && (typeof data[key] !== 'string' || data[key].length > 100)) return res.status(400).json({ success: false, message: 'Thông tin phường, quận hoặc tỉnh thành không hợp lệ' });
      for (const [key, limit] of [['recipient_name',150], ['recipient_phone',20], ['full_address',255]]) if (typeof data[key] !== 'string' || !data[key].trim() || data[key].length > limit) return res.status(400).json({ success: false, message: 'Tên người nhận, số điện thoại và địa chỉ là bắt buộc và không được vượt độ dài cho phép' });
      if (!/^(0\d{9}|\+84\d{9})$/.test(data.recipient_phone.trim())) return res.status(400).json({ success: false, message: 'Số điện thoại không hợp lệ' });
      for (const [key, max] of [['latitude',90],['longitude',180]]) {
        if (typeof data[key] === 'string') data[key] = data[key].trim();
        if (data[key] === '') data[key] = null;
        if (data[key] != null && (!['number','string'].includes(typeof data[key]) || !Number.isFinite(Number(data[key])) || Math.abs(Number(data[key])) > max)) return res.status(400).json({ success: false, message: 'Tọa độ địa chỉ không hợp lệ' });
        if (data[key] != null) data[key] = Number(data[key]);
      }
      if ((data.latitude == null) !== (data.longitude == null)) return res.status(400).json({ success: false, message: 'Vui lòng cung cấp đủ kinh độ và vĩ độ' });
      for (const key of ['recipient_name','recipient_phone','full_address','ward','district','city']) if (typeof data[key] === 'string') data[key] = data[key].trim();
      if (data.recipient_name.length < 2) return res.status(400).json({ success: false, message: 'Tên người nhận phải có ít nhất 2 ký tự' });
      if (data.is_default != null && ![true,false,0,1].includes(data.is_default)) return res.status(400).json({ success: false, message: 'Trạng thái mặc định không hợp lệ' });
      const id = req.params.id ? await addressModel.updateAddress(req.user.id, req.params.id, data) : await addressModel.addAddress(req.user.id, data);
      res.json({ success: true, message: req.params.id ? 'Cập nhật địa chỉ thành công' : 'Thêm địa chỉ thành công', data: { address_id: id } });
    } catch (error) {
      next(error);
    }
  },
  remove: async (req, res, next) => {
    try {
      const removed = await addressModel.deleteAddress(req.user.id, req.params.id);
      if (!removed) return res.status(404).json({ success: false, message: 'Không tìm thấy địa chỉ' });
      res.json({ success: true, message: 'Xóa địa chỉ thành công' });
    } catch (error) {
      next(error);
    }
  },
  setDefault: async (req, res, next) => {
    try {
      if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id))) return res.status(400).json({ success: false, message: 'Mã địa chỉ không hợp lệ' });
      await addressModel.setDefault(req.user.user_id || req.user.id, req.params.id);
      res.json({ success: true, message: 'Đã đặt làm mặc định' });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = addressController;
