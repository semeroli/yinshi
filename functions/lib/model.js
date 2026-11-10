/**
 * Edge 端模型适配（WebCrypto）：魔搭 ModelScope（主）→ 商汤日日新（备）
 * 未配置 Key 时抛出 fallback 标记，由上层降级到本地演示库
 */
import { parseJson } from '../../shared/prompts.js';

export {
  IMAGERY_SYSTEM,
  POEM_SYSTEM,
  FIX_SYSTEM,
  imageryUser,
  poemUser,
  fixUser,
  parseJson,
} from '../../shared/prompts.js';

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

const enc = new TextEncoder();

function b64url(data) {
  const bytes = typeof data === 'string' ? enc.encode(data) : new Uint8Array(data);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
async function callOpenAICompatible(env, messages, { temperature, top_p, max_tokens }) {
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

function modelCandidates(env) {
  const configured = String(env.MODELSCOPE_MODEL || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return [...new Set([...configured, ...DEFAULT_MODELS])];
}

async function callModelScope(env, messages, { temperature, top_p, max_tokens }) {
  if (!env.MODELSCOPE_API_KEY) throw new Error('NO_MODELSCOPE_KEY');
  if (Date.now() < modelScopeDownUntil) throw new Error('魔搭通道熔断中，稍后重试');

  const candidates = workingModel ? [workingModel] : modelCandidates(env);
  const errors = [];

  for (const name of candidates) {
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
  // 全部候选失败：10 分钟内直接跳过该通道，避免拖慢请求
  modelScopeDownUntil = Date.now() + 10 * 60 * 1000;
  throw new Error(errors.join(' | ').slice(0, 400));
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
async function callSenseNova(env, messages, { temperature, top_p, max_tokens }) {
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

    // response_format 在部分模型上会返回空内容，空则退回纯文本再试一次
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
  const first = await chat(env, messages, params);
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
      { ...params, temperature: 0.1 },
    );
    return { ...retry, data: parseJson(retry.content) };
  }
}
