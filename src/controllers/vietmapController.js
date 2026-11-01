const VietmapController = {
  autocomplete: async (req, res) => {
    try {
      const { text } = req.query;
      const apiKey = process.env.VIETMAP_API_KEY;

      if (!apiKey) return res.status(500).json({ success: false, message: 'Chưa cấu hình VIETMAP_API_KEY ở backend' });
      if (typeof text !== 'string' || !text.trim() || text.length > 500) return res.status(400).json({ success: false, message: 'Địa chỉ cần từ 1 đến 500 ký tự' });

      const response = await fetch(`https://maps.vietmap.vn/api/autocomplete/v3?apikey=${encodeURIComponent(apiKey)}&text=${encodeURIComponent(text)}`, { signal: AbortSignal.timeout(6000) });
      if (!response.ok) return res.status(502).json({ success: false, message: 'Dịch vụ bản đồ chưa sẵn sàng' });
      const data = await response.json();
      return res.json({ success: true, data: data });
    } catch (error) {
      return res.status(502).json({ success: false, message: 'Chưa kết nối được VietMap, vui lòng thử lại' });
    }
  },
  place: async (req, res) => {
    try {
      const { ref_id } = req.query;
      const apiKey = process.env.VIETMAP_API_KEY;

      if (!apiKey) return res.status(500).json({ success: false, message: 'Chưa cấu hình VIETMAP_API_KEY ở backend' });
      if (typeof ref_id !== 'string' || !ref_id.trim() || ref_id.length > 500) return res.status(400).json({ success: false, message: 'Mã địa điểm không hợp lệ' });

      const response = await fetch(`https://maps.vietmap.vn/api/place/v3?apikey=${encodeURIComponent(apiKey)}&refid=${encodeURIComponent(ref_id)}`, { signal: AbortSignal.timeout(6000) });
      if (!response.ok) return res.status(502).json({ success: false, message: 'Dịch vụ bản đồ chưa sẵn sàng' });
      const data = await response.json();
      return res.json({ success: true, data: data });
    } catch (error) {
      return res.status(502).json({ success: false, message: 'Chưa lấy được vị trí VietMap, vui lòng thử lại' });
    }
  }
};

module.exports = VietmapController;
