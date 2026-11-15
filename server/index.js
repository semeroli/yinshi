/**
 * 「诗境」本地服务
 * 静态托管 public/ + API：
 *   POST /api/theme          ① 意境润色（可编辑的意境稿）
 *   POST /api/imagery        ① 意象解析（旧接口，保留）
 *   POST /api/poem           ② 格律成诗 + ③ 程序校验 / 逐句修复 / 补句
 *   POST /api/auth/register  注册（PBKDF2）
 *   POST /api/auth/login     登录
 *   POST /api/auth/logout    退出
 *   GET  /api/auth/me        当前登录态
 *   GET  /api/admin/users    管理员用户列表
 *   GET  /api/config         前端配置（Turnstile sitekey / 演示模式）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseImagery,
  composePoem,
  validatePoem,
  localTheme,
  patchedLines,
  syncRhymeWords,
} from './poems.js';
import {
  IMAGERY_SYSTEM,
  THEME_SYSTEM,
  POEM_SYSTEM,
  FIX_SYSTEM,
  imageryUser,
  themeUser,
  poemUser,
  fixUser,
  parseJson,
  parseTheme,
  chat,
  chatJson,
  hasOnlineModel,
  STEP_TIMEOUT,
} from './model.js';
import {
  createUser,
  findUserByUsername,
  listUsers,
  publicUser,
  verifyPassword,
  issueSession,
  clearSession,
  getUserFromRequest,
  cacheGet,
  cacheSet,
  cacheKey,
  rateLimit,
  touchLogin,
  listPosts,
  getPostBySlug,
  getPostById,
  createPost,
  updatePost,
  deletePost,
} from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 0);
const DEMO_MODE = !hasOnlineModel();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 512 * 1024) reject(new Error('请求体过大'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  return (req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'unknown').toString();
}

async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return true; // 未配置即开发模式放行
  if (!token) return false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip: ip }),
    });
    const data = await res.json();
    return Boolean(data.success);
  } catch {
    return false;
  }
}

/* ---------------- 三段式流水线 ---------------- */

async function runImagery({ description, form, style }) {
  const key = cacheKey({ t: 'imagery', description, form, style });
  const cached = cacheGet(key);
  if (cached) return { ...cached, cached: true };

  let imagery = null;
  let channel = 'demo';
  let fallbackReason = '';
  if (!DEMO_MODE) {
    try {
      const { data: parsed, channel: ch } = await chatJson(
        [
          { role: 'system', content: IMAGERY_SYSTEM },
          { role: 'user', content: imageryUser(description, form, style) },
        ],
        { temperature: 0.3, top_p: 0.8, max_tokens: 400 },
      );
      if (Array.isArray(parsed.core_imagery) && parsed.core_imagery.length) {
        imagery = parsed;
        channel = ch;
      }
    } catch (err) {
      fallbackReason = err.message;
      console.warn('[imagery] 模型通道失败，降级演示库：', err.message);
    }
  }
  if (!imagery) imagery = parseImagery(description, form, style);

  const result = { imagery, channel, cached: false };
  if (fallbackReason) result.fallback_reason = fallbackReason;
  cacheSet(key, { imagery, channel });
  return result;
}

/** ① 意境润色：把用户那三五句话扩写成可照着作诗的底本 */
async function runTheme({ description, form, style }) {
  const key = cacheKey({ t: 'theme', description, form, style });
  const cached = cacheGet(key);
  if (cached) return { ...cached, cached: true };

  let theme = null;
  let channel = 'local';
  let fallbackReason = '';

  if (!DEMO_MODE) {
    try {
      const { content, channel: ch } = await chat(
        [
          { role: 'system', content: THEME_SYSTEM },
          { role: 'user', content: themeUser(description, form, style) },
        ],
        { temperature: 0.7, top_p: 0.9, max_tokens: 700, timeoutMs: STEP_TIMEOUT.theme },
      );
      theme = parseTheme(content);
      channel = ch;
    } catch (err) {
      fallbackReason = err.message;
      console.warn('[theme] 润色失败，改用本地模板：', err.message);
    }
  }

  if (!theme) {
    theme = localTheme(description, form, style);
    channel = 'local';
  }

  const result = { theme, channel, cached: false };
  if (fallbackReason) result.fallback_reason = fallbackReason;
  // 降级稿不缓存：否则用户"重新润色"也只会拿回同一段模板
  if (channel !== 'local') cacheSet(key, { theme, channel });
  return result;
}

/** ② 逐句诊断重写：只把坏句喂回去，好句一律强制还原 */
async function repairLines(poem, form, issues, bad, round) {
  if (DEMO_MODE) return null;
  try {
    const { content } = await chat(
      [
        { role: 'system', content: FIX_SYSTEM },
        { role: 'user', content: fixUser(poem.lines, form, issues, bad) },
      ],
      {
        temperature: round === 1 ? 0.25 : 0.15,
        top_p: 0.7,
        max_tokens: 400,
        timeoutMs: STEP_TIMEOUT.fix,
      },
    );
    const fixed = parseJson(content);
    if (!Array.isArray(fixed.lines) || fixed.lines.length !== 4) return null;
    // 🔴 模型很爱顺手"润色"没让它动的地方 ⇒ 非坏句一律取原句
    return poem.lines.map((line, i) => (bad.includes(i) ? String(fixed.lines[i] || line) : line));
  } catch (err) {
    console.warn(`[fix] 第 ${round} 轮修复失败：`, err.message);
    return null;
  }
}

async function runPoem({ imagery, theme, form, style, strict, avoid }) {
  const finalForm = form === '自动' || !form ? imagery.form_suggestion : form;
  const finalStyle = style === '自动' || !style ? imagery.style_suggestion : style;
  const themeText = String(theme || '').slice(0, 400);
  const needLen = finalForm === '七言绝句' ? 7 : 5;
  const key = cacheKey({ t: 'poem', imagery, themeText, finalForm, finalStyle, strict, avoid });

  if (!avoid || !avoid.length) {
    const cached = cacheGet(key);
    if (cached) return { ...cached, cached: true };
  }

  const steps = [];
  let poem = null;
  let channel = 'demo';
  let fallbackReason = '';
  if (!DEMO_MODE) {
    try {
      const { data: parsed, channel: ch } = await chatJson(
        [
          { role: 'system', content: POEM_SYSTEM },
          {
            role: 'user',
            content: poemUser(imagery, {
              form: finalForm,
              style: finalStyle,
              strict,
              avoid,
              theme: themeText,
            }),
          },
        ],
        { temperature: 0.85, top_p: 0.9, max_tokens: 500, timeoutMs: STEP_TIMEOUT.poem },
      );
      poem = parsed;
      channel = ch;
    } catch (err) {
      fallbackReason = err.message;
      console.warn('[poem] 模型通道失败：', err.message);
    }
  }
  if (!poem || !Array.isArray(poem.lines) || poem.lines.length !== 4) {
    poem = composePoem(imagery, { form: finalForm, style: finalStyle, strict, avoid });
    channel = 'demo';
    steps.push({ step: 'local', note: '模型没有给出四句诗，改用本地诗库' });
  } else if (syncRhymeWords(poem)) {
    steps.push({ step: 'rhyme-decl', note: '模型声明的韵脚写错了，已按实际句尾修正（诗未改动）' });
  }

  let check = validatePoem(poem, finalForm);

  // ② 逐句诊断重写：最多两轮
  for (let round = 1; round <= 2 && !check.ok && channel !== 'demo'; round += 1) {
    const badNow = check.bad.slice();
    const before = check.issues.length;
    const merged = await repairLines(poem, finalForm, check.issues, badNow, round);
    if (!merged) break;

    const next = validatePoem({ ...poem, lines: merged }, finalForm);
    if (next.issues.length > before) {
      steps.push({ step: 'fix', note: `第 ${round} 轮改完反而更差，已撤回` });
      break;
    }
    poem.lines = merged;
    check = next;
    steps.push({ step: 'fix', note: `第 ${round} 轮重写了第 ${badNow.map((i) => i + 1).join('、')} 句` });
  }

  // ③ 库存补坏句：只补不承担押韵的位置
  if (!check.ok) {
    const patched = patchedLines(poem, needLen, check.bad);
    if (patched.patches.length) {
      poem.lines = patched.lines;
      patched.patches.forEach((pt) => {
        if (pt.para && Array.isArray(poem.paraphrase)) poem.paraphrase[pt.index] = pt.para;
      });
      check = validatePoem(poem, finalForm);
      steps.push({
        step: 'patch',
        note: `第 ${patched.patches.map((p) => p.index + 1).join('、')} 句改用本地诗句补齐，其余句子保留`,
      });
    }
  }

  // ④ 整首回落：最后一步，才换库存
  if (!check.ok) {
    const local = composePoem(imagery, { form: finalForm, style: finalStyle, strict, avoid });
    const localCheck = validatePoem(local, finalForm);
    if (localCheck.issues.length < check.issues.length) {
      poem = local;
      check = localCheck;
      channel = 'demo';
      fallbackReason = fallbackReason || '坏句过多，整首改由本地诗库兜底';
      steps.push({ step: 'fallback', note: '坏句过多，整首改用本地诗库' });
    }
  }

  const result = {
    poem,
    channel,
    form: poem.form || finalForm,
    style: poem.style || finalStyle,
    validation: {
      ok: check.ok,
      issues: check.issues,
      bad: check.bad,
      repaired: steps.some((s) => s.step === 'fix' || s.step === 'patch'),
    },
    pipeline: steps,
    theme: themeText,
    cached: false,
  };
  if (fallbackReason) result.fallback_reason = fallbackReason;
  // 🔴 只缓存"模型写成 + 校验通过"的结果，别把降级结果钉死 24 小时
  if (check.ok && channel !== 'demo' && (!avoid || !avoid.length)) cacheSet(key, result);
  return result;
}

/* ---------------- 路由 ---------------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (pathname.startsWith('/api/')) {
      return await handleApi(req, res, pathname, url);
    }
    return serveStatic(res, pathname);
  } catch (err) {
    console.error('[server]', err);
    return send(res, 500, { error: '服务异常，请稍后再试' });
  }
});

async function handleApi(req, res, pathname, url) {
  const ip = clientIp(req);

  if (pathname === '/api/health') {
    return send(res, 200, { ok: true, demo: DEMO_MODE, time: new Date().toISOString() });
  }

  if (pathname === '/api/config') {
    return send(res, 200, {
      turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '',
      demo: DEMO_MODE,
      model: DEMO_MODE ? '本地演示库' : process.env.LLM_MODEL || process.env.MODELSCOPE_MODEL || '在线模型',
    });
  }

  if (pathname === '/api/auth/me') {
    const user = getUserFromRequest(req);
    return send(res, 200, { user: publicUser(user) });
  }

  if (pathname === '/api/auth/register' && req.method === 'POST') {
    const body = await readBody(req);
    const { username, email, password, turnstileToken } = body;

    if (!rateLimit(`reg:${ip}`, 8, 60 * 60 * 1000)) {
      return send(res, 429, { error: '注册过于频繁，请稍后再试' });
    }
    if (process.env.TURNSTILE_SECRET && !(await verifyTurnstile(turnstileToken, ip))) {
      return send(res, 403, { error: '人机验证未通过，请重试' });
    }
    if (!username || !/^[\w\u4e00-\u9fa5-]{2,20}$/.test(username)) {
      return send(res, 400, { error: '用户名需 2~20 位，支持中文、字母、数字、下划线和短横线' });
    }
    if (!password || password.length < 6) {
      return send(res, 400, { error: '密码至少 6 位' });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return send(res, 400, { error: '邮箱格式不正确' });
    }
    if (findUserByUsername(username)) {
      return send(res, 409, { error: '该用户名已被注册' });
    }

    const user = createUser({ username, email, password });
    touchLogin(user.id);
    return send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': issueSession(user.id) });
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await readBody(req);
    const { username, password } = body;
    if (!rateLimit(`login:${ip}`, 20, 60 * 60 * 1000)) {
      return send(res, 429, { error: '尝试次数过多，请稍后再试' });
    }
    const user = findUserByUsername(username || '');
    if (!user || !verifyPassword(password || '', user.password_hash)) {
      return send(res, 401, { error: '用户名或密码不正确' });
    }
    if (user.status !== 'active') {
      return send(res, 403, { error: '账号已被停用，请联系管理员' });
    }
    touchLogin(user.id);
    return send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': issueSession(user.id) });
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': clearSession() });
  }

  if (pathname === '/api/theme' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) return send(res, 401, { error: '请先登录后再题诗' });

    const body = await readBody(req);
    const description = String(body.description || '').trim();
    if (description.length < 2) return send(res, 400, { error: '请多写几个字，让诗兴有个落点' });
    if (description.length > 120) return send(res, 400, { error: '意境描述请控制在 120 字以内' });
    if (!rateLimit(`theme:${ip}`, 40, 60 * 60 * 1000)) {
      return send(res, 429, { error: '今日诗兴已用尽，请稍后再来' });
    }
    if (process.env.TURNSTILE_SECRET && !(await verifyTurnstile(body.turnstileToken, ip))) {
      return send(res, 403, { error: '人机验证未通过，请重试' });
    }

    const result = await runTheme({ description, form: body.form, style: body.style });
    return send(res, 200, result);
  }

  if (pathname === '/api/imagery' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) return send(res, 401, { error: '请先登录后再题诗' });

    const body = await readBody(req);
    const description = String(body.description || '').trim();
    if (description.length < 2) return send(res, 400, { error: '请多写几个字，让诗兴有个落点' });
    if (description.length > 120) return send(res, 400, { error: '意境描述请控制在 120 字以内' });
    if (!rateLimit(`gen:${ip}`, 30, 60 * 60 * 1000)) {
      return send(res, 429, { error: '今日诗兴已用尽，请稍后再来' });
    }
    if (process.env.TURNSTILE_SECRET && !(await verifyTurnstile(body.turnstileToken, ip))) {
      return send(res, 403, { error: '人机验证未通过，请重试' });
    }

    const result = await runImagery({ description, form: body.form, style: body.style });
    return send(res, 200, result);
  }

  if (pathname === '/api/poem' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) return send(res, 401, { error: '请先登录后再题诗' });

    const body = await readBody(req);
    const imagery = body.imagery;
    if (!imagery || !Array.isArray(imagery.core_imagery)) {
      return send(res, 400, { error: '缺少意象解析结果' });
    }
    if (!rateLimit(`gen:${ip}`, 30, 60 * 60 * 1000)) {
      return send(res, 429, { error: '今日诗兴已用尽，请稍后再来' });
    }

    const result = await runPoem({
      imagery,
      theme: body.theme,
      form: body.form || '自动',
      style: body.style || '自动',
      strict: body.strict !== false,
      avoid: Array.isArray(body.avoid) ? body.avoid : [],
    });
    return send(res, 200, result);
  }

  /* ---------- 博客文章 ---------- */

  if (pathname === '/api/posts' && req.method === 'GET') {
    const limit = Number(url.searchParams.get('limit') || 0);
    return send(res, 200, { posts: listPosts({ limit: Number.isFinite(limit) ? limit : 0 }) });
  }

  if (pathname.startsWith('/api/posts/') && req.method === 'GET') {
    const slug = decodeURIComponent(pathname.slice('/api/posts/'.length));
    const post = getPostBySlug(slug);
    if (!post) return send(res, 404, { error: '文章不存在或已下线' });
    const user = getUserFromRequest(req);
    if (post.status !== 'published' && !user?.is_admin) {
      return send(res, 404, { error: '文章不存在或已下线' });
    }
    return send(res, 200, { post, canEdit: Boolean(user?.is_admin) });
  }

  if (pathname === '/api/admin/posts') {
    const user = getUserFromRequest(req);
    if (!user) return send(res, 401, { error: '请先登录' });
    if (!user.is_admin) return send(res, 403, { error: '无权访问：仅管理员可管理文章' });

    if (req.method === 'GET') {
      const posts = listPosts({ includeDrafts: true });
      return send(res, 200, {
        posts,
        stats: {
          total: posts.length,
          published: posts.filter((p) => p.status === 'published').length,
          draft: posts.filter((p) => p.status === 'draft').length,
        },
      });
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const check = validatePost(body);
      if (check.error) return send(res, 400, { error: check.error });
      const post = createPost({ ...body, author: user.username });
      return send(res, 200, { post });
    }

    return send(res, 405, { error: '方法不允许' });
  }

  const postIdMatch = pathname.match(/^\/api\/admin\/posts\/(\d+)$/);
  if (postIdMatch) {
    const user = getUserFromRequest(req);
    if (!user) return send(res, 401, { error: '请先登录' });
    if (!user.is_admin) return send(res, 403, { error: '无权访问：仅管理员可管理文章' });

    const id = Number(postIdMatch[1]);
    const existing = getPostById(id);
    if (!existing) return send(res, 404, { error: '文章不存在' });

    if (req.method === 'GET') return send(res, 200, { post: existing });

    if (req.method === 'PUT' || req.method === 'PATCH') {
      const body = await readBody(req);
      const check = validatePost(body, { partial: true });
      if (check.error) return send(res, 400, { error: check.error });
      const post = updatePost(id, body);
      return send(res, 200, { post });
    }

    if (req.method === 'DELETE') {
      deletePost(id);
      return send(res, 200, { ok: true });
    }

    return send(res, 405, { error: '方法不允许' });
  }

  if (pathname === '/api/admin/users' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) return send(res, 401, { error: '请先登录' });
    if (!user.is_admin) return send(res, 403, { error: '无权访问：仅管理员可见' });
    const users = listUsers();
    return send(res, 200, {
      users,
      stats: {
        total: users.length,
        admins: users.filter((u) => u.is_admin).length,
        active: users.filter((u) => u.status === 'active').length,
      },
    });
  }

  return send(res, 404, { error: '接口不存在' });
}

function validatePost(body, { partial = false } = {}) {
  const { title, summary, content, cover_url, tags, status } = body || {};

  if (!partial || title !== undefined) {
    const t = String(title || '').trim();
    if (t.length < 2 || t.length > 80) return { error: '标题需 2~80 字' };
  }
  if (!partial || content !== undefined) {
    const c = String(content || '').trim();
    if (c.length < 10) return { error: '正文至少 10 个字' };
    if (c.length > 100000) return { error: '正文过长（上限 10 万字）' };
  }
  if (summary !== undefined && String(summary).length > 200) {
    return { error: '摘要请控制在 200 字以内' };
  }
  if (cover_url !== undefined && String(cover_url).trim()) {
    const u = String(cover_url).trim();
    const ok = /^https?:\/\/[^\s]+$/i.test(u) || /^\/[^\s]*$/.test(u) || /^data:image\/[a-z+]+;base64,/.test(u);
    if (!ok) return { error: '封面图片需为 http(s) 图床链接或站内绝对路径' };
    if (u.length > 2000) return { error: '封面链接过长' };
  }
  if (tags !== undefined && !Array.isArray(tags)) return { error: '标签格式不正确' };
  if (status !== undefined && !['draft', 'published'].includes(status)) {
    return { error: '状态只能是 draft 或 published' };
  }
  return {};
}

function serveStatic(res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  if (rel === '/app') rel = '/app.html';
  if (rel === '/login') rel = '/login.html';
  if (rel === '/register') rel = '/register.html';
  if (rel === '/admin') rel = '/admin.html';
  if (rel === '/blog') rel = '/blog.html';
  if (rel === '/post') rel = '/post.html';
  if (rel === '/write') rel = '/admin-editor.html';

  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return send(res, 403, { error: '禁止访问' });
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return send(res, 404, '<h1>404</h1><p>页面不存在</p><a href="/">回到首页</a>', {
      'Content-Type': 'text/html; charset=utf-8',
    });
  }
  const ext = path.extname(filePath).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  };
  res.writeHead(200, headers);
  return fs.createReadStream(filePath).pipe(res);
}

server.listen(PORT, '127.0.0.1', () => {
  const port = server.address().port;
  console.log(`启动中: http://localhost:${port}/`);
  console.log(`[诗境] 演示模式: ${DEMO_MODE ? '开启（本地诗词库）' : '关闭（已接入模型）'}`);
});
