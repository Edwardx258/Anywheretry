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

function uploadPhoto(filePath) {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: API_BASE + '/api/upload',
      filePath,
      name: 'file',
      success: (res) => {
        let body = {};
        try { body = JSON.parse(res.data); } catch (e) { /* ignore */ }
        if (res.statusCode === 200 && body.id) resolve(body);
        else reject(new Error(body.error || '上传失败'));
      },
      fail: () => reject(new Error('上传失败，请检查网络')),
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 发起试衣并轮询直到出结果（通常 10~30 秒）
async function tryOn(productId, photoId, { onProgress, timeoutMs = 120000 } = {}) {
  const { jobId } = await request('/api/tryon', { method: 'POST', data: { productId, photoId } });
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(2500);
    const r = await request(`/api/tryon/${jobId}`);
    if (onProgress) onProgress(r.status, Date.now() - start);
    if (r.status === 'succeeded') return r.imageUrl;
    if (r.status === 'failed') throw new Error(r.error || '生成失败');
  }
  throw new Error('生成超时，请稍后再试');
}

module.exports = {
  getProducts: (category) => request('/api/products' + (category ? `?category=${category}` : '')),
  getProduct: (id) => request(`/api/products/${id}`),
  uploadPhoto,
  tryOn,
};
