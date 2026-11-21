// 阿里云百炼（DashScope）AI 试衣接口适配。
// 接口为异步：先提交任务拿到 task_id，再轮询任务状态拿结果图。
// 文档：https://help.aliyun.com/zh/model-studio/aitryon-plus-api
//
// 输入图片要求（摘自官方文档，上线前请以最新文档为准）：
//   - 必须是公网可访问的 http/https 链接
//   - 人像图：有且仅有一个完整的人
//   - 服饰图：平铺拍摄、单一主体、背景干净
//   - 5KB ~ 5MB，边长 150 ~ 4096 像素，jpg/jpeg/png/bmp/heic
//   - 上装、下装至少传一个；连衣裙/连体衣放在上装字段
// 结果图链接有有效期（约 24 小时），所以我们拿到后会转存到自己的服务器。

const SUBMIT_URL =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis';
const TASK_URL = 'https://dashscope.aliyuncs.com/api/v1/tasks/';

function createDashscopeProvider({ apiKey, model }) {
  if (!apiKey) {
    throw new Error('TRYON_PROVIDER=dashscope 时必须配置 DASHSCOPE_API_KEY');
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  return {
    name: 'dashscope',

    // 返回 { taskId }
    async submit({ personImageUrl, topGarmentUrl, bottomGarmentUrl }) {
      const input = { person_image_url: personImageUrl };
      if (topGarmentUrl) input.top_garment_url = topGarmentUrl;
      if (bottomGarmentUrl) input.bottom_garment_url = bottomGarmentUrl;

      const res = await fetch(SUBMIT_URL, {
        method: 'POST',
        headers: { ...headers, 'X-DashScope-Async': 'enable' },
        body: JSON.stringify({
          model,
          input,
          parameters: { resolution: -1, restore_face: true },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.output || !body.output.task_id) {
        throw new Error(
          `提交试衣任务失败: HTTP ${res.status} ${body.code || ''} ${body.message || ''}`.trim()
        );
      }
      return { taskId: body.output.task_id };
    },

    // 返回 { status: 'pending' | 'running' | 'succeeded' | 'failed', imageUrl?, error? }
    async query(taskId) {
      const res = await fetch(TASK_URL + encodeURIComponent(taskId), { headers });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.output) {
        throw new Error(`查询试衣任务失败: HTTP ${res.status} ${body.message || ''}`.trim());
      }
      const out = body.output;
      switch (out.task_status) {
        case 'SUCCEEDED':
          return { status: 'succeeded', imageUrl: out.image_url };
        case 'FAILED':
        case 'CANCELED':
        case 'UNKNOWN':
          return { status: 'failed', error: out.message || out.code || out.task_status };
        case 'RUNNING':
          return { status: 'running' };
        default:
          return { status: 'pending' };
      }
    },
  };
}

module.exports = { createDashscopeProvider };
