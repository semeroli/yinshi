/**
 * 本地数据层：JSON 文件存储（对应线上 D1 的 users 表）
 * 密码：PBKDF2-SHA256 10 万次迭代；会话：HMAC 签名 Cookie；生成结果：TTL 缓存
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me-in-production';
const ITERATIONS = Number(process.env.PBKDF2_ITERATIONS || 100000);
export const COOKIE_NAME = 'shijing_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let db = { users: [], nextId: 1, posts: [], nextPostId: 1 };

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      db.users ||= [];
      db.nextId ||= db.users.length + 1;
      db.posts ||= [];
      db.nextPostId ||= (db.posts.reduce((m, p) => Math.max(m, p.id || 0), 0) || 0) + 1;
    } catch {
      console.warn('[store] 数据文件损坏，使用空库启动');
      db = { users: [], nextId: 1, posts: [], nextPostId: 1 };
    }
  } else {
    persist();
  }
}

function persist() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

ensure();

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256').toString('hex');
  return `${ITERATIONS}$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [iter, salt, hash] = String(stored).split('$');
    const calc = crypto.pbkdf2Sync(password, salt, Number(iter), 32, 'sha256').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(calc, 'hex'), Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

export function findUserByUsername(username) {
  return db.users.find((u) => u.username.toLowerCase() === String(username).toLowerCase());
}

export function findUserById(id) {
  return db.users.find((u) => u.id === id);
}

export function createUser({ username, email, password }) {
  const adminName = (process.env.ADMIN_USERNAME || '').trim().toLowerCase();
  const user = {
    id: db.nextId++,
    username,
    email: email || null,
    password_hash: hashPassword(password),
    is_admin: adminName && username.toLowerCase() === adminName ? 1 : 0,
    status: 'active',
    created_at: new Date().toISOString(),
    last_login_at: null,
  };
  db.users.push(user);
  persist();
  return user;
}

export function touchLogin(id) {
  const user = findUserById(id);
  if (!user) return;
  user.last_login_at = new Date().toISOString();
  persist();
}

export function listUsers() {
  return db.users.map((u) => ({
    id: u.id,
    username: u.username,
    email: u.email,
    is_admin: u.is_admin,
    status: u.status,
    created_at: u.created_at,
    last_login_at: u.last_login_at,
  }));
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    is_admin: Boolean(user.is_admin),
    created_at: user.created_at,
    last_login_at: user.last_login_at,
  };
}

/* ---------------- 文章（博客） ---------------- */

export function listPosts({ includeDrafts = false, limit = 0 } = {}) {
  let list = [...db.posts];
  if (!includeDrafts) list = list.filter((p) => p.status === 'published');
  list.sort((a, b) => {
    const ta = new Date(a.published_at || a.updated_at || 0).getTime();
    const tb = new Date(b.published_at || b.updated_at || 0).getTime();
    return tb - ta;
  });
  if (limit > 0) list = list.slice(0, limit);
  return list.map(publicPost);
}

export function getPostBySlug(slug) {
  return db.posts.find((p) => p.slug === slug) || null;
}

export function getPostById(id) {
  return db.posts.find((p) => p.id === id) || null;
}

export function publicPost(post) {
  if (!post) return null;
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    summary: post.summary || '',
    content: post.content || '',
    cover_url: post.cover_url || '',
    tags: Array.isArray(post.tags) ? post.tags : [],
    status: post.status,
    author: post.author || '',
    created_at: post.created_at,
    updated_at: post.updated_at,
    published_at: post.published_at || null,
  };
}

function normalizeSlug(input, fallback) {
  const raw = String(input || '').trim();
  if (!raw) return fallback;
  const cleaned = raw
    .replace(/\s+/g, '-')
    .replace(/[^\w\u4e00-\u9fa5-]/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

export function uniqueSlug(input, excludeId = null) {
  const base = normalizeSlug(input, `p-${Date.now().toString(36)}`);
  let slug = base;
  let n = 2;
  while (db.posts.some((p) => p.slug === slug && p.id !== excludeId)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

export function createPost(data) {
  const now = new Date().toISOString();
  const post = {
    id: db.nextPostId++,
    slug: uniqueSlug(data.slug || data.title),
    title: data.title,
    summary: data.summary || '',
    content: data.content || '',
    cover_url: data.cover_url || '',
    tags: Array.isArray(data.tags) ? data.tags.slice(0, 8) : [],
    status: data.status === 'published' ? 'published' : 'draft',
    author: data.author || 'admin',
    created_at: now,
    updated_at: now,
    published_at: data.status === 'published' ? now : null,
  };
  db.posts.push(post);
  persist();
  return publicPost(post);
}

export function updatePost(id, data) {
  const post = getPostById(id);
  if (!post) return null;
  if (data.slug !== undefined) post.slug = uniqueSlug(data.slug, id);
  if (data.title !== undefined) post.title = data.title;
  if (data.summary !== undefined) post.summary = data.summary;
  if (data.content !== undefined) post.content = data.content;
  if (data.cover_url !== undefined) post.cover_url = data.cover_url;
  if (data.tags !== undefined) post.tags = Array.isArray(data.tags) ? data.tags.slice(0, 8) : [];
  if (data.status !== undefined) {
    post.status = data.status === 'published' ? 'published' : 'draft';
    if (post.status === 'published' && !post.published_at) post.published_at = new Date().toISOString();
    if (post.status === 'draft') post.published_at = post.published_at || null;
  }
  post.updated_at = new Date().toISOString();
  persist();
  return publicPost(post);
}

export function deletePost(id) {
  const idx = db.posts.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  db.posts.splice(idx, 1);
  persist();
  return true;
}

/* ---------------- 会话（签名 Cookie） ---------------- */

function sign(data) {
  return crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
}

export function issueSession(userId) {
  const payload = Buffer.from(
    JSON.stringify({ u: userId, exp: Date.now() + SESSION_TTL_MS }),
  ).toString('base64url');
  const token = `${payload}.${sign(payload)}`;
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${
    process.env.NODE_ENV === 'production' ? '; Secure' : ''
  }`;
}

export function clearSession() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function parseCookies(header = '') {
  return header.split(';').reduce((acc, part) => {
    const idx = part.indexOf('=');
    if (idx > -1) acc[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    return acc;
  }, {});
}

export function getUserFromRequest(req) {
  const token = parseCookies(req.headers.cookie || '')[COOKIE_NAME];
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now()) return null;
    const user = findUserById(data.u);
    if (!user || user.status !== 'active') return null;
    return user;
  } catch {
    return null;
  }
}

/* ---------------- 生成结果缓存（对应线上 KV） ---------------- */

const cache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function cacheKey(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

export function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expire < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

export function cacheSet(key, value) {
  if (cache.size > 500) cache.clear();
  cache.set(key, { value, expire: Date.now() + CACHE_TTL_MS });
}

/* ---------------- 简易频控 ---------------- */

const buckets = new Map();

export function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const list = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= limit) return false;
  list.push(now);
  buckets.set(key, list);
  return true;
}
