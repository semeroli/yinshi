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
export const STEP_TIMEOUT = { theme: 18000, poem: 70000, fix: 18000 };

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
async function callOpenAICompatible(messages, { temperature, top_p, max_tokens, timeoutMs }) {
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
      response_format: { type: 'json_object' },
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
 *    候选别贪多：串行试会均分超时，润色只有 18 秒，放五个等于一个都出不来。
 */
const DEFAULT_MODELS = [
  'Qwen/Qwen3.8-Flash-Next',
  'ZhipuAI/GLM-5.2',
  'deepseek-ai/DeepSeek-V4.1-Flash',
];

let workingModel = '';
/** 上一轮真正调通的模型名；自检接口靠它回报"用的哪个" */
export function getWorkingModel() {
  return workingModel;
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

async function callModelScope(messages, { temperature, top_p, max_tokens, timeoutMs }, model) {
  const key = process.env.MODELSCOPE_API_KEY;
  if (!key) throw new Error('NO_MODELSCOPE_KEY');
  // 熔断期不再一刀切拒绝：每 30 秒放一个请求出去探路（半开）。
  // 否则一次偶发超时会把接下来十分钟的请求全部按死在本地库存上。
  const nowAt = Date.now();
  if (nowAt < modelScopeDownUntil) {
    if (nowAt - lastProbeAt < PROBE_INTERVAL_MS) throw new Error('魔搭通道熔断中，稍后重试');
    lastProbeAt = nowAt;
  }

  const candidates = model ? [model] : workingModel ? [workingModel] : modelCandidates();
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
    // 第一家给一半预算：命中的大概率是第一个，别让它跟备胎平分到谁都写不完
    const share = i === 0 && remain > 1 ? Math.floor(left * 0.5) : Math.floor(left / remain);
    const perTry = Math.max(2500, Math.min(left - 300, share));

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
          response_format: { type: 'json_object' },
        },
        perTry,
      );
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error('模型返回为空');
      workingModel = name;
      modelScopeDownUntil = 0;
      return content;
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
      if (workingModel) workingModel = '';
    }
  }
  modelScopeDownUntil = Date.now() + OUTAGE_MS;
  lastProbeAt = Date.now();
  throw new Error(errors.join(' | ').slice(0, 400));
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
 */
async function callSenseNova(messages, { temperature, top_p, max_tokens, timeoutMs }) {
  const apiKey = process.env.SENSENOVA_API_KEY;

  if (apiKey) {
    const base = String(process.env.SENSENOVA_BASE_URL || 'https://token.sensenova.cn/v1').replace(/\/+$/, '');
    const payload = {
      model: process.env.SENSENOVA_MODEL || 'sensenova-6.8-flash-lite',
      messages,
      temperature,
      top_p,
      max_tokens,
    };
    const url = `${base}/chat/completions`;
    const headers = { Authorization: `Bearer ${apiKey}` };

    let content = '';
    let firstHint = '';
    try {
      const data = await postJson(url, headers, { ...payload, response_format: { type: 'json_object' } }, timeoutMs);
      content = pickContent(data);
      if (!content) firstHint = `带 response_format 时 200 但内容为空：${JSON.stringify(data).slice(0, 160)}`;
    } catch (err) {
      // 以前这里把异常静默吞了，外界只看到"商汤返回为空"，401/404/模型名错全查不出来
      firstHint = `带 response_format 失败：${err.message}`;
      content = '';
    }
    if (!content) {
      const data = await postJson(url, headers, payload, timeoutMs);
      content = pickContent(data);
      if (!content) {
        throw new Error(
          `商汤返回为空（模型 ${payload.model}）。纯文本请求 200 但无内容：${JSON.stringify(data).slice(
            0,
            150,
          )}｜${firstHint}`,
        );
      }
    }
    if (!content) throw new Error('商汤返回为空');
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

/** 统一入口，返回 { content, channel } */
export async function chat(messages, params, model) {
  const errors = [];

  if (process.env.LLM_BASE_URL && process.env.LLM_API_KEY) {
    try {
      return { content: await callOpenAICompatible(messages, params), channel: 'llm' };
    } catch (err) {
      errors.push(`llm: ${err.message}`);
    }
  }

  if (process.env.MODELSCOPE_API_KEY) {
    try {
      return { content: await callModelScope(messages, params, model), channel: 'modelscope' };
    } catch (err) {
      errors.push(`modelscope: ${err.message}`);
    }
  }

  if (hasSenseNova()) {
    try {
      const content = await callSenseNova(messages, params);
      return { content, channel: 'sensenova' };
    } catch (err) {
      errors.push(`sensenova: ${err.message}`);
    }
  }

  const err = new Error(errors.length ? errors.join(' | ') : '未配置模型 Key');
  err.fallback = true;
  throw err;
}

/** 结构化输出：解析失败时补一句硬约束重试一次 */
export async function chatJson(messages, params, model) {
  const first = await chat(messages, params, model);
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
      { ...params, temperature: 0.1 },
      model,
    );
    return { ...retry, data: parseJson(retry.content) };
  }
}
