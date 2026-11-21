const { API_BASE } = require('../config');

function request(path, { method = 'GET', data } = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: API_BASE + path,
      method,
      data,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else reject(new Error((res.data && res.data.error) || `请求失败 (${res.statusCode})`));
      },
      fail: () => reject(new Error('网络异常，请检查网络后重试')),
    });
  });
}

// 商品图在后端是相对路径，这里补全成完整地址
const withBase = (p) => ({ ...p, cover: API_BASE + p.cover, garmentImage: API_BASE + p.garmentImage });

module.exports = {
  getProducts: (category) =>
    request('/api/products' + (category ? `?category=${category}` : '')).then((list) => list.map(withBase)),
  getProduct: (id) => request(`/api/products/${id}`).then(withBase),
};
