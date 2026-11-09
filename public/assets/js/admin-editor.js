import { api, toast, logout, getMe } from './api.js';
import { renderMarkdown } from './markdown.js';

const el = (id) => document.getElementById(id);
const form = el('post-form');
const titleInput = el('title');
const slugInput = el('slug');
const summaryInput = el('summary');
const coverInput = el('cover_url');
const tagsInput = el('tags');
const contentInput = el('content');
const errorEl = el('form-error');

const postId = Number(new URLSearchParams(location.search).get('id') || 0);
const state = { status: 'draft', dirty: false, saving: false, ready: false };

/* ---------------- 登录与权限 ---------------- */

const me = await getMe();
if (!me) {
  location.replace(`/login.html?next=${encodeURIComponent(location.pathname + location.search)}`);
} else {
  el('admin-name').textContent = `${me.username}${me.is_admin ? ' · 管理员' : ''}`;
  el('preview-author').textContent = me.username;
  if (!me.is_admin) location.replace('/admin-posts.html');
}

el('btn-logout').addEventListener('click', logout);

/* ---------------- 状态切换 ---------------- */

document.querySelectorAll('.seg[data-status]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.seg[data-status]').forEach((b) => {
      b.classList.remove('is-active');
      b.setAttribute('aria-checked', 'false');
    });
    btn.classList.add('is-active');
    btn.setAttribute('aria-checked', 'true');
    state.status = btn.dataset.status;
    markDirty();
  });
});

function setStatus(status) {
  state.status = status;
  document.querySelectorAll('.seg[data-status]').forEach((b) => {
    const on = b.dataset.status === status;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-checked', String(on));
  });
}

/* ---------------- 预览 ---------------- */

function fmtToday() {
  return new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

function renderTags() {
  const box = el('preview-tags');
  box.innerHTML = '';
  tagsInput.value
    .split(/[,，\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8)
    .forEach((tag) => {
      const span = document.createElement('span');
      span.className = 'tag';
      span.textContent = `# ${tag}`;
      box.appendChild(span);
    });
}

function updatePreview() {
  el('preview-title-text').textContent = titleInput.value.trim() || '未命名诗话';
  el('preview-date').textContent = fmtToday();

  const body = el('preview-body');
  if (contentInput.value.trim()) {
    body.innerHTML = renderMarkdown(contentInput.value);
  } else {
    body.innerHTML = '<p class="preview-placeholder">正文预览会显示在这里。</p>';
  }
  renderTags();

  const url = coverInput.value.trim();
  const img = el('preview-cover');
  if (url) {
    img.src = url;
    img.hidden = false;
  } else {
    img.hidden = true;
    img.removeAttribute('src');
  }

  el('content-count').textContent = `${contentInput.value.trim().length} 字`;
}

function updateCoverPreview() {
  const url = coverInput.value.trim();
  const box = el('cover-preview');
  const img = el('cover-img');
  const tip = el('cover-tip');

  if (!url) {
    box.hidden = true;
    tip.textContent = '';
    tip.classList.remove('error');
    return;
  }

  box.hidden = false;
  img.classList.remove('broken');
  img.src = url;
  tip.classList.remove('error');
  tip.textContent = '加载中…';

  img.onload = () => {
    tip.textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
  };
  img.onerror = () => {
    img.classList.add('broken');
    tip.classList.add('error');
    tip.textContent = '图片无法加载，请检查链接';
  };
}

let timer = null;
function schedulePreview() {
  clearTimeout(timer);
  timer = setTimeout(updatePreview, 110);
}

function markDirty() {
  state.dirty = true;
  el('preview-state').textContent = '未保存';
  el('preview-state').style.color = 'var(--cinnabar)';
}

function markClean() {
  state.dirty = false;
  el('preview-state').textContent = '已保存';
  el('preview-state').style.color = 'var(--bamboo)';
}

[titleInput, summaryInput, contentInput, tagsInput, slugInput].forEach((input) => {
  input.addEventListener('input', () => {
    markDirty();
    schedulePreview();
  });
});

coverInput.addEventListener('input', () => {
  markDirty();
  updateCoverPreview();
  schedulePreview();
});

el('btn-cover-clear').addEventListener('click', () => {
  coverInput.value = '';
  coverInput.dispatchEvent(new Event('input'));
  coverInput.focus();
});

/* 编辑器工具条 */
document.querySelectorAll('.tool[data-insert]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const text = btn.dataset.insert;
    const start = contentInput.selectionStart;
    const end = contentInput.selectionEnd;
    const value = contentInput.value;
    contentInput.value = value.slice(0, start) + text + value.slice(end);
    const pos = start + (text.includes('粗体') ? 2 : text.length);
    contentInput.focus();
    contentInput.setSelectionRange(pos, pos);
    contentInput.dispatchEvent(new Event('input'));
  });
});

/* ---------------- 加载 ---------------- */

async function loadPost() {
  try {
    const data = await api(`/api/admin/posts/${postId}`);
    const post = data.post;
    titleInput.value = post.title;
    slugInput.value = post.slug;
    summaryInput.value = post.summary || '';
    coverInput.value = post.cover_url || '';
    tagsInput.value = (post.tags || []).join(', ');
    contentInput.value = post.content || '';
    setStatus(post.status);
    el('editor-eyebrow').textContent = '编辑';
    el('editor-title').textContent = '编辑诗话';
    document.title = `编辑《${post.title}》· 诗境`;
    updateCoverPreview();
    updatePreview();
    markClean();
    state.ready = true;
  } catch (err) {
    errorEl.textContent = err.message;
    toast(err.message, 'error');
    state.ready = true;
  }
}

if (postId) {
  await loadPost();
} else {
  el('preview-date').textContent = fmtToday();
  state.ready = true;
}

/* ---------------- 保存 ---------------- */

function validate() {
  if (titleInput.value.trim().length < 2) return '请填写标题（至少 2 个字）';
  if (contentInput.value.trim().length < 10) return '正文至少 10 个字';
  const url = coverInput.value.trim();
  if (url && !/^(https?:\/\/|\/|data:image\/)/i.test(url)) {
    return '封面需以 http(s):// 开头，或使用站内绝对路径';
  }
  return '';
}

function setSaving(saving) {
  state.saving = saving;
  ['btn-save', 'btn-submit', 'btn-save-draft'].forEach((id) => {
    el(id).disabled = saving;
  });
  el('btn-save').innerHTML = saving ? '<span class="spinner"></span>' : '保存';
}

async function save(status) {
  if (state.saving) return;
  const err = validate();
  if (err) {
    errorEl.textContent = err;
    toast(err, 'error');
    return;
  }
  errorEl.textContent = '';
  setSaving(true);

  const payload = {
    title: titleInput.value.trim(),
    slug: slugInput.value.trim() || undefined,
    summary: summaryInput.value.trim(),
    cover_url: coverInput.value.trim(),
    tags: tagsInput.value
      .split(/[,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 8),
    content: contentInput.value,
    status,
  };

  try {
    const data = postId
      ? await api(`/api/admin/posts/${postId}`, { method: 'PUT', body: payload })
      : await api('/api/admin/posts', { method: 'POST', body: payload });

    const post = data.post;
    slugInput.value = post.slug;
    setStatus(post.status);
    markClean();
    toast(status === 'published' ? '已发布到诗话' : '草稿已保存');

    if (!postId) {
      history.replaceState(null, '', `/admin-editor.html?id=${post.id}`);
      el('editor-eyebrow').textContent = '编辑';
      el('editor-title').textContent = '编辑诗话';
    }
    if (status === 'published') {
      setTimeout(() => {
        location.href = `/post.html?slug=${encodeURIComponent(post.slug)}`;
      }, 600);
    }
  } catch (err) {
    errorEl.textContent = err.message;
    toast(err.message, 'error');
  } finally {
    setSaving(false);
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  save(state.status);
});

el('btn-save').addEventListener('click', () => save(state.status));
el('btn-save-draft').addEventListener('click', () => save('draft'));

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save(state.status);
  }
});

window.addEventListener('beforeunload', (e) => {
  if (state.dirty && !state.saving) {
    e.preventDefault();
    e.returnValue = '';
  }
});
