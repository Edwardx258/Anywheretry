// 本地联调用的假试衣服务：不调用任何 AI，几秒后直接把人像原图当作“结果”返回。
// 用于在没有 API Key 时把小程序 → 后端 → 轮询 → 展示 整条链路跑通。

const crypto = require('crypto');

function createMockProvider({ delayMs = 4000 } = {}) {
  const tasks = new Map();

  return {
    name: 'mock',

    async submit({ personImageUrl }) {
      const taskId = 'mock-' + crypto.randomUUID();
      tasks.set(taskId, { createdAt: Date.now(), personImageUrl });
      return { taskId };
    },

    async query(taskId) {
      const t = tasks.get(taskId);
      if (!t) return { status: 'failed', error: '任务不存在' };
      if (Date.now() - t.createdAt < delayMs) return { status: 'running' };
      tasks.delete(taskId);
      return { status: 'succeeded', imageUrl: t.personImageUrl };
    },
  };
}

module.exports = { createMockProvider };
