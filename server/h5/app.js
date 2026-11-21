// H5 实时试穿页（Anywear 式实时视频虚拟试穿）
//
// 流程：用户点“开始” → 打开摄像头 → 向自家后端要一个短期令牌 → 用 Decart SDK 通过 WebRTC
//      把摄像头画面实时送到 Lucy VTON 模型 → 拿回“已经穿上这件衣服”的视频流直接播放。
//      切换衣服只需 set({ image })，不用重连。
//
// 运行环境：手机/电脑浏览器（主要），也可嵌入微信小程序 <web-view>。需要 https + 摄像头权限。
// 未配置 DECART_API_KEY 时进入“演示模式”：只显示摄像头原画，用来联调页面流程。

import { createDecartClient, models } from '@decartai/sdk';

const $ = (id) => document.getElementById(id);
const els = {
  video: $('video'), product: $('product'), timer: $('timer'), status: $('status'),
  aiBadge: $('aiBadge'), startSheet: $('startSheet'), endSheet: $('endSheet'),
  endTitle: $('endTitle'), endText: $('endText'), consent: $('consent'),
  startBtn: $('startBtn'), againBtn: $('againBtn'), controls: $('controls'), rail: $('rail'),
  flipBtn: $('flipBtn'), stopBtn: $('stopBtn'), buyBtn: $('buyBtn'), buyBtn2: $('buyBtn2'), back: $('back'),
};

const params = new URLSearchParams(location.search);
const CONSENT_KEY = 'live_tryon_consent_v1';
const inMiniProgram = () => window.__wxjs_environment === 'miniprogram';
const inWeChatBrowser = /MicroMessenger/i.test(navigator.userAgent);

const state = {
  products: [],
  current: null,          // 当前试穿的商品
  facingMode: 'user',
  stream: null,           // 本地摄像头
  rtc: null,              // Decart 实时会话
  mode: null,             // 'live' | 'demo'
  maxSeconds: 90,
  startedAt: 0,
  tick: null,
  model: models.realtime('lucy-vton-latest'), // 采集分辨率/帧率按模型要求；以后端下发的为准
  switching: false,
};

// ---------- 初始化 ----------
init().catch((e) => showStatus(e.message || '页面加载失败'));

async function init() {
  try { els.consent.checked = localStorage.getItem(CONSENT_KEY) === '1'; } catch (_) { /* 无痕模式 */ }

  const res = await fetch('/api/products');
  if (!res.ok) throw new Error('商品加载失败');
  state.products = await res.json();
  state.current = state.products.find((p) => p.id === params.get('id')) || state.products[0];
  renderProduct();
  renderRail();

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.RTCPeerConnection) {
    els.startBtn.disabled = true;
    showStatus(
      inWeChatBrowser && !inMiniProgram()
        ? '微信内置浏览器暂不支持摄像头试穿：请点右上角「···」，选择「在浏览器打开」'
        : '当前浏览器不支持实时视频，请换用最新版 Safari / Chrome 再试'
    );
  }
}

function renderProduct() {
  const p = state.current;
  els.back.href = `/product.html?id=${encodeURIComponent(p.id)}`;
  els.product.innerHTML = '';
  const b = document.createElement('b');
  b.textContent = p.name;
  els.product.append(b, document.createTextNode(`¥${p.price}`));
}

function renderRail() {
  els.rail.innerHTML = '';
  for (const p of state.products) {
    const item = document.createElement('div');
    item.className = 'item' + (p.id === state.current.id ? ' on' : '');
    item.dataset.id = p.id;
    const img = document.createElement('img');
    img.src = p.cover;
    img.alt = p.name;
    const label = document.createElement('div');
    label.textContent = `¥${p.price}`;
    item.append(img, label);
    item.addEventListener('click', () => switchGarment(p));
    els.rail.append(item);
  }
}

// ---------- 开始 / 结束 ----------
els.consent.addEventListener('change', () => {
  try { localStorage.setItem(CONSENT_KEY, els.consent.checked ? '1' : '0'); } catch (_) { /* ignore */ }
});
els.startBtn.addEventListener('click', start);
els.againBtn.addEventListener('click', start);
els.stopBtn.addEventListener('click', () => stop('试穿结束', '喜欢的话就把它带回家吧～'));
els.flipBtn.addEventListener('click', flipCamera);
els.buyBtn.addEventListener('click', goBuy);
els.buyBtn2.addEventListener('click', goBuy);

async function start() {
  if (!els.consent.checked) {
    showStatus('请先勾选同意，才能开启摄像头试穿', 2500);
    return;
  }
  els.startBtn.disabled = els.againBtn.disabled = true;
  els.startSheet.hidden = els.endSheet.hidden = true;

  try {
    // 1. 摄像头（必须在用户点击后调用）
    showStatus('正在打开摄像头…');
    state.stream = await openCamera();

    // 2. 拿到摄像头后再要令牌（令牌 60 秒内有效）
    showStatus('正在连接试穿服务…');
    const tokenRes = await fetch('/api/realtime-token', { method: 'POST' });
    const token = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok) throw new Error(token.error || '试穿服务暂时不可用');
    state.mode = token.mode;
    if (token.model) state.model = models.realtime(token.model);
    state.maxSeconds = token.maxSessionSeconds || 90;

    if (token.mode === 'demo') {
      // 演示模式：直接显示原画，方便没有 API Key 时联调
      showLocalPreview();
      els.aiBadge.textContent = '演示模式 · 未接入 AI';
      onLive();
      return;
    }

    // 3. 建立实时会话，初始就带上当前这件衣服
    const client = createDecartClient({ apiKey: token.apiKey });
    const garment = state.current;
    state.rtc = await client.realtime.connect(state.stream, {
      model: state.model,
      mirror: 'auto', // 前置摄像头自动镜像，像照镜子一样
      initialState: garmentInput(garment),
      onRemoteStream: (remote) => {
        els.video.classList.remove('mirror');
        els.video.srcObject = remote;
        els.video.play().catch(() => {});
      },
      onQueuePosition: (q) => showStatus(`试穿的人有点多，正在排队（第 ${q.position} 位）…`),
      onCapacityWait: ({ retryAfterMs }) => showStatus(`试穿的人有点多，${Math.ceil(retryAfterMs / 1000)} 秒后自动重试…`),
    });

    state.rtc.on('connectionChange', (s) => {
      if (s === 'generating') onLive();
      else if (s === 'reconnecting') showStatus('网络波动，正在重连…');
    });
    state.rtc.on('connectionQuality', (q) => {
      if (q && !q.warmingUp && (q.quality === 'poor' || q.quality === 'critical')) showStatus('网络较差，画面可能卡顿', 2500);
    });
    state.rtc.on('sessionEnded', ({ reason }) => stop(...endMessage(reason)));
    state.rtc.on('error', (e) => console.warn('[tryon]', e));

    if (state.rtc.getConnectionState() === 'generating') onLive();
    else showStatus('AI 正在为你换装…');
  } catch (e) {
    console.error(e);
    stop('没能开始试穿', friendlyError(e));
  }
}

function onLive() {
  if (state.tick) return;
  hideStatus();
  els.controls.hidden = false;
  state.startedAt = Date.now();
  els.timer.hidden = false;
  updateTimer();
  state.tick = setInterval(updateTimer, 1000);
}

function updateTimer() {
  const left = Math.max(0, state.maxSeconds - Math.floor((Date.now() - state.startedAt) / 1000));
  els.timer.textContent = `剩余 ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  // 服务端会在到点时强制断开；这里提前收尾，体验更平滑
  if (left <= 0) stop('本次试穿时间到', '可以再试一次，或者直接把喜欢的带回家～');
}

function stop(title, text) {
  clearInterval(state.tick);
  state.tick = null;
  if (state.rtc) { try { state.rtc.disconnect(); } catch (_) { /* ignore */ } state.rtc = null; }
  if (state.stream) { state.stream.getTracks().forEach((t) => t.stop()); state.stream = null; }
  els.video.srcObject = null;
  els.controls.hidden = true;
  els.timer.hidden = true;
  hideStatus();
  els.endTitle.textContent = title;
  els.endText.textContent = text || '';
  els.endSheet.hidden = false;
  els.startBtn.disabled = els.againBtn.disabled = false;
}

// 离开页面（切后台、返回小程序）立即断开，避免继续计费、继续传输画面
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (state.rtc || state.stream)) stop('试穿已暂停', '离开页面后会自动断开，点“再试一次”继续');
});
window.addEventListener('pagehide', () => { if (state.rtc) state.rtc.disconnect(); });

// ---------- 摄像头 ----------
async function openCamera() {
  const model = state.model;
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: state.facingMode,
        frameRate: model.fps,
        width: { ideal: model.width },
        height: { ideal: model.height },
      },
    });
  } catch (e) {
    if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
      throw new Error(
        inWeChatBrowser
          ? '没有摄像头权限。请在手机设置中允许微信使用摄像头，或点右上角「···」选择「在浏览器打开」'
          : '没有摄像头权限。请在浏览器地址栏或手机设置中允许本网站使用摄像头'
      );
    }
    throw new Error('摄像头打开失败：' + (e && e.message ? e.message : '未知错误'));
  }
}

function showLocalPreview() {
  els.video.srcObject = state.stream;
  els.video.classList.toggle('mirror', state.facingMode === 'user');
  els.video.play().catch(() => {});
}

async function flipCamera() {
  state.facingMode = state.facingMode === 'user' ? 'environment' : 'user';
  try {
    const next = await openCamera();
    const track = next.getVideoTracks()[0];
    if (state.rtc) await state.rtc.replaceVideoTrack(track);
    if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
    state.stream = next;
    if (!state.rtc) showLocalPreview();
  } catch (e) {
    state.facingMode = state.facingMode === 'user' ? 'environment' : 'user';
    showStatus('切换摄像头失败', 2000);
  }
}

// ---------- 换衣服 ----------
function garmentInput(p) {
  // 参考图用同源 URL，SDK 会读取后发送；prompt 作为补充描述（英文效果更稳定）
  const input = { image: new URL(p.garmentImage, location.href).href };
  if (p.tryonPrompt) input.prompt = { text: p.tryonPrompt, enhance: true };
  return input;
}

async function switchGarment(p) {
  if (p.id === state.current.id || state.switching) return;
  state.current = p;
  renderProduct();
  const item = els.rail.querySelector(`[data-id="${p.id}"]`);
  els.rail.querySelectorAll('.item').forEach((n) => n.classList.toggle('on', n === item));
  history.replaceState(null, '', `?id=${encodeURIComponent(p.id)}`);

  if (!state.rtc) return; // 还没开始或演示模式，只更新选择
  state.switching = true;
  item && item.classList.add('busy');
  try {
    const g = garmentInput(p);
    await state.rtc.setImage(g.image, g.prompt ? { prompt: g.prompt.text, enhance: true } : {});
  } catch (e) {
    console.warn(e);
    showStatus('换装失败，请再点一次', 2000);
  } finally {
    state.switching = false;
    item && item.classList.remove('busy');
  }
}

// ---------- 购买 / 返回小程序 ----------
function goBuy() {
  const id = encodeURIComponent(state.current.id);
  stop('试穿结束', '');
  if (inMiniProgram() && window.wx && wx.miniProgram) {
    wx.miniProgram.redirectTo({ url: `/pages/detail/detail?id=${id}&from=tryon` });
  } else {
    // 网站：回到商品页并直接弹出“微信下单”
    location.href = `/product.html?id=${id}&order=1`;
  }
}

// ---------- 提示 ----------
let statusTimer = null;
function showStatus(text, autoHideMs) {
  clearTimeout(statusTimer);
  els.status.textContent = text;
  els.status.hidden = false;
  if (autoHideMs) statusTimer = setTimeout(hideStatus, autoHideMs);
}
function hideStatus() { els.status.hidden = true; }

function endMessage(reason) {
  switch (reason) {
    case 'session_limit': return ['试穿的人太多了', '当前同时试穿人数已满，请稍后再试'];
    case 'insufficient_credits': return ['试穿服务暂停', '服务额度不足，请联系客服'];
    case 'moderation_violation':
    case 'policy_violation': return ['试穿已中止', '画面内容不符合规范，请调整后重试'];
    default: return ['本次试穿结束', '可以再试一次，或者直接把喜欢的带回家～'];
  }
}

function friendlyError(e) {
  const msg = (e && e.message) || '';
  if (/Concurrent session limit/i.test(msg)) return '当前同时试穿人数已满，请稍后再试';
  if (/TOKEN_EXPIRED|expired/i.test(msg)) return '连接超时，请重试';
  return msg || '网络异常，请检查网络后重试';
}
