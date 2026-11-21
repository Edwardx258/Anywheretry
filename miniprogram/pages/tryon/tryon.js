const api = require('../../utils/api');
const app = getApp();

const CONSENT_KEY = 'tryon_photo_consent_v1';

Page({
  data: {
    product: null,
    consent: false,       // 用户是否同意人像照片处理（人脸属于敏感个人信息，须单独同意）
    photoPath: '',        // 本地预览路径
    photo: null,          // 已上传 { id, url }
    stage: 'idle',        // idle | uploading | generating | done | error
    progressText: '',
    resultUrl: '',
    errorMsg: '',
  },

  async onLoad({ id }) {
    let consent = false;
    try { consent = !!wx.getStorageSync(CONSENT_KEY); } catch (e) { /* ignore */ }
    this.setData({ consent });

    // 从实时预览页拍照跳过来的
    if (app.globalData.pendingPhotoPath) {
      this.setData({ photoPath: app.globalData.pendingPhotoPath, photo: null });
      app.globalData.pendingPhotoPath = '';
    } else if (app.globalData.photo) {
      this.setData({ photo: app.globalData.photo, photoPath: app.globalData.photo.url });
    }

    try {
      this.setData({ product: await api.getProduct(id) });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  toggleConsent() {
    const consent = !this.data.consent;
    this.setData({ consent });
    try { wx.setStorageSync(CONSENT_KEY, consent); } catch (e) { /* ignore */ }
  },

  choosePhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const f = res.tempFiles[0];
        if (f.size > 5 * 1024 * 1024) {
          wx.showToast({ title: '图片不能超过 5MB', icon: 'none' });
          return;
        }
        this.setData({ photoPath: f.tempFilePath, photo: null, stage: 'idle', resultUrl: '' });
      },
    });
  },

  async generate() {
    if (!this.data.consent) {
      wx.showToast({ title: '请先阅读并同意照片使用说明', icon: 'none' });
      return;
    }
    if (!this.data.photoPath) {
      this.choosePhoto();
      return;
    }

    this.setData({ stage: 'uploading', progressText: '正在上传照片…', errorMsg: '' });
    try {
      let photo = this.data.photo;
      if (!photo) {
        photo = await api.uploadPhoto(this.data.photoPath);
        app.globalData.photo = photo;
        this.setData({ photo });
      }

      this.setData({ stage: 'generating', progressText: 'AI 正在为你换装，约需 10~30 秒…' });
      const resultUrl = await api.tryOn(this.data.product.id, photo.id, {
        onProgress: (status, elapsed) => {
          this.setData({ progressText: `AI 正在为你换装… 已等待 ${Math.round(elapsed / 1000)} 秒` });
        },
      });
      this.setData({ stage: 'done', resultUrl });
    } catch (e) {
      // 照片过期（服务端已删除）时清掉缓存，下次重新上传
      if (/照片不存在|已过期/.test(e.message)) {
        app.globalData.photo = null;
        this.setData({ photo: null });
      }
      this.setData({ stage: 'error', errorMsg: e.message });
    }
  },

  preview() {
    wx.previewImage({ urls: [this.data.resultUrl] });
  },

  save() {
    wx.downloadFile({
      url: this.data.resultUrl,
      success: (res) =>
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: () => wx.showToast({ title: '已保存到相册' }),
          fail: () => wx.showToast({ title: '保存失败，请检查相册权限', icon: 'none' }),
        }),
      fail: () => wx.showToast({ title: '下载失败', icon: 'none' }),
    });
  },

  onShareAppMessage() {
    const p = this.data.product;
    return {
      title: p ? `我试穿了「${p.name}」，你觉得怎么样？` : 'AI 试衣间',
      path: p ? `/pages/detail/detail?id=${p.id}` : '/pages/index/index',
      imageUrl: this.data.resultUrl || (p && p.cover),
    };
  },
});
