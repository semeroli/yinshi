import { api, getMe } from './api.js';
import { renderMarkdown } from './markdown.js';

const el = (id) => document.getElementById(id);
const article = el('article');
const loading = el('loading-state');
const errorState = el('error-state');

const slug = new URLSearchParams(location.search).get('slug') || '';

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

const me = await getMe();
const navAuth = el('nav-auth');
if (me && navAuth) {
  navAuth.textContent = '创作台';
  navAuth.href = '/app.html';
}

if (!slug) {
  loading.hidden = true;
  errorState.hidden = false;
} else {
  try {
    const data = await api(`/api/posts/${encodeURIComponent(slug)}`);
    const post = data.post;

    document.title = `${post.title} · 诗境诗话`;
    const desc = el('meta-desc');
    if (desc) desc.content = post.summary || post.title;

    el('article-title').textContent = post.title;
    el('article-author').textContent = post.author || '诗境';
    const dateEl = el('article-date');
    dateEl.textContent = fmtDate(post.published_at || post.created_at);
    dateEl.dateTime = post.published_at || post.created_at || '';

    const tags = el('article-tags');
    (post.tags || []).forEach((tag) => {
      const span = document.createElement('span');
      span.className = 'tag';
      span.textContent = `# ${tag}`;
      tags.appendChild(span);
    });

    if (post.cover_url) {
      const img = el('article-cover');
      img.src = post.cover_url;
      img.alt = `${post.title} 封面`;
      img.hidden = false;
      img.addEventListener('error', () => {
        img.hidden = true;
      });
    }

    el('article-body').innerHTML = renderMarkdown(post.content);

    if (data.canEdit) {
      const edit = el('article-edit');
      edit.href = `/admin-editor.html?id=${post.id}`;
      edit.hidden = false;
    }

    loading.hidden = true;
    article.hidden = false;
  } catch (err) {
    loading.hidden = true;
    errorState.hidden = false;
    const msg = el('error-message');
    if (msg) msg.textContent = err.message || '这篇诗话可能已被移除或尚未发布。';
  }
}
