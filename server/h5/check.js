// 国内网络检测页：判断 Decart 实时试穿在当前网络下是否可用。
// ①②③ 免费；④ 会真实连接模型约 12 秒（按秒计费）。

import { createDecartClient, models } from '@decartai/sdk';

const $ = (id) => document.getElementById(id);
const MODEL = new URLSearchParams(location.search).get('model') || 'lucy-vton-latest';

// SDK 默认用 Google 的 STUN 服务器，国内访问不了，会误判为“UDP 不通”。这里换成国内可用的，Google/Cloudflare 作备用。
const ICE_SERVERS = [
  { urls: ['stun:stun.miwifi.com:3478', 'stun:stun.chat.bilibili.com:3478'] },
  { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
];

const report = { time: new Date().toLocaleString('zh-CN'), model: MODEL };

// 令牌按需从自家后端获取（和试穿页一样，不暴露永久 Key）
const client = createDecartClient({
  apiKeyProvider: async () => {
    const res = await fetch('/api/realtime-token', { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || '获取令牌失败');
    if (body.mode !== 'live') throw new Error('服务器未配置 DECART_API_KEY（演示模式），无法测试真实延迟');
    return body.apiKey;
  },
});

function setStatus(key, level, text) {
  const el = $('s-' + key);
  el.className = 'pill ' + level;
  el.textContent = text;
}
function setResult(key, text) { $('r-' + key).textContent = text; }

// ---------- ① 环境 ----------
function checkEnv() {
  const ua = navigator.userAgent;
  const wechat = /MicroMessenger/i.test(ua);
  const webrtc = typeof RTCPeerConnection === 'function';
  const camera = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  report.env = { wechat, webrtc, camera, secure: window.isSecureContext, ua };
  const lines = [
    `浏览器：${wechat ? '微信内置浏览器' : '普通浏览器'}`,
    `WebRTC：${webrtc ? '支持' : '不支持'}`,
    `摄像头接口：${camera ? '支持' : '不支持'}${window.isSecureContext ? '' : '（需要 https 才能用摄像头）'}`,
  ];
  setResult('env', lines.join('\n'));
  if (webrtc && camera) setStatus('env', 'ok', '支持');
  else setStatus('env', 'bad', wechat ? '请用系统浏览器打开' : '不支持');
}

// ---------- ② HTTPS 可达 ----------
async function checkHttp() {
  setStatus('http', '', '检测中…');
  const times = [];
  let lastErr = '';
  for (let i = 0; i < 4; i++) {
    const t0 = performance.now();
    try {
      await Promise.race([
        fetch(`https://api.decart.ai/?_=${Date.now()}`, { mode: 'no-cors', cache: 'no-store' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('超时')), 8000)),
      ]);
      times.push(Math.round(performance.now() - t0));
    } catch (e) {
      lastErr = e.message || '连接失败';
    }
  }
  if (!times.length) {
    report.http = { ok: false, error: lastErr };
    setStatus('http', 'bad', '无法访问');
    setResult('http', `连不上 api.decart.ai（${lastErr}）。当前网络可能屏蔽了该服务。`);
    return;
  }
  // 第一次包含 DNS+TLS 握手，后面几次更接近真实往返
  const steady = times.length > 1 ? Math.min(...times.slice(1)) : times[0];
  report.http = { ok: true, firstMs: times[0], steadyMs: steady };
  const level = steady < 250 ? 'ok' : steady < 500 ? 'warn' : 'bad';
  setStatus('http', level, level === 'ok' ? '良好' : level === 'warn' ? '偏慢' : '很慢');
  setResult('http', `首次连接 ${times[0]} ms，之后往返约 ${steady} ms（${times.length}/4 次成功）`);
}

// ---------- ③ UDP / WebRTC ----------
async function checkUdp() {
  setStatus('udp', '', '检测中…');
  try {
    const r = await client.realtime.checkConnectivity({ iceServers: ICE_SERVERS });
    report.udp = r;
    const t = r.metrics.transport;
    if (t === 'udp') {
      setStatus('udp', 'ok', 'UDP 正常');
      setResult('udp', `可以直连（STUN 响应 ${r.metrics.rttMs ?? '-'} ms）`);
    } else if (t === 'relay') {
      setStatus('udp', 'warn', '需中转');
      setResult('udp', 'UDP 受限，视频会走 TCP/中转，延迟和卡顿会增加。');
    } else {
      setStatus('udp', 'bad', '不通');
      setResult('udp', '无法建立 WebRTC 通道。' + (r.reasons || []).join(' '));
    }
  } catch (e) {
    report.udp = { error: e.message };
    setStatus('udp', 'bad', '出错');
    setResult('udp', e.message);
  }
}

// ---------- ④ 深度测试：真实连接模型 ----------
async function checkDeep() {
  setStatus('deep', '', '测试中…');
  try {
    const health = await fetch('/api/health').then((r) => r.json()).catch(() => ({}));
    if (health.realtime !== 'decart') {
      setStatus('deep', 'warn', '未配置');
      setResult('deep', '服务器还没配置 DECART_API_KEY（演示模式），无法测试真实延迟。');
      return;
    }
    setResult('deep', '正在连接 AI 模型，约 12 秒，请勿离开页面…');
    const r = await client.realtime.checkConnectivity({ deep: true, model: models.realtime(MODEL), iceServers: ICE_SERVERS });
    report.deep = r;
    const m = r.metrics;
    const g2g = m.g2gMs;
    const lines = [
      `动作 → 看到画面延迟：${g2g != null ? Math.round(g2g) + ' ms' : '未测到'}`,
      `首帧出现：${m.ttffMs != null ? (m.ttffMs / 1000).toFixed(1) + ' 秒' : '-'}`,
      `丢包率：${m.packetLoss != null ? (m.packetLoss * 100).toFixed(1) + '%' : '-'}`,
      `抖动：${m.upstreamJitterMs != null ? Math.round(m.upstreamJitterMs) + ' ms' : '-'}`,
      `传输方式：${m.transport === 'udp' ? 'UDP 直连' : m.transport === 'relay' ? '中转' : '失败'}`,
    ];
    if (r.reasons && r.reasons.length) lines.push('说明：' + r.reasons.join(' '));
    setResult('deep', lines.join('\n'));
    const level = { good: 'ok', fair: 'warn', poor: 'bad', critical: 'bad' }[r.quality] || '';
    setStatus('deep', level, { good: '流畅', fair: '可用', poor: '卡顿', critical: '不可用' }[r.quality] || r.quality);
  } catch (e) {
    report.deep = { error: e.message };
    setStatus('deep', 'bad', '失败');
    setResult('deep', e.message);
  }
}

// ---------- 结论 ----------
function verdict() {
  const el = $('verdict');
  const d = report.deep;
  if (d && d.quality) {
    const g = d.metrics.g2gMs;
    if (d.quality === 'good') { el.className = 'res ok'; el.textContent = `✅ 流畅可用（延迟约 ${Math.round(g)} ms）`; }
    else if (d.quality === 'fair') { el.className = 'res warn'; el.textContent = `⚠️ 能用但有明显延迟（约 ${Math.round(g || 0)} ms），换装动作会慢半拍`; }
    else { el.className = 'res bad'; el.textContent = '❌ 当前网络下体验很差，不建议上线给这类网络的用户'; }
    return;
  }
  if (report.http && !report.http.ok) { el.className = 'res bad'; el.textContent = '❌ 连不上试穿服务器，当前网络无法使用'; return; }
  if (report.udp && report.udp.metrics && report.udp.metrics.transport === 'failed') { el.className = 'res bad'; el.textContent = '❌ 实时视频通道不通'; return; }
  el.className = 'res';
  el.textContent = '基础检测完成。点“测试真实延迟”才能知道实际试穿是否流畅。';
}

$('basicBtn').addEventListener('click', async () => {
  $('basicBtn').disabled = true;
  checkEnv();
  await checkHttp();
  await checkUdp();
  verdict();
  $('basicBtn').disabled = false;
});

$('deepBtn').addEventListener('click', async () => {
  $('deepBtn').disabled = true;
  await checkDeep();
  verdict();
  $('deepBtn').disabled = false;
});

$('copyBtn').addEventListener('click', async () => {
  const text = JSON.stringify(report, null, 2);
  try { await navigator.clipboard.writeText(text); $('copyBtn').textContent = '已复制'; }
  catch (_) { prompt('长按全选复制：', text); }
  setTimeout(() => ($('copyBtn').textContent = '复制检测结果（发给开发者）'), 1500);
});

checkEnv();
