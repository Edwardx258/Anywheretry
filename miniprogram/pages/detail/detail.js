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

  // 实时预览：摄像头 + 人体检测，衣服实时贴合
  goLive() {
    wx.navigateTo({ url: `/pages/live/live?id=${this.data.product.id}` });
  },

  // AI 高清试穿：上传照片，生成逼真的上身效果图
  goTryOn() {
    wx.navigateTo({ url: `/pages/tryon/tryon?id=${this.data.product.id}` });
  },

  buy() {
    // TODO：接入微信支付（需企业主体 + 商户号），或跳转到微信小店 / 视频号小店商品页
    wx.showToast({ title: '下单功能待接入', icon: 'none' });
  },
});
