/**
 * 流水线回归（零外网、零额度）
 *
 * 做法：把 globalThis.fetch 换成桩件，让本地服务以为自己在跟魔搭说话；
 * 然后真起 server/index.js，真打 HTTP 接口（含 cookie 鉴权）。
 *
 * 🔴 桩件只替换「模型上游」这一个出口，被测代码一行不改 ——
 *    否则测的就不是线上那份逻辑了。
 */
const realFetch = globalThis.fetch.bind(globalThis);

process.env.PORT = process.env.YS_TEST_PORT || '5187';
process.env.MODELSCOPE_API_KEY = 'test-key-not-real';
delete process.env.LLM_BASE_URL;
delete process.env.LLM_API_KEY;
delete process.env.SENSENOVA_API_KEY;
delete process.env.SENSENOVA_AK;
delete process.env.TURNSTILE_SECRET;
delete process.env.TURNSTILE_SITE_KEY;

/* ---------------- 桩件语料 ---------------- */

const THEME_OK = JSON.stringify({
  theme:
    '秋声起时，独坐小楼。案上残茶已冷，檐角一声疏钟浮在薄雾里。阶前桂子落了满地，无人扫。推窗见雁字横过，忽觉山长水远，去岁同看的那轮月，今夜只照着我一个。',
  imagery: ['残茶', '疏钟', '桂子', '雁字', '小楼'],
  mood: '怅惘',
  season: '秋',
  time: '夜',
  scene: '独坐小楼，故人已远',
  form_suggestion: '五言绝句',
  style_suggestion: '婉约',
});

const POEM_GOOD = JSON.stringify({
  title: '秋夜独坐',
  lines: ['孤灯照晚汀', '寒渚夜潮生', '遥忆同舟客', '天涯共月明'],
  rhyme_words: ['生', '明'],
  mood: '怅惘',
  imagery: ['孤灯', '寒渚', '夜潮', '远月'],
  paraphrase: ['一盏孤灯照着晚汀', '寒渚上夜潮暗生', '遥想当年同舟的人', '天涯共对一轮明月'],
  self_check: { line_lengths_ok: true, rhyme_ok: true },
});

/** 第 3 句只有 4 字（五言要 5 字） */
const POEM_BAD3 = JSON.stringify({
  title: '秋夜独坐',
  lines: ['孤灯照晚汀', '寒渚夜潮生', '遥忆同舟', '天涯共月明'],
  rhyme_words: ['生', '明'],
  mood: '怅惘',
  imagery: ['孤灯', '寒渚', '夜潮', '远月'],
  paraphrase: ['一盏孤灯照着晚汀', '寒渚上夜潮暗生', '遥想当年同舟', '天涯共对一轮明月'],
  self_check: { line_lengths_ok: false, rhyme_ok: true },
});

/** 修好了第 3 句，但顺手把没让它动的第 2 句也改了 —— 必须被还原 */
const FIX_TOUCHES_LINE2 = JSON.stringify({
  lines: ['孤灯照晚汀', '寒渚夜潮平', '遥忆同舟客', '天涯共月明'],
  fixed: true,
  notes: ['第3句补足五字'],
});

/** 两轮都修不好 —— 只有这样才能逼出「库存补句」那条路 */
const FIX_STILL_BAD = JSON.stringify({
  lines: ['孤灯照晚汀', '寒渚夜潮生', '遥忆同舟', '天涯共月明'],
  fixed: true,
  notes: ['无法修复'],
});

/* ---------------- 桩件 ---------------- */

let mode = 'happy';
const calls = [];

function classify(sys) {
  if (sys.includes('意境润色引擎')) return 'theme';
  if (sys.includes('创作近体绝句')) return 'poem';
  if (sys.includes('近体诗校对')) return 'fix';
  return 'unknown';
}

/**
 * 每个场景的稿子必须各不相同 —— 否则服务端 24h 缓存会让后一个场景直接命中
 * 前一个场景的结果，测出来的全是缓存。
 */
function themeReply(userMsg) {
  const tag = String(userMsg || '')
    .split('\n')[0]
    .replace('【用户原话】', '')
    .slice(0, 8);
  return JSON.stringify({
    theme: `${tag}。秋声起时，独坐小楼。案上残茶已冷，檐角一声疏钟浮在薄雾里。阶前桂子落了满地，无人扫。推窗见雁字横过，忽觉山长水远，去岁同看的那轮月，今夜只照着我一个。`,
    imagery: ['残茶', '疏钟', '桂子', '雁字', '小楼'],
    mood: '怅惘',
    season: '秋',
    time: '夜',
    scene: '独坐小楼，故人已远',
    form_suggestion: '五言绝句',
    style_suggestion: '婉约',
  });
}

function produce(kind, userMsg) {
  if (kind === 'theme') {
    if (mode === 'refusal') return '抱歉，我无法完成这个请求，请你提供更多细节。';
    if (mode === 'allDown') throw new Error('connect ECONNREFUSED 127.0.0.1:443');
    return themeReply(userMsg);
  }
  if (kind === 'poem') {
    if (mode === 'allDown') throw new Error('connect ECONNREFUSED 127.0.0.1:443');
    if (mode === 'shortLine' || mode === 'fixFail') return POEM_BAD3;
    return POEM_GOOD;
  }
  if (kind === 'fix') {
    if (mode === 'fixFail') return FIX_STILL_BAD;
    return FIX_TOUCHES_LINE2;
  }
  return '{}';
}

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || String(input);
  if (!url.includes('api-inference.modelscope.cn')) return realFetch(input, init);

  const body = JSON.parse(init.body || '{}');
  const sys = body.messages?.[0]?.content || '';
  const userMsg = body.messages?.[1]?.content || '';
  const kind = classify(sys);
  calls.push({ kind, sys, userMsg });

  const content = produce(kind, userMsg); // 在 allDown 场景里会抛，正好模拟上游挂掉
  return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

/* ---------------- 断言 ---------------- */

let pass = 0;
const fails = [];

function ok(cond, label, extra = '') {
  if (cond) {
    pass += 1;
    console.log(`  ★ ${label}`);
  } else {
    fails.push(`${label}${extra ? ` — ${extra}` : ''}`);
    console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
  }
}

/* ---------------- 主流程 ---------------- */

await import('../server/index.js');

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await realFetch(`${BASE}/api/health`);
      if (r.ok) return await r.json();
    } catch {
      /* 还没起来 */
    }
    await sleep(120);
  }
  throw new Error('本地服务没起来');
}

const health = await waitReady();
ok(health.demo === false, '桩件生效：服务认为已接入模型');

const reg = await realFetch(`${BASE}/api/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: `t${Date.now().toString(36)}`, password: 'test123456' }),
});
ok(reg.status === 200, '测试账号注册成功', `status=${reg.status}`);
const rawCookie = reg.headers.get('set-cookie') || '';
const COOKIE = rawCookie.split(';')[0];
ok(COOKIE.includes('='), '拿到会话 Cookie');

async function post(path, payload) {
  const r = await realFetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: COOKIE },
    body: JSON.stringify(payload),
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

function only(kind) {
  return calls.filter((c) => c.kind === kind);
}

const DESC = {
  happy: '秋夜一个人坐着，想一个不会回来的人',
  shortLine: '秋夜独坐，残茶已冷，雁字横空',
  fixFail: '小楼独坐，疏钟一声，桂子落满阶',
  allDown: '雨后空山，松间清泉，一个人走',
  refusal: '想你，秋天，一个人',
};

/* ===== 场景 1：正常两步 ===== */
console.log('\n[1] 两步生成（润色 → 成诗）');
mode = 'happy';
calls.length = 0;
const t1 = await post('/api/theme', { description: DESC.happy });
ok(t1.status === 200, '/api/theme 200', `status=${t1.status} ${JSON.stringify(t1.body).slice(0, 120)}`);
ok(t1.body?.theme?.theme?.length >= 20, '润色稿长度合格');
ok(t1.body?.theme?.imagery?.length >= 3, '润色稿给出意象', JSON.stringify(t1.body?.theme?.imagery));
ok(t1.body?.channel === 'modelscope', '润色走的是模型通道', t1.body?.channel);

const themeText = t1.body?.theme?.theme || '';
const p1 = await post('/api/poem', {
  imagery: {
    core_imagery: t1.body.theme.imagery,
    emotion: t1.body.theme.mood,
    season: t1.body.theme.season,
    time: t1.body.theme.time,
    scene: t1.body.theme.scene,
    form_suggestion: t1.body.theme.form_suggestion,
    style_suggestion: t1.body.theme.style_suggestion,
  },
  theme: themeText,
  form: '自动',
  style: '自动',
  strict: true,
});
ok(p1.status === 200, '/api/poem 200', `status=${p1.status}`);
ok(p1.body?.validation?.ok === true, '成诗一次过（无需修复）');
ok(p1.body?.poem?.lines?.length === 4, '四句齐全');

// 🔴 本轮最关键的断言：成诗请求里必须带着意境稿原文
const poemCall = only('poem').find((c) => c.userMsg.includes('秋声起时'));
ok(Boolean(poemCall), '成诗请求带上了意境稿原文（不是只喂几个意象词）');
ok(poemCall?.userMsg.includes('【意境稿】'), '成诗请求里有【意境稿】字段');
ok(Boolean(poemCall?.userMsg.match(themeText.slice(0, 24))), '意境稿正文逐字进入请求');

/* ===== 场景 2：坏句重写，好句不许动 ===== */
console.log('\n[2] 第 3 句少一个字 → 只重写坏句');
mode = 'shortLine';
calls.length = 0;
const t2 = await post('/api/theme', { description: DESC.shortLine });
const p2 = await post('/api/poem', {
  imagery: { core_imagery: t2.body.theme.imagery, form_suggestion: '五言绝句' },
  theme: t2.body.theme.theme,
  form: '五言绝句',
  style: '自动',
  strict: true,
});
ok(p2.body?.validation?.ok === true, '修复后校验通过');
ok(
  Array.isArray(p2.body?.pipeline) && p2.body.pipeline.some((s) => s.step === 'fix'),
  '兜底轨迹里记了「局部重写」',
  JSON.stringify(p2.body?.pipeline),
);
ok(p2.body?.poem?.lines?.[2] === '遥忆同舟客', '第 3 句被修好', p2.body?.poem?.lines?.[2]);
// 桩件故意把第 2 句改成「平」，必须被还原成原句「生」
ok(
  p2.body?.poem?.lines?.[1] === '寒渚夜潮生',
  '模型顺手改的好句被强制还原（只改坏句）',
  p2.body?.poem?.lines?.[1],
);
const fixCall = only('fix')[0];
ok(Boolean(fixCall?.userMsg.includes('【需改动】第3句')), '修复请求点名第3句', fixCall?.userMsg.slice(0, 200));
ok(Boolean(fixCall?.userMsg.includes('【未列入的一律不改】')), '修复请求写明哪些句子不许动');

/* ===== 场景 3：两轮都修不好 → 库存补句（不整首换） ===== */
console.log('\n[3] 两轮修不好 → 只补那一句，其余保留');
mode = 'fixFail';
calls.length = 0;
const t3 = await post('/api/theme', { description: DESC.fixFail });
const p3 = await post('/api/poem', {
  imagery: { core_imagery: t3.body.theme.imagery, form_suggestion: '五言绝句' },
  theme: t3.body.theme.theme,
  form: '五言绝句',
  style: '自动',
  strict: true,
});
const steps3 = (p3.body?.pipeline || []).map((s) => s.step);
ok(steps3.includes('patch'), '走到了「库存补句」这一步', JSON.stringify(steps3));
ok(!steps3.includes('fallback'), '没有整首换库存', JSON.stringify(steps3));
ok(p3.body?.validation?.ok === true, '补完校验通过');
ok(p3.body?.poem?.lines?.[2]?.length === 5, '第 3 句补齐到 5 字', p3.body?.poem?.lines?.[2]);
ok(
  p3.body?.poem?.lines?.[0] === '孤灯照晚汀' &&
    p3.body?.poem?.lines?.[1] === '寒渚夜潮生' &&
    p3.body?.poem?.lines?.[3] === '天涯共月明',
  '其余三句原样保留（意境没被扔掉）',
  JSON.stringify(p3.body?.poem?.lines),
);
ok(only('fix').length >= 2, '确实尝试了两轮修复', `fix=${only('fix').length}`);

/* ===== 场景 4：模型回道歉语 ===== */
console.log('\n[4] 模型回「抱歉，我无法完成」→ 必须识别并降级');
mode = 'refusal';
calls.length = 0;
const t4 = await post('/api/theme', { description: DESC.refusal });
ok(t4.status === 200, '仍然返回 200');
ok(t4.body?.channel === 'local', '识别为失败并降级', t4.body?.channel);
ok(!String(t4.body?.theme?.theme || '').includes('抱歉'), '没有把道歉语当意境用');
ok(Boolean(t4.body?.theme?.theme?.length >= 40), '降级稿可用', String(t4.body?.theme?.theme).slice(0, 40));

/* ===== 场景 5：上游全挂 ===== */
console.log('\n[5] 上游全挂 → 本地模板 + 本地诗库，且不缓存');
mode = 'allDown';
calls.length = 0;
const t5 = await post('/api/theme', { description: DESC.allDown });
ok(t5.status === 200, '模型挂了也不报错（降级返回）');
ok(t5.body?.channel === 'local', '润色降级为本地模板', t5.body?.channel);
ok(Boolean(t5.body?.theme?.theme?.length >= 40), '本地也产出了可用的意境稿');

const p5 = await post('/api/poem', {
  imagery: { core_imagery: t5.body.theme.imagery, form_suggestion: '五言绝句' },
  theme: t5.body.theme.theme,
  form: '五言绝句',
  style: '自动',
  strict: true,
});
ok(p5.body?.channel === 'demo', '成诗降级为本地诗库', p5.body?.channel);
ok(p5.body?.validation?.ok === true, '库存诗本身是合律的');

// 降级结果不进缓存：同样请求再来一次，仍应重新尝试模型
mode = 'allDown';
const t5b = await post('/api/theme', { description: DESC.allDown });
ok(t5b.body?.cached !== true, '降级的润色稿没有被缓存 24 小时', JSON.stringify(t5b.body?.cached));

/* ===== 场景 6：选了七言绝句，必须真的七言，不许出长短句 =====
   线上真实事故：意境「雨后空山，松间清泉」+ 七言 + 冲淡，
   库存按意象分挑了五言的《山居》，再按七言口径补句 ⇒
   「石径盘云上翠微 / 松径落云深 / 忽闻岭外钟声起 / 苔痕上石心」。 */
console.log('\n[6] 明确选七言 → 整首七言（不许五言七言混着来）');
mode = 'allDown';
calls.length = 0;
const p6 = await post('/api/poem', {
  imagery: { core_imagery: ['空山', '松林', '微雨', '苔痕'], form_suggestion: '七言绝句' },
  theme: '雨后空山，松间清泉。苔痕浸石，风过松梢。',
  form: '七言绝句',
  style: '冲淡',
  strict: true,
});
const lines6 = p6.body?.poem?.lines || [];
ok(lines6.length === 4, '给出四句', `lines=${lines6.length}`);
ok(
  lines6.every((l) => l.length === 7),
  '每句都是 7 字',
  lines6.map((l) => `${l}(${l.length})`).join(' / '),
);
ok(p6.body?.validation?.ok === true, '校验通过', (p6.body?.validation?.issues || []).join(';'));
ok(p6.body?.form === '七言绝句', '标出来的体裁是七言', p6.body?.form);
ok(p6.body?.form_mismatch !== true, '没有发生体裁降级');

// 反过来：选五言就必须五言
const p6b = await post('/api/poem', {
  imagery: { core_imagery: ['空山', '松林', '微雨', '苔痕'], form_suggestion: '五言绝句' },
  theme: '雨后空山，松间清泉。苔痕浸石，风过松梢。',
  form: '五言绝句',
  style: '冲淡',
  strict: true,
});
const lines6b = p6b.body?.poem?.lines || [];
ok(
  lines6b.length === 4 && lines6b.every((l) => l.length === 5),
  '选五言时每句 5 字',
  lines6b.map((l) => `${l}(${l.length})`).join(' / '),
);
ok(p6b.body?.validation?.ok === true, '五言这版校验通过');

/* ---------------- 收尾 ---------------- */

console.log(`\n${'='.repeat(52)}`);
console.log(`通过 ${pass} 项 · 失败 ${fails.length} 项`);
if (fails.length) {
  console.log('\n失败明细：');
  fails.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
}
process.exit(fails.length ? 1 : 0);
