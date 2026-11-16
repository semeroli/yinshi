/**
 * Edge 端模型适配（WebCrypto）：魔搭 ModelScope（主）→ 商汤日日新（备）
 * 未配置 Key 时抛出 fallback 标记，由上层降级到本地演示库
 */
import { parseJson } from '../../shared/prompts.js';

export {
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
} from '../../shared/prompts.js';

/** 单次调用的默认上限。成诗慢，润色/校对快，调用方可按步骤覆盖。 */
const DEFAULT_TIMEOUT_MS = 70000;
/**
 * 🔴 润色那步给 22 秒，不是 18 秒：GLM-5.2 / Qwen3.8 这类模型会先"想"再吐字，
 *    60~110 字的意境稿 + 一整个 JSON 对象，18 秒里分给三家候选（9s/4.5s/4.5s）
 *    谁都不够，线上实测就是三连 aborted。宁可选一个给足时间，也别三家都瘸着跑。
 */
export const STEP_TIMEOUT = { theme: 22000, poem: 70000, fix: 18000 };

/** 兼容不同厂商的返回结构（content / reasoning_content / text） */
function pickContent(data) {
  const choice = data?.choices?.[0];
  return (
    choice?.message?.content ||
    choice?.message?.reasoning_content ||
    choice?.text ||
    data?.data?.choices?.[0]?.message?.content ||
    data?.data?.choices?.[0]?.text ||
    ''
  );
}

const enc = new TextEncoder();

function b64url(data) {
  const bytes = typeof data === 'string' ? enc.encode(data) : new Uint8Array(data);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function postJson(url, headers, body, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${text.slice(0, 180)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 通用 OpenAI 兼容通道（DeepSeek / 智谱 / 通义 / OpenAI / 自建网关均可）
 * 只需配置 LLM_BASE_URL、LLM_API_KEY，模型名用 LLM_MODEL
 */
async function callOpenAICompatible(env, messages, { temperature, top_p, max_tokens, timeoutMs, json = false }) {
  const base = String(env.LLM_BASE_URL || '').replace(/\/+$/, '');
  if (!base) throw new Error('NO_LLM_BASE_URL');

  const data = await postJson(
    `${base}/chat/completions`,
    { Authorization: `Bearer ${env.LLM_API_KEY || ''}` },
    {
      model: env.LLM_MODEL || 'deepseek-chat',
      messages,
      temperature,
      top_p,
      max_tokens,
      // ⚠️ 只有真的要结构化输出时才加：润色那一步要的是一段中文散文，
      //    强加 json_object 既让模型把稿子包进 JSON，也拖慢生成，
      //    还有一批模型/网关直接 400（DeepSeek 实测就报 400）
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    },
    timeoutMs,
  );
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('模型返回为空');
  return content;
}

/**
 * 魔搭服务端模型会上下架：MODELSCOPE_MODEL 可填多个候选（逗号分隔），未命中时按链重试。
 *
 * 🔴 2026-11-16 实测：原来那四个（Qwen3-8B / Qwen3-32B / Qwen2.5-7B-Instruct /
 *    DeepSeek-V3.1）**全部下架**，接口报 400 "has no provider supported"，
 *    于是整站悄悄退回本地库存。
 *    现用清单来自 https://api-inference.modelscope.cn/v1/models（匿名可读，随时可查）。
 *
 * 🔴 排序按**线上实测**，不按名气：
 *    GLM-5.2 实测 2.85 秒真出内容；Qwen3.8-Flash-Next 虽然在架清单里，
 *    但实测没排上（见 /api/ai-status 的 attempts），所以退到第二顺位。
 *    第一位要放「最确定、最快」的：第一个候选会吃掉一半预算，
 *    它要是坏的，等于每次冷启动先白等一半时间。
 *
 *    候选数量**不要超过 3 个**：串行试、按预算分配，润色那步只有 18 秒。
 */
const DEFAULT_MODELS = [
  'ZhipuAI/GLM-5.2',
  'Qwen/Qwen3.8-Flash-Next',
  'deepseek-ai/DeepSeek-V4.1-Flash',
];

let workingModel = '';
/** 上一轮真正调通的模型名；空串表示还没定下来。自检接口靠它回报"用的哪个" */
export function getWorkingModel() {
  return workingModel;
}
/**
 * 最近一轮每个候选的失败原因（成功时也会保留"之前那几个为什么没成"）。
 * 没有这个，自检只能说"通了"，说不了"第一个为什么不通"。
 */
let lastModelErrors = [];
export function getLastModelErrors() {
  return lastModelErrors.slice(0, 6);
}
let modelScopeDownUntil = 0;
let lastProbeAt = 0;
/** 熔断期内的半开探测间隔；熔断时长也别给太长，否则一次失手 = 十分钟全废 */
const PROBE_INTERVAL_MS = 30 * 1000;
const OUTAGE_MS = 2 * 60 * 1000;

function modelCandidates(env) {
  const configured = String(env.MODELSCOPE_MODEL || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return [...new Set([...configured, ...DEFAULT_MODELS])];
}

/**
 * 候选串行试时的单次超时怎么分。
 *
 * 🔴 这是「模型全都不通」的真凶，别再改回去：
 *    润色那步总预算只有 22 秒，候选 3 个。以前是「第一家拿一半、其余平分」，
 *    也就是 9s / 4.5s / 4.5s —— GLM-5.2、Qwen3.8 这类先想后吐字的模型
 *    一个字都来不及出来，三连 `aborted`，整站退回本地模板。
 *
 * 现在的规矩：**预算紧就不分**，整份给当前这家跑到出字为止；
 * 预算宽（成诗 70 秒）才对冲 —— 那时候平分也够写完，多试几家才划算。
 * 对冲真正的用武之地是「第一家快速失败」（HTTP 4xx/空返回，1~2 秒），
 * 这种情况剩下的时间会自然留给后面的候选。
 */
export function planTimeout(leftMs, index, remain) {
  if (leftMs <= 30000 || remain <= 1) return leftMs - 300;
  return index === 0 ? Math.floor(leftMs * 0.5) : Math.floor(leftMs / remain);
}

/**
 * 容量类错误：额度用尽 / 限流 / 欠费。
 * 这类错误**换一家就有救**，和"超时"（换一家也来不及）不是一回事。
 */
function isCapacityError(msg) {
  return /\b(429|402)\b|quota|rate[ -]?limit|exceeded your current|insufficient/i.test(String(msg || ''));
}

/** 上游 429 的正文是一大段 JSON，原样塞进错误串会把后面几家全挤掉，压成一句话 */
function compactErr(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (/quota|rate[ -]?limit|\b429\b/i.test(s)) return '额度用尽/被限流（429），换一家';
  if (/\b402\b|insufficient|balance/i.test(s)) return '账户余额不足（402），换一家';
  return s.slice(0, 90);
}

/**
 * 被上游判了"额度/限流"的模型进冷却表，冷却期内不再把它排在最前面撞。
 * 没有这张表的话，GLM 额度用尽后每次请求都要先白等它一次（润色那步是整份预算）。
 */
const modelCooldown = new Map();
const COOLDOWN_MS = 10 * 60 * 1000;

/**
 * 候选顺序：**跑通过的排最前，但绝不排除其它家**。
 *
 * 🔴 这里原来写的是 `workingModel ? [workingModel] : 全量` ——
 *    一旦某个模型成功过，候选数组就只剩它一个。于是它额度一满（429），
 *    整条链当场断掉，另外两家从头到尾没被试过，错误串里也只留它一家。
 *    记录"谁好用"是为了少走弯路，不是为了把自己钉死在一家上。
 */
function orderCandidates(env, preferred) {
  const all = modelCandidates(env);
  const now = Date.now();
  const alive = all.filter((m) => (modelCooldown.get(m) || 0) <= now);
  // 全都在冷却就别干等，硬着头皮按原顺序全试一遍（额度可能已经恢复了）
  const pool = alive.length ? alive : all;
  if (!preferred || !pool.includes(preferred)) return pool;
  return [preferred, ...pool.filter((m) => m !== preferred)];
}

async function callModelScope(env, messages, { temperature, top_p, max_tokens, timeoutMs, json = false }) {
  if (!env.MODELSCOPE_API_KEY) throw new Error('NO_MODELSCOPE_KEY');
  // 熔断期不再一刀切拒绝：每 30 秒放一个请求出去探路（半开）。
  // 否则一次偶发超时会把接下来十分钟的请求全部按死在本地库存上。
  const nowAt = Date.now();
  if (nowAt < modelScopeDownUntil) {
    if (nowAt - lastProbeAt < PROBE_INTERVAL_MS) throw new Error('魔搭通道熔断中，稍后重试');
    lastProbeAt = nowAt;
  }

  // 跑通过的那家排最前，但**不排除其它家**（见 orderCandidates 的注释）
  const candidates = orderCandidates(env, workingModel);
  const errors = [];

  // 候选模型是串行试的，每家都吃满超时会把整步拖爆 ⇒ 按**剩余预算**动态分配。
  // ⚠️ 不能用「固定每家用 timeout/候选数」：润色那步只有 18 秒，
  //    放 4 个候选就是每家 4.5 秒，一个都出不来 —— 白等一圈照样降级。
  const totalBudget = timeoutMs || DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + totalBudget;

  for (let i = 0; i < candidates.length; i += 1) {
    const name = candidates[i];
    const left = deadline - Date.now();
    if (left < 2500) {
      errors.push(`${name}: 总预算用尽，未尝试`);
      break;
    }
    const remain = candidates.length - i;
    // 分配策略见上面的 planTimeout（那是本文件最容易改坏的一段）
    const perTry = Math.max(2500, Math.min(left - 300, planTimeout(left, i, remain)));

    try {
      const data = await postJson(
        'https://api-inference.modelscope.cn/v1/chat/completions',
        { Authorization: `Bearer ${env.MODELSCOPE_API_KEY}` },
        {
          model: name,
          messages,
          temperature,
          top_p,
          max_tokens,
          // 同上：只要 JSON 的步骤才加，润色走纯文本
          ...(json ? { response_format: { type: 'json_object' } } : {}),
        },
        perTry,
      );
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error('模型返回为空');
      workingModel = name;
      modelScopeDownUntil = 0;
      modelCooldown.delete(name); // 之前被限流、现在又能用了
      lastModelErrors = errors.slice(); // 之前那几个为什么没成，留着给自检看
      return content;
    } catch (err) {
      // "The operation was aborted" 对排查等于零信息：看不出是超时还是被网关掐了。
      // 换成"超时 >21.7s 无响应"，一眼能分辨"该加预算"还是"该换模型"。
      const raw = String(err?.message || '');
      const timedOut = err?.name === 'AbortError' || /abort/i.test(raw);
      const capacity = !timedOut && isCapacityError(raw);
      // 额度用尽 / 限流：立刻换下一家，并让这家先凉十分钟 ——
      // 否则接下来每个请求都要先撞它一次，白花掉整份预算。
      if (capacity) modelCooldown.set(name, Date.now() + COOLDOWN_MS);
      if (workingModel === name) workingModel = '';
      errors.push(`${name}: ${timedOut ? `超时（>${(perTry / 1000).toFixed(1)}s 无响应）` : compactErr(raw)}`);
    }
  }
  // 全部候选失败：短时熔断，避免每次请求都白等四个候选串行超时
  modelScopeDownUntil = Date.now() + OUTAGE_MS;
  lastProbeAt = Date.now();
  lastModelErrors = errors.slice();
  throw new Error(errors.join(' | ').slice(0, 600));
}

export function hasSenseNova(env) {
  return Boolean(env.SENSENOVA_API_KEY) || Boolean(env.SENSENOVA_AK && env.SENSENOVA_SK);
}

/** 是否配置了任意在线模型通道 */
export function hasOnlineModel(env) {
  return Boolean(env.LLM_BASE_URL && env.LLM_API_KEY) || Boolean(env.MODELSCOPE_API_KEY) || hasSenseNova(env);
}

/**
 * 商汤日日新，两代接口都支持：
 * 1) SENSENOVA_API_KEY（新版 platform.sensenova.cn，sk- 开头，OpenAI 兼容）
 *    → https://token.sensenova.cn/v1/chat/completions
 * 2) SENSENOVA_AK + SENSENOVA_SK（旧版商汤大装置 console.sensecore.cn）
 *    → https://api.sensenova.cn/v1/llm/chat-completions（JWT 鉴权）
 */
async function callSenseNova(env, messages, { temperature, top_p, max_tokens, timeoutMs, json = false }) {
  const apiKey = env.SENSENOVA_API_KEY;

  // 新版：单 Key
  if (apiKey) {
    const base = String(env.SENSENOVA_BASE_URL || 'https://token.sensenova.cn/v1').replace(/\/+$/, '');
    const payload = {
      model: env.SENSENOVA_MODEL || 'sensenova-6.8-flash-lite',
      messages,
      temperature,
      top_p,
      max_tokens,
    };
    const url = `${base}/chat/completions`;
    const headers = { Authorization: `Bearer ${apiKey}` };

    // 只有要结构化输出时才先试 response_format；
    // 不要 JSON 的步骤（润色）直接一次纯文本请求 —— 商汤对 response_format 的支持本来就不稳
    let content = '';
    let firstHint = '';
    if (json) {
      try {
        const data = await postJson(url, headers, { ...payload, response_format: { type: 'json_object' } }, timeoutMs);
        content = pickContent(data);
        if (!content) firstHint = `带 response_format 时 200 但内容为空：${JSON.stringify(data).slice(0, 160)}`;
      } catch (err) {
        // 🔴 以前这里把异常静默吞了，结果外界只看到"商汤返回为空"，
        //    401 / 404 / 模型名错全都查不出来。记下来，报错时要带上。
        firstHint = `带 response_format 失败：${err.message}`;
        content = '';
      }
    }
    if (!content) {
      const data = await postJson(url, headers, payload, timeoutMs);
      content = pickContent(data);
      if (!content) {
        throw new Error(
          `商汤返回为空（模型 ${payload.model}）。纯文本请求 200 但无内容：${JSON.stringify(data).slice(
            0,
            150,
          )}｜${firstHint || '未带 response_format'}`,
        );
      }
    }
    if (!content) throw new Error('商汤返回为空');
    return content;
  }

  // 旧版：AK/SK 换 JWT
  const ak = env.SENSENOVA_AK;
  const sk = env.SENSENOVA_SK;
  if (!ak || !sk) throw new Error('NO_SENSENOVA_KEY');

  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iss: ak, exp: Math.floor(Date.now() / 1000) + 300 }));
  const key = await crypto.subtle.importKey('raw', enc.encode(sk), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${payload}`));
  const token = `${header}.${payload}.${b64url(sig)}`;

  const data = await postJson(
    'https://api.sensenova.cn/v1/llm/chat-completions',
    { Authorization: `Bearer ${token}` },
    {
      model: env.SENSENOVA_MODEL || 'SenseChat-5',
      messages,
      temperature,
      top_p,
      max_tokens,
    },
    timeoutMs,
  );
  const content = data?.data?.choices?.[0]?.message?.content || data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('商汤返回为空');
  return content;
}

/** 统一入口，返回 { content, channel } */
export async function chat(env, messages, params) {
  const errors = [];

  if (env.LLM_BASE_URL && env.LLM_API_KEY) {
    try {
      return { content: await callOpenAICompatible(env, messages, params), channel: 'llm' };
    } catch (err) {
      errors.push(`llm: ${err.message}`);
    }
  }

  if (env.MODELSCOPE_API_KEY) {
    try {
      return { content: await callModelScope(env, messages, params), channel: 'modelscope' };
    } catch (err) {
      errors.push(`modelscope: ${err.message}`);
    }
  }
  if (hasSenseNova(env)) {
    try {
      return { content: await callSenseNova(env, messages, params), channel: 'sensenova' };
    } catch (err) {
      errors.push(`sensenova: ${err.message}`);
    }
  }
  const err = new Error(errors.length ? errors.join(' | ') : '未配置模型 Key');
  err.fallback = true;
  throw err;
}

/** 结构化输出：解析失败时补一句硬约束重试一次 */
export async function chatJson(env, messages, params) {
  // json: true 才会带 response_format，普通 chat() 不带
  const first = await chat(env, messages, { ...params, json: true });
  try {
    return { ...first, data: parseJson(first.content) };
  } catch (err) {
    const retry = await chat(
      env,
      [
        ...messages,
        {
          role: 'user',
          content: '请只输出一个 JSON 对象，第一个字符必须是 {，不要任何解释，不要 Markdown 代码围栏。',
        },
      ],
      { ...params, json: true, temperature: 0.1 },
    );
    return { ...retry, data: parseJson(retry.content) };
  }
}
