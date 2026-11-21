// 实时试穿：用 <web-view> 打开 H5 试穿页。
// 原生小程序没有标准 WebRTC，而实时视频试穿模型（Decart Lucy VTON）通过 WebRTC 收发视频流，
// 所以试穿界面做成 H5，嵌在小程序里；H5 内通过 wx.miniProgram.redirectTo 回到商品页下单。
const { TRYON_H5_URL } = require('../../config');

Page({
  data: { src: '' },
  onLoad({ id }) {
    this.setData({ src: `${TRYON_H5_URL}?id=${encodeURIComponent(id || '')}` });
  },
  onShareAppMessage() {
    return { title: '来试试 AI 实时试穿，衣服直接“穿”在身上', path: '/pages/index/index' };
  },
});
