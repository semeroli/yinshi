/**
 * Cloudflare Pages Functions 存储层
 * - 绑定 D1（env.DB）时持久化到 SQLite
 * - 未绑定 D1 时降级为实例内存（部署即可用，重启后清空）
 */

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT,
    password_hash TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    last_login_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    summary TEXT DEFAULT '',
    content TEXT DEFAULT '',
    cover_url TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    status TEXT DEFAULT 'draft',
    author TEXT DEFAULT 'admin',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    published_at TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS idx_users_username ON users (username)',
  'CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts (slug)',
  'CREATE INDEX IF NOT EXISTS idx_posts_status ON posts (status)',
];

/* ---------------- 内存降级实现 ---------------- */

const mem = { users: [], posts: [], userId: 1, postId: 1 };

const memoryStore = {
  persistent: false,
  async findUserByUsername(username) {
    const key = String(username).toLowerCase();
    return mem.users.find((u) => u.username.toLowerCase() === key) || null;
  },
  async findUserById(id) {
    return mem.users.find((u) => u.id === Number(id)) || null;
  },
  async createUser({ username, email, password_hash, is_admin }) {
    const now = new Date().toISOString();
    const user = {
      id: mem.userId++,
      username,
      email: email || null,
      password_hash,
      is_admin: is_admin ? 1 : 0,
      status: 'active',
      created_at: now,
      last_login_at: null,
    };
    mem.users.push(user);
    return user;
  },
  async touchLogin(id) {
    const u = await this.findUserById(id);
    if (u) u.last_login_at = new Date().toISOString();
  },
  async listUsers() {
    return [...mem.users].sort((a, b) => a.id - b.id);
  },
  async listPosts({ includeDrafts = false, limit = 0 } = {}) {
    let list = [...mem.posts];
    if (!includeDrafts) list = list.filter((p) => p.status === 'published');
    list.sort((a, b) => String(b.published_at || b.updated_at).localeCompare(String(a.published_at || a.updated_at)));
    return limit > 0 ? list.slice(0, limit) : list;
  },
  async getPostBySlug(slug) {
    return mem.posts.find((p) => p.slug === slug) || null;
  },
  async getPostById(id) {
    return mem.posts.find((p) => p.id === Number(id)) || null;
  },
  async slugExists(slug, excludeId = null) {
    return mem.posts.some((p) => p.slug === slug && p.id !== excludeId);
  },
  async createPost(data) {
    const now = new Date().toISOString();
    const post = {
      id: mem.postId++,
      slug: data.slug,
      title: data.title,
      summary: data.summary || '',
      content: data.content || '',
      cover_url: data.cover_url || '',
      tags: JSON.stringify(data.tags || []),
      status: data.status === 'published' ? 'published' : 'draft',
      author: data.author || 'admin',
      created_at: now,
      updated_at: now,
      published_at: data.status === 'published' ? now : null,
    };
    mem.posts.push(post);
    return post;
  },
  async updatePost(id, data) {
    const post = await this.getPostById(id);
    if (!post) return null;
    Object.assign(post, data, { updated_at: new Date().toISOString() });
    if (data.tags) post.tags = JSON.stringify(data.tags);
    if (data.status === 'published' && !post.published_at) post.published_at = post.updated_at;
    return post;
  },
  async deletePost(id) {
    const i = mem.posts.findIndex((p) => p.id === Number(id));
    if (i === -1) return false;
    mem.posts.splice(i, 1);
    return true;
  },
};

/* ---------------- D1 实现 ---------------- */

function d1Store(db) {
  return {
    persistent: true,
    async findUserByUsername(username) {
      return db
        .prepare('SELECT * FROM users WHERE lower(username) = lower(?)')
        .bind(String(username))
        .first();
    },
    async findUserById(id) {
      return db.prepare('SELECT * FROM users WHERE id = ?').bind(Number(id)).first();
    },
    async createUser({ username, email, password_hash, is_admin }) {
      const now = new Date().toISOString();
      const res = await db
        .prepare(
          `INSERT INTO users (username, email, password_hash, is_admin, status, created_at, last_login_at)
           VALUES (?, ?, ?, ?, 'active', ?, ?)`,
        )
        .bind(username, email || null, password_hash, is_admin ? 1 : 0, now, null)
        .run();
      return this.findUserById(res.meta.last_row_id);
    },
    async touchLogin(id) {
      await db
        .prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
        .bind(new Date().toISOString(), Number(id))
        .run();
    },
    async listUsers() {
      const { results } = await db.prepare('SELECT * FROM users ORDER BY id ASC').all();
      return results || [];
    },
    async listPosts({ includeDrafts = false, limit = 0 } = {}) {
      const sql = includeDrafts
        ? 'SELECT * FROM posts ORDER BY COALESCE(published_at, updated_at) DESC'
        : "SELECT * FROM posts WHERE status = 'published' ORDER BY COALESCE(published_at, updated_at) DESC";
      const stmt = limit > 0 ? db.prepare(`${sql} LIMIT ?`).bind(limit) : db.prepare(sql);
      const { results } = await stmt.all();
      return results || [];
    },
    async getPostBySlug(slug) {
      return db.prepare('SELECT * FROM posts WHERE slug = ?').bind(slug).first();
    },
    async getPostById(id) {
      return db.prepare('SELECT * FROM posts WHERE id = ?').bind(Number(id)).first();
    },
    async slugExists(slug, excludeId = null) {
      const row = excludeId
        ? await db.prepare('SELECT id FROM posts WHERE slug = ? AND id != ?').bind(slug, Number(excludeId)).first()
        : await db.prepare('SELECT id FROM posts WHERE slug = ?').bind(slug).first();
      return Boolean(row);
    },
    async createPost(data) {
      const now = new Date().toISOString();
      const res = await db
        .prepare(
          `INSERT INTO posts (slug, title, summary, content, cover_url, tags, status, author, created_at, updated_at, published_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          data.slug,
          data.title,
          data.summary || '',
          data.content || '',
          data.cover_url || '',
          JSON.stringify(data.tags || []),
          data.status === 'published' ? 'published' : 'draft',
          data.author || 'admin',
          now,
          now,
          data.status === 'published' ? now : null,
        )
        .run();
      return this.getPostById(res.meta.last_row_id);
    },
    async updatePost(id, data) {
      const post = await this.getPostById(id);
      if (!post) return null;
      const next = { ...post, ...data, updated_at: new Date().toISOString() };
      if (data.tags !== undefined) next.tags = JSON.stringify(data.tags);
      if (next.status === 'published' && !post.published_at) next.published_at = next.updated_at;
      await db
        .prepare(
          `UPDATE posts SET slug = ?, title = ?, summary = ?, content = ?, cover_url = ?, tags = ?,
             status = ?, updated_at = ?, published_at = ? WHERE id = ?`,
        )
        .bind(
          next.slug,
          next.title,
          next.summary || '',
          next.content || '',
          next.cover_url || '',
          next.tags,
          next.status,
          next.updated_at,
          next.published_at || null,
          Number(id),
        )
        .run();
      return this.getPostById(id);
    },
    async deletePost(id) {
      const res = await db.prepare('DELETE FROM posts WHERE id = ?').bind(Number(id)).run();
      return (res.meta.changes || 0) > 0;
    },
  };
}

let schemaReady = false;

/** 获取存储实例；首次调用时确保表结构存在（D1 幂等） */
export async function getStore(env) {
  if (!env || !env.DB) return memoryStore;
  const store = d1Store(env.DB);
  if (!schemaReady) {
    try {
      for (const sql of SCHEMA) await env.DB.prepare(sql).run();
      schemaReady = true;
    } catch (err) {
      console.error('[store] 初始化表结构失败，降级内存存储：', err.message);
      return memoryStore;
    }
  }
  return store;
}

/** 统一对外字段（隐藏 password_hash） */
export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    is_admin: Boolean(user.is_admin),
    status: user.status || 'active',
    created_at: user.created_at,
    last_login_at: user.last_login_at,
  };
}

export function publicPost(post) {
  if (!post) return null;
  let tags = [];
  try {
    tags = typeof post.tags === 'string' ? JSON.parse(post.tags || '[]') : post.tags || [];
  } catch {
    tags = [];
  }
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    summary: post.summary || '',
    content: post.content || '',
    cover_url: post.cover_url || '',
    tags: Array.isArray(tags) ? tags : [],
    status: post.status,
    author: post.author || '',
    created_at: post.created_at,
    updated_at: post.updated_at,
    published_at: post.published_at || null,
  };
}
