const api = require('../../utils/api');

Page({
  data: {
    tabs: [
      { key: '', label: '全部' },
      { key: 'top', label: '上装' },
      { key: 'bottom', label: '下装' },
      { key: 'dress', label: '连衣裙' },
    ],
    active: '',
    products: [],
    loading: true,
  },

  onLoad() { this.load(); },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },

  async load() {
    this.setData({ loading: true });
    try {
      const products = await api.getProducts(this.data.active);
      this.setData({ products });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    }
    this.setData({ loading: false });
  },

  onTab(e) {
    this.setData({ active: e.currentTarget.dataset.key });
    this.load();
  },

  openDetail(e) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${e.currentTarget.dataset.id}` });
  },
});
