# AI 试衣间 · 实时视频虚拟试穿小程序（MVP 骨架）

参照 **Anywear: Live Virtual Try-On** 的体验：顾客打开摄像头，衣服**实时“穿”在视频里的自己身上**，转身、抬手都跟着动，下方一排商品点一下就换装，不用上传照片、不用等生成。

## 原理

```
小程序 <web-view>
   └─ H5 试穿页 (server/h5)
        ├─ getUserMedia 打开摄像头
        ├─ POST /api/realtime-token  ──► 自家后端用永久 Key 签发 60 秒短期令牌
        └─ Decart SDK (WebRTC/LiveKit) ──摄像头视频流──► Decart Lucy VTON 实时模型（云端 GPU）
                                       ◄──已换装的视频流──
           换衣服：rtc.setImage(服饰图)，不断线即时切换
```

- **实时模型**：Anywear 背后就是 Decart 公司的 Lucy VTON 实时视频试穿模型，官方提供 JS SDK（`@decartai/sdk`），本项目直接接它。
- **为什么用 web-view + H5**：实时模型通过 WebRTC 收发视频，原生小程序没有标准 WebRTC，H5 里有。H5 内用 `wx.miniProgram.redirectTo` 跳回商品页下单。
- **安全与成本**：永久 API Key 只在后端；令牌限定模型、限定来源域名、**服务端强制单次时长上限**（默认 90 秒）；按 IP 每日次数限制；页面切后台立即断开，不再计费、不再传画面。

## 目录结构

```
fashion-tryon/
├── miniprogram/                 微信小程序（原生）
│   ├── config.js                API 地址、H5 试穿页地址
│   └── pages/
│       ├── index/               商品列表
│       ├── detail/              商品详情 →「AI 实时试穿」入口
│       └── live/                <web-view> 打开 H5 试穿页
└── server/                      Node.js 后端
    ├── src/index.js             商品 API、实时令牌签发、限流
    ├── src/products.json        示例商品（含服饰参考图、英文描述 tryonPrompt）
    ├── h5/                      H5 实时试穿页源码（index.html / style.css / app.js）
    └── public/garments/         服饰参考图（目前是占位图，要换成真实商品图）
```

## 本地运行

```bash
cd fashion-tryon/server
cp .env.example .env     # 不填 DECART_API_KEY = 演示模式（只显示摄像头原画，用来联调页面）
npm install
npm start                # 会先打包 H5，然后启动 http://localhost:3000
```

- 电脑浏览器直接打开 `http://localhost:3000/tryon/?id=t001` 就能看到试穿页（localhost 允许用摄像头）。
- 在 `.env` 填上 [Decart 平台](https://platform.decart.ai) 的 API Key 后，就是真正的 AI 实时试穿。
- 小程序：微信开发者工具导入 `fashion-tryon/miniprogram`，勾选“不校验合法域名”。**web-view 里的摄像头必须真机 + https 测试**（可用内网穿透得到 https 地址，填到 `config.js`）。

## ⚠️ 面向国内用户，上线前必须先解决的三件事

这是这个方案最大的风险，建议**先用小范围真机测试验证，再决定是否投入**：

1. **网络延迟与稳定性**：Decart 的服务器在境外（低延迟的 fast 模式目前只在美国区）。国内用户的视频流要跨境往返，WebRTC 延迟和丢包会明显高于海外用户，体验可能远不如 Anywear 官方演示。
   → 先让几位国内同事用 4G/5G 和家庭宽带实测，看延迟能否接受。
2. **个人信息出境**：摄像头画面含人脸（敏感个人信息），实时传到境外服务器属于《个人信息保护法》下的**数据出境**，需要单独同意（页面已有勾选框）、在隐私政策中说明，并视规模完成个人信息出境标准合同备案或安全评估。
3. **生成式 AI 监管**：在国内向公众提供生成式 AI 服务，一般要求使用已完成备案的模型/服务，并对生成内容做标识（页面已加“AI 实时效果”标识）。境外未备案模型面向国内公众上线存在合规风险，需要咨询法务。

**可行的路线**：
- 先用 Decart 快速做出 Demo，验证用户是否喜欢这种玩法；
- 同时找国内厂商（阿里云、火山引擎、腾讯云、商汤等）确认有没有**国内部署的实时视频试穿**能力，或者谈私有化部署；
- 本项目里换供应商只需改 `server/src/index.js` 的令牌签发和 `server/h5/app.js` 的连接部分，商城和小程序不用动。

## 上线清单

**账号与资质**
- [ ] 小程序用**企业主体**注册（个人主体不能用 web-view，也不能做电商）
- [ ] 域名完成 ICP 备案，HTTPS 证书
- [ ] 小程序后台：`request` 合法域名 = 后端域名；**业务域名** = H5 试穿页域名（需上传校验文件到网站根目录）
- [ ] `.env` 中 `TRYON_PUBLIC_ORIGIN` 填 H5 页的 https 源，令牌只能从这个域名使用
- [ ] 接入微信支付或微信小店，替换“立即购买”

**合规**
- [ ] 隐私政策 + 小程序后台“用户隐私保护指引”中声明摄像头用途和数据出境（见上文）
- [ ] 确认生成式 AI 相关备案要求（见上文）

**体验**
- [ ] 换成真实服饰图：白底/干净背景、单件平铺、主体完整；`tryonPrompt` 写准确的英文描述
- [ ] iOS / Android 各主流机型真机测试 web-view 摄像头（iOS 需较新的系统和微信版本）
- [ ] Nginx 开启 gzip/brotli（H5 脚本约 1.1MB，压缩后小很多），静态资源上 CDN

**工程**
- [ ] `wx.login` 拿 openid，按用户限次数（现在按 IP）；限流计数换 Redis
- [ ] 商品数据换数据库 + 管理后台
- [ ] 在 Decart 后台设置并发会话上限与额度告警

## 成本

实时视频按**秒**计费（第三方托管平台上 Lucy 实时模型约 0.02 美元/秒，Decart 官方价格以其平台为准），一次 90 秒试穿约 1.8 美元。务必保留：单次时长上限、每日次数、离开页面即断开。可以考虑“新用户免费 N 次 / 会员或下单后解锁更多次数”。
