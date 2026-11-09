import { api, toast, getMe } from './api.js';

const script = document.querySelector('script[data-page]');
const page = script?.dataset.page || 'login';
const next = new URLSearchParams(location.search).get('next') || '/app.html';

const form = document.getElementById('auth-form');
const errorEl = document.getElementById('auth-error');
const submit = document.getElementById('auth-submit');
const pwd = document.getElementById('password');
const toggle = document.querySelector('.pwd-toggle');
const meter = document.querySelector('.pwd-meter');
const hint = document.getElementById('pwd-hint');

let turnstileToken = '';

const existing = await getMe();
if (existing) location.replace(next);

/* 人机验证（配置了 sitekey 才渲染） */
try {
  const cfg = await api('/api/config');
  if (cfg.turnstileSiteKey) {
    const slot = document.getElementById('turnstile-slot');
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
    const render = () => {
      if (!window.turnstile) return setTimeout(render, 300);
      window.turnstile.render(slot, {
        sitekey: cfg.turnstileSiteKey,
        theme: 'light',
        callback: (t) => {
          turnstileToken = t;
        },
        'expired-callback': () => {
          turnstileToken = '';
        },
      });
    };
    render();
  }
} catch {
  /* 忽略 */
}

/* 密码显示切换 */
toggle?.addEventListener('click', () => {
  const show = pwd.type === 'password';
  pwd.type = show ? 'text' : 'password';
  toggle.textContent = show ? '隐藏' : '显示';
  toggle.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
});

/* 密码强度 */
pwd?.addEventListener('input', () => {
  if (!meter) return;
  const v = pwd.value;
  let level = 0;
  if (v.length >= 6) level = 1;
  if (v.length >= 8 && /[a-zA-Z]/.test(v) && /\d/.test(v)) level = 2;
  if (v.length >= 12 && /[^a-zA-Z0-9]/.test(v)) level = 3;
  meter.dataset.level = String(level);
  if (hint) {
    hint.textContent =
      level === 0 ? '至少 6 位' : level === 1 ? '再长一些会更安全' : level === 2 ? '强度：中' : '强度：高';
  }
  errorEl.textContent = '';
});

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = form.username.value.trim();
  const password = form.password.value;
  const email = form.email?.value.trim() || '';

  errorEl.textContent = '';
  if (page === 'register') {
    if (!/^[\w\u4e00-\u9fa5-]{2,20}$/.test(username)) {
      errorEl.textContent = '用户名需 2~20 位，支持中文、字母、数字';
      return;
    }
    if (password.length < 6) {
      errorEl.textContent = '密码至少 6 位';
      return;
    }
  } else if (!username || !password) {
    errorEl.textContent = '请填写用户名与密码';
    return;
  }

  submit.disabled = true;
  submit.innerHTML = '<span class="spinner"></span><span>请稍候…</span>';

  try {
    const path = page === 'register' ? '/api/auth/register' : '/api/auth/login';
    const payload = page === 'register' ? { username, email, password, turnstileToken } : { username, password };
    await api(path, { method: 'POST', body: payload });
    toast(page === 'register' ? '注册成功，开始题诗' : '欢迎回来');
    setTimeout(() => location.replace(next), 320);
  } catch (err) {
    errorEl.textContent = err.message;
    submit.disabled = false;
    submit.textContent = page === 'register' ? '注册并开始题诗' : '登录';
    if (window.turnstile) window.turnstile.reset?.();
  }
});
