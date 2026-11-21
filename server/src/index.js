// 服装商城 + 实时视频 AI 试穿 后端
//
// API：
//   GET  /api/products            商品列表
//   GET  /api/products/:id        商品详情
//   POST /api/realtime-token      为 H5 试穿页签发短期会话令牌（不把永久 API Key 暴露给前端）
//
// 静态文件：
//   /tryon/      H5 实时试穿页（小程序通过 <web-view> 打开）
//   /garments/*  服饰图（实时模型的参考图）

require('dotenv').config();

const path = require('path');
const express = require('express');
const products = require('./products.json');

// ---------- 配置 ----------
const PORT = Number(process.env.PORT || 3000);
const DECART_API_KEY = process.env.DECART_API_KEY || '';
const MODEL = process.env.DECART_VTON_MODEL || 'lucy-vton-latest';
const PUBLIC_ORIGIN = (process.env.TRYON_PUBLIC_ORIGIN || '').replace(/\/$/, '');
const MAX_SESSION_SECONDS = Number(process.env.TRYON_MAX_SESSION_SECONDS || 90);
const DAILY_SESSIONS = Number(process.env.TRYON_DAILY_SESSIONS_PER_IP || 10);

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Decart SDK 是 ESM 包，CommonJS 里用动态 import 加载一次
let decartClientPromise = null;
function getDecartClient() {
  if (!decartClientPromise) {
    decartClientPromise = import('@decartai/sdk').then(({ createDecartClient }) =>
      createDecartClient({ apiKey: DECART_API_KEY })
    );
  }
  return decartClientPromise;
}

// ---------- 限流：按 IP 每日次数（单机内存版；多实例请换 Redis，接入登录后改为按 openid） ----------
const usage = new Map();
const today = () => new Date().toISOString().slice(0, 10);
function takeQuota(ip) {
  const key = `${today()}|${ip}`;
  const n = usage.get(key) || 0;
  if (n >= DAILY_SESSIONS) return false;
  usage.set(key, n + 1);
  return true;
}
function refundQuota(ip) {
  const key = `${today()}|${ip}`;
  const n = usage.get(key) || 0;
  if (n > 0) usage.set(key, n - 1);
}
setInterval(() => {
  for (const k of usage.keys()) if (!k.startsWith(today())) usage.delete(k);
}, 3600 * 1000).unref();

// ---------- 路由 ----------
const app = express();
app.set('trust proxy', true); // 部署在 Nginx / 负载均衡之后时取真实客户端 IP
app.use(express.json({ limit: '10kb' }));

// H5 页只需要摄像头，不需要麦克风
app.use('/tryon', (req, res, next) => {
  res.set('Permissions-Policy', 'camera=(self), microphone=()');
  next();
});
app.use(express.static(PUBLIC_DIR, { maxAge: '1h' }));

const productView = (p) => ({
  id: p.id,
  name: p.name,
  price: p.price,
  category: p.category,
  cover: p.cover,
  garmentImage: p.garmentImage,
  tryonPrompt: p.tryonPrompt,
  description: p.description,
});

app.get('/api/health', (req, res) =>
  res.json({ ok: true, realtime: DECART_API_KEY ? 'decart' : 'demo', model: MODEL })
);

app.get('/api/products', (req, res) => {
  const { category } = req.query;
  const list = category ? products.filter((p) => p.category === category) : products;
  res.json(list.map(productView));
});

app.get('/api/products/:id', (req, res) => {
  const p = products.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: '商品不存在' });
  res.json(productView(p));
});

// 在用户点击“开始试穿”、拿到摄像头权限之后再调用；令牌 60 秒内必须用来建立连接
app.post('/api/realtime-token', async (req, res) => {
  if (!DECART_API_KEY) {
    return res.json({ mode: 'demo', maxSessionSeconds: MAX_SESSION_SECONDS });
  }
  if (!takeQuota(req.ip)) {
    return res.status(429).json({ error: `今天的实时试穿次数已用完（每天 ${DAILY_SESSIONS} 次），明天再来吧` });
  }
  try {
    const client = await getDecartClient();
    const { apiKey, expiresAt } = await client.tokens.create({
      expiresIn: 60,
      allowedModels: [MODEL],
      ...(PUBLIC_ORIGIN ? { allowedOrigins: [PUBLIC_ORIGIN] } : {}),
      // 服务端强制的单次会话时长上限，前端改不掉
      constraints: { realtime: { maxSessionDuration: MAX_SESSION_SECONDS } },
    });
    res.json({ mode: 'live', apiKey, expiresAt, model: MODEL, maxSessionSeconds: MAX_SESSION_SECONDS });
  } catch (err) {
    refundQuota(req.ip); // 没签发成功不算次数
    console.error('签发实时令牌失败', err);
    res.status(502).json({ error: '试穿服务暂时不可用，请稍后再试' });
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message || '请求错误' });
});

app.listen(PORT, () => {
  console.log(
    `服务已启动: http://localhost:${PORT}  H5 试穿页: http://localhost:${PORT}/tryon/?id=t001  ` +
      `模式: ${DECART_API_KEY ? 'Decart ' + MODEL : '演示（未配置 DECART_API_KEY）'}`
  );
});
