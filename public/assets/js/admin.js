import { api, logout, getMe, toast, copyText } from './api.js';

const el = (id) => document.getElementById(id);
const stateBox = el('state-box');
const forbidden = el('forbidden');
const tablePanel = el('table-panel');
const statsEl = el('stats');
const toolbar = el('toolbar');
const dialog = el('pwd-dialog');

const state = {
  users: [],
  stats: {},
  me: null,
  filter: '',
  target: null,
  busy: false,
};

/**
 * 🔴 D1 的 `datetime('now')` 存的是 "2026-02-10 12:34:56"（UTC，无时区）。
 * 直接 new Date(s) 会被浏览器当成本地时间，界面上整整差 8 小时。
 * 判据：串里既没有 T 也没有 Z 的，补成 ISO 再按 UTC 解析。
 */
function toDate(iso) {
  if (!iso) return null;
  const s = String(iso).trim();
  if (!s) return null;
  const naive = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(s);
  const d = new Date(naive ? `${s.replace(' ', 'T')}Z` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmt(iso) {
  const d = toDate(iso);
  if (!d) return '—';
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function checkPwd(pwd) {
  if (!pwd) return '请输入新密码';
  if (pwd.length < 6) return `至少 6 位，现在只有 ${pwd.length} 位`;
  if (pwd.length > 64) return '最多 64 位';
  if (!pwd.trim()) return '密码不能全是空格';
  return '';
}

/* ---------------- 渲染 ---------------- */

function visibleUsers() {
  const kw = state.filter.trim().toLowerCase();
  if (!kw) return state.users;
  return state.users.filter((u) =>
    [u.username, u.email, String(u.id)].some((v) => String(v || '').toLowerCase().includes(kw)),
  );
}

function renderStats(s) {
  const set = (id, v) => {
    el(id).textContent = String(v ?? 0);
  };
  set('stat-total', s.total);
  set('stat-today', s.today);
  set('stat-week', s.week);
  set('stat-admins', s.admins);
  set('stat-disabled', s.disabled);
}

function buildRow(u) {
  const tr = document.createElement('tr');

  const cell = (label, text) => {
    const td = document.createElement('td');
    // data-label 只给窄屏卡片的 ::before 用，桌面上那个隐藏的 thead 才是表头
    td.dataset.label = label;
    td.textContent = text;
    tr.appendChild(td);
    return td;
  };

  cell('编号', String(u.id));
  cell('用户名', u.username);
  cell('邮箱', u.email || '—');

  const tdRole = document.createElement('td');
  tdRole.dataset.label = '角色';
  const role = document.createElement('span');
  role.className = `tag ${u.is_admin ? 'admin' : 'user'}`;
  role.textContent = u.is_admin ? '管理员' : '普通用户';
  tdRole.appendChild(role);
  tr.appendChild(tdRole);

  const tdCreated = cell('注册时间', fmt(u.created_at));
  tdCreated.title = u.created_at || '';

  const tdLogin = cell('最近登录', fmt(u.last_login_at));
  tdLogin.title = u.last_login_at || '';

  const tdStatus = document.createElement('td');
  tdStatus.dataset.label = '状态';
  const st = document.createElement('span');
  const active = u.status === 'active';
  st.className = `tag ${active ? 'active' : 'muted'}`;
  st.textContent = active ? '正常' : '已停用';
  tdStatus.appendChild(st);
  tr.appendChild(tdStatus);

  const tdOps = document.createElement('td');
  tdOps.className = 'cell-ops';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'op';
  btn.textContent = '改密码';
  btn.dataset.userId = String(u.id);
  tdOps.appendChild(btn);
  tr.appendChild(tdOps);

  return tr;
}

function render() {
  renderStats(state.stats || {});
  statsEl.hidden = false;
  toolbar.hidden = false;
  tablePanel.hidden = false;

  const rows = visibleUsers();
  const kw = state.filter.trim();
  el('list-hint').textContent = kw
    ? `匹配 ${rows.length} / ${state.users.length} 位`
    : `共 ${state.users.length} 位，最新注册的在最上面`;

  const tbody = el('user-rows');
  tbody.innerHTML = '';

  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 8;
    td.className = 'empty-cell';
    td.textContent = kw ? '没有匹配的用户' : '还没有人注册';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  const frag = document.createDocumentFragment();
  rows.forEach((u) => frag.appendChild(buildRow(u)));
  tbody.appendChild(frag);
}

/* ---------------- 改密码弹窗 ---------------- */

const isSelf = (user) => Boolean(state.me && user && state.me.id === user.id);

function openDialog(user) {
  state.target = user;
  el('pwd-user').textContent = `${user.username}${user.email ? `（${user.email}）` : ''}`;
  el('pwd-input').value = '';
  el('pwd-input').type = 'password';
  el('pwd-show').checked = false;
  el('pwd-error').textContent = '';
  el('pwd-submit').disabled = false;
  el('pwd-submit').textContent = '确认重置';
  el('pwd-hint').textContent = isSelf(user)
    ? '这是你自己的账号。改完后当前页面会立刻退出登录，请用新密码重新登录，别把密码忘了。'
    : '6~64 位。改完后这个用户已登录的页面会立即失效，需要用新密码重新登录；重置前建议先跟他确认一句。';
  dialog.showModal();
  setTimeout(() => el('pwd-input').focus(), 60);
}

function closeDialog() {
  if (dialog.open) dialog.close();
  state.target = null;
}

el('user-rows').addEventListener('click', (e) => {
  const btn = e.target.closest('.op[data-user-id]');
  if (!btn) return;
  const user = state.users.find((u) => String(u.id) === btn.dataset.userId);
  if (user) openDialog(user);
});

el('pwd-show').addEventListener('change', () => {
  el('pwd-input').type = el('pwd-show').checked ? 'text' : 'password';
});

el('pwd-copy').addEventListener('click', async () => {
  const pwd = el('pwd-input').value;
  if (!pwd) {
    toast('先输入密码再复制', 'error');
    return;
  }
  const ok = await copyText(pwd);
  toast(ok ? '已复制，可以直接发给用户' : '复制失败，请手动选中');
});

el('pwd-cancel').addEventListener('click', closeDialog);

dialog.addEventListener('close', () => {
  state.target = null;
});

el('pwd-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (state.busy || !state.target) return;

  const password = el('pwd-input').value;
  const err = checkPwd(password);
  if (err) {
    el('pwd-error').textContent = err;
    el('pwd-input').focus();
    return;
  }

  state.busy = true;
  el('pwd-submit').disabled = true;
  el('pwd-submit').textContent = '提交中…';

  const target = state.target;
  const self = isSelf(target);
  try {
    await api(`/api/admin/users/${target.id}`, { method: 'PATCH', body: { password } });
    closeDialog();
    if (self) {
      // 改的是自己：旧 cookie 已经作废，留在页面上点什么都会 401
      toast('已重置你自己的密码，请用新密码重新登录');
      setTimeout(() => location.replace('/login.html?next=/admin.html'), 1600);
    } else {
      toast(`已重置「${target.username}」的密码，请把新密码告诉他`);
    }
  } catch (e2) {
    el('pwd-error').textContent = e2.message || '重置失败，请稍后再试';
    if (e2.status === 401) {
      setTimeout(() => location.replace('/login.html?next=/admin.html'), 1200);
    }
  } finally {
    state.busy = false;
    el('pwd-submit').disabled = false;
    el('pwd-submit').textContent = '确认重置';
  }
});

el('user-search').addEventListener('input', () => {
  state.filter = el('user-search').value;
  render();
});

/* ---------------- 加载 ---------------- */

async function load() {
  tablePanel.hidden = true;
  statsEl.hidden = true;
  toolbar.hidden = true;
  stateBox.hidden = false;
  forbidden.hidden = true;

  try {
    const data = await api('/api/admin/users');
    state.users = data.users || [];
    state.stats = data.stats || {};
    stateBox.hidden = true;
    render();
  } catch (err) {
    stateBox.hidden = true;
    if (err.status === 401) {
      location.replace('/login.html?next=/admin.html');
      return;
    }
    forbidden.hidden = false;
    if (err.status !== 403) {
      forbidden.querySelector('p').textContent = err.message;
    }
  }
}

async function boot() {
  const me = await getMe();
  if (!me) {
    location.replace('/login.html?next=/admin.html');
    return;
  }
  state.me = me;
  el('admin-name').textContent = `${me.username}${me.is_admin ? ' · 管理员' : ''}`;
  await load();
}

el('btn-refresh').addEventListener('click', load);
el('btn-logout').addEventListener('click', logout);

await boot();
