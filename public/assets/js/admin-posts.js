import { api, toast, logout, getMe } from './api.js';

const el = (id) => document.getElementById(id);
const stateBox = el('state-box');
const emptyBox = el('empty-box');
const forbidden = el('forbidden');
const tablePanel = el('table-panel');
const statsEl = el('stats');
const tbody = el('post-rows');

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

function statusTag(status) {
  const span = document.createElement('span');
  span.className = `tag ${status === 'published' ? 'active' : 'user'}`;
  span.textContent = status === 'published' ? '已发布' : '草稿';
  return span;
}

function render(posts, stats) {
  el('stat-total').textContent = String(stats.total);
  el('stat-published').textContent = String(stats.published);
  el('stat-draft').textContent = String(stats.draft);
  statsEl.hidden = false;

  tbody.innerHTML = '';
  posts.forEach((post) => {
    const tr = document.createElement('tr');

    const tdCover = document.createElement('td');
    tdCover.className = 'cell-cover';
    if (post.cover_url) {
      const img = document.createElement('img');
      img.src = post.cover_url;
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('error', () => {
        img.classList.add('broken');
        img.alt = '封面失效';
      });
      tdCover.appendChild(img);
    } else {
      const ph = document.createElement('span');
      ph.className = 'cover-ph';
      ph.textContent = '无';
      tdCover.appendChild(ph);
    }

    const tdTitle = document.createElement('td');
    tdTitle.className = 'cell-title';
    const a = document.createElement('a');
    a.href = `/post.html?slug=${encodeURIComponent(post.slug)}`;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = post.title;
    const slugSpan = document.createElement('span');
    slugSpan.className = 'slug';
    slugSpan.textContent = `/${post.slug}`;
    tdTitle.append(a, slugSpan);

    const tdStatus = document.createElement('td');
    tdStatus.appendChild(statusTag(post.status));

    const tdTime = document.createElement('td');
    tdTime.textContent = fmt(post.updated_at);

    const tdOps = document.createElement('td');
    tdOps.className = 'cell-ops';

    const edit = document.createElement('a');
    edit.className = 'op';
    edit.href = `/admin-editor.html?id=${post.id}`;
    edit.textContent = '编辑';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'op';
    toggle.textContent = post.status === 'published' ? '下线' : '发布';
    toggle.addEventListener('click', async () => {
      toggle.disabled = true;
      try {
        await api(`/api/admin/posts/${post.id}`, {
          method: 'PUT',
          body: { status: post.status === 'published' ? 'draft' : 'published' },
        });
        toast(post.status === 'published' ? '已下线' : '已发布');
        await load();
      } catch (err) {
        toast(err.message, 'error');
        toggle.disabled = false;
      }
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'op danger';
    del.textContent = '删除';
    del.addEventListener('click', async () => {
      if (!window.confirm(`确定删除《${post.title}》？该操作不可恢复。`)) return;
      del.disabled = true;
      try {
        await api(`/api/admin/posts/${post.id}`, { method: 'DELETE' });
        toast('文章已删除');
        await load();
      } catch (err) {
        toast(err.message, 'error');
        del.disabled = false;
      }
    });

    tdOps.append(edit, toggle, del);
    tr.append(tdCover, tdTitle, tdStatus, tdTime, tdOps);
    tbody.appendChild(tr);
  });

  tablePanel.hidden = posts.length === 0;
  emptyBox.hidden = posts.length !== 0;
}

async function load() {
  tablePanel.hidden = true;
  statsEl.hidden = true;
  emptyBox.hidden = true;
  forbidden.hidden = true;
  stateBox.hidden = false;

  try {
    const data = await api('/api/admin/posts');
    stateBox.hidden = true;
    render(data.posts || [], data.stats || { total: 0, published: 0, draft: 0 });
  } catch (err) {
    stateBox.hidden = true;
    if (err.status === 401) {
      location.replace('/login.html?next=/admin-posts.html');
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
  location.replace('/login.html?next=/admin-posts.html');
} else {
  el('admin-name').textContent = `${me.username}${me.is_admin ? ' · 管理员' : ''}`;
  await load();
}

el('btn-refresh').addEventListener('click', load);
el('btn-logout').addEventListener('click', logout);
