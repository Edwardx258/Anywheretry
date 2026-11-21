module.exports = {
  // 后端 API 地址。正式环境必须是已在「小程序后台 → 开发管理 → 服务器域名 → request 合法域名」配置的 https 域名。
  // 开发时可在开发者工具「详情 → 本地设置」勾选「不校验合法域名」后用 http://localhost:3000
  API_BASE: 'http://localhost:3000',

  // H5 实时试穿页地址。<web-view> 只能打开在「业务域名」里配置过的 https 地址（需 ICP 备案的企业主体域名）。
  // 一般与 API_BASE 同域名：https://你的域名/tryon/
  TRYON_H5_URL: 'http://localhost:3000/tryon/',
};
