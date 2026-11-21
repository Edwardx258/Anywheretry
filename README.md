# AI 试衣间 · 服装商城微信小程序（MVP 骨架）

面向国内用户的服装商城小程序，顾客可以在小程序里直接“试穿”商品：

| 模式 | 体验 | 技术 | 成本 |
| --- | --- | --- | --- |
| **📷 实时预览** | 打开摄像头，衣服实时“贴”在身上跟着人动，快速看搭配 | 微信 VisionKit 人体检测 + canvas 贴图（端上运行） | 免费 |
| **✨ AI 高清试穿** | 上传/拍一张全身照，约 10~30 秒生成逼真上身效果图 | 阿里云百炼 AI 试衣（`aitryon` / `aitryon-plus`） | 按张计费 |

两种模式是串起来的：实时预览页点快门 → 拍下原始照片 → 自动进入 AI 高清试穿。

> **为什么不是“纯 AI 实时”？** 目前生成式试衣模型出一张图要十几秒，做不到摄像头逐帧实时生成。
> 业界的“实时试穿”基本都是 AR 贴图/3D 服装模型方案（真实感有限），而逼真效果靠生成式 AI。
> 所以这里采用“实时预览看大概 + AI 出高清图”的组合，兼顾即时互动和效果。

## 目录结构

```
fashion-tryon/
├── miniprogram/              微信小程序（原生，无需构建工具）
│   ├── config.js             后端地址
│   ├── utils/api.js          请求封装、上传、试衣轮询
│   └── pages/
│       ├── index/            商品列表（分类筛选）
│       ├── detail/           商品详情 + 试穿入口
│       ├── live/             实时试穿预览（摄像头 + 人体追踪 + 贴图）
│       └── tryon/            AI 高清试穿（上传照片 → 生成 → 保存/分享）
└── server/                   Node.js 后端（Express）
    ├── src/index.js          API、上传、限流、过期清理
    ├── src/products.json     示例商品（后续换成数据库/后台）
    ├── src/tryon/dashscope.js  阿里云百炼 AI 试衣适配
    ├── src/tryon/mock.js       本地联调用的假试衣服务（不花钱）
    └── public/garments/      服饰平铺图（目前是占位图，需替换成真实商品图）
```

## 本地跑起来

**1. 后端**

```bash
cd fashion-tryon/server
cp .env.example .env      # 默认 TRYON_PROVIDER=mock，不需要 API Key
npm install
npm start                 # http://localhost:3000
```

**2. 小程序**

1. 用[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)导入 `fashion-tryon/miniprogram` 目录（AppID 可先用测试号）。
2. 「详情 → 本地设置」勾选“不校验合法域名”。
3. 商品列表、详情、AI 试穿（mock 模式下几秒后返回原图）可以直接在模拟器里走通。
4. **实时预览必须真机调试**：开发者工具不支持摄像头帧和 VisionKit。真机调试时把 `config.js` 的 `API_BASE` 改成电脑的局域网 IP 或内网穿透地址。

**3. 接入真正的 AI 试衣**

1. 在[阿里云百炼](https://bailian.console.aliyun.com/)开通服务，创建 API Key。
2. `.env` 中设置 `TRYON_PROVIDER=dashscope`、`DASHSCOPE_API_KEY=...`。
3. `PUBLIC_BASE_URL` 必须是**公网可访问的 https 地址**——AI 服务要从这个地址拉取用户照片和服饰图（本地开发可用内网穿透）。
4. 把 `public/garments/` 的占位图换成真实的**服饰平铺图**（白底/干净背景、单件完整、≤5MB）。

## 接口一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/products?category=top\|bottom\|dress` | 商品列表 |
| GET | `/api/products/:id` | 商品详情 |
| POST | `/api/upload` | 上传人像（multipart，字段 `file`）→ `{ id, url }` |
| POST | `/api/tryon` | `{ productId, photoId }` → `{ jobId }` |
| GET | `/api/tryon/:jobId` | → `{ status: pending\|running\|succeeded\|failed, imageUrl? }` |

已内置：只接受本站上传的照片 id（防止被当成图片代理）、按 IP 每日限流（AI 按次收费，防刷）、用户照片和结果图 24 小时自动删除、AI 结果图转存到自有域名（第三方链接约 24 小时过期）。

## 实时预览：怎么做得更好

当前实现是用“人体框”按比例估算衣服位置，属于能用的第一版。提升路线：

1. **透明 PNG 贴图**：每件商品额外准备一张去背景的 `overlayImage`（products.json 里加字段即可），比白底图自然得多。
2. **关键点贴合**：用 VisionKit 返回的肩、髋关键点算衣服的宽度和倾斜角（代码里已留 TODO）。
3. **3D 服装 + XR-Frame**：用微信官方 XR-Frame 框架加载 3D 服装模型跟随人体，效果最好，但每件衣服都要做 3D 建模，成本高，适合主推款。
4. **第三方 AR 试穿 SDK**：商汤、字节火山引擎等有 AR 特效/试穿方案，需要商务对接，注意确认是否支持小程序端和国内部署。

## 上线前必做清单

**账号与资质**
- [ ] 小程序用**企业主体**注册（个人主体不能做电商和支付）
- [ ] 服务类目选择电商/服装相关类目；涉及 AI 生成能力的，按微信后台要求补充类目/资质
- [ ] 后端域名完成 ICP 备案，并在小程序后台配置 `request`、`uploadFile`、`downloadFile` 合法域名
- [ ] 接入微信支付（商户号）或对接微信小店，替换详情页的“立即购买”

**合规（重要）**
- [ ] 人脸照片属于《个人信息保护法》的**敏感个人信息**：需单独同意（已在试穿页加勾选框）、写进隐私政策、最小化保存（已 24 小时自动删除）
- [ ] 在小程序后台填写**用户隐私保护指引**，声明摄像头、相册、上传照片的用途
- [ ] 《互联网信息服务深度合成管理规定》《生成式人工智能服务管理暂行办法》：AI 生成图需显著标识（结果图已加“AI 生成效果图”角标）；使用已备案的大模型服务（如阿里云百炼），并确认自身是否需要做算法备案/登记
- [ ] 用户上传图片接入微信**内容安全接口** `security.mediaCheckAsync`（后端已留 TODO）

**工程**
- [ ] 文件存储换成阿里云 OSS / 腾讯云 COS（多实例部署时本地磁盘不共享）
- [ ] 任务表和限流计数换成数据库 / Redis
- [ ] 用 `wx.login` + 后端 `code2session` 获取 openid，按用户（而非 IP）限流、保存试穿记录
- [ ] 商品管理后台

## 成本粗估

AI 试衣按生成张数计费，具体单价以阿里云百炼官方价格页为准。建议：基础版 `aitryon` 做默认，`aitryon-plus` 给高客单价商品；配合每日次数限制，并考虑“下单返还/会员不限次”等运营玩法。实时预览在用户手机端运行，不产生服务器费用。
