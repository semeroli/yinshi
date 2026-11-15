/**
 * Cloudflare Pages Functions：/api/*
 * 与本地 Node 服务保持同一套接口契约
 */
import {
  parseImagery,
  composePoem,
  validatePoem,
  localTheme,
  patchedLines,
  syncRhymeWords,
} from '../../server/poems.js';
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
} from '../lib/model.js';
import { getStore, publicUser, publicPost } from '../lib/store.js';
import {
  hashPassword,
  verifyPassword,
  issueSessionCookie,
  clearSessionCookie,
  readSession,
  sessionTag,
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

/* ---------------- 用户统计与密码校验 ---------------- */

const CN_OFFSET = 8 * 60 * 60 * 1000;

/** '2026-11-15 05:04:33'（D1 的 datetime('now')，UTC）/ '2026-11-15T05:04:33.000Z'（JSON 文件）都能吃 */
function toMs(value) {
  if (!value) return NaN;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    return Date.parse(`${s.replace(' ', 'T')}Z`);
  }
  return Date.parse(s);
}

/** 北京时间某一天 00:00 对应的 UTC 毫秒 */
function cnDayStart(daysAgo = 0) {
  const cn = new Date(Date.now() + CN_OFFSET);
  const start = Date.UTC(cn.getUTCFullYear(), cn.getUTCMonth(), cn.getUTCDate()) - CN_OFFSET;
  return start - daysAgo * 86400000;
}

/**
 * 统计口径一律按北京时间算。
 * ⚠️ 别直接用 new Date(created_at) 比日期 —— 库里存的是 UTC，
 *    北京时间每天 0~8 点注册的用户会被算到「昨天」，管理员早上看数据会以为没人注册。
 */
function userStats(users) {
  const todayStart = cnDayStart(0);
  const weekStart = cnDayStart(6);
  const count = (fn) => users.filter(fn).length;
  return {
    total: users.length,
    admins: count((u) => Boolean(u.is_admin)),
    active: count((u) => u.status === 'active'),
    disabled: count((u) => u.status !== 'active'),
    today: users.filter((u) => toMs(u.created_at) >= todayStart).length,
    week: users.filter((u) => toMs(u.created_at) >= weekStart).length,
  };
}

function checkNewPassword(pwd) {
  const p = String(pwd ?? '');
  if (!p) return '请输入新密码';
  if (p.length < 6) return '新密码至少 6 位';
  if (p.length > 64) return '新密码最长 64 位';
  if (!p.trim()) return '密码不能全是空格';
  return '';
}

function secretOf(env) {
  return env.JWT_SECRET || 'dev-only-change-me-in-production';
}

async function currentUser(request, env, store) {
  const sess = await readSession(request, secretOf(env));
  if (!sess) return null;
  const user = await store.findUserById(sess.id);
  if (!user || user.status !== 'active') return null;
  // 密码被管理员重置过 ⇒ 这张票是旧密码签发的，作废
  if (!sess.ph || sess.ph !== (await sessionTag(user.password_hash))) return null;
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

/** ① 意境润色：把用户那三五句话扩写成可照着作诗的底本 */
async function runTheme(env, { description, form, style }) {
  const key = cacheKey({ t: 'theme', description, form, style });
  const cached = cacheGet(key);
  if (cached) return { ...cached, cached: true };

  let theme = null;
  let channel = 'local';
  let fallbackReason = '';

  if (!isDemo(env)) {
    try {
      const { content, channel: ch } = await chat(
        env,
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
async function repairLines(env, poem, form, issues, bad, round) {
  try {
    const { content } = await chat(
      env,
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

async function runPoem(env, { imagery, theme, form, style, strict, avoid }) {
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

  /* —— 生成 —— */
  if (!isDemo(env)) {
    try {
      const { data: parsed, channel: ch } = await chatJson(
        env,
        [
          { role: 'system', content: POEM_SYSTEM },
          {
            role: 'user',
            content: poemUser(imagery, { form: finalForm, style: finalStyle, strict, avoid, theme: themeText }),
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

  /* —— ② 逐句诊断重写：最多两轮 —— */
  for (let round = 1; round <= 2 && !check.ok && channel !== 'demo'; round += 1) {
    const badNow = check.bad.slice();
    const beforeBad = badNow.length;
    const merged = await repairLines(env, poem, finalForm, check.issues, badNow, round);
    if (!merged) break;

    const next = validatePoem({ ...poem, lines: merged }, finalForm);
    if (next.bad.length > beforeBad) {
      steps.push({ step: 'fix', note: `第 ${round} 轮改完反而更差，已撤回` });
      break;
    }
    poem.lines = merged;
    check = next;
    steps.push({ step: 'fix', note: `第 ${round} 轮重写了第 ${badNow.map((i) => i + 1).join('、')} 句` });
  }

  /* —— ③ 库存补坏句：只补不承担押韵的位置 —— */
  if (!check.ok) {
    const patched = patchedLines(poem, needLen, check.bad);
    if (patched.patches.length) {
      const next = validatePoem({ ...poem, lines: patched.lines }, finalForm);
      // 补完必须真的少坏句才算数，否则撤回 —— 防止"补两句、留下更烂的一三句"
      if (next.bad.length < check.bad.length) {
        poem.lines = patched.lines;
        patched.patches.forEach((pt) => {
          if (pt.para && Array.isArray(poem.paraphrase)) poem.paraphrase[pt.index] = pt.para;
        });
        check = next;
        steps.push({
          step: 'patch',
          note: `第 ${patched.patches.map((p) => p.index + 1).join('、')} 句改用本地诗句补齐，其余句子保留`,
        });
      } else {
        steps.push({ step: 'patch', note: '库存补句没能让坏句变少，已撤回' });
      }
    }
  }

  /* —— ④ 整首回落：最后一步，才换库存 —— */
  if (!check.ok && check.bad.length >= 2) {
    const local = composePoem(imagery, { form: finalForm, style: finalStyle, strict, avoid });
    const localCheck = validatePoem(local, finalForm);
    // 🔴 判据用「坏句数」而不是「问题条数」：
    //    一条「第N句为5字」和一个「句数不为4」不是等价的。
    if (localCheck.bad.length < check.bad.length) {
      poem = local;
      check = localCheck;
      channel = 'demo';
      fallbackReason = fallbackReason || '坏句过多，整首改由本地诗库兜底';
      steps.push({ step: 'fallback', note: '坏句过多，整首改用本地诗库' });
    }
  }

  // 句子被改过之后，声明的韵脚可能又对不上了 —— 以句子为准再同步一次
  if (syncRhymeWords(poem)) {
    check = validatePoem(poem, finalForm);
    steps.push({ step: 'rhyme-sync', note: '韵脚声明与句尾对不上，已按句子改正（诗未改动）' });
  }

  // 标签要跟"用户选的体裁 + 校验口径"一致。诗的实际体裁对不上时如实报出来，
  // 别让人选了七言、标签上却写五言。
  const formMismatch = Boolean(poem.form) && poem.form !== finalForm;
  const result = {
    poem,
    channel,
    form: formMismatch ? poem.form : finalForm,
    form_requested: finalForm,
    form_mismatch: formMismatch,
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
  // 🔴 只缓存"模型写成 + 校验通过"的结果。
  //    缓存降级结果等于把一次偶发失败钉死 24 小时，用户怎么刷新都是同一首库存。
  if (check.ok && channel !== 'demo' && (!avoid || !avoid.length)) cacheSet(key, result);
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
        'Set-Cookie': await issueSessionCookie(user.id, secretOf(env), secure, user.password_hash),
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
        'Set-Cookie': await issueSessionCookie(user.id, secretOf(env), secure, user.password_hash),
      });
    }

    if (pathname === '/api/auth/logout' && method === 'POST') {
      return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(secure) });
    }

    if (pathname === '/api/theme' && method === 'POST') {
      const user = await currentUser(request, env, store);
      if (!user) return json({ error: '请先登录后再题诗' }, 401);
      const body = await readJson(request);
      const description = String(body.description || '').trim();
      if (description.length < 2) return json({ error: '请多写几个字，让诗兴有个落点' }, 400);
      if (description.length > 120) return json({ error: '意境描述请控制在 120 字以内' }, 400);
      if (!rateLimit(`theme:${ip}`, 40, 60 * 60 * 1000)) return json({ error: '今日诗兴已用尽，请稍后再来' }, 429);
      return json(await runTheme(env, { description, form: body.form, style: body.style }));
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
          theme: body.theme,
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
      const users = (await store.listUsers()).map(publicUser).sort((a, b) => b.id - a.id);
      return json({ users, stats: userStats(users) });
    }

    const userMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
    if (userMatch && method === 'PATCH') {
      const me = await currentUser(request, env, store);
      if (!me) return json({ error: '请先登录' }, 401);
      if (!me.is_admin) return json({ error: '无权访问：仅管理员可操作' }, 403);
      if (!rateLimit(`admin:pwd:${ip}`, 20, 60 * 60 * 1000)) {
        return json({ error: '操作过于频繁，请稍后再试' }, 429);
      }

      const id = Number(userMatch[1]);
      const target = await store.findUserById(id);
      if (!target) return json({ error: '用户不存在' }, 404);

      const body = await readJson(request);
      const password = String(body.password ?? '');
      const pwdErr = checkNewPassword(password);
      if (pwdErr) return json({ error: pwdErr }, 400);

      const updated = await store.updateUserPassword(
        id,
        await hashPassword(password, Number(env.PBKDF2_ITERATIONS) || 100000),
      );
      if (!updated) return json({ error: '用户不存在' }, 404);

      console.log(`[admin] ${me.username} 重置了 #${id} ${target.username} 的密码`);
      return json({ ok: true, user: publicUser(updated) });
    }

    return json({ error: '接口不存在' }, 404);
  } catch (err) {
    console.error('[api]', err?.stack || err);
    return json({ error: err?.message || '服务异常，请稍后再试' }, 500);
  }
}
