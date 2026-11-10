/**
 * Cloudflare Pages Functions：/api/*
 * 与本地 Node 服务保持同一套接口契约
 */
import { parseImagery, composePoem, validatePoem } from '../../server/poems.js';
import {
  IMAGERY_SYSTEM,
  POEM_SYSTEM,
  FIX_SYSTEM,
  imageryUser,
  poemUser,
  fixUser,
  parseJson,
  chat,
  chatJson,
  hasOnlineModel,
} from '../lib/model.js';
import { getStore, publicUser, publicPost } from '../lib/store.js';
import {
  hashPassword,
  verifyPassword,
  issueSessionCookie,
  clearSessionCookie,
  readSessionUserId,
} from '../lib/auth.js';

/* ---------------- 工具 ---------------- */

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } });
}

async function readJson(request) {
  try {
    const text = await request.text();
    if (!text) return {};
    if (text.length > 512 * 1024) throw new Error('请求体过大');
    return JSON.parse(text);
  } catch (err) {
    throw new Error(err.message === '请求体过大' ? err.message : '请求体不是合法 JSON');
  }
}

function isDemo(env) {
  return !hasOnlineModel(env);
}

function secretOf(env) {
  return env.JWT_SECRET || 'dev-only-change-me-in-production';
}

async function currentUser(request, env, store) {
  const uid = await readSessionUserId(request, secretOf(env));
  if (!uid) return null;
  const user = await store.findUserById(uid);
  if (!user || user.status !== 'active') return null;
  return user;
}

/* 实例内频控与缓存（Pages 无 KV 时的最佳努力） */
const buckets = new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const list = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= limit) return false;
  list.push(now);
  buckets.set(key, list);
  return true;
}

const cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000;
function cacheKey(obj) {
  return JSON.stringify(obj);
}
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expire < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}
function cacheSet(key, value) {
  if (cache.size > 200) cache.clear();
  cache.set(key, { value, expire: Date.now() + CACHE_TTL });
}

/* ---------------- 三段式流水线 ---------------- */

async function runImagery(env, { description, form, style }) {
  const key = cacheKey({ t: 'imagery', description, form, style });
  const cached = cacheGet(key);
  if (cached) return { ...cached, cached: true };

  let imagery = null;
  let channel = 'demo';
  let fallbackReason = '';
  if (!isDemo(env)) {
    try {
      const { data: parsed, channel: ch } = await chatJson(
        env,
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

async function runPoem(env, { imagery, form, style, strict, avoid }) {
  const finalForm = form === '自动' || !form ? imagery.form_suggestion : form;
  const finalStyle = style === '自动' || !style ? imagery.style_suggestion : style;
  const key = cacheKey({ t: 'poem', imagery, finalForm, finalStyle, strict, avoid });
  if (!avoid || !avoid.length) {
    const cached = cacheGet(key);
    if (cached) return { ...cached, cached: true };
  }

  let poem = null;
  let channel = 'demo';
  let fallbackReason = '';
  if (!isDemo(env)) {
    try {
      const { data: parsed, channel: ch } = await chatJson(
        env,
        [
          { role: 'system', content: POEM_SYSTEM },
          {
            role: 'user',
            content: poemUser(imagery, { form: finalForm, style: finalStyle, strict, avoid }),
          },
        ],
        { temperature: 0.85, top_p: 0.9, max_tokens: 400 },
      );
      poem = parsed;
      channel = ch;
    } catch (err) {
      fallbackReason = err.message;
      console.warn('[poem] 模型通道失败，降级演示库：', err.message);
      poem = null;
    }
  }
  if (!poem || !Array.isArray(poem.lines)) {
    poem = composePoem(imagery, { form: finalForm, style: finalStyle, strict, avoid });
    channel = 'demo';
  }

  let check = validatePoem(poem, finalForm);
  let repaired = false;
  if (!check.ok && !isDemo(env)) {
    try {
      const { content } = await chat(
        env,
        [
          { role: 'system', content: FIX_SYSTEM },
          { role: 'user', content: fixUser(poem.lines, finalForm, check.issues) },
        ],
        { temperature: 0.2, top_p: 0.7, max_tokens: 300 },
      );
      const fixed = parseJson(content);
      if (Array.isArray(fixed.lines) && fixed.lines.length === 4) {
        poem.lines = fixed.lines;
        repaired = true;
        check = validatePoem(poem, finalForm);
      }
    } catch (err) {
      console.warn('[fix] 修复失败：', err.message);
    }
  }

  const result = {
    poem,
    channel,
    form: poem.form || finalForm,
    style: poem.style || finalStyle,
    validation: { ok: check.ok, issues: check.issues, repaired },
    cached: false,
  };
  if (fallbackReason) result.fallback_reason = fallbackReason;
  if (check.ok && (!avoid || !avoid.length)) cacheSet(key, result);
  return result;
}

/* ---------------- 文章校验 ---------------- */

function validatePost(body, { partial = false } = {}) {
  const { title, summary, content, cover_url, tags, status } = body || {};
  if (!partial || title !== undefined) {
    const t = String(title || '').trim();
    if (t.length < 2 || t.length > 80) return '标题需 2~80 字';
  }
  if (!partial || content !== undefined) {
    const c = String(content || '').trim();
    if (c.length < 10) return '正文至少 10 个字';
    if (c.length > 100000) return '正文过长（上限 10 万字）';
  }
  if (summary !== undefined && String(summary).length > 200) return '摘要请控制在 200 字以内';
  if (cover_url !== undefined && String(cover_url).trim()) {
    const u = String(cover_url).trim();
    const ok = /^https?:\/\/[^\s]+$/i.test(u) || /^\/[^\s]*$/.test(u) || /^data:image\/[a-z+]+;base64,/.test(u);
    if (!ok) return '封面图片需为 http(s) 图床链接或站内绝对路径';
    if (u.length > 2000) return '封面链接过长';
  }
  if (tags !== undefined && !Array.isArray(tags)) return '标签格式不正确';
  if (status !== undefined && !['draft', 'published'].includes(status)) return '状态只能是 draft 或 published';
  return '';
}

async function uniqueSlug(store, input, excludeId = null) {
  const raw = String(input || '').trim() || `p-${Date.now().toString(36)}`;
  const base = raw.replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fa5-]/g, '').slice(0, 80) || `p-${Date.now().toString(36)}`;
  let slug = base;
  let n = 2;
  while (await store.slugExists(slug, excludeId)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

/* ---------------- 入口 ---------------- */

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const pathname = decodeURIComponent(url.pathname);
  const method = request.method.toUpperCase();
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const store = await getStore(env);
  const secure = url.protocol === 'https:';

  try {
    if (pathname === '/api/health') {
      return json({ ok: true, demo: isDemo(env), persistent: store.persistent, time: new Date().toISOString() });
    }

    if (pathname === '/api/config') {
      return json({
        turnstileSiteKey: env.TURNSTILE_SITE_KEY || '',
        demo: isDemo(env),
        model: isDemo(env) ? '本地演示库' : env.LLM_MODEL || env.MODELSCOPE_MODEL || '在线模型',
      });
    }

    if (pathname === '/api/auth/me') {
      const user = await currentUser(request, env, store);
      return json({ user: publicUser(user) });
    }

    if (pathname === '/api/auth/register' && method === 'POST') {
      const body = await readJson(request);
      const { username, email, password } = body;
      if (!rateLimit(`reg:${ip}`, 8, 60 * 60 * 1000)) return json({ error: '注册过于频繁，请稍后再试' }, 429);
      if (!username || !/^[\w\u4e00-\u9fa5-]{2,20}$/.test(username)) {
        return json({ error: '用户名需 2~20 位，支持中文、字母、数字、下划线和短横线' }, 400);
      }
      if (!password || password.length < 6) return json({ error: '密码至少 6 位' }, 400);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: '邮箱格式不正确' }, 400);
      if (await store.findUserByUsername(username)) return json({ error: '该用户名已被注册' }, 409);

      const adminName = String(env.ADMIN_USERNAME || '').trim().toLowerCase();
      const isAdmin = Boolean(adminName) && username.toLowerCase() === adminName;
      const user = await store.createUser({
        username,
        email,
        password_hash: await hashPassword(password, Number(env.PBKDF2_ITERATIONS) || 100000),
        is_admin: isAdmin,
      });
      await store.touchLogin(user.id);
      return json({ user: publicUser(user) }, 200, {
        'Set-Cookie': await issueSessionCookie(user.id, secretOf(env), secure),
      });
    }

    if (pathname === '/api/auth/login' && method === 'POST') {
      const { username, password } = await readJson(request);
      if (!rateLimit(`login:${ip}`, 20, 60 * 60 * 1000)) return json({ error: '尝试次数过多，请稍后再试' }, 429);
      const user = await store.findUserByUsername(username || '');
      if (!user || !(await verifyPassword(password || '', user.password_hash))) {
        return json({ error: '用户名或密码不正确' }, 401);
      }
      if (user.status !== 'active') return json({ error: '账号已被停用，请联系管理员' }, 403);
      await store.touchLogin(user.id);
      return json({ user: publicUser(user) }, 200, {
        'Set-Cookie': await issueSessionCookie(user.id, secretOf(env), secure),
      });
    }

    if (pathname === '/api/auth/logout' && method === 'POST') {
      return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(secure) });
    }

    if (pathname === '/api/imagery' && method === 'POST') {
      const user = await currentUser(request, env, store);
      if (!user) return json({ error: '请先登录后再题诗' }, 401);
      const body = await readJson(request);
      const description = String(body.description || '').trim();
      if (description.length < 2) return json({ error: '请多写几个字，让诗兴有个落点' }, 400);
      if (description.length > 120) return json({ error: '意境描述请控制在 120 字以内' }, 400);
      if (!rateLimit(`gen:${ip}`, 30, 60 * 60 * 1000)) return json({ error: '今日诗兴已用尽，请稍后再来' }, 429);
      return json(await runImagery(env, { description, form: body.form, style: body.style }));
    }

    if (pathname === '/api/poem' && method === 'POST') {
      const user = await currentUser(request, env, store);
      if (!user) return json({ error: '请先登录后再题诗' }, 401);
      const body = await readJson(request);
      if (!body.imagery || !Array.isArray(body.imagery.core_imagery)) {
        return json({ error: '缺少意象解析结果' }, 400);
      }
      if (!rateLimit(`gen:${ip}`, 30, 60 * 60 * 1000)) return json({ error: '今日诗兴已用尽，请稍后再来' }, 429);
      return json(
        await runPoem(env, {
          imagery: body.imagery,
          form: body.form || '自动',
          style: body.style || '自动',
          strict: body.strict !== false,
          avoid: Array.isArray(body.avoid) ? body.avoid : [],
        }),
      );
    }

    if (pathname === '/api/posts' && method === 'GET') {
      const limit = Number(url.searchParams.get('limit') || 0);
      const posts = await store.listPosts({ limit: Number.isFinite(limit) ? limit : 0 });
      return json({ posts: posts.map(publicPost) });
    }

    if (pathname.startsWith('/api/posts/') && method === 'GET') {
      const slug = pathname.slice('/api/posts/'.length);
      const post = await store.getPostBySlug(slug);
      if (!post) return json({ error: '文章不存在或已下线' }, 404);
      const user = await currentUser(request, env, store);
      if (post.status !== 'published' && !user?.is_admin) return json({ error: '文章不存在或已下线' }, 404);
      return json({ post: publicPost(post), canEdit: Boolean(user?.is_admin) });
    }

    if (pathname === '/api/admin/posts') {
      const user = await currentUser(request, env, store);
      if (!user) return json({ error: '请先登录' }, 401);
      if (!user.is_admin) return json({ error: '无权访问：仅管理员可管理文章' }, 403);

      if (method === 'GET') {
        const posts = (await store.listPosts({ includeDrafts: true })).map(publicPost);
        return json({
          posts,
          stats: {
            total: posts.length,
            published: posts.filter((p) => p.status === 'published').length,
            draft: posts.filter((p) => p.status === 'draft').length,
          },
        });
      }

      if (method === 'POST') {
        const body = await readJson(request);
        const err = validatePost(body);
        if (err) return json({ error: err }, 400);
        const post = await store.createPost({
          ...body,
          slug: await uniqueSlug(store, body.slug || body.title),
          author: user.username,
        });
        return json({ post: publicPost(post) });
      }

      return json({ error: '方法不允许' }, 405);
    }

    const postMatch = pathname.match(/^\/api\/admin\/posts\/(\d+)$/);
    if (postMatch) {
      const user = await currentUser(request, env, store);
      if (!user) return json({ error: '请先登录' }, 401);
      if (!user.is_admin) return json({ error: '无权访问：仅管理员可管理文章' }, 403);

      const id = Number(postMatch[1]);
      const existing = await store.getPostById(id);
      if (!existing) return json({ error: '文章不存在' }, 404);

      if (method === 'GET') return json({ post: publicPost(existing) });

      if (method === 'PUT' || method === 'PATCH') {
        const body = await readJson(request);
        const err = validatePost(body, { partial: true });
        if (err) return json({ error: err }, 400);
        const patch = { ...body };
        if (body.slug !== undefined) patch.slug = await uniqueSlug(store, body.slug, id);
        const post = await store.updatePost(id, patch);
        return json({ post: publicPost(post) });
      }

      if (method === 'DELETE') {
        await store.deletePost(id);
        return json({ ok: true });
      }

      return json({ error: '方法不允许' }, 405);
    }

    if (pathname === '/api/admin/users' && method === 'GET') {
      const user = await currentUser(request, env, store);
      if (!user) return json({ error: '请先登录' }, 401);
      if (!user.is_admin) return json({ error: '无权访问：仅管理员可见' }, 403);
      const users = (await store.listUsers()).map(publicUser);
      return json({
        users,
        stats: {
          total: users.length,
          admins: users.filter((u) => u.is_admin).length,
          active: users.filter((u) => u.status === 'active').length,
        },
      });
    }

    return json({ error: '接口不存在' }, 404);
  } catch (err) {
    console.error('[api]', err?.stack || err);
    return json({ error: err?.message || '服务异常，请稍后再试' }, 500);
  }
}
