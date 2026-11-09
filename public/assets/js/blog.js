import { api, getMe } from './api.js';

const grid = document.getElementById('post-grid');
const empty = document.getElementById('empty-state');
const errorState = document.getElementById('error-state');
const errorMessage = document.getElementById('error-message');

const me = await getMe();
const navAuth = document.getElementById('nav-auth');
if (me && navAuth) {
  navAuth.textContent = '创作台';
  navAuth.href = '/app.html';
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

function coverNode(post) {
  const wrap = document.createElement('div');
  wrap.className = 'cover';
  if (post.cover_url) {
    const img = document.createElement('img');
    img.src = post.cover_url;
    img.alt = `${post.title} 封面`;
    img.loading = 'lazy';
    img.addEventListener('error', () => {
      img.remove();
      const fb = document.createElement('div');
      fb.className = 'cover-fallback';
      fb.textContent = '诗话';
      wrap.appendChild(fb);
    });
    wrap.appendChild(img);
  } else {
    const fb = document.createElement('div');
    fb.className = 'cover-fallback';
    fb.textContent = '诗话';
    wrap.appendChild(fb);
  }
  return wrap;
}

function render(posts) {
  grid.innerHTML = '';
  if (!posts.length) {
    empty.hidden = false;
    return;
  }

  posts.forEach((post, i) => {
    const card = document.createElement('article');
    card.className = 'post-card';
    card.style.animation = `fade-up .45s var(--ease) ${i * 60}ms backwards`;

    card.appendChild(coverNode(post));

    const body = document.createElement('div');
    body.className = 'post-card-body';

    const h2 = document.createElement('h2');
    const link = document.createElement('a');
    link.href = `/post.html?slug=${encodeURIComponent(post.slug)}`;
    link.textContent = post.title;
    h2.appendChild(link);

    const summary = document.createElement('p');
    summary.className = 'summary';
    summary.textContent = post.summary || '';

    const foot = document.createElement('footer');
    const date = document.createElement('time');
    date.textContent = fmtDate(post.published_at || post.created_at);
    const dot = document.createElement('span');
    dot.className = 'dot';
    const read = document.createElement('span');
    read.textContent = `${Math.max(1, Math.round((post.content || '').length / 350))} 分钟`;
    const more = document.createElement('span');
    more.className = 'more';
    more.textContent = '阅读 →';
    foot.append(date, dot, read, more);

    body.append(h2, summary, foot);
    card.appendChild(body);
    grid.appendChild(card);
  });
}

try {
  const data = await api('/api/posts');
  render(data.posts || []);
} catch (err) {
  errorState.hidden = false;
  errorMessage.textContent = err.message || '请稍后重试。';
}
