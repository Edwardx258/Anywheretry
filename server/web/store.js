// 网站前台：首页商品列表 + 商品详情 + 微信下单弹窗。
// 不收款：顾客点“微信下单”看到店主微信号/二维码，和一段可复制的下单信息。
(function () {
  'use strict';

  const page = document.body.dataset.page;
  const params = new URLSearchParams(location.search);
  const state = { site: null, product: null, size: '' };

  // 小工具：安全地创建元素（所有文字都用 textContent，避免注入）
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const c of children) if (c != null) el.append(c);
    return el;
  }

  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status === 404 ? 'not_found' : '加载失败');
    return res.json();
  }

  // ---------- 店铺信息 ----------
  async function loadSite() {
    state.site = await getJSON('/api/site');
    document.querySelectorAll('[data-shop-name]').forEach((el) => (el.textContent = state.site.shopName));
    document.querySelectorAll('[data-open-order]').forEach((el) => el.addEventListener('click', openOrder));
  }

  // ---------- 首页 ----------
  async function initHome() {
    document.title = state.site.shopName;
    const grid = document.getElementById('grid');
    const empty = document.getElementById('empty');

    async function render(cat) {
      const list = await getJSON('/api/products' + (cat ? `?category=${encodeURIComponent(cat)}` : ''));
      grid.replaceChildren(
        ...list.map((p) =>
          h('a', { class: 'card', href: `/product.html?id=${encodeURIComponent(p.id)}` },
            h('img', { src: p.cover, alt: p.name, loading: 'lazy' }),
            h('div', { class: 'body' },
              h('div', { class: 'name' }, p.name),
              h('div', { class: 'row' }, h('span', { class: 'price' }, `¥${p.price}`), h('span', { class: 'tag' }, '可实时试穿'))
            )
          )
        )
      );
      empty.hidden = list.length > 0;
      // 首页大按钮直接试穿第一件
      if (list[0]) document.getElementById('heroTry').href = `/tryon/?id=${encodeURIComponent(list[0].id)}`;
    }

    document.getElementById('tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t === btn));
      render(btn.dataset.cat).catch(showLoadError);
    });
    await render('');
  }

  // ---------- 商品详情 ----------
  async function initProduct() {
    let p;
    try {
      p = await getJSON(`/api/products/${encodeURIComponent(params.get('id') || '')}`);
    } catch (e) {
      document.getElementById('notFound').hidden = false;
      return;
    }
    state.product = p;
    document.title = `${p.name} - ${state.site.shopName}`;
    document.getElementById('pImg').src = p.cover;
    document.getElementById('pImg').alt = p.name;
    document.getElementById('pName').textContent = p.name;
    document.getElementById('pPrice').textContent = `¥${p.price}`;
    document.getElementById('pDesc').textContent = p.description || '';
    document.getElementById('tryBtn').href = `/tryon/?id=${encodeURIComponent(p.id)}`;

    const sizes = document.getElementById('pSizes');
    sizes.replaceChildren(
      ...p.sizes.map((s) =>
        h('button', {
          class: 'size',
          type: 'button',
          onclick: (e) => {
            state.size = s;
            sizes.querySelectorAll('.size').forEach((b) => b.classList.toggle('on', b === e.currentTarget));
          },
        }, s)
      )
    );
    document.getElementById('detail').hidden = false;

    // 从试穿页点“购买这件”过来，直接弹出下单方式
    if (params.get('order') === '1') openOrder();
  }

  // ---------- 微信下单弹窗 ----------
  function orderMessage() {
    const p = state.product;
    if (!p) return '你好，我想咨询一下衣服～';
    return `你好，我想买：\n${p.name}\n尺码：${state.size || '（请填写）'}\n价格：¥${p.price}`;
  }

  function copy(text, btn) {
    const done = () => { const t = btn.textContent; btn.textContent = '已复制'; setTimeout(() => (btn.textContent = t), 1500); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    const ta = h('textarea', { readonly: '', style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (_) { /* 用户可手动长按复制 */ }
    ta.remove();
  }

  function openOrder() {
    const modal = document.getElementById('orderModal');
    const s = state.site;
    const msg = orderMessage();
    const copyIdBtn = h('button', { class: 'copy', type: 'button' }, '复制');
    const copyMsgBtn = h('button', { class: 'copy', type: 'button' }, '复制下单信息');
    copyIdBtn.addEventListener('click', () => copy(s.wechatId, copyIdBtn));
    copyMsgBtn.addEventListener('click', () => copy(orderMessage(), copyMsgBtn));

    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': '微信下单' },
      h('button', { class: 'close', type: 'button', 'aria-label': '关闭', onclick: closeOrder }, '×'),
      h('h2', null, '微信下单'),
      h('div', { class: 'small' }, '扫码或搜索微信号添加店主'),
      h('img', { class: 'qr', src: s.wechatQr, alt: '店主微信二维码' }),
      s.wechatId ? h('div', { class: 'wxid' }, h('span', null, `微信号：${s.wechatId}`), copyIdBtn) : null,
      h('div', { class: 'msg' }, msg),
      copyMsgBtn,
      h('p', { class: 'small' }, s.orderNote)
    );
    modal.replaceChildren(sheet);
    modal.hidden = false;
    modal.onclick = (e) => { if (e.target === modal) closeOrder(); };
  }
  function closeOrder() { document.getElementById('orderModal').hidden = true; }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOrder(); });

  function showLoadError() {
    const empty = document.getElementById('empty');
    if (empty) { empty.textContent = '加载失败，请刷新重试'; empty.hidden = false; }
  }

  // ---------- 启动 ----------
  loadSite()
    .then(() => (page === 'product' ? initProduct() : initHome()))
    .catch(showLoadError);
})();
