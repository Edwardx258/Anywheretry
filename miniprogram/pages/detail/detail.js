const api = require('../../utils/api');

Page({
  data: { product: null },

  async onLoad({ id }) {
    try {
      this.setData({ product: await api.getProduct(id) });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  // 实时试穿：打开摄像头，AI 实时把衣服“穿”到视频里的你身上
  goLive() {
    wx.navigateTo({ url: `/pages/live/live?id=${this.data.product.id}` });
  },

  buy() {
    // TODO：接入微信支付（需企业主体 + 商户号），或跳转到微信小店 / 视频号小店商品页
    wx.showToast({ title: '下单功能待接入', icon: 'none' });
  },
});
