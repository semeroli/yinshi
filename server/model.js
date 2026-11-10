/**
 * 服务端模型适配（Node）：魔搭 ModelScope（主）→ 商汤日日新（备）
 * 未配置任何 Key 时由上层降级到本地演示库（poems.js）
 */
import { parseJson } from '../shared/prompts.js';

export {
  IMAGERY_SYSTEM,
  POEM_SYSTEM,
  FIX_SYSTEM,
  imageryUser,
  poemUser,
  fixUser,
  parseJson,
} from '../shared/prompts.js';

const TIMEOUT_MS = 70000;

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


async function postJson(url, headers, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
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
async function callOpenAICompatible(messages, { temperature, top_p, max_tokens }) {
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
  );
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('模型返回为空');
  return content;
}

/** 魔搭服务端模型会上下架：MODELSCOPE_MODEL 可填多个候选，未命中时按链重试 */
const DEFAULT_MODELS = [
  'Qwen/Qwen3-8B',
  'Qwen/Qwen3-32B',
  'Qwen/Qwen2.5-7B-Instruct',
  'deepseek-ai/DeepSeek-V3.1',
];

let workingModel = '';
let modelScopeDownUntil = 0;

function modelCandidates() {
  const configured = String(process.env.MODELSCOPE_MODEL || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return [...new Set([...configured, ...DEFAULT_MODELS])];
}

async function callModelScope(messages, { temperature, top_p, max_tokens }, model) {
  const key = process.env.MODELSCOPE_API_KEY;
  if (!key) throw new Error('NO_MODELSCOPE_KEY');
  if (Date.now() < modelScopeDownUntil) throw new Error('魔搭通道熔断中，稍后重试');

  const candidates = model ? [model] : workingModel ? [workingModel] : modelCandidates();
  const errors = [];

  for (const name of candidates) {
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
      );
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error('模型返回为空');
      workingModel = name;
      return content;
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
      if (workingModel) workingModel = '';
    }
  }
  modelScopeDownUntil = Date.now() + 10 * 60 * 1000;
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
async function callSenseNova(messages, { temperature, top_p, max_tokens }) {
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
    try {
      const data = await postJson(url, headers, { ...payload, response_format: { type: 'json_object' } });
      content = pickContent(data);
    } catch {
      content = '';
    }
    if (!content) {
      const data = await postJson(url, headers, payload);
      content = pickContent(data);
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
