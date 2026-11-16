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
// 商汤也配一个假 Key：它这一代全是推理型模型，"只有 reasoning 没有 content"是个必测的分支
process.env.SENSENOVA_API_KEY = 'sk-test-not-real';
delete process.env.LLM_BASE_URL;
delete process.env.LLM_API_KEY;
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
  if (!url.includes('api-inference.modelscope.cn') && !url.includes('token.sensenova.cn')) {
    return realFetch(input, init);
  }

  const body = JSON.parse(init.body || '{}');
  const sys = body.messages?.[0]?.content || '';
  const userMsg = body.messages?.[1]?.content || '';
  const kind = classify(sys);
  // 记下这次打的是哪个模型：验证"一家 429 要换下一家"时全靠它
  calls.push({
    kind,
    sys,
    userMsg,
    model: body.model,
    maxTokens: body.max_tokens,
    thinking: body.thinking, // 验证有没有试着关掉思考
    host: url.includes('sensenova') ? 'sensenova' : 'modelscope',
  });

  /* ---- 商汤 ---- */
  if (url.includes('token.sensenova.cn')) {
    if (mode === 'allDown') throw new Error('connect ECONNREFUSED 127.0.0.1:443');
    // 线上原始响应：只有 reasoning、没有 content，finish_reason=length
    if (mode === 'senseReasoning') {
      return new Response(
        JSON.stringify({
          id: '8303f68c72954dc5b16bb59d46458ee3',
          created: 1794807515,
          model: body.model || 'sensenova-6.8-flash-lite',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', reasoning: 'Thinking Process:\n\n1.  **Analyze the Request:** 用户只让回一个字' },
              finish_reason: 'length',
            },
          ],
          usage: { prompt_tokens: 96, completion_tokens: 32, total_tokens: 128 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { role: 'assistant', content: '好' }, finish_reason: 'stop' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // 线上真实事故：GLM-5.2 额度用尽，上游回 429 + 一大段 JSON。
  // 旧代码记住 GLM 之后候选数组只剩它一个 ⇒ 链当场断掉，另外两家没被试过。
  if (mode === 'glm429' && String(body.model || '').includes('GLM')) {
    return new Response(
      JSON.stringify({
        error: {
          message:
            'You exceeded your current quota, please check your plan and billing details. For details, see: https://help.aliyun.com/zh/model-studio/',
        },
      }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }

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

async function getJson(path) {
  const r = await realFetch(`${BASE}${path}`, { headers: { Cookie: COOKIE } });
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
  glm429: '春深小院，燕子双飞，独坐无事',
};

/* ===== 场景 0：首选模型额度用尽（429）→ 必须自动换下一家 =====
   线上真实事故：GLM-5.2 回 429 "You exceeded your current quota"，
   页面提示里只有它一家 —— 因为记住 workingModel 之后候选数组只剩它一个，
   另外两家从头到尾没被试过。放在最前面跑，是因为此刻通道还没进熔断。 */
console.log('\n[0] 首选模型 429 时必须换下一家，不能整条链断掉');
mode = 'glm429';
calls.length = 0;
const t0 = await post('/api/theme', { description: DESC.glm429 });
const triedModels = [...new Set(calls.map((c) => c.model))];
ok(t0.status === 200, '接口没有报错');
ok(String(triedModels[0] || '').includes('GLM'), '第一家仍然是记得住的那个（先试它没毛病）', String(triedModels[0]));
ok(
  triedModels.some((m) => !String(m).includes('GLM')),
  '额度用尽后确实去试了别家',
  `试过：${triedModels.join(' / ') || '（一次都没发出去）'}`,
);
ok(t0.body?.channel === 'modelscope', '最终换到了能用的模型', t0.body?.channel);
ok(Boolean(t0.body?.theme?.theme?.length >= 20), '换家之后意境稿是真模型给的（不是本地模板）');

/* ===== 场景 0b：自检可以点名某一家，并回报 Key 指纹 =====
   三家都不通时要能逐家问"到底谁坏"；换 Key 之后要能看出"生效没有"。 */
console.log('\n[0b] 自检支持 ?channel= 与 Key 指纹');
const st = await getJson('/api/ai-status?channel=modelscope');
ok(st.status === 200, '自检接口 200', `status=${st.status}`);
ok(st.body?.ok === true, '点名 modelscope 这一家能通', JSON.stringify(st.body).slice(0, 100));
ok(st.body?.channel === 'modelscope', '回的就是点名的那一家', st.body?.channel);
ok(/^[0-9a-f]{8}$/.test(String(st.body?.keys?.modelscope || '')), 'Key 指纹是 8 位十六进制');
ok(
  !JSON.stringify(st.body || {}).includes('test-key-not-real'),
  '响应里不会出现明文 Key',
);

/* ===== 场景 0c：商汤是推理型模型，「只有 reasoning 没有 content」要说清楚 =====
   线上原始响应：{"choices":[{"message":{"reasoning":"Thinking Process:…"},
                                "finish_reason":"length"}],"usage":{"completion_tokens":32}}
   思考的 token 也算 max_tokens，32 个全被"想"吃光，content 一个字都没有。
   以前报"商汤返回为空"，查了一圈 Key 和模型名 —— 现在必须点明是被思考截断。 */
console.log('\n[0c] 商汤只有 reasoning 时要说明是被思考截断');
mode = 'senseReasoning';
calls.length = 0;
const sr = await getJson('/api/ai-status?channel=sensenova');
ok(sr.body?.configured?.sensenova === true, '商汤被认定为已配置');
ok(sr.body?.ok === false, '这种响应不能算成功');
ok(
  /思考占满|finish_reason=length/.test(String(sr.body?.error || '')),
  '报错点明是思考吃光了额度（不再是含糊的"返回为空"）',
  String(sr.body?.error || '').slice(0, 70),
);
const senseCall = calls.find((c) => c.host === 'sensenova');
ok(
  Number(senseCall?.maxTokens) >= 1500,
  '商汤的 max_tokens 被抬到 1500 以上（思考 token 也算在这里）',
  String(senseCall?.maxTokens),
);
ok(senseCall?.thinking?.type === 'disabled', '尝试过带 thinking:disabled 关掉思考', JSON.stringify(senseCall?.thinking));

// 反之：商汤正常出字时必须算成功
mode = 'happy';
const so = await getJson('/api/ai-status?channel=sensenova');
ok(so.body?.ok === true && so.body?.channel === 'sensenova', '商汤正常时能拿到内容', String(so.body?.sample));

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

/* ---------------- [7] 超时预算怎么分（模型全都不通的真凶） ---------------- */

// 润色那步 22 秒、3 个候选。如果按"第一家一半"分，就是 9s/4.5s/4.5s，
// 先想后吐字的模型一个字都来不及出 —— 线上就是三连 aborted。这里把策略锁死。
console.log('\n[7] 候选超时预算分配');
{
  const { planTimeout } = await import('../server/model.js');

  const themeBudget = 22000;
  const first = planTimeout(themeBudget, 0, 3);
  ok(first > 20000, '润色：第一家拿到几乎全部预算（不摊薄）', `${first}ms / 共 ${themeBudget}ms`);
  ok(first <= themeBudget, '润色：不会超过总预算', `${first}ms`);

  const poemBudget = 70000;
  const poemFirst = planTimeout(poemBudget, 0, 3);
  const poemSecond = planTimeout(poemBudget - poemFirst, 1, 2);
  ok(
    poemFirst > 25000 && poemFirst < 40000,
    '成诗：预算宽裕时第一家只拿一半（留出对冲）',
    `${poemFirst}ms / 共 ${poemBudget}ms`,
  );
  ok(poemSecond > 10000, '成诗：第二家仍拿得到够写的时间', `${poemSecond}ms`);
  ok(planTimeout(8000, 0, 3) > 6000, '预算极紧时也是整份给一家', `${planTimeout(8000, 0, 3)}ms`);
  ok(planTimeout(60000, 0, 1) === 59700, '只剩一个候选时直接给满', `${planTimeout(60000, 0, 1)}ms`);
}

/* ===== 场景 8：掉库存时，库存诗跟描述零关联必须如实说 =====
   线上真实事故：用户写"我最喜欢华山"，选七言绝句 + 豪放，模型那步没接上，
   库存按"风格豪放 +3 分"挑了《塞上曲》（大漠风高卷暮旌），
   页面却不声不响当成品呈上 ⇒ 用户以为工具根本不懂他。 */
console.log('\n[8] 库存诗与描述不搭时必须挑明');
mode = 'allDown';
calls.length = 0;
const p8 = await post('/api/poem', {
  imagery: { core_imagery: ['削壁', '清溪', '荷叶', '粉荷', '小鱼小虾'], form_suggestion: '七言绝句' },
  theme: '华山千仞，削壁如城。清溪绕石而下，山色如画。',
  form: '七言绝句',
  style: '豪放',
  strict: true,
});
ok(p8.body?.channel === 'demo', '这种情况确实掉到本地库存', p8.body?.channel);
ok(p8.body?.demo_mismatch === true, '标记为「与描述无关」', String(p8.body?.demo_mismatch));
ok(
  (p8.body?.pipeline || []).some((s) => s.step === 'demo-mismatch'),
  '兜底轨迹里写明是本地示例',
  (p8.body?.pipeline || []).map((s) => s.step).join(','),
);
// 反过来：意象能对上库存诗时，别乱报警
const p8b = await post('/api/poem', {
  imagery: { core_imagery: ['大漠', '长河', '孤城', '旌旗'], form_suggestion: '七言绝句' },
  theme: '塞上黄昏，大漠风紧，孤城一角压着落日。',
  form: '七言绝句',
  style: '豪放',
  strict: true,
});
ok(p8b.body?.demo_mismatch !== true, '意象能对上库存时不误报', String(p8b.body?.demo_mismatch));

/* ---------------- 收尾 ---------------- */

console.log(`\n${'='.repeat(52)}`);
console.log(`通过 ${pass} 项 · 失败 ${fails.length} 项`);
if (fails.length) {
  console.log('\n失败明细：');
  fails.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
}
process.exit(fails.length ? 1 : 0);
