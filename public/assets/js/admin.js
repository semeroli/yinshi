import { api, logout, getMe } from './api.js';

const el = (id) => document.getElementById(id);
const stateBox = el('state-box');
const forbidden = el('forbidden');
const tablePanel = el('table-panel');
const statsEl = el('stats');

function fmt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function render(users, stats) {
  el('stat-total').textContent = String(stats.total);
  el('stat-admins').textContent = String(stats.admins);
  el('stat-active').textContent = String(stats.active);
  statsEl.hidden = false;
  tablePanel.hidden = false;

  const tbody = el('user-rows');
  tbody.innerHTML = '';
  users.forEach((u) => {
    const tr = document.createElement('tr');

    const cells = [
      String(u.id),
      u.username,
      u.email || '—',
      null,
      fmt(u.created_at),
      fmt(u.last_login_at),
      null,
    ];

    cells.forEach((value, idx) => {
      const td = document.createElement('td');
      if (idx === 3) {
        const span = document.createElement('span');
        span.className = `tag ${u.is_admin ? 'admin' : 'user'}`;
        span.textContent = u.is_admin ? '管理员' : '普通用户';
        td.appendChild(span);
      } else if (idx === 6) {
        const span = document.createElement('span');
        span.className = 'tag active';
        span.textContent = u.status === 'active' ? '正常' : '停用';
        td.appendChild(span);
      } else {
        td.textContent = value;
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

async function load() {
  tablePanel.hidden = true;
  statsEl.hidden = true;
  stateBox.hidden = false;
  forbidden.hidden = true;

  try {
    const data = await api('/api/admin/users');
    stateBox.hidden = true;
    render(data.users, data.stats);
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

const me = await getMe();
if (!me) {
  location.replace('/login.html?next=/admin.html');
} else {
  el('admin-name').textContent = `${me.username}${me.is_admin ? ' · 管理员' : ''}`;
  await load();
}

el('btn-refresh').addEventListener('click', load);
el('btn-logout').addEventListener('click', logout);
