// 服装商城 + AI 试衣 后端
//
// API：
//   GET  /api/products            商品列表
//   GET  /api/products/:id        商品详情
//   POST /api/upload              上传人像照片（multipart，字段名 file）→ { id, url }
//   POST /api/tryon               发起试衣 { productId, photoId } → { jobId }
//   GET  /api/tryon/:jobId        查询试衣进度 → { status, imageUrl?, error? }
//
// 静态文件：/garments/*（服饰平铺图）、/uploads/*（用户照片）、/results/*（试衣结果）

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const { createDashscopeProvider } = require('./tryon/dashscope');
const { createMockProvider } = require('./tryon/mock');
const products = require('./products.json');

// ---------- 配置 ----------
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DAILY_LIMIT = Number(process.env.TRYON_DAILY_LIMIT_PER_IP || 20);
const RETENTION_MS = Number(process.env.UPLOAD_RETENTION_HOURS || 24) * 3600 * 1000;

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
const RESULT_DIR = path.join(PUBLIC_DIR, 'results');
for (const d of [UPLOAD_DIR, RESULT_DIR]) fs.mkdirSync(d, { recursive: true });

const provider =
  (process.env.TRYON_PROVIDER || 'mock') === 'dashscope'
    ? createDashscopeProvider({
        apiKey: process.env.DASHSCOPE_API_KEY,
        model: process.env.DASHSCOPE_TRYON_MODEL || 'aitryon-plus',
      })
    : createMockProvider();

// ---------- 工具函数 ----------
const publicUrl = (p) => PUBLIC_BASE_URL + p;
const productView = (p) => ({ ...p, cover: publicUrl(p.cover), garmentImage: publicUrl(p.garmentImage) });

// 简单的按 IP 每日限流（单机内存版；多实例部署请换成 Redis）
const usage = new Map(); // key: `${day}|${ip}` → count
function takeQuota(ip) {
  const day = new Date().toISOString().slice(0, 10);
  const key = `${day}|${ip}`;
  const n = usage.get(key) || 0;
  if (n >= DAILY_LIMIT) return false;
  usage.set(key, n + 1);
  return true;
}

// 试衣任务表（单机内存版；正式环境请存数据库）
const jobs = new Map(); // jobId → { providerTaskId, status, imageUrl, error, createdAt }

// 把 AI 结果图转存到自己的服务器（第三方结果链接会过期，且小程序下载需配置合法域名）
async function rehostResult(remoteUrl, jobId) {
  if (remoteUrl.startsWith(PUBLIC_BASE_URL)) return remoteUrl; // mock 模式直接返回本站链接
  const res = await fetch(remoteUrl);
  if (!res.ok) throw new Error(`下载结果图失败: HTTP ${res.status}`);
  const ext = (res.headers.get('content-type') || '').includes('png') ? '.png' : '.jpg';
  const file = `${jobId}${ext}`;
  fs.writeFileSync(path.join(RESULT_DIR, file), Buffer.from(await res.arrayBuffer()));
  return publicUrl(`/results/${file}`);
}

// 定期删除过期的用户照片和结果图（人脸照片属于敏感个人信息，不要长期保存）
function cleanup() {
  const now = Date.now();
  for (const dir of [UPLOAD_DIR, RESULT_DIR]) {
    for (const f of fs.readdirSync(dir)) {
      const fp = path.join(dir, f);
      try {
        if (now - fs.statSync(fp).mtimeMs > RETENTION_MS) fs.unlinkSync(fp);
      } catch (_) {
        /* 文件可能已被删除 */
      }
    }
  }
  for (const [id, job] of jobs) if (now - job.createdAt > RETENTION_MS) jobs.delete(id);
  for (const key of usage.keys()) if (!key.startsWith(new Date().toISOString().slice(0, 10))) usage.delete(key);
}
setInterval(cleanup, 10 * 60 * 1000).unref();

// ---------- 路由 ----------
const app = express();
app.set('trust proxy', true); // 部署在 Nginx / 负载均衡之后时，用真实客户端 IP 限流
app.use(express.json({ limit: '100kb' }));
app.use(express.static(PUBLIC_DIR, { maxAge: '1h' }));

app.get('/api/health', (req, res) => res.json({ ok: true, provider: provider.name }));

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

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
      cb(null, crypto.randomUUID() + ext);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // AI 试衣接口要求 ≤ 5MB
  fileFilter: (req, file, cb) => {
    const ok = /\.(jpe?g|png|bmp|heic)$/i.test(file.originalname) || /^image\//.test(file.mimetype);
    cb(ok ? null : new Error('只支持 jpg / png / bmp / heic 图片'), ok);
  },
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' });
  // TODO 上线前：调用微信内容安全接口（security.mediaCheckAsync）审核用户上传的图片
  res.json({ id: req.file.filename, url: publicUrl(`/uploads/${req.file.filename}`) });
});

app.post('/api/tryon', async (req, res) => {
  const { productId, photoId } = req.body || {};
  const product = products.find((p) => p.id === productId);
  if (!product) return res.status(400).json({ error: '商品不存在' });

  // 只接受本站上传过的照片 id，避免后端被当成任意图片的转发代理
  if (typeof photoId !== 'string' || !/^[0-9a-f-]{36}\.[a-z]+$/i.test(photoId) ||
      !fs.existsSync(path.join(UPLOAD_DIR, photoId))) {
    return res.status(400).json({ error: '照片不存在或已过期，请重新上传' });
  }

  if (!takeQuota(req.ip)) {
    return res.status(429).json({ error: `今天的试穿次数已用完（每天 ${DAILY_LIMIT} 次），明天再来吧` });
  }

  const garmentUrl = publicUrl(product.garmentImage);
  try {
    const { taskId } = await provider.submit({
      personImageUrl: publicUrl(`/uploads/${photoId}`),
      // 连衣裙 / 连体衣按接口要求放在上装字段
      topGarmentUrl: product.category === 'bottom' ? undefined : garmentUrl,
      bottomGarmentUrl: product.category === 'bottom' ? garmentUrl : undefined,
    });
    const jobId = crypto.randomUUID();
    jobs.set(jobId, { providerTaskId: taskId, status: 'pending', createdAt: Date.now() });
    res.json({ jobId });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'AI 试衣服务暂时不可用，请稍后再试' });
  }
});

app.get('/api/tryon/:jobId', async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: '任务不存在或已过期' });

  if (job.status === 'pending' || job.status === 'running') {
    try {
      const r = await provider.query(job.providerTaskId);
      if (r.status === 'succeeded') {
        job.imageUrl = await rehostResult(r.imageUrl, req.params.jobId);
        job.status = 'succeeded';
      } else if (r.status === 'failed') {
        job.status = 'failed';
        job.error = r.error;
        console.warn('试衣任务失败', job.providerTaskId, r.error);
      } else {
        job.status = r.status;
      }
    } catch (err) {
      console.error(err);
      // 查询出错时不改状态，前端下次轮询会重试
    }
  }

  res.json({
    status: job.status,
    imageUrl: job.imageUrl,
    error: job.status === 'failed' ? '生成失败：请换一张正面、全身、只有一个人的清晰照片再试' : undefined,
  });
});

// multer / 其他错误统一返回 JSON
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: '图片不能超过 5MB' });
  }
  res.status(400).json({ error: err.message || '请求错误' });
});

app.listen(PORT, () => {
  console.log(`服务已启动: http://localhost:${PORT}  试衣服务: ${provider.name}  对外地址: ${PUBLIC_BASE_URL}`);
});
