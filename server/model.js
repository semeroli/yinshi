/**
 * 服务端模型适配（Node）：魔搭 ModelScope（主）→ 商汤日日新（备）
 * 未配置任何 Key 时由上层降级到本地演示库（poems.js）
 */
import { parseJson } from '../shared/prompts.js';

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
} from '../shared/prompts.js';

/** 单次调用的默认上限。成诗慢，润色/校对快，调用方可按步骤覆盖。 */
const DEFAULT_TIMEOUT_MS = 70000;
/**
 * 🔴 润色那步给 22 秒，不是 18 秒：GLM-5.2 / Qwen3.8 这类模型先"想"再吐字，
 *    一整段意境稿 + 一整个 JSON，18 秒三家候选分（9s/4.5s/4.5s）谁都不够 ⇒ 三连 aborted。
 */
export const STEP_TIMEOUT = { theme: 22000, poem: 70000, fix: 18000 };

/**
 * 兼容不同厂商的返回结构（content / reasoning_content / text）。
 * ⚠️ 故意不把 `reasoning` 当内容：商汤 flash-lite 族的思考字段就叫 reasoning，
 *    里面是"Thinking Process: 1. Analyze…"这种草稿，当诗交上去等于给用户一段英文自言自语。
 */
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
      const err = new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
      err.status = res.status;
      throw err;
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
async function callOpenAICompatible(messages, { temperature, top_p, max_tokens, timeoutMs, json = false }) {
  const base = String(process.env.LLM_BASE_URL || '').replace(/\/+$/, '');
  if (!base) throw new Error('NO_LLM_BASE_URL');

  const data = await postJson(
    `${base}/chat/completions`,
    { Authorization: `Bearer ${process.env.LLM_API_KEY || ''}` },
    {
      model: process.env.LLM_MODEL || 'deepseek-chat',
      messages,
      temperature,
      top_p,
      max_tokens,
      // ⚠️ 只有真的要结构化输出时才加：润色要的是一段中文散文，
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

/** 魔搭服务端模型会上下架：MODELSCOPE_MODEL 可填多个候选，未命中时按链重试 */
/**
 * 🔴 2026-11-16 实测：原来那四个（Qwen3-8B / Qwen3-32B / Qwen2.5-7B-Instruct /
 *    DeepSeek-V3.1）全部下架，接口报 400 "has no provider supported"。
 *    现用清单来自 https://api-inference.modelscope.cn/v1/models（匿名可读）。
 *
 * 🔴 排序按线上实测：GLM-5.2 实测 2.85 秒真出内容；Qwen3.8-Flash-Next 虽然在架清单里
 *    但实测没排上，退第二。第一位会吃掉一半预算，必须是"最确定"的那个。
 *    候选别贪多：串行试会摊薄超时，润色只有 18 秒。
 */
const DEFAULT_MODELS = [
  'ZhipuAI/GLM-5.2',
  'Qwen/Qwen3.8-Flash-Next',
  'deepseek-ai/DeepSeek-V4.1-Flash',
];

let workingModel = '';
/** 上一轮真正调通的模型名；自检接口靠它回报"用的哪个" */
export function getWorkingModel() {
  return workingModel;
}

/** 最近一轮每个候选的失败原因（成功时也保留"前面那几个为什么没成"） */
let lastModelErrors = [];
export function getLastModelErrors() {
  return lastModelErrors.slice(0, 6);
}
let modelScopeDownUntil = 0;
let lastProbeAt = 0;
/** 熔断期内的半开探测间隔；熔断时长也别给太长，否则一次失手 = 十分钟全废 */
const PROBE_INTERVAL_MS = 30 * 1000;
const OUTAGE_MS = 2 * 60 * 1000;

function modelCandidates() {
  const configured = String(process.env.MODELSCOPE_MODEL || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return [...new Set([...configured, ...DEFAULT_MODELS])];
}

/**
 * 候选串行试时的单次超时怎么分。
 *
 * 🔴 这是「模型全都不通」的真凶，别再改回去：
 *    润色那步总预算只有 22 秒、候选 3 个。以前「第一家一半、其余平分」
 *    ＝ 9s / 4.5s / 4.5s，先想后吐字的模型一个字都来不及出来，三连 aborted。
 *
 * 现在：预算紧就**不分**，整份给当前这家；预算宽（成诗）才对冲。
 */
export function planTimeout(leftMs, index, remain) {
  if (leftMs <= 30000 || remain <= 1) return leftMs - 300;
  return index === 0 ? Math.floor(leftMs * 0.5) : Math.floor(leftMs / remain);
}

/**
 * 容量类错误：额度用尽 / 限流 / 欠费。这类错误**换一家就有救**，
 * 和"超时"（换一家也来不及）不是一回事。
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

/** 被上游判了"额度/限流"的模型进冷却表，冷却期内不再排在最前面撞 */
const modelCooldown = new Map();
const COOLDOWN_MS = 10 * 60 * 1000;

/**
 * 候选顺序：**跑通过的排最前，但绝不排除其它家**。
 *
 * 🔴 这里原来是 `workingModel ? [workingModel] : 全量` —— 一旦某模型成功过，
 *    候选就只剩它一个。于是它额度一满（429），整条链当场断掉，
 *    另外两家从头到尾没被试过，错误串里也只留它一家。
 *    记住"谁好用"是为了少走弯路，不是为了把自己钉死在一家上。
 */
function orderCandidates(preferred) {
  const all = modelCandidates();
  const now = Date.now();
  const alive = all.filter((m) => (modelCooldown.get(m) || 0) <= now);
  const pool = alive.length ? alive : all;
  if (!preferred || !pool.includes(preferred)) return pool;
  return [preferred, ...pool.filter((m) => m !== preferred)];
}

async function callModelScope(messages, { temperature, top_p, max_tokens, timeoutMs, json = false }, model) {
  const key = process.env.MODELSCOPE_API_KEY;
  if (!key) throw new Error('NO_MODELSCOPE_KEY');
  // 熔断期不再一刀切拒绝：每 30 秒放一个请求出去探路（半开）。
  // 否则一次偶发超时会把接下来十分钟的请求全部按死在本地库存上。
  const nowAt = Date.now();
  if (nowAt < modelScopeDownUntil) {
    if (nowAt - lastProbeAt < PROBE_INTERVAL_MS) throw new Error('魔搭通道熔断中，稍后重试');
    lastProbeAt = nowAt;
  }

  // model 参数是"指定必须用这一家"（测试/调试用）；否则跑通过的排最前、其余照试
  const candidates = model ? [model] : orderCandidates(workingModel);
  const errors = [];

  // 按**剩余预算**动态分配：润色只有 18 秒，固定均分会让每个候选都短到来不及出字
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
    // 分配策略见 planTimeout
    const perTry = Math.max(2500, Math.min(left - 300, planTimeout(left, i, remain)));

    try {
      const data = await postJson(
        'https://api-inference.modelscope.cn/v1/chat/completions',
        { Authorization: `Bearer ${key}` },
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
      modelCooldown.delete(name);
      lastModelErrors = errors.slice();
      return content;
    } catch (err) {
      // "aborted" 对排查等于零信息，换成"超时 >x.x s 无响应"
      const raw = String(err?.message || '');
      const timedOut = err?.name === 'AbortError' || /abort/i.test(raw);
      const capacity = !timedOut && isCapacityError(raw);
      // 额度用尽 / 限流：立刻换下一家，并让这家凉十分钟
      if (capacity) modelCooldown.set(name, Date.now() + COOLDOWN_MS);
      if (workingModel === name) workingModel = '';
      errors.push(`${name}: ${timedOut ? `超时（>${(perTry / 1000).toFixed(1)}s 无响应）` : compactErr(raw)}`);
    }
  }
  modelScopeDownUntil = Date.now() + OUTAGE_MS;
  lastProbeAt = Date.now();
  lastModelErrors = errors.slice();
  throw new Error(errors.join(' | ').slice(0, 600));
}

/** 是否配置了任意在线模型通道 */
export function hasOnlineModel() {
  return (
    Boolean(process.env.LLM_BASE_URL && process.env.LLM_API_KEY) ||
    Boolean(process.env.MODELSCOPE_API_KEY) ||
    hasSenseNova()
  );
}

/** 是否配置了商汤通道：单 Key 或 AK/SK 任一即可 */
export function hasSenseNova() {
  return (
    Boolean(process.env.SENSENOVA_API_KEY) ||
    Boolean(process.env.SENSENOVA_AK && process.env.SENSENOVA_SK)
  );
}

/**
 * 商汤日日新，两代接口都支持：
 * 1) SENSENOVA_API_KEY（新版，sk- 开头，OpenAI 兼容）
 * 2) SENSENOVA_AK + SENSENOVA_SK（旧版商汤大装置，JWT 鉴权）
 *
 * 🔴 2026-11-16 实测原始响应：
 *    {"choices":[{"message":{"role":"assistant","reasoning":"Thinking Process:…"},
 *                 "finish_reason":"length"}],"usage":{"completion_tokens":32}}
 *    商汤这一代全是推理型模型，**思考的 token 也算 max_tokens**。
 *    32 个 token 全被"想"吃光，content 一个字没有，我们却报"商汤返回为空"。
 *    思考字段叫 **reasoning**（flash-lite 族），不是 reasoning_content。
 */
const SENSENOVA_DEFAULT_MODEL = 'sensenova-6.8-flash-lite';

/** 推理型的思考 token 也占额度，别让"还没开口就被截断"重演 */
const SENSENOVA_MIN_TOKENS = 1500;

/** 明确不吃 thinking 参数的模型（400 过就别再带了） */
const noThinkingParam = new Set();

/**
 * 发一次商汤请求，并尝试关掉思考。
 * thinking 字段各模型支持不一（官方文档写对象形态，社区实测 flash-lite 未测成、
 * 字符串形态全线 400）⇒ 试一次，被 400 就黑名单并立刻重发一次不带它的。
 */
async function sensePost(url, headers, payload, timeoutMs, model) {
  if (noThinkingParam.has(model)) return postJson(url, headers, payload, timeoutMs);
  try {
    return await postJson(url, headers, { ...payload, thinking: { type: 'disabled' } }, timeoutMs);
  } catch (err) {
    if (!/HTTP 4\d\d/.test(String(err?.message || ''))) throw err;
    noThinkingParam.add(model);
    console.warn(`[sensenova] ${model} 不接受 thinking 参数，后续请求不再带`);
    return postJson(url, headers, payload, timeoutMs);
  }
}

/** 空返回时把"为什么空"说清楚 */
function senseEmptyReason(data, model, budget) {
  const choice = data?.choices?.[0] || data?.data?.choices?.[0];
  const finish = choice?.finish_reason || '未知';
  const msg = choice?.message || {};
  const thinkLen = String(msg.reasoning || msg.reasoning_content || '').length;
  if (finish === 'length') {
    return `商汤返回为空：思考占满了 max_tokens（${budget}），还没开始写就被截断（finish_reason=length，思考 ${thinkLen} 字）。模型 ${model}`;
  }
  return `商汤返回为空（模型 ${model}，finish_reason=${finish}，思考 ${thinkLen} 字）：${JSON.stringify(data).slice(0, 400)}`;
}

async function callSenseNova(messages, { temperature, top_p, max_tokens, timeoutMs, json = false }) {
  const apiKey = process.env.SENSENOVA_API_KEY;

  if (apiKey) {
    const base = String(process.env.SENSENOVA_BASE_URL || 'https://token.sensenova.cn/v1').replace(/\/+$/, '');
    const model = process.env.SENSENOVA_MODEL || SENSENOVA_DEFAULT_MODEL;
    const budget = Math.max(Number(max_tokens) || 0, SENSENOVA_MIN_TOKENS);
    const payload = { model, messages, temperature, top_p, max_tokens: budget };
    const url = `${base}/chat/completions`;
    const headers = { Authorization: `Bearer ${apiKey}` };

    // 只有要结构化输出时才先试 response_format；润色直接走纯文本
    let content = '';
    let firstHint = '';
    if (json) {
      try {
        const data = await sensePost(url, headers, { ...payload, response_format: { type: 'json_object' } }, timeoutMs, model);
        content = pickContent(data);
        if (!content) firstHint = `带 response_format 时：${senseEmptyReason(data, model, budget)}`;
      } catch (err) {
        firstHint = `带 response_format 失败：${err.message}`;
        content = '';
      }
    }
    if (!content) {
      const data = await sensePost(url, headers, payload, timeoutMs, model);
      content = pickContent(data);
      if (!content) {
        throw new Error(`${senseEmptyReason(data, model, budget)}${firstHint ? `｜${firstHint}` : ''}`);
      }
    }
    return content;
  }

  const { createHmac } = await import('node:crypto');
  const ak = process.env.SENSENOVA_AK;
  const sk = process.env.SENSENOVA_SK;
  if (!ak || !sk) throw new Error('NO_SENSENOVA_KEY');

  const b64 = (obj) =>
    Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)).toString('base64url');
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({ iss: ak, exp: Math.floor(Date.now() / 1000) + 300 });
  const signature = createHmac('sha256', sk).update(`${header}.${payload}`).digest('base64url');
  const token = `${header}.${payload}.${signature}`;

  const data = await postJson(
    'https://api.sensenova.cn/v1/llm/chat-completions',
    { Authorization: `Bearer ${token}` },
    {
      model: process.env.SENSENOVA_MODEL || 'SenseChat-5',
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

/** 只打某一家，不参与自动降级（自检用）。错误原样上抛。 */
export async function chatVia(channel, messages, params, model) {
  if (channel === 'llm') {
    if (!(process.env.LLM_BASE_URL && process.env.LLM_API_KEY)) throw new Error('未配置 LLM_BASE_URL / LLM_API_KEY');
    return callOpenAICompatible(messages, params);
  }
  if (channel === 'modelscope') {
    if (!process.env.MODELSCOPE_API_KEY) throw new Error('未配置 MODELSCOPE_API_KEY');
    return callModelScope(messages, params, model);
  }
  if (channel === 'sensenova') {
    if (!hasSenseNova()) throw new Error('未配置商汤 Key');
    return callSenseNova(messages, params);
  }
  throw new Error(`未知通道：${channel}`);
}

/**
 * 统一入口，返回 { content, channel }
 * 默认 llm → 魔搭 → 商汤；MODEL_PREFER 可钉住某一家打头。
 */
export async function chat(messages, params, model) {
  const errors = [];
  const prefer = String(process.env.MODEL_PREFER || '').trim().toLowerCase();
  const order =
    prefer === 'sensenova'
      ? ['sensenova', 'modelscope', 'llm']
      : prefer === 'modelscope'
        ? ['modelscope', 'sensenova', 'llm']
        : ['llm', 'modelscope', 'sensenova'];

  for (const ch of order) {
    if (ch === 'llm' && !(process.env.LLM_BASE_URL && process.env.LLM_API_KEY)) continue;
    if (ch === 'modelscope' && !process.env.MODELSCOPE_API_KEY) continue;
    if (ch === 'sensenova' && !hasSenseNova()) continue;
    try {
      return { content: await chatVia(ch, messages, params, model), channel: ch };
    } catch (err) {
      errors.push(`${ch}: ${err.message}`);
    }
  }

  const err = new Error(errors.length ? errors.join(' | ') : '未配置模型 Key');
  err.fallback = true;
  throw err;
}

/** 结构化输出：解析失败时补一句硬约束重试一次 */
export async function chatJson(messages, params, model) {
  // json: true 才会带 response_format，普通 chat() 不带
  const first = await chat(messages, { ...params, json: true }, model);
  try {
    return { ...first, data: parseJson(first.content) };
  } catch (err) {
    const retry = await chat(
      messages.concat([
        {
          role: 'user',
          content: '请只输出一个 JSON 对象，第一个字符必须是 {，不要任何解释，不要 Markdown 代码围栏。',
        },
      ]),
      { ...params, json: true, temperature: 0.1 },
      model,
    );
    return { ...retry, data: parseJson(retry.content) };
  }
}
