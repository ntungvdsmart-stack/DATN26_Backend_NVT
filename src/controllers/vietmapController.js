const VietmapController = {
  autocomplete: async (req, res) => {
    try {
      const { text } = req.query;
      const apiKey = process.env.VIETMAP_API_KEY;

      if (!apiKey) return res.status(500).json({ success: false, message: 'Chưa cấu hình VIETMAP_API_KEY ở backend' });
      if (!text) return res.status(400).json({ success: false, message: 'Thiếu tham số text' });

      const response = await fetch(`https://maps.vietmap.vn/api/autocomplete/v3?apikey=${apiKey}&text=${encodeURIComponent(text)}`);
      const data = await response.json();
      return res.json({ success: true, data: data });
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Lỗi server khi gọi Vietmap', error: error.message });
    }
  },
  place: async (req, res) => {
    try {
      const { ref_id } = req.query;
      const apiKey = process.env.VIETMAP_API_KEY;

      if (!apiKey) return res.status(500).json({ success: false, message: 'Chưa cấu hình VIETMAP_API_KEY ở backend' });
      if (!ref_id) return res.status(400).json({ success: false, message: 'Thiếu tham số ref_id' });

      const response = await fetch(`https://maps.vietmap.vn/api/place/v3?apikey=${apiKey}&refid=${encodeURIComponent(ref_id)}`);
      const data = await response.json();
      return res.json({ success: true, data: data });
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Lỗi server khi gọi Vietmap Place API', error: error.message });
    }
  }
};

module.exports = VietmapController;
