/**
 * 管理员用户管理回归（零外网、零模型调用）
 *
 * 覆盖三件事：
 *   ① 能看到「多少用户注册」—— 总数 / 今日 / 近 7 天 / 管理员 / 停用
 *   ② 能看到「注册信息」—— 用户名 / 邮箱 / 注册时间 / 最近登录 / 角色 / 状态
 *   ③ 能改密码 —— 且改完目标用户的旧 cookie 立刻失效、旧密码登不进、新密码能登
 *
 * 做法：真起 server/index.js，真打 HTTP。数据目录指到系统临时目录，
 * 不碰本地开发库（靠 YS_DATA_DIR）。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.YS_TEST_PORT || '5188';
const BASE = `http://127.0.0.1:${PORT}`;
const DS_DIR = mkdtempSync(path.join(tmpdir(), 'ys-admin-'));

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fails.push(name + (extra ? ` → ${extra}` : ''));
    console.log(`  ✗ ${name}${extra ? ` → ${extra}` : ''}`);
  }
}

/* ---------------- 起服务 ---------------- */

const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT,
    YS_DATA_DIR: DS_DIR,
    ADMIN_USERNAME: 'boss',
    SESSION_SECRET: 'test-secret-for-admin-regression-only',
    // 挡住所有模型上游：本脚本一个模型调用都不该发生
    MODELSCOPE_API_KEY: '',
    LLM_BASE_URL: '',
    LLM_API_KEY: '',
    SENSENOVA_API_KEY: '',
    TURNSTILE_SECRET: '',
    TURNSTILE_SITE_KEY: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const bootLog = [];
child.stdout.on('data', (d) => bootLog.push(String(d)));
child.stderr.on('data', (d) => bootLog.push(String(d)));

async function waitServer(ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function cleanup() {
  try {
    child.kill('SIGKILL');
  } catch {
    /* ignore */
  }
  try {
    rmSync(DS_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/* ---------------- HTTP 小工具 ---------------- */

async function call(method, p, { body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  const r = await fetch(`${BASE}${p}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await r.json();
  } catch {
    data = null;
  }
  const setCookie = r.headers.get('set-cookie') || '';
  // ⚠️ cookie 名是 shijing_session（见 server/store.js 的 COOKIE_NAME），别照项目名猜
  const m = setCookie.match(/shijing_session=([^;]*)/);
  return { status: r.status, data, cookie: m ? `shijing_session=${m[1]}` : '' };
}

/** /api/auth/me 恒返回 200，登录与否要看 body.user —— 只看状态码会永远「通过」 */
async function meUser(cookie) {
  const r = await call('GET', '/api/auth/me', { cookie });
  return r.data?.user?.username || null;
}

const reg = (username, email, password) =>
  call('POST', '/api/auth/register', { body: { username, email, password } });
const login = (username, password) =>
  call('POST', '/api/auth/login', { body: { username, password } });

/* ---------------- 开跑 ---------------- */

try {
  const up = await waitServer();
  if (!up) {
    console.error('服务起不来：\n' + bootLog.join(''));
    cleanup();
    process.exit(1);
  }

  console.log('\n[1] 准备账号');
  const boss = await reg('boss', 'boss@example.com', 'boss-pass-1');
  ok('注册管理员 boss 成功', boss.status === 200 || boss.status === 201, `status=${boss.status}`);
  const alice = await reg('alice', 'alice@example.com', 'alice-pass-1');
  ok('注册 alice 成功', alice.status === 200 || alice.status === 201);
  const bob = await reg('bob', '', 'bob-pass-1');
  ok('注册 bob 成功', bob.status === 200 || bob.status === 201);

  const bossLogin = await login('boss', 'boss-pass-1');
  ok('管理员登录成功', bossLogin.status === 200 && !!bossLogin.cookie, `status=${bossLogin.status}`);
  const bossCookie = bossLogin.cookie;

  const aliceLogin = await login('alice', 'alice-pass-1');
  ok('alice 登录成功', aliceLogin.status === 200 && !!aliceLogin.cookie);
  const aliceCookie = aliceLogin.cookie;

  console.log('\n[2] 权限：谁能看用户列表');
  const noAuth = await call('GET', '/api/admin/users');
  ok('未登录看列表 → 401', noAuth.status === 401, `status=${noAuth.status}`);
  ok('未登录时 /api/auth/me 的 user 为空', (await meUser('')) === null);
  const asUser = await call('GET', '/api/admin/users', { cookie: aliceCookie });
  ok('普通用户看列表 → 403', asUser.status === 403, `status=${asUser.status}`);

  console.log('\n[3] 数量统计');
  const list = await call('GET', '/api/admin/users', { cookie: bossCookie });
  ok('管理员拿到列表 → 200', list.status === 200, `status=${list.status}`);
  const stats = list.data?.stats || {};
  const users = list.data?.users || [];
  ok('总数 = 3', stats.total === 3, `total=${stats.total}`);
  ok('今日新增 = 3', stats.today === 3, `today=${stats.today}`);
  ok('近 7 天 = 3', stats.week === 3, `week=${stats.week}`);
  ok('管理员数 = 1', stats.admins === 1, `admins=${stats.admins}`);
  ok('已停用 = 0', stats.disabled === 0, `disabled=${stats.disabled}`);

  console.log('\n[4] 注册信息');
  ok('列表按注册先后倒序（最新在前）', users[0]?.username === 'bob', `first=${users[0]?.username}`);
  const aliceRow = users.find((u) => u.username === 'alice');
  ok('带邮箱字段', aliceRow?.email === 'alice@example.com', `email=${aliceRow?.email}`);
  ok('带注册时间', Boolean(aliceRow?.created_at), `created_at=${aliceRow?.created_at}`);
  ok('带角色', aliceRow?.is_admin === false && users.find((u) => u.username === 'boss')?.is_admin === true);
  ok('带状态', aliceRow?.status === 'active', `status=${aliceRow?.status}`);
  ok('带最近登录（登录过的不是空）', Boolean(users.find((u) => u.username === 'alice')?.last_login_at));
  ok('响应里不含密码哈希', !JSON.stringify(list.data).includes('password'));

  console.log('\n[5] 改密码：守门与校验');
  const idOf = (name) => users.find((u) => u.username === name)?.id;
  const aliceId = idOf('alice');
  const asUserPatch = await call('PATCH', `/api/admin/users/${aliceId}`, {
    cookie: aliceCookie,
    body: { password: 'hacked-pass' },
  });
  ok('普通用户改别人密码 → 403', asUserPatch.status === 403, `status=${asUserPatch.status}`);
  const short = await call('PATCH', `/api/admin/users/${aliceId}`, {
    cookie: bossCookie,
    body: { password: '123' },
  });
  ok('密码太短 → 400', short.status === 400, `status=${short.status}`);
  const long = await call('PATCH', `/api/admin/users/${aliceId}`, {
    cookie: bossCookie,
    body: { password: 'x'.repeat(65) },
  });
  ok('密码太长 → 400', long.status === 400, `status=${long.status}`);
  const blank = await call('PATCH', `/api/admin/users/${aliceId}`, {
    cookie: bossCookie,
    body: { password: '' },
  });
  ok('空密码 → 400', blank.status === 400, `status=${blank.status}`);
  const ghost = await call('PATCH', '/api/admin/users/99999', {
    cookie: bossCookie,
    body: { password: 'whatever-1' },
  });
  ok('用户不存在 → 404', ghost.status === 404, `status=${ghost.status}`);

  console.log('\n[6] 改密码：生效');
  const done = await call('PATCH', `/api/admin/users/${aliceId}`, {
    cookie: bossCookie,
    body: { password: 'alice-new-pass' },
  });
  ok('管理员改 alice 密码 → 200', done.status === 200, `status=${done.status} ${JSON.stringify(done.data)}`);
  ok('回包带用户信息但不带密码', done.data?.user?.username === 'alice' && !JSON.stringify(done.data).includes('password'));

  const oldStill = await meUser(aliceCookie);
  ok('alice 改密码前签发的 cookie 立刻失效', oldStill === null, `me=${oldStill}`);

  const oldPwd = await login('alice', 'alice-pass-1');
  ok('旧密码登不进 → 401', oldPwd.status === 401, `status=${oldPwd.status}`);

  const newPwd = await login('alice', 'alice-new-pass');
  ok('新密码能登 → 200', newPwd.status === 200, `status=${newPwd.status}`);
  const me = await meUser(newPwd.cookie);
  ok('新 cookie 可用且就是 alice', me === 'alice', `me=${me}`);

  const bossStill = await meUser(bossCookie);
  ok('管理员自己的会话不受影响', bossStill === 'boss', `me=${bossStill}`);

  console.log('\n[7] 改密码后统计口径不乱');
  const list2 = await call('GET', '/api/admin/users', { cookie: bossCookie });
  ok('改密码不会新增用户', list2.data?.stats?.total === 3, `total=${list2.data?.stats?.total}`);
  ok('alice 仍在列表里', Boolean(list2.data?.users?.find((u) => u.username === 'alice')));
} catch (err) {
  fails.push(`脚本异常：${err?.message || err}`);
  console.error(err);
} finally {
  cleanup();
}

console.log('');
if (fails.length) {
  console.log(`❌ ${pass} 通过 / ${fails.length} 失败`);
  fails.forEach((f) => console.log('   - ' + f));
  process.exit(1);
}
console.log(`✅ 全部通过（${pass} 项）`);
