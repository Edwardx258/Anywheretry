// 实时试穿预览
//
// 原理：<camera> 实时取帧 → 微信 VisionKit 人体检测（VKSession body, mode 2 手动送帧）
//      → 拿到人体框 → 在 canvas 上把服饰图贴到对应位置，逐帧跟随。
// 这是“快速看搭配”的 2D 贴图预览，不是生成式 AI；想看逼真效果，点“拍照生成 AI 高清试穿”，
// 会把拍下的照片交给 AI 试衣接口生成。
//
// 设备不支持 VisionKit 时自动降级为“对准人形框”的静态贴图模式。
//
// ⚠️ 真机调试须知（开发者工具里摄像头和 VisionKit 不可用）：
//   - VisionKit 人体检测需要基础库 ≥ 2.28.0，部分低端机不支持
//   - 不同机型 onCameraFrame 的帧方向/镜像可能不同，如贴图位置左右反了，调整 MIRROR_X
//   - 人体关键点（肩、髋）可以让贴合更准，见下方 TODO

const api = require('../../utils/api');
const app = getApp();

const DETECT_INTERVAL_MS = 80;   // 约 12 次/秒检测，兼顾流畅和耗电
const SMOOTHING = 0.35;          // 越小越平滑（越“拖”），越大越跟手（越抖）
const LOST_AFTER_MS = 600;       // 多久没检测到人就隐藏衣服
const MIRROR_X = true;           // 前置摄像头预览是镜像的，而帧数据通常不是

// 服饰相对“人体框”（头顶到脚）的位置：[左右中心偏移, 顶部, 宽度, 高度]，均为人体框的比例
const LAYOUT = {
  top:    { cx: 0.5, top: 0.15, w: 1.05, h: 0.38 },
  dress:  { cx: 0.5, top: 0.15, w: 1.05, h: 0.62 },
  bottom: { cx: 0.5, top: 0.46, w: 0.75, h: 0.52 },
};
// 不支持人体检测时的固定人形框（相对画布）
const FALLBACK_BOX = { x: 0.25, y: 0.12, w: 0.5, h: 0.8 };

Page({
  data: {
    product: null,
    devicePosition: 'front',
    mode: 'loading',      // loading | tracking | fallback
    hasBody: false,
    hint: '正在启动摄像头…',
  },

  async onLoad({ id }) {
    try {
      const product = await api.getProduct(id);
      this.setData({ product });
      this.product = product;
      if (this.canvas) this.loadGarment();
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  onReady() {
    wx.createSelectorQuery()
      .select('#overlay')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) return;
        const canvas = res[0].node;
        const dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio;
        canvas.width = res[0].width * dpr;
        canvas.height = res[0].height * dpr;
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.ctx.scale(dpr, dpr);
        this.viewW = res[0].width;
        this.viewH = res[0].height;
        if (this.product) this.loadGarment();
        this.startTracking();
        this.renderLoop();
      });
  },

  onUnload() {
    this.stopped = true;
    if (this.frameListener) this.frameListener.stop();
    if (this.session) this.session.destroy();
  },

  loadGarment() {
    const img = this.canvas.createImage();
    img.onload = () => { this.garment = img; };
    img.onerror = () => wx.showToast({ title: '服饰图加载失败', icon: 'none' });
    // 建议为每件商品准备一张“去背景的透明 PNG”(overlayImage) 用于实时贴图，效果远好于白底图
    img.src = this.product.overlayImage || this.product.garmentImage;
  },

  // ---------- 人体检测 ----------
  startTracking() {
    const supported = wx.isVKSupported && wx.isVKSupported('v1') && wx.createVKSession;
    if (!supported) return this.useFallback('当前设备不支持实时人体追踪');

    let session;
    try {
      session = wx.createVKSession({ track: { body: { mode: 2 } }, version: 'v1' });
    } catch (e) {
      return this.useFallback('当前设备不支持实时人体追踪');
    }
    this.session = session;

    session.start((err) => {
      if (err) return this.useFallback('人体追踪启动失败');
      this.setData({ mode: 'tracking', hint: '请后退几步，让全身入镜' });

      session.on('updateAnchors', (anchors) => this.onAnchors(anchors));
      session.on('removeAnchors', () => { /* 交给 LOST_AFTER_MS 处理，避免闪烁 */ });

      const cam = wx.createCameraContext();
      let last = 0;
      this.frameListener = cam.onCameraFrame((frame) => {
        const now = Date.now();
        if (this.stopped || now - last < DETECT_INTERVAL_MS) return;
        last = now;
        this.frameW = frame.width;
        this.frameH = frame.height;
        try {
          session.detectBody({
            frameBuffer: frame.data,
            width: frame.width,
            height: frame.height,
            scoreThreshold: 0.5,
            sourceType: 0, // 0 = 连续视频帧
          });
        } catch (e) { /* 单帧失败忽略 */ }
      });
      this.frameListener.start();
    });
  },

  useFallback(reason) {
    this.setData({ mode: 'fallback', hint: `${reason}，请站进虚线框内` });
    const b = FALLBACK_BOX;
    this.box = { x: b.x * this.viewW, y: b.y * this.viewH, w: b.w * this.viewW, h: b.h * this.viewH };
  },

  // 把检测结果（帧坐标）换算为画布坐标（camera 组件默认等比铺满裁切）
  onAnchors(anchors) {
    if (!anchors || !anchors.length || !this.frameW) return;
    // 取面积最大的那个人
    const a = anchors.reduce((m, x) => (x.size.width * x.size.height > m.size.width * m.size.height ? x : m));

    // 兼容归一化坐标（0~1）和像素坐标两种返回
    const norm = a.size.width <= 1.5 && a.size.height <= 1.5;
    const fx = norm ? a.origin.x * this.frameW : a.origin.x;
    const fy = norm ? a.origin.y * this.frameH : a.origin.y;
    const fw = norm ? a.size.width * this.frameW : a.size.width;
    const fh = norm ? a.size.height * this.frameH : a.size.height;

    const scale = Math.max(this.viewW / this.frameW, this.viewH / this.frameH);
    const offX = (this.viewW - this.frameW * scale) / 2;
    const offY = (this.viewH - this.frameH * scale) / 2;
    let x = fx * scale + offX;
    const y = fy * scale + offY;
    const w = fw * scale;
    const h = fh * scale;
    if (MIRROR_X && this.data.devicePosition === 'front') x = this.viewW - x - w;

    // TODO：用 a.points 里的肩、髋关键点替代按比例估算，贴合会更准（关键点序号以官方文档为准）

    const target = { x, y, w, h };
    this.box = this.box ? lerpBox(this.box, target, SMOOTHING) : target;
    this.lastSeen = Date.now();
    if (!this.data.hasBody) this.setData({ hasBody: true, hint: '' });
  },

  // ---------- 绘制 ----------
  renderLoop() {
    if (this.stopped) return;
    const { ctx } = this;
    ctx.clearRect(0, 0, this.viewW, this.viewH);

    const tracking = this.data.mode === 'tracking';
    const visible = this.box && (!tracking || Date.now() - this.lastSeen < LOST_AFTER_MS);

    if (tracking && !visible && this.data.hasBody) {
      this.setData({ hasBody: false, hint: '没找到人，请后退几步让全身入镜' });
    }
    if (this.data.mode === 'fallback') drawGuide(ctx, this.box);

    if (visible && this.garment && this.product) {
      const L = LAYOUT[this.product.category] || LAYOUT.top;
      const b = this.box;
      const gw = b.w * L.w;
      const gh = b.h * L.h;
      const gx = b.x + b.w * L.cx - gw / 2;
      const gy = b.y + b.h * L.top;
      ctx.save();
      ctx.globalAlpha = 0.92;
      // 白底图用“正片叠底”可以去掉大部分白色背景；透明 PNG 用默认混合即可
      if (!this.product.overlayImage) ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(this.garment, gx, gy, gw, gh);
      ctx.restore();
    }

    this.canvas.requestAnimationFrame(() => this.renderLoop());
  },

  // ---------- 操作 ----------
  flip() {
    this.setData({ devicePosition: this.data.devicePosition === 'front' ? 'back' : 'front' });
    this.box = this.data.mode === 'fallback' ? this.box : null;
  },

  // 拍一张不带贴图的原始照片，交给 AI 生成高清试穿效果
  capture() {
    wx.createCameraContext().takePhoto({
      quality: 'high',
      success: (res) => {
        app.globalData.pendingPhotoPath = res.tempImagePath;
        wx.redirectTo({ url: `/pages/tryon/tryon?id=${this.product.id}` });
      },
      fail: () => wx.showToast({ title: '拍照失败', icon: 'none' }),
    });
  },

  onCameraError() {
    this.setData({ mode: 'fallback', hint: '需要摄像头权限才能实时试穿' });
    wx.showModal({
      title: '需要摄像头权限',
      content: '请在设置中允许使用摄像头，用于实时试穿预览',
      confirmText: '去设置',
      success: (r) => r.confirm && wx.openSetting(),
    });
  },
});

function lerpBox(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    w: a.w + (b.w - a.w) * t,
    h: a.h + (b.h - a.h) * t,
  };
}

function drawGuide(ctx, b) {
  if (!b) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 8]);
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.restore();
}
