/**
 * deepseek-api.js — chat.deepseek.com 网页端（非官方）接口客户端
 *
 * Integration references: docs/usage.md and THIRD_PARTY_NOTICES.md.
 * Section references in older comments refer to the development protocol notes,
 * not an official, stable DeepSeek API specification.
 *
 * 设计约束：
 * - ESM、零第三方依赖、只用 Node 内置模块（node:buffer）；
 * - Node ^22.19.0 or >=24.0.0, as declared in package.json; plain JavaScript;
 * - 文档未确认的端点/请求头一律不发；hifLeim 只有构造时显式传入才发送。
 *
 * 主要导出：
 *   DEFAULT_BASE_URL       默认 base URL
 *   DeepSeekWebApi         客户端（会话列表 / 历史 / 续聊 / 新建会话）
 *   DeepSeekWebError       统一错误类型（code/status/bizCode/body + 中文可操作提示）
 *   normalizeToken         解析 localStorage.userToken（裸 token 或 JSON 字符串）
 *   messagesToMarkdown     把归一化后的消息渲染成可导入的 Markdown
 *   solveChallenge         PoW 求解入口（文档 §5.4/§5.5）
 *   deepseekHashV1         DeepSeekHashV1 哈希（导出供测试；文档 §5.3–§5.5）
 */

import { Buffer } from 'node:buffer';

// ---------------------------------------------------------------------------
// 常量（文档 §0/§1）
// ---------------------------------------------------------------------------

/** 文档 §1.1：Base URL。 */
export const DEFAULT_BASE_URL = 'https://chat.deepseek.com';
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_REF_FILES = 10;
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_IMPORT_FILE_BYTES = 100 * 1024 * 1024;

/** Preserve descriptors on both current FILE fragments and older message.files. */
export function messageFiles(message) {
  const candidates = [...(Array.isArray(message?.files) ? message.files : [])];
  for (const fragment of Array.isArray(message?.fragments) ? message.fragments : []) {
    if (String(fragment?.type).toUpperCase() === 'FILE' && Array.isArray(fragment.files)) candidates.push(...fragment.files);
  }
  const files = new Map();
  for (const entry of candidates) {
    const id = entry?.id ?? entry?.file_id ?? entry?.fileId ?? entry?.server_id;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(id)) continue;
    const previous = files.get(id) || {};
    const name = String(entry.file_name || entry.fileName || entry.name || previous.name || '附件');
    const imageFlag = entry.is_image ?? entry.isImage;
    files.set(id, { id, name, size: Number(entry.file_size || entry.size || previous.size) || 0,
      isImage: typeof imageFlag === 'boolean' ? imageFlag : previous.isImage ?? /\.(png|jpe?g|gif|webp|bmp|heic|tiff?)$/i.test(name),
      width: Number(entry.width) || previous.width || 0, height: Number(entry.height) || previous.height || 0 });
  }
  return [...files.values()];
}

/** Only the known signed-file origin is allowed; never follow arbitrary URLs. */
export function signedImageUrl(path) {
  if (typeof path !== 'string' || !path || /[\u0000-\u0020\u007f\\]/.test(path) || path.startsWith('//')) {
    throw new DeepSeekWebError('图片预览路径无效。', { code: 'bad_response' });
  }
  let url;
  try { url = new URL(/^https?:\/\//i.test(path) ? path : 'https://files.deepseeksvc.com/api/' + path.replace(/^\//, '')); }
  catch (_) { throw new DeepSeekWebError('图片预览路径无效。', { code: 'bad_response' }); }
  if (url.origin !== 'https://files.deepseeksvc.com' || url.username || url.password || !url.pathname.startsWith('/api/')) {
    throw new DeepSeekWebError('拒绝读取非 DeepSeek 文件服务的图片地址。', { code: 'bad_response' });
  }
  url.hash = '';
  url.searchParams.set('ty', 'p');
  return url.href;
}

export function signedFileUrl(path) {
  const url = new URL(signedImageUrl(path));
  url.searchParams.set('ty', 'r');
  return url.href;
}

export function sniffImageType(bytes) {
  if (bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  const head = Buffer.from(bytes.subarray(0, 12)).toString('ascii');
  if (/^GIF8[79]a/.test(head)) return 'image/gif';
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function normalizeFileIds(value = []) {
  if (!Array.isArray(value) || value.length > MAX_REF_FILES || value.some((id) => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(id))) {
    throw new DeepSeekWebError(`附件 ID 无效，最多允许 ${MAX_REF_FILES} 个附件。`, { code: 'bad_request', status: 400 });
  }
  return [...new Set(value)];
}

/** 文档 §1.2：拟真浏览器 UA（服务端对 UA 不做硬校验，但风控会看）。 */
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/** 普通 JSON 接口默认超时（20s）。 */
const READ_TIMEOUT_MS = 20_000;
/** completion SSE 默认超时（120s）。 */
const STREAM_TIMEOUT_MS = 120_000;
/** HTTP 429/5xx 重试一次的退避（小退避，不无限重试）。 */
const RETRY_DELAY_MS = 300;
/** 会话列表最多翻页次数（防御性上限，文档 §2.3 伪代码用 500，这里收紧）。 */
const MAX_LIST_PAGES = 100;
/** 附件-only 用户消息的占位文本（文档 §3.5 第 1 条）。 */
const ATTACHMENT_ONLY_PLACEHOLDER = '（仅附件，无文字）';
/** token 获取提示（文档 §1.3/§6.6）。 */
const AUTH_HINT =
  '请在浏览器打开 https://chat.deepseek.com 并登录，然后从 localStorage.userToken 复制 {"value":"..."}（或只复制其中的 value）填入配置。';

// ---------------------------------------------------------------------------
// 错误类型（文档 §6）
// ---------------------------------------------------------------------------

/**
 * 客户端统一错误。
 *
 * 字段：
 * - code：语义错误码（字符串），如 auth_invalid_token / auth_missing_token / muted / banned /
 *   rate_limited / waf_challenge / timeout / aborted / network_error / pow_invalid / bad_response；
 * - status：HTTP 状态码（未经过 HTTP 时为 0）；
 * - bizCode：信封里的 data.biz_code（没有则为 null）；
 * - body：原始响应/流帧（便于上层日志排查）。
 */
export class DeepSeekWebError extends Error {
  constructor(message, { code = 'unknown', status = 0, bizCode = null, body = null, cause } = {}) {
    super(String(message ?? ''));
    this.name = 'DeepSeekWebError';
    this.code = code;
    this.status = status;
    this.bizCode = bizCode;
    this.body = body;
    if (cause !== undefined) this.cause = cause;
  }
}

/** 截断长文本，避免错误信息/日志爆掉。 */
function truncate(text, max = 300) {
  const s = typeof text === 'string' ? text : String(text ?? '');
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

/** 把秒/毫秒时间戳格式化为可读时间（用于 mute_until 提示）。 */
function formatTimestamp(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  const ms = n > 1e12 ? n : n * 1000; // 兼容秒与毫秒两种观测
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/**
 * 把「统一信封」（文档 §1.4）里的错误翻译成带中文可操作提示的 DeepSeekWebError。
 * 判断成功必须同时看 code==0 与 biz_code==0。
 */
function errorFromEnvelope(json, status = 200) {
  const envelope = json && typeof json === 'object' ? json : {};
  const data = envelope.data && typeof envelope.data === 'object' ? envelope.data : {};
  const code = Number(envelope.code ?? 0);
  const bizCodeRaw = Number(data.biz_code ?? 0);
  const bizCode = Number.isFinite(bizCodeRaw) ? bizCodeRaw : null;
  const codeMsg = String(envelope.msg || '');
  const bizMsg = String(data.biz_msg || '');
  const detail =
    [code ? `code=${code}${codeMsg ? ` (${codeMsg})` : ''}` : '', bizCode ? `biz_code=${bizCode}${bizMsg ? ` (${bizMsg})` : ''}` : '']
      .filter(Boolean)
      .join('，') || `HTTP ${status}`;
  const base = { status, bizCode, body: envelope };

  // 文档 §6.2：系统级错误码
  if (code === 40002) {
    return new DeepSeekWebError(`缺少 token（code=40002 Missing Token）。${AUTH_HINT}`, {
      ...base,
      code: 'auth_missing_token',
    });
  }
  if (code === 40001 || code === 40003 || status === 401 || status === 403) {
    return new DeepSeekWebError(
      `token 无效或已过期（${detail}）。${AUTH_HINT} 注意：DeepSeek 没有公开的 refresh 流程，只能重新登录后复制新的 userToken。`,
      { ...base, code: 'auth_invalid_token' },
    );
  }

  // 文档 §6.3：业务级错误码
  if (bizCode === 5) {
    const muteUntil = formatTimestamp(data.mute_until ?? data.biz_data?.mute_until);
    return new DeepSeekWebError(
      `账号被临时禁言（biz_code=5 user is muted）${muteUntil ? `，预计解封时间 ${muteUntil}` : '，未返回解封时间'}。` +
        '解封前所有请求都会失败，请等待后再试；不要反复重试或换设备，否则会加重风控判定。',
      { ...base, code: 'muted' },
    );
  }
  if (bizCode === 10) {
    return new DeepSeekWebError(
      '账号已被封禁（biz_code=10 USER_IS_BANNED），该状态无法通过本客户端恢复；只能更换账号，或联系 DeepSeek 官方申诉。',
      { ...base, code: 'banned' },
    );
  }
  if (bizCode === 1) {
    return new DeepSeekWebError(
      '会话 id 非法（biz_code=1 ILLEGAL_CHAT_SESSION_ID）：该 chat_session_id 不存在或不属于当前 token。请重新从会话列表读取 id，或新建会话。',
      { ...base, code: 'illegal_session_id' },
    );
  }
  if (bizCode === 11) {
    return new DeepSeekWebError(
      '设备指纹风险（biz_code=11 RISK_DEVICE_DETECTED）：上游判定当前客户端环境可疑。请降低频率，并在真实浏览器环境重新登录后复制 token。',
      { ...base, code: 'risk_device' },
    );
  }
  if (bizCode === 26) {
    return new DeepSeekWebError(
      '消息 id 非法（biz_code=26 invalid message id）：parent_message_id / message_id 不存在。请重新读取会话历史，取最后一条 assistant 消息的 message_id。',
      { ...base, code: 'invalid_message_id' },
    );
  }

  // HTTP 限流（文档 §6.1/§6.4）
  if (status === 429 || code === 40029 || /rate.?limit|too[_\s-]*many[_\s-]*requests/i.test(`${bizMsg} ${codeMsg}`)) {
    return new DeepSeekWebError(
      `请求过于频繁，已被限流（${detail}）。请等待 5–15 秒后重试，并降低发送频率；仍失败请停止使用一段时间，避免账号被风控。`,
      { ...base, code: 'rate_limited' },
    );
  }

  return new DeepSeekWebError(`上游返回错误（${detail}）`, { ...base, code: 'api_error' });
}

/** HTTP 状态错误（非信封响应，如 WAF 页面/纯文本）。 */
function httpStatusError(status, text) {
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // 非 JSON，保持 json = null
  }
  if (json && typeof json === 'object' && (json.code !== undefined || json.data !== undefined)) {
    return errorFromEnvelope(json, status);
  }
  if (status === 429) {
    return new DeepSeekWebError(
      '请求过于频繁（HTTP 429）。请退避 5–15 秒后重试，并降低频率；持续 429 说明出口 IP / 账号已被限流。',
      { code: 'rate_limited', status, bizCode: null, body: truncate(text, 1_000) },
    );
  }
  if (status >= 500) {
    return new DeepSeekWebError(`上游服务异常（HTTP ${status}）。已自动重试一次仍失败，请稍后再试。`, {
      code: 'http_error',
      status,
      bizCode: null,
      body: truncate(text, 1_000),
    });
  }
  return new DeepSeekWebError(`上游返回 HTTP ${status}：${truncate(text)}`, {
    code: 'http_error',
    status,
    bizCode: null,
    body: truncate(text, 1_000),
  });
}

/** WAF/风控拦截（文档 §1.5）。 */
function wafError(status, text) {
  return new DeepSeekWebError(
    `请求被上游 WAF/风控拦截（HTTP ${status}）。请更换出口 IP（避免机房/US IP）、降低请求频率，或改在真实浏览器环境操作；纯 Node fetch 的 TLS 指纹与浏览器不同，高频时更容易被拦。`,
    { code: 'waf_challenge', status, bizCode: null, body: truncate(text, 1_000) },
  );
}

/** 可自动重试一次的错误码（仅安全场景：连接失败 / HTTP 429 / HTTP 5xx）。 */
function isRetryableHttpStatus(status) {
  return status === 429 || status >= 500;
}

// ---------------------------------------------------------------------------
// token 归一化（文档 §1.3）
// ---------------------------------------------------------------------------

/**
 * 归一化 token：接受裸 token，或 localStorage.userToken 的 JSON 字符串
 * （形如 {"value":"<token>","__version":"0"}）。空值抛错。
 *
 * @param {string|{value?: string}} value
 * @returns {string} 可直接放进 `Authorization: Bearer <token>` 的 token
 */
export function normalizeToken(value) {
  if (value == null) {
    throw new DeepSeekWebError(`缺少 DeepSeek token。${AUTH_HINT}`, { code: 'auth_missing_token' });
  }
  let raw = value;
  if (typeof raw === 'object') raw = raw.value; // 兼容调用方已经 JSON.parse 过的情况
  if (typeof raw !== 'string') {
    throw new DeepSeekWebError('token 必须是字符串（裸 token 或 localStorage.userToken 的 JSON 字符串）。', {
      code: 'auth_missing_token',
    });
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new DeepSeekWebError(`token 为空。${AUTH_HINT}`, { code: 'auth_missing_token' });
  }
  // 网页 localStorage 里存的是 JSON：{"value":"<TOKEN>","__version":"0"}
  if (trimmed.startsWith('{')) {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new DeepSeekWebError(
        'token 看起来是 JSON 但解析失败。请确认复制的是完整的 localStorage.userToken 值（形如 {"value":"...","__version":"0"}），或只复制 value 本身。',
        { code: 'auth_missing_token', body: truncate(trimmed, 200) },
      );
    }
    const token = typeof parsed?.value === 'string' ? parsed.value.trim() : '';
    if (!token) {
      throw new DeepSeekWebError(
        'localStorage.userToken 里没有有效的 value 字段（为空或不是字符串）。请重新登录后复制最新的 userToken。',
        { code: 'auth_missing_token', body: parsed },
      );
    }
    return token;
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// 历史消息归一化（文档 §3.3–§3.6）
// ---------------------------------------------------------------------------

const USER_FRAGMENT_TYPES = new Set(['REQUEST']);
const ANSWER_FRAGMENT_TYPES = new Set(['RESPONSE']);
const THINKING_FRAGMENT_TYPES = new Set(['THINK']);
const SEARCH_FRAGMENT_TYPES = new Set(['TOOL_SEARCH', 'TOOL_OPEN']);

/**
 * 旧版 content 可能是 string / 块数组 / 对象，统一拍平成字符串（文档 §3.6 flattenLegacy）。
 */
function flattenLegacy(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (typeof block === 'string' ? block : (block?.text ?? block?.content ?? '')))
      .join('\n');
  }
  if (typeof content === 'object') return content.text ?? content.content ?? '';
  return String(content);
}

/** 提取某类 fragment 的正文，按出现顺序用空行拼接（文档 §3.6）。 */
function fragmentText(msg, wanted) {
  const fragments = Array.isArray(msg?.fragments) ? msg.fragments : [];
  return fragments
    .filter((f) => f && f.content != null && wanted.has(String(f.type || '').toUpperCase()))
    .map((f) => (typeof f.content === 'string' ? f.content : flattenLegacy(f.content)).trim())
    .filter(Boolean)
    .join('\n\n');
}

/** 从 TOOL_SEARCH / TOOL_OPEN fragment 里提取搜索来源（文档 §3.4/§4.6）。 */
function extractSearchResults(msg) {
  const fragments = Array.isArray(msg?.fragments) ? msg.fragments : [];
  const out = [];
  const seen = new Set();
  for (const fragment of fragments) {
    if (!fragment || typeof fragment !== 'object') continue;
    if (!SEARCH_FRAGMENT_TYPES.has(String(fragment.type || '').toUpperCase())) continue;
    const results = Array.isArray(fragment.results) ? fragment.results : [];
    const candidates = [...results];
    if (fragment.result && typeof fragment.result === 'object') candidates.push(fragment.result);
    for (const result of candidates) {
      if (!result || typeof result !== 'object') continue;
      const url = typeof result.url === 'string' ? result.url : '';
      const title = typeof result.title === 'string' ? result.title : '';
      const snippet = typeof result.snippet === 'string' ? result.snippet : '';
      if (!url && !title) continue;
      const key = url || title;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ title, url, snippet });
    }
  }
  return out;
}

/** Preserve the actual interleaving, including individual page opens. */
export function messageProcessSteps(msg) {
  return (Array.isArray(msg?.fragments) ? msg.fragments : []).flatMap((fragment, index) => {
    const kind = String(fragment?.type || '').toUpperCase();
    if (kind !== 'THINK' && !SEARCH_FRAGMENT_TYPES.has(kind)) return [];
    const elapsed = fragment.elapsed_secs;
    const timing = typeof elapsed === 'number' && Number.isFinite(elapsed) && elapsed >= 0 ? { elapsedMs: elapsed * 1000 } : {};
    const id = `${index}:${fragment.id ?? ''}`;
    if (kind === 'THINK') return [{ id, type: 'thinking', text: typeof fragment.content === 'string' ? fragment.content : '', ...timing }];
    const queries = Array.isArray(fragment.queries) ? fragment.queries.map(item => typeof item === 'string' ? item : item?.query).filter(item => typeof item === 'string') : [];
    return [{ id, type: 'search', action: kind === 'TOOL_OPEN' ? 'open' : 'search', query: queries.join(' · '),
      searchResults: extractSearchResults({ fragments: [fragment] }), ...timing }];
  });
}

export function processThinkingMs(steps) {
  const thinking = steps.filter(step => step.type === 'thinking');
  if (!thinking.length || thinking.some(step => !Number.isFinite(step.elapsedMs) || step.elapsedMs < 0)) return undefined;
  const ms = thinking.reduce((sum, step) => sum + step.elapsedMs, 0);
  return Number.isFinite(ms) ? ms : undefined;
}

/** The chosen root-to-leaf path, for read/import consumers which are not a tree UI. */
export function selectHistoryPath(messages, currentMessageId) {
  const byId = new Map(messages.map(message => [String(message.id), message]));
  if (!messages.some(message => message.parentId != null && byId.has(String(message.parentId)))) return messages;
  const children = new Map();
  for (const message of messages) {
    if (message.parentId != null && byId.has(String(message.parentId))) children.set(String(message.parentId), message);
  }
  let node = byId.get(String(currentMessageId)) || messages.at(-1);
  const forwardSeen = new Set();
  while (node && children.has(String(node.id))) {
    if (forwardSeen.has(String(node.id))) return [];
    forwardSeen.add(String(node.id)); node = children.get(String(node.id));
  }
  const path = [], seen = new Set();
  while (node) {
    const id = String(node.id);
    if (seen.has(id)) return [];
    seen.add(id); path.push(node);
    node = node.parentId == null ? null : byId.get(String(node.parentId));
  }
  return path.reverse();
}

/** 消息是否带附件（文档 §3.3 files 字段；附件-only 用占位符）。 */
function hasAttachments(msg) {
  return messageFiles(msg).length > 0;
}

/**
 * 归一化单条历史消息（文档 §3.5 规则）：
 * - 只保留 role=user / assistant，其余角色丢弃；
 * - 用户正文只取 REQUEST fragment；助手正文只取 RESPONSE；思维链只取 THINK；
 * - TOOL_* / TIP 等不拼进正文；status 原样保留；inserted_at 为秒。
 * 返回 null 表示该消息应被丢弃。
 */
function normalizeHistoryMessage(msg) {
  const role = String(msg?.role || '').toLowerCase();
  if (role !== 'user' && role !== 'assistant') return null;
  const id = msg?.message_id ?? null;
  const parentId = msg?.parent_id ?? null;
  const status = String(msg?.status || '');
  let text = '';
  let thinking = '';
  let searchResults = [];
  if (role === 'user') {
    text = fragmentText(msg, USER_FRAGMENT_TYPES) || flattenLegacy(msg?.content).trim();
    if (!text && hasAttachments(msg)) text = ATTACHMENT_ONLY_PLACEHOLDER;
  } else {
    text = fragmentText(msg, ANSWER_FRAGMENT_TYPES) || flattenLegacy(msg?.content).trim();
    thinking = fragmentText(msg, THINKING_FRAGMENT_TYPES);
    searchResults = extractSearchResults(msg);
  }
  const files = messageFiles(msg);
  const processSteps = role === 'assistant' ? messageProcessSteps(msg) : [];
  const thinkingMs = processThinkingMs(processSteps);
  return { id, parentId, role, status, text, thinking, searchResults,
    ...(typeof msg.ban_regenerate === 'boolean' ? { banRegenerate: msg.ban_regenerate } : {}),
    ...(files.length ? { files } : {}),
    ...(processSteps.length ? { processSteps } : {}), ...(thinkingMs !== undefined ? { thinkingMs } : {}) };
}

// ---------------------------------------------------------------------------
// Markdown 渲染（供导入上下文使用）
// ---------------------------------------------------------------------------

/**
 * 把 getHistory 归一化后的消息渲染成 Markdown。
 *
 * @param {Array<{role: string, text?: string, thinking?: string, searchResults?: Array<{title?:string,url?:string}>}>} messages
 * @param {{includeThinking?: boolean, title?: string}} [options]
 * @returns {string}
 */
export function messagesToMarkdown(messages, { includeThinking = true, title } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const headingRaw = typeof title === 'string' ? title.trim() : '';
  const heading = (headingRaw || 'DeepSeek 对话').replace(/[\r\n]+/g, ' ');
  const parts = [`# ${heading}`];
  for (const message of list) {
    if (!message || typeof message !== 'object') continue;
    const role = String(message.role || '').toLowerCase();
    const text = typeof message.text === 'string' ? message.text.trim() : '';
    const thinking = includeThinking && typeof message.thinking === 'string' ? message.thinking.trim() : '';
    if (role === 'user') {
      if (!text) continue;
      parts.push(`### 用户\n\n${text}`);
      continue;
    }
    if (role !== 'assistant') continue;
    if (!text && !thinking) continue;
    const blocks = ['### DeepSeek'];
    if (thinking) {
      blocks.push(`<details>\n<summary>思考过程</summary>\n\n${thinking}\n\n</details>`);
    }
    if (text) {
      blocks.push(text);
    } else {
      blocks.push('（该轮没有正文：可能被中断或内容过滤）');
    }
    const sources = Array.isArray(message.searchResults)
      ? message.searchResults.filter((item) => item && typeof item.url === 'string' && item.url)
      : [];
    if (sources.length > 0) {
      const seen = new Set();
      const lines = [];
      for (const source of sources) {
        if (seen.has(source.url)) continue;
        seen.add(source.url);
        const label = (typeof source.title === 'string' && source.title.trim()) || source.url;
        lines.push(`- [${label.replace(/[[\]]/g, '')}](${source.url})`);
      }
      if (lines.length > 0) blocks.push(`**参考来源：**\n\n${lines.join('\n')}`);
    }
    parts.push(blocks.join('\n\n'));
  }
  return `${parts.join('\n\n')}\n`;
}

// ---------------------------------------------------------------------------
// DeepSeekHashV1（文档 §5.2–§5.4）
//
// 注意：node:crypto 的 sha3-256 是完整 24 轮 Keccak，**算不出**本算法（文档 §5.3）。
// 这里按文档 §5.4 自实现 Keccak-f[1600]，但跳过 round 0（只跑 rounds 1..23）。
// ---------------------------------------------------------------------------

/** 24 个标准 round constant（按 32 位 lo/hi 展开）。 */
const RC = new Uint32Array([
  0x00000001, 0x00000000, 0x00008082, 0x00000000, 0x0000808a, 0x80000000, 0x80008000, 0x80000000, 0x0000808b,
  0x00000000, 0x80000001, 0x00000000, 0x80008081, 0x80000000, 0x00008009, 0x80000000, 0x0000008a, 0x00000000,
  0x00000088, 0x00000000, 0x80008009, 0x00000000, 0x8000000a, 0x00000000, 0x8000808b, 0x00000000, 0x0000008b,
  0x80000000, 0x00008089, 0x80000000, 0x00008003, 0x80000000, 0x00008002, 0x80000000, 0x00000080, 0x80000000,
  0x0000800a, 0x00000000, 0x8000000a, 0x80000000, 0x80008081, 0x80000000, 0x00008080, 0x80000000, 0x80000001,
  0x00000000, 0x80008008, 0x80000000,
]);

/** rho 旋转位数，按 x + 5*y 索引。 */
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];

/** pi 目标下标，按 x + 5*y 索引。 */
const PI = new Uint8Array(25);
for (let y = 0; y < 5; y++) {
  for (let x = 0; x < 5; x++) PI[x + 5 * y] = y + 5 * ((2 * x + 3 * y) % 5);
}

// 模块级 scratch（求解是同步函数，串行调用安全；文档 §5.4 实现注意）
const A_LO = new Uint32Array(25);
const A_HI = new Uint32Array(25);
const B_LO = new Uint32Array(25);
const B_HI = new Uint32Array(25);
const C_LO = new Uint32Array(5);
const C_HI = new Uint32Array(5);
/** rate = 136 字节，与 SHA3-256 相同。 */
const RATE = 136;

/** Keccak-f[1600]，**跳过 round 0**（DeepSeekHashV1 的关键差异）。 */
function keccakF23() {
  for (let round = 1; round < 24; round++) {
    // θ
    for (let x = 0; x < 5; x++) {
      C_LO[x] = A_LO[x] ^ A_LO[x + 5] ^ A_LO[x + 10] ^ A_LO[x + 15] ^ A_LO[x + 20];
      C_HI[x] = A_HI[x] ^ A_HI[x + 5] ^ A_HI[x + 10] ^ A_HI[x + 15] ^ A_HI[x + 20];
    }
    for (let x = 0; x < 5; x++) {
      const pl = C_LO[(x + 4) % 5];
      const ph = C_HI[(x + 4) % 5];
      const rl = C_LO[(x + 1) % 5];
      const rh = C_HI[(x + 1) % 5];
      const dl = pl ^ ((rl << 1) | (rh >>> 31));
      const dh = ph ^ ((rh << 1) | (rl >>> 31));
      A_LO[x] ^= dl;
      A_HI[x] ^= dh;
      A_LO[x + 5] ^= dl;
      A_HI[x + 5] ^= dh;
      A_LO[x + 10] ^= dl;
      A_HI[x + 10] ^= dh;
      A_LO[x + 15] ^= dl;
      A_HI[x + 15] ^= dh;
      A_LO[x + 20] ^= dl;
      A_HI[x + 20] ^= dh;
    }
    // rho + pi
    for (let i = 0; i < 25; i++) {
      const k = ROT[i];
      const lo = A_LO[i];
      const hi = A_HI[i];
      const dst = PI[i];
      if (k === 0) {
        B_LO[dst] = lo;
        B_HI[dst] = hi;
      } else if (k < 32) {
        B_LO[dst] = (lo << k) | (hi >>> (32 - k));
        B_HI[dst] = (hi << k) | (lo >>> (32 - k));
      } else if (k === 32) {
        B_LO[dst] = hi;
        B_HI[dst] = lo;
      } else {
        const m = k - 32;
        B_LO[dst] = (hi << m) | (lo >>> (32 - m));
        B_HI[dst] = (lo << m) | (hi >>> (32 - m));
      }
    }
    // chi
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) {
        const i = x + y;
        const i1 = ((x + 1) % 5) + y;
        const i2 = ((x + 2) % 5) + y;
        A_LO[i] = B_LO[i] ^ (~B_LO[i1] & B_LO[i2]);
        A_HI[i] = B_HI[i] ^ (~B_HI[i1] & B_HI[i2]);
      }
    }
    // ι（round constant 仍用标准表，只是 round 0 不执行）
    A_LO[0] ^= RC[round * 2];
    A_HI[0] ^= RC[round * 2 + 1];
  }
}

/** 吸收一个 136 字节块并做 23 轮置换。 */
function absorbBlock(bytes, off) {
  for (let i = 0; i < RATE / 8; i++) {
    const p = off + i * 8;
    A_LO[i] ^= bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24);
    A_HI[i] ^= bytes[p + 4] | (bytes[p + 5] << 8) | (bytes[p + 6] << 16) | (bytes[p + 7] << 24);
  }
  keccakF23();
}

/**
 * DeepSeekHashV1 一次性哈希：Uint8Array → 32 字节 Uint8Array。
 * 文档 §5.4（含官方 WASM 测试向量验证，§5.5）。
 */
export function deepseekHashV1(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  A_LO.fill(0);
  A_HI.fill(0);
  let off = 0;
  while (off + RATE <= input.length) {
    absorbBlock(input, off);
    off += RATE;
  }
  const final = new Uint8Array(RATE);
  const rest = input.length - off;
  final.set(input.subarray(off));
  final[rest] = 0x06; // SHA3/KECCAK padding，与文档一致
  final[RATE - 1] |= 0x80;
  absorbBlock(final, 0);
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    out[i * 8] = A_LO[i] & 0xff;
    out[i * 8 + 1] = (A_LO[i] >>> 8) & 0xff;
    out[i * 8 + 2] = (A_LO[i] >>> 16) & 0xff;
    out[i * 8 + 3] = (A_LO[i] >>> 24) & 0xff;
    out[i * 8 + 4] = A_HI[i] & 0xff;
    out[i * 8 + 5] = (A_HI[i] >>> 8) & 0xff;
    out[i * 8 + 6] = (A_HI[i] >>> 16) & 0xff;
    out[i * 8 + 7] = (A_HI[i] >>> 24) & 0xff;
  }
  return out;
}

/**
 * 前缀吸收状态缓存：PoW 的输入是 `salt_expireAt_` + 十进制 answer，
 * 前缀固定，因此把前缀吸收后的状态缓存起来，每次只吸收 answer 尾块。
 * key 必须是「拼接用的字面量前缀」（expire_at 原样，不做单位转换）。
 */
const PREFIX_STATE_CACHE = new Map();
const PREFIX_STATE_CACHE_MAX = 8;

function absorbPrefixState(prefix) {
  const cached = PREFIX_STATE_CACHE.get(prefix);
  if (cached) return cached;
  const bytes = new TextEncoder().encode(prefix);
  A_LO.fill(0);
  A_HI.fill(0);
  let off = 0;
  while (off + RATE <= bytes.length) {
    absorbBlock(bytes, off);
    off += RATE;
  }
  const state = { lo: A_LO.slice(), hi: A_HI.slice(), tail: bytes.slice(off) };
  PREFIX_STATE_CACHE.set(prefix, state);
  if (PREFIX_STATE_CACHE.size > PREFIX_STATE_CACHE_MAX) {
    const oldest = PREFIX_STATE_CACHE.keys().next().value;
    PREFIX_STATE_CACHE.delete(oldest);
  }
  return state;
}

/** challenge 既可能是对象，也可能被上层包了一层 {challenge:{...}} 或 JSON 字符串。 */
function unwrapChallengeObject(value) {
  let v = value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (v && typeof v === 'object' && v.challenge && typeof v.challenge === 'object' && v.challenge.challenge) {
    return v.challenge;
  }
  return v;
}

/**
 * 求解 PoW challenge：暴力枚举 answer ∈ [0, difficulty)，
 * 使 DeepSeekHashV1(`salt_expire_at_answer`) === challenge（完整 32 字节比较）。
 *
 * 文档 §5.2/§5.4/§5.5：
 * - `expire_at` **原样字符串化**，绝不换算单位；
 * - `difficulty` 是搜索次数上界，不硬编码；
 * - `answer` 是十进制整数字面量。
 *
 * @param {object} challenge 形如 {algorithm, challenge, salt, signature, difficulty, expire_at, target_path}
 * @returns {number} answer ∈ [0, difficulty)
 * @throws {DeepSeekWebError} 算法不符 / 字段非法 / 枚举完仍无解
 */
export function solveChallenge(challenge) {
  const c = unwrapChallengeObject(challenge);
  if (!c || typeof c !== 'object') {
    throw new DeepSeekWebError('PoW challenge 不是对象，无法求解。', { code: 'pow_invalid', body: challenge });
  }
  const algorithm = String(c.algorithm || '');
  if (algorithm !== 'DeepSeekHashV1') {
    throw new DeepSeekWebError(
      `不支持的 PoW 算法「${algorithm || '空'}」：本客户端只实现 DeepSeekHashV1（文档 §5.2）。若上游更换算法，需要改用官方 WASM。`,
      { code: 'pow_invalid', body: c },
    );
  }
  const challengeHex = String(c.challenge || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(challengeHex)) {
    throw new DeepSeekWebError(
      `PoW challenge 字段不是 64 位 hex（32 字节），实际长度 ${challengeHex.length}：${truncate(challengeHex, 80)}`,
      { code: 'pow_invalid', body: c },
    );
  }
  const salt = c.salt == null ? '' : String(c.salt);
  if (c.expire_at == null || c.expire_at === '') {
    throw new DeepSeekWebError('PoW challenge 缺少 expire_at 字段，无法拼前缀（文档 §5.2）。', {
      code: 'pow_invalid',
      body: c,
    });
  }
  const expireAt = String(c.expire_at); // 原样，不做单位转换
  const difficultyRaw = Number(c.difficulty);
  if (!Number.isFinite(difficultyRaw) || difficultyRaw <= 0) {
    throw new DeepSeekWebError(`PoW challenge 的 difficulty 非法：${String(c.difficulty)}（应为正整数）。`, {
      code: 'pow_invalid',
      body: c,
    });
  }
  const difficulty = Math.floor(difficultyRaw);

  const target = Buffer.from(challengeHex, 'hex');
  const t0 = target.readUInt32LE(0);
  const h0 = target.readUInt32LE(4);
  const t1 = target.readUInt32LE(8);
  const h1 = target.readUInt32LE(12);
  const t2 = target.readUInt32LE(16);
  const h2 = target.readUInt32LE(20);
  const t3 = target.readUInt32LE(24);
  const h3 = target.readUInt32LE(28);

  const prefix = `${salt}_${expireAt}_`;
  const state = absorbPrefixState(prefix);
  const tail = state.tail;
  const baseLo = state.lo;
  const baseHi = state.hi;

  const buf = new Uint8Array(RATE);
  const num = new Uint8Array(20);
  const encoder = new TextEncoder();

  for (let answer = 0; answer < difficulty; answer++) {
    // 把 answer 写成十进制字面量（无前导零）
    let v = answer;
    let pos = 20;
    if (v === 0) {
      pos = 19;
      num[19] = 48;
    } else {
      while (v > 0) {
        pos--;
        num[pos] = 48 + (v % 10);
        v = Math.floor(v / 10);
      }
    }
    const digits = num.subarray(pos);
    const total = tail.length + digits.length;
    if (total >= RATE) {
      // 极长前缀（实际不会出现）：回退到通用一次性哈希
      const digest = deepseekHashV1(encoder.encode(prefix + String(answer)));
      if (Buffer.from(digest).equals(target)) return answer;
      continue;
    }
    buf.fill(0);
    buf.set(tail, 0);
    buf.set(digits, tail.length);
    buf[total] = 0x06;
    buf[RATE - 1] |= 0x80;
    A_LO.set(baseLo);
    A_HI.set(baseHi);
    absorbBlock(buf, 0);
    if (A_LO[0] === t0 && A_HI[0] === h0 && A_LO[1] === t1 && A_HI[1] === h1 && A_LO[2] === t2 && A_HI[2] === h2 && A_LO[3] === t3 && A_HI[3] === h3) {
      return answer;
    }
  }
  throw new DeepSeekWebError(
    `PoW 在 [0, ${difficulty}) 内没有找到解：challenge 可能已过期、被修改，或算法实现与上游不一致（文档 §5.2）。请重新申请 challenge 再试。`,
    { code: 'pow_failed', body: c },
  );
}

/**
 * 构造 x-ds-pow-response 头的值：base64(JSON{algorithm,challenge,salt,answer,signature,target_path})。
 * 文档 §5.2：标准 base64（带 padding），**不要**带 difficulty / expire_at。
 */
function buildPowResponseHeader(challenge, answer, fallbackTargetPath) {
  const payload = {
    algorithm: challenge.algorithm,
    challenge: challenge.challenge,
    salt: challenge.salt,
    answer,
    signature: challenge.signature,
    target_path: challenge.target_path || fallbackTargetPath,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 拼接路径补丁的父子路径（文档 §4.5 BATCH）。 */
function joinPath(parent, child) {
  const p = parent == null ? '' : String(parent);
  const c = child == null ? '' : String(child);
  if (!c) return p;
  return p ? `${p}/${c}` : c;
}

/** Awaited retries/polling must keep the event loop alive until they settle or
 * are cancelled, including Node 22 and clients with no other live sockets. */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DeepSeekWebError('请求已被取消（AbortSignal）。', { code: 'aborted' }));
      return;
    }
    const onAbort = () => {
      cleanup();
      reject(new DeepSeekWebError('请求已被取消（AbortSignal）。', { code: 'aborted' }));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

/** 校验 prompt（不允许空串，避免上游 4xx 或无意义的空消息）。 */
function assertPrompt(prompt, methodName, fileIds = []) {
  if (typeof prompt !== 'string' || (prompt.trim() === '' && fileIds.length === 0)) {
    throw new DeepSeekWebError(`${methodName} 需要非空的 prompt 字符串。`, { code: 'bad_request' });
  }
}

/** SSE 帧是否为错误提示（文档 §4.8）。 */
function isErrorFrame(data) {
  if (!data || typeof data !== 'object') return false;
  if (String(data.type || '').toLowerCase() === 'error') return true;
  const finishReason = String(data.finish_reason || data?.toast?.finish_reason || '');
  return finishReason === 'rate_limit_reached' || finishReason === 'input_exceeds_limit';
}

/** 把 SSE 内的错误帧翻译成中文可操作提示（文档 §4.8/§6.4）。 */
function streamFrameError(data, eventName) {
  const finishReason = String(data?.finish_reason || data?.toast?.finish_reason || '');
  const content = String(data?.content || data?.toast?.content || '').trim();
  const base = { status: 200, bizCode: null, body: data };
  if (finishReason === 'rate_limit_reached' || /rate.?limit/i.test(finishReason)) {
    return new DeepSeekWebError(
      `请求过于频繁，已被限流（${content || 'rate_limit_reached'}）。请等待 5–15 秒后重试；仍失败请降低发送频率，避免账号被风控。`,
      { ...base, code: 'rate_limited' },
    );
  }
  if (finishReason === 'input_exceeds_limit') {
    return new DeepSeekWebError('输入内容过长（input_exceeds_limit），请缩短 prompt 或拆成多轮发送。', {
      ...base,
      code: 'input_too_long',
    });
  }
  return new DeepSeekWebError(
    `服务端在流中返回错误（event=${eventName}）：${content || finishReason || '未知错误'}`,
    { ...base, code: 'stream_error' },
  );
}

/**
 * SSE 帧解析器（文档 §4.3）：以空行分隔帧，`event:` 可选（缺省等价 message），
 * `data:` 支持多行拼接；忽略 `:` 注释与 id/retry 字段。
 */
function createSseFrameParser() {
  let event = 'message';
  let dataLines = [];
  const pushLine = (line) => {
    if (line === '') {
      if (dataLines.length === 0) {
        event = 'message';
        return null;
      }
      const raw = dataLines.join('\n');
      const name = event || 'message';
      dataLines = [];
      event = 'message';
      return { event: name, raw };
    }
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') {
      event = value.trim() || 'message';
      return null;
    }
    if (field === 'data') {
      dataLines.push(value);
      return null;
    }
    return null; // id / retry / 其他字段忽略
  };
  return {
    pushLine,
    end: () => pushLine(''),
  };
}

/** 会话列表条目归一化（文档 §2.2）。 */
function normalizeSessionEntry(raw) {
  const id = typeof raw?.id === 'string' ? raw.id : raw?.id == null ? '' : String(raw.id);
  const updatedAt = Number(raw?.updated_at);
  return {
    id,
    title: typeof raw?.title === 'string' ? raw.title : '',
    pinned: raw?.pinned === true,
    modelType: typeof raw?.model_type === 'string' ? raw.model_type : '',
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
  };
}

/** 从 create_session 响应（新旧两种形状）里取会话 id（文档 §4.1）。 */
function extractSessionId(data) {
  const id = data?.chat_session?.id ?? data?.id ?? data?.chat_session_id ?? data?.session_id;
  if (id == null) return '';
  return typeof id === 'string' ? id : String(id);
}

// ---------------------------------------------------------------------------
// 客户端
// ---------------------------------------------------------------------------

export class DeepSeekWebApi {
  #token;
  #baseUrl;
  #fetchImpl;
  #hifLeim;
  #origin;
  #referer;
  #timezoneOffset;
  #fileQueue = Promise.resolve();
  #nextFileReadAt = 0;
  #fileCache = new Map();
  #fileInterval;
  #fileCooldown;

  /**
   * @param {object} [options]
   * @param {string} [options.token] localStorage.userToken 的 value，或其原始 JSON 字符串
   * @param {string} [options.baseUrl] 默认 https://chat.deepseek.com
   * @param {Function} [options.fetchImpl] 默认 globalThis.fetch（测试可注入 mock）
   * @param {string} [options.hifLeim] 可选：风控头 x-hif-leim（文档 §1.2）；只有显式传入才发送
   */
  constructor({ token, baseUrl = DEFAULT_BASE_URL, fetchImpl = globalThis.fetch, hifLeim, fileRequestIntervalMs = 1000, fileRateLimitDelayMs = 5000 } = {}) {
    this.#token = normalizeToken(token);
    if (typeof fetchImpl !== 'function') {
      throw new DeepSeekWebError('fetchImpl 必须是 fetch 兼容函数（Node 20+ 可直接用全局 fetch）。', {
        code: 'bad_config',
      });
    }
    this.#fetchImpl = fetchImpl;
    // Shared by previews, original-file imports and upload polling on this client.
    // Optional shorter intervals are for offline tests, never taken from HTTP input.
    this.#fileInterval = Number.isFinite(fileRequestIntervalMs) ? Math.max(0, fileRequestIntervalMs) : 1000;
    this.#fileCooldown = Number.isFinite(fileRateLimitDelayMs) ? Math.max(0, fileRateLimitDelayMs) : 5000;
    const base = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.#baseUrl = base || DEFAULT_BASE_URL;
    let origin = DEFAULT_BASE_URL;
    try {
      origin = new URL(this.#baseUrl).origin;
    } catch {
      // 非法 baseUrl 时保留默认 Origin，避免构造直接失败
    }
    this.#origin = origin;
    this.#referer = `${origin}/`;
    this.#hifLeim = typeof hifLeim === 'string' ? hifLeim.trim() : '';
    const tz = -new Date().getTimezoneOffset() * 60;
    this.#timezoneOffset = Number.isFinite(tz) ? String(tz) : '28800';
  }

  // ---------------------------------------------------------------- 基础请求层

  /** 拼 URL（query 用 URLSearchParams，保证 `lte_cursor.updated_at=...` 的点号不被编码）。 */
  #url(path, query) {
    let url = path.startsWith('http') ? path : `${this.#baseUrl}${path}`;
    if (query && Object.keys(query).length > 0) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        params.append(key, String(value));
      }
      const qs = params.toString();
      if (qs) url += `${url.includes('?') ? '&' : '?'}${qs}`;
    }
    return url;
  }

  /** 文档 §1.2：最小必要头集合；未确认的头一律不发。 */
  #baseHeaders({ json = false, sse = false } = {}) {
    const headers = {
      Authorization: `Bearer ${this.#token}`,
      Accept: sse ? '*/*' : 'application/json',
      'User-Agent': DEFAULT_UA,
      'x-client-version': '2.3.0',
      'x-client-platform': 'web',
      'x-client-locale': 'zh_CN',
      'x-client-timezone-offset': this.#timezoneOffset,
      'x-client-bundle-id': 'com.deepseek.chat',
      Origin: this.#origin,
      Referer: this.#referer,
    };
    if (json) headers['Content-Type'] = 'application/json';
    return headers;
  }

  /** 发起请求并处理超时/外部 AbortSignal；返回 {res, timedOut, signal, dispose}。 */
  async #fetchOnce(url, init, { signal, timeoutMs }) {
    const controller = new AbortController();
    let timedOut = false;
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          controller.abort(new Error('timeout'));
        } catch {
          // 忽略重复 abort
        }
      }, timeoutMs);
      timer.unref?.();
    }
    const onAbort = () => {
      try {
        controller.abort(signal?.reason ?? new Error('aborted'));
      } catch {
        // 忽略重复 abort
      }
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    let res;
    try {
      res = await this.#fetchImpl(url, { ...init, signal: controller.signal });
    } catch (err) {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      throw this.#convertError(err, { timedOut, timeoutMs, signal: controller.signal }, signal);
    }
    const dispose = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      if (res && res.body && !res.bodyUsed) {
        try {
          res.body.cancel().catch(() => {});
        } catch {
          // 忽略取消失败
        }
      }
    };
    return { res, get timedOut() { return timedOut; }, timeoutMs, signal: controller.signal, dispose };
  }

  /** 把底层异常翻译成 DeepSeekWebError（区分超时 / 取消 / 网络错误）。 */
  #convertError(err, handle, externalSignal) {
    if (err instanceof DeepSeekWebError) return err;
    if (handle?.timedOut) {
      return new DeepSeekWebError(
        `上游请求超时（超过 ${Math.round((handle.timeoutMs ?? STREAM_TIMEOUT_MS) / 1000)}s 未完成）。可能是网络慢、代理不稳，或服务端挂起；可稍后重试。`,
        { code: 'timeout', body: err?.message ?? String(err), cause: err },
      );
    }
    if (externalSignal?.aborted || handle?.signal?.aborted) {
      return new DeepSeekWebError('请求已被取消（AbortSignal）。', {
        code: 'aborted',
        body: err?.message ?? String(err),
        cause: err,
      });
    }
    return new DeepSeekWebError(`网络请求失败：${truncate(err?.message || String(err), 200)}（请检查网络/代理设置）。`, {
      code: 'network_error',
      body: err?.message ?? String(err),
      cause: err,
    });
  }

  /** 读取错误响应体（尽力而为，失败返回空串）。 */
  async #readTextQuiet(handle) {
    try {
      return await handle.res.text();
    } catch {
      return '';
    }
  }

  /**
   * 请求 + 有界重试：
   * - HTTP 429 / 5xx 最多重试一次（小退避）；
   * - 连接层网络错误最多重试一次；
   * - 401/403（含 WAF 头）与业务错误不重试（文档 §6.7）。
   */
  async #fetchWithRetry(url, init, { signal, timeoutMs = READ_TIMEOUT_MS, retry = 1 } = {}) {
    let attempt = 0;
    for (;;) {
      if (attempt > 0) {
        try {
          await sleep(RETRY_DELAY_MS + Math.floor(Math.random() * 100), signal);
        } catch (err) {
          throw this.#convertError(err, null, signal);
        }
      }
      let handle;
      try {
        handle = await this.#fetchOnce(url, init, { signal, timeoutMs });
      } catch (err) {
        if (err?.code === 'network_error' && attempt < retry && !signal?.aborted) {
          attempt++;
          continue;
        }
        throw err;
      }

      const status = handle.res.status;
      if (isRetryableHttpStatus(status)) {
        const text = await this.#readTextQuiet(handle);
        handle.dispose();
        const err = httpStatusError(status, text);
        if (attempt < retry && !signal?.aborted) {
          attempt++;
          continue;
        }
        throw err;
      }
      if (status === 202 || status === 405 || status === 403 || status === 401) {
        const wafAction = handle.res.headers.get('x-amzn-waf-action') || handle.res.headers.get('cf-mitigated') || '';
        const text = await this.#readTextQuiet(handle);
        handle.dispose();
        if (wafAction) throw wafError(status, text);
        throw httpStatusError(status, text);
      }
      return handle;
    }
  }

  /** 统一入口：组装头/体/超时，返回未消费的响应句柄。 */
  async #open(method, path, { query, body, signal, timeoutMs = READ_TIMEOUT_MS, headers: extraHeaders = {}, sse = false, retry = 1 } = {}) {
    const url = this.#url(path, query);
    const headers = { ...this.#baseHeaders({ json: body !== undefined, sse }), ...(extraHeaders || {}) };
    const init = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    return this.#fetchWithRetry(url, init, { signal, timeoutMs, retry });
  }

  /** 解析 JSON 文本（非法 JSON 直接给可读错误）。 */
  #parseJson(text, status) {
    try {
      return JSON.parse(text);
    } catch {
      throw new DeepSeekWebError(`上游返回的不是合法 JSON（HTTP ${status}）：${truncate(text)}`, {
        code: 'bad_response',
        status,
        body: truncate(text, 1_000),
      });
    }
  }

  /** 校验统一信封（文档 §1.4）：code==0 且 data.biz_code==0 才算成功。 */
  #parseEnvelope(json, status) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      throw new DeepSeekWebError(`响应信封不是对象（HTTP ${status}）：${truncate(JSON.stringify(json))}`, {
        code: 'bad_response',
        status,
        body: json,
      });
    }
    const code = Number(json.code ?? 0);
    const data = json.data;
    if (code !== 0) throw errorFromEnvelope(json, status);
    if (!data || typeof data !== 'object') {
      throw new DeepSeekWebError(`响应缺少 data 信封（HTTP ${status}）：${truncate(JSON.stringify(json))}`, {
        code: 'bad_response',
        status,
        body: json,
      });
    }
    const bizCode = Number(data.biz_code ?? 0);
    if (bizCode !== 0) throw errorFromEnvelope(json, status);
    return data.biz_data ?? {};
  }

  /** GET/POST 普通 JSON 接口。 */
  async #requestJson(method, path, { query, body, signal, timeoutMs = READ_TIMEOUT_MS, headers, retry = method === 'GET' ? 1 : 0 } = {}) {
    const handle = await this.#open(method, path, { query, body, signal, timeoutMs, headers, retry });
    let text;
    try {
      text = await handle.res.text();
    } catch (err) {
      throw this.#convertError(err, handle, signal);
    } finally {
      handle.dispose();
    }
    return this.#parseEnvelope(this.#parseJson(text, handle.res.status), handle.res.status);
  }

  // ------------------------------------------------------------------ 公共 API

  /** A single paced file-metadata lane. HTTP 200 + code 40029 is a real rate limit.
   * Cache only successful signed descriptors in memory, briefly; never failures.
   * A cancelled waiter must not cancel other files or poison the shared queue.
   */
  async #fileDescriptor(fileId, { signal, refresh = false, timeoutMs = READ_TIMEOUT_MS } = {}) {
    const run = async () => {
      signal?.throwIfAborted();
      const cached = this.#fileCache.get(fileId);
      if (!refresh && cached && cached.expires > Date.now()) return cached.file;
      this.#fileCache.delete(fileId);
      for (let attempt = 0; ; attempt++) {
        await sleep(Math.max(0, this.#nextFileReadAt - Date.now()), signal);
        signal?.throwIfAborted();
        this.#nextFileReadAt = Date.now() + this.#fileInterval;
        try {
          const result = await this.#requestJson('GET', '/api/v0/file/fetch_files', { query: { file_ids: fileId }, signal, timeoutMs, retry: 0 });
          const files = Array.isArray(result) ? result : Array.isArray(result?.files) ? result.files : [];
          const file = files.find(entry => String(entry?.id ?? entry?.file_id ?? entry?.fileId ?? entry?.server_id) === fileId);
          if (file && String(file.status || 'SUCCESS').toUpperCase() === 'SUCCESS' && (file.signed_path || file.signedPath)) {
            this.#fileCache.set(fileId, { file, expires: Date.now() + 15000 });
            while (this.#fileCache.size > 128) this.#fileCache.delete(this.#fileCache.keys().next().value);
          }
          return file;
        } catch (error) {
          const throttled = error.code === 'rate_limited';
          if (!throttled && !['network_error', 'timeout'].includes(error.code) && !(error.code === 'http_error' && error.status >= 500)) throw error;
          // One cooldown for the whole lane, not 24 independent retry storms.
          this.#nextFileReadAt = Math.max(this.#nextFileReadAt, Date.now() + (throttled ? this.#fileCooldown : this.#fileInterval) * (attempt + 1));
          if (attempt >= 2 || signal?.aborted) throw error;
        }
      }
    };
    const job = this.#fileQueue.then(run);
    this.#fileQueue = job.catch(() => {});
    if (!signal) return job;
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(this.#convertError(signal.reason, null, signal));
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
      job.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
  }

  /** A verbatim attachment stream; the caller must always dispose it. */
  async openFile(fileId, { signal } = {}) {
    normalizeFileIds([fileId]);
    const file = await this.#fileDescriptor(fileId, { signal });
    if (!file) throw new DeepSeekWebError('附件不存在或当前账号无权读取。', { code: 'file_not_found', status: 404 });
    const handle = await this.#fetchOnce(signedFileUrl(file.signed_path || file.signedPath), {
      method: 'GET', headers: { Accept: 'application/octet-stream' }, credentials: 'omit', redirect: 'manual',
    }, { signal, timeoutMs: 120000 });
    if (handle.res.status !== 200 || !handle.res.body) {
      await handle.res.body?.cancel().catch(() => {}); handle.dispose();
      this.#fileCache.delete(fileId);
      throw new DeepSeekWebError('附件原文件读取失败。', { code: 'file_unavailable' });
    }
    if (Number(handle.res.headers.get('content-length')) > MAX_IMPORT_FILE_BYTES) {
      handle.res.body.cancel().catch(() => {}); handle.dispose();
      throw new DeepSeekWebError('附件超过单文件导入上限 100 MiB。', { code: 'too_large', status: 413 });
    }
    let reader;
    const dispose = async () => {
      if (reader) await reader.cancel().catch(() => {});
      else await handle.res.body.cancel().catch(() => {});
      handle.dispose();
    };
    const data = (async function* () {
      reader = handle.res.body.getReader();
      let bytes = 0;
      try {
        for (;;) {
          signal?.throwIfAborted();
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.length;
          if (bytes > MAX_IMPORT_FILE_BYTES) throw new DeepSeekWebError('附件超过单文件导入上限 100 MiB。', { code: 'too_large', status: 413 });
          yield part.value;
        }
      } finally { await dispose(); }
    })();
    return { data, dispose };
  }

  /** Refresh the private signed path, then read preview bytes without account headers. */
  async getImage(fileId, { signal, retryDelayMs = 300, original = false } = {}) {
    normalizeFileIds([fileId]);
    for (let attempt = 0; ; attempt++) {
      try { return await this.#getImageOnce(fileId, signal, original, attempt > 0); }
      catch (error) {
        if (attempt >= 2 || signal?.aborted || !['image_pending', 'network_error', 'timeout'].includes(error.code)) throw error;
        try { await sleep(Math.max(0, Math.min(1000, retryDelayMs)) * (attempt + 1), signal); }
        catch (aborted) { throw this.#convertError(aborted, null, signal); }
      }
    }
  }

  async #getImageOnce(fileId, signal, original, refresh) {
    const file = await this.#fileDescriptor(fileId, { signal, refresh });
    if (!file) throw new DeepSeekWebError('图片附件不存在或当前账号无权读取。', { code: 'file_not_found', status: 404 });
    if (['PENDING', 'PROCESSING', 'UPLOADING', 'PARSING'].includes(String(file.status).toUpperCase()) || !(file.signed_path || file.signedPath)) {
      throw new DeepSeekWebError('图片预览正在准备，请稍后重试。', { code: 'image_pending', status: 503 });
    }
    const url = (original ? signedFileUrl : signedImageUrl)(file.signed_path || file.signedPath);
    const limit = original ? MAX_FILE_BYTES : MAX_IMAGE_BYTES;
    const tooLarge = () => new DeepSeekWebError(original ? '图片原文件超过导入上限 20 MiB。' : '图片预览超过 12 MiB。', { code: 'too_large', status: 413 });
    const handle = await this.#fetchOnce(url, { method: 'GET', headers: { Accept: 'image/*' }, credentials: 'omit', redirect: 'manual' }, { signal, timeoutMs: 30000 });
    let reader;
    try {
      if (handle.res.status !== 200) throw new DeepSeekWebError(`图片预览读取失败（HTTP ${handle.res.status}）。`, {
        code: [403, 404, 425, 429, 500, 502, 503, 504].includes(handle.res.status) ? 'image_pending' : 'image_unavailable', status: 502 });
      if (Number(handle.res.headers.get('content-length')) > limit) throw tooLarge();
      if (!handle.res.body) throw new DeepSeekWebError('图片预览没有返回内容。', { code: 'bad_response' });
      reader = handle.res.body.getReader();
      let length = 0;
      const chunks = [];
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        length += item.value.length;
        if (length > limit) throw tooLarge();
        chunks.push(Buffer.from(item.value));
      }
      const bytes = Buffer.concat(chunks);
      const contentType = sniffImageType(bytes);
      if (!contentType) throw new DeepSeekWebError('图片预览不是支持的图片格式。', { code: 'bad_response' });
      return { bytes, contentType };
    } catch (error) { this.#fileCache.delete(fileId); throw error instanceof DeepSeekWebError ? error : this.#convertError(error, handle, signal); }
    finally { if (reader) await reader.cancel().catch(() => {}); handle.dispose(); }
  }

  /** Upload actual bytes once, then wait for parsing before returning an id.
   * Private web protocol: multipart `file`, upload-specific PoW, fetch_files.
   * No local paths or remote URLs are accepted, and mutation is never retried.
   */
  async uploadFile({ name, bytes, contentType = 'application/octet-stream', thinking = false, signal, pollIntervalMs = 1000, parseTimeoutMs = 120000 } = {}) {
    if (typeof name !== 'string' || !name.trim() || name.length > 255 || /[\\/\u0000-\u001f\u007f]/.test(name) || !(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_FILE_BYTES) {
      throw new DeepSeekWebError('文件名无效，或文件为空/超过 20 MiB。', { code: 'bad_request', status: 400 });
    }
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0 || !Number.isFinite(parseTimeoutMs) || parseTimeoutMs <= 0 || parseTimeoutMs > 120000) {
      throw new DeepSeekWebError('文件解析等待参数无效。', { code: 'bad_request', status: 400 });
    }
    const proof = await this.#powHeader('/api/v0/file/upload_file', signal);
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: contentType }), name);
    const headers = { ...this.#baseHeaders(), 'x-ds-pow-response': proof,
      'x-file-size': String(bytes.length), 'x-model-type': 'default', 'x-thinking-enabled': String(!!thinking) };
    const handle = await this.#fetchWithRetry(this.#url('/api/v0/file/upload_file'), { method: 'POST', headers, body: form },
      { signal, timeoutMs: 60000, retry: 0 });
    let uploaded;
    try {
      uploaded = this.#parseEnvelope(this.#parseJson(await handle.res.text(), handle.res.status), handle.res.status);
    } catch (error) { throw error instanceof DeepSeekWebError ? error : this.#convertError(error, handle, signal); }
    finally { handle.dispose(); }
    if (typeof uploaded?.id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(uploaded.id)) {
      throw new DeepSeekWebError('上传响应缺少有效的附件 ID。', { code: 'bad_response' });
    }
    const id = uploaded.id;
    const deadline = Date.now() + parseTimeoutMs;
    let current = uploaded;
    for (;;) {
      const status = String(current?.status || '').toUpperCase();
      if (status === 'SUCCESS') return { id, name, size: bytes.length, status };
      if (status && !['PENDING', 'PROCESSING', 'UPLOADING', 'PARSING'].includes(status)) {
        throw new DeepSeekWebError(`附件「${name}」解析失败（${status}）。`, { code: 'file_parse_failed' });
      }
      if (signal?.aborted) throw this.#convertError(signal.reason, null, signal);
      if (Date.now() >= deadline) throw new DeepSeekWebError(`附件「${name}」解析超时，请稍后重新上传。`, { code: 'timeout', status: 504 });
      current = await this.#fileDescriptor(id, { signal, refresh: true,
        timeoutMs: Math.max(1, Math.min(READ_TIMEOUT_MS, deadline - Date.now())) });
      if (!current) throw new DeepSeekWebError('上游未返回已上传附件的解析状态。', { code: 'bad_response' });
      if (String(current.status).toUpperCase() !== 'SUCCESS') {
        try { await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())), signal); }
        catch (error) { throw this.#convertError(error, null, signal); }
      }
    }
  }

  /**
   * 会话目录（文档 §2）。
   *
   * 分页参数必须用嵌套点号形式：`lte_cursor.pinned=false&lte_cursor.updated_at=<秒>`；
   * 平铺写法会被服务端忽略（文档 §2.1 坑）。`nextCursor` 是「本页最后一条的 updatedAt」，
   * 注意服务端边界是 `<=`，下一页第一条会与本页最后一条重复，调用方需按 id 去重。
   *
   * @param {{limit?: number, cursor?: number|string|null, signal?: AbortSignal}} [options]
   * @returns {Promise<{sessions: Array<{id:string,title:string,pinned:boolean,modelType:string,updatedAt:number}>, hasMore: boolean, nextCursor: number|null}>}
   */
  async listSessions({ limit = 30, cursor = null, signal } = {}) {
    const max = Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 30;
    if (max <= 0) return { sessions: [], hasMore: false, nextCursor: null };

    const seen = new Set();
    const sessions = [];
    let pageCursor = cursor === null || cursor === undefined || cursor === '' ? null : String(cursor);
    let serverHasMore = false;
    let emptyPages = 0;

    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const query = { 'lte_cursor.pinned': 'false', count: 100 };
      if (pageCursor !== null) query['lte_cursor.updated_at'] = pageCursor;
      const biz = await this.#requestJson('GET', '/api/v0/chat_session/fetch_page', { query, signal });
      const rawList = Array.isArray(biz?.chat_sessions) ? biz.chat_sessions : [];
      serverHasMore = biz?.has_more === true;

      let added = 0;
      for (const raw of rawList) {
        const entry = normalizeSessionEntry(raw);
        if (!entry.id || seen.has(entry.id)) continue;
        seen.add(entry.id);
        sessions.push(entry);
        added++;
      }

      // 游标 = 本页最后一条的 updated_at（原样浮点秒，不 parseInt / 不 *1000）
      if (rawList.length > 0) {
        const last = rawList[rawList.length - 1];
        const lastUpdated = Number(last?.updated_at);
        if (!Number.isFinite(lastUpdated)) break; // 无法翻页
        pageCursor = String(last.updated_at);
      }

      if (sessions.length >= max) break;
      if (!serverHasMore || rawList.length === 0) break;
      if (added === 0) {
        if (++emptyPages >= 2) break; // 连续两页无新数据就停（文档 §2.1）
      } else {
        emptyPages = 0;
      }
    }

    const result = sessions.slice(0, max);
    const hasMore = sessions.length > max || (sessions.length === max && serverHasMore);
    const nextCursor = hasMore && result.length > 0 ? result[result.length - 1].updatedAt : null;
    return { sessions: result, hasMore, nextCursor };
  }

  /** Remote title update, never implicitly retried. */
  async renameSession(sessionId, title, { signal } = {}) {
    if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(sessionId) || typeof title !== 'string' || !title.trim() || title.trim().length > 200 || /[\u0000-\u001f\u007f]/.test(title)) {
      throw new DeepSeekWebError('会话 ID 或标题无效，标题需为 1–200 个字符。', { code: 'bad_request', status: 400 });
    }
    title = title.trim();
    await this.#requestJson('POST', '/api/v0/chat_session/update_title', { body: { chat_session_id: sessionId, title }, signal });
    return { sessionId, title };
  }

  /** Permanent remote mutation; explicitly confirmed by the UI, never retried. */
  async deleteSession(sessionId, { signal } = {}) {
    if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(sessionId)) {
      throw new DeepSeekWebError('会话 ID 无效。', { code: 'bad_request', status: 400 });
    }
    await this.#requestJson('POST', '/api/v0/chat_session/delete', { body: { chat_session_id: sessionId }, signal });
    return { sessionId };
  }

  /**
   * 会话历史（文档 §3）：GET /api/v0/chat/history_messages?chat_session_id=<uuid>。
   * 只取 REQUEST/RESPONSE/THINK/TOOL_SEARCH；正文只取 RESPONSE，思维链取 THINK，
   * 按 inserted_at 升序（缺失时间用会话最早时间兜底，文档 §3.5）。
   *
   * @param {string} sessionId
   * @param {{signal?: AbortSignal}} [options]
   * @returns {Promise<{id: string, title: string, messages: Array<{id:number|null,parentId:number|null,role:'user'|'assistant',status:string,insertedAt:number,text:string,thinking:string,searchResults:Array<{title:string,url:string,snippet:string}>}>}>}
   */
  async getHistory(sessionId, { signal } = {}) {
    const sid = typeof sessionId === 'string' ? sessionId.trim() : sessionId == null ? '' : String(sessionId).trim();
    if (!sid) {
      throw new DeepSeekWebError('getHistory 需要非空的 sessionId（会话 id）。', { code: 'bad_request' });
    }
    const biz = await this.#requestJson('GET', '/api/v0/chat/history_messages', {
      query: { chat_session_id: sid },
      signal,
    });
    const rawMessages = Array.isArray(biz?.chat_messages) ? biz.chat_messages : [];

    // 先按 inserted_at 排序（从旧到新）。缺失时间用有效时间的最小值兜底，不用「现在」。
    const rows = [];
    for (const raw of rawMessages) {
      const normalized = normalizeHistoryMessage(raw);
      if (!normalized) continue; // SYSTEM / TOOL 等角色丢弃
      const insertedAt = Number(raw?.inserted_at);
      rows.push({
        normalized,
        insertedAt: Number.isFinite(insertedAt) && insertedAt > 0 ? insertedAt : null,
      });
    }
    let fallbackTime = null;
    for (const row of rows) {
      if (row.insertedAt == null) continue;
      fallbackTime = fallbackTime == null ? row.insertedAt : Math.min(fallbackTime, row.insertedAt);
    }
    const fallback = fallbackTime ?? 0;
    // 注意：网页端 assistant 消息的 inserted_at 可能比它回答的 user 消息小几毫秒
    // （实测 2026-10 抓包：user .832 / assistant .827），所以不能只按时间排序。
    // message_id 在同一会话内单调递增，优先按它排；缺失时才退回时间。
    const idOf = (row) => {
      const number = Number(row.normalized.id);
      return Number.isFinite(number) ? number : null;
    };
    rows.sort((a, b) => {
      const idA = idOf(a);
      const idB = idOf(b);
      if (idA != null && idB != null) return idA - idB;
      return (a.insertedAt ?? fallback) - (b.insertedAt ?? fallback);
    });

    const messages = rows.map((row) => ({
      id: row.normalized.id,
      parentId: row.normalized.parentId,
      role: row.normalized.role,
      status: row.normalized.status,
      insertedAt: row.insertedAt ?? fallback,
      text: row.normalized.text,
      thinking: row.normalized.thinking,
      searchResults: row.normalized.searchResults,
      ...(row.normalized.banRegenerate !== undefined ? { banRegenerate: row.normalized.banRegenerate } : {}),
      ...(row.normalized.processSteps ? { processSteps: row.normalized.processSteps } : {}),
      ...(row.normalized.thinkingMs !== undefined ? { thinkingMs: row.normalized.thinkingMs } : {}),
      ...(row.normalized.files ? { files: row.normalized.files } : {}),
    }));

    const title = typeof biz?.chat_session?.title === 'string' ? biz.chat_session.title : '';
    const id =
      (typeof biz?.chat_session_id === 'string' && biz.chat_session_id) ||
      (typeof biz?.chat_session?.id === 'string' && biz.chat_session.id) ||
      sid;
    const current = Number(biz?.chat_session?.current_message_id);
    const activeMessages = selectHistoryPath(messages, current);
    return { id, title, messages, ...(Number.isSafeInteger(current) && current > 0 ? { currentMessageId: current } : {}),
      ...(activeMessages.length !== messages.length ? { activeMessages } : {}) };
  }

  /**
   * 继续已有会话（文档 §4）：POST /api/v0/chat/completion，响应始终是 SSE。
   * `prompt` 只放最新一条用户文本，历史由服务端按 parent_message_id 链维护。
   *
   * @param {object} options
   * @param {string} options.sessionId 已有会话 id
   * @param {number|null} [options.parentMessageId] 上一条 assistant 消息的 message_id（历史最后一条 ASSISTANT）
   * @param {string} options.prompt 新的一条用户消息
   * @param {boolean} [options.thinking] DeepThink 开关
   * @param {boolean} [options.search] 联网搜索开关
   * @param {(delta: {type: 'text'|'thinking', text: string}|{type: 'search', results: object[]}) => void} [options.onDelta] 文本与汇总来源增量
   * @param {(delta: object) => void} [options.onProcess] 有序 process-step / process-text / process-reset 增量
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<{sessionId: string, messageId: number|null, parentMessageId: number|null, reply: string, thinking: string, usage: number}>}
   *   `messageId` = 本轮 assistant 消息 id（ready.response_message_id / 快照 response.message_id）；
   *   `parentMessageId` = **下一轮续聊应使用的 parent_message_id**（文档 §4.1：下一轮 parent = 本轮
   *   assistant message id），因此当前与 messageId 同值；取不到 id 时为 null。
   */
  async continueSession({ sessionId, parentMessageId, prompt, fileIds = [], thinking = false, search = false, onDelta, onProcess, signal } = {}) {
    const sid = typeof sessionId === 'string' ? sessionId.trim() : sessionId == null ? '' : String(sessionId).trim();
    if (!sid) {
      throw new DeepSeekWebError('continueSession 需要非空的 sessionId（会话 id）。', { code: 'bad_request' });
    }
    fileIds = normalizeFileIds(fileIds);
    assertPrompt(prompt, 'continueSession', fileIds);
    const result = await this.#runCompletion({
      sessionId: sid,
      parentMessageId: parentMessageId ?? null,
      prompt,
      fileIds,
      thinking,
      search,
      onDelta,
      onProcess,
      signal,
    });
    const assistantMessageId = result.messageId ?? null;
    return {
      sessionId: sid,
      messageId: assistantMessageId,
      parentMessageId: assistantMessageId,
      reply: result.reply,
      thinking: result.thinking,
      usage: result.usage,
      ...(result.requestMessageId != null ? { requestMessageId: result.requestMessageId } : {}),
      ...(result.searchResults?.length ? { searchResults: result.searchResults } : {}),
      ...(result.processSteps?.length ? { processSteps: result.processSteps } : {}),
      ...(result.thinkingMs !== undefined ? { thinkingMs: result.thinkingMs } : {}),
    };
  }

  /** Official web regenerate: child_message_id is the existing ASSISTANT id.
   * Completion-like PoW still targets /chat/completion, as the public web bundle
   * does. No prompt/file replay, no retries of a mutating POST.
   */
  async regenerateSession({ sessionId, childMessageId, thinking = false, search = false, onDelta, onProcess, signal } = {}) {
    const child = Number(childMessageId);
    if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(sessionId) || !Number.isSafeInteger(child) || child <= 0) {
      throw new DeepSeekWebError('重新回答需要有效的会话与回答 ID。', { code: 'bad_request', status: 400 });
    }
    const result = await this.#runCompletion({ sessionId, regenerateChildId: child, thinking, search, onDelta, onProcess, signal });
    if (!Number.isSafeInteger(result.messageId) || result.messageId <= 0 || result.messageId === child) {
      throw new DeepSeekWebError('重新回答结果的消息 ID 尚未确认，请刷新会话检查结果，不要重复提交。', { code: 'incomplete_stream' });
    }
    return { sessionId, messageId: result.messageId, parentMessageId: result.messageId, reply: result.reply, thinking: result.thinking,
      usage: result.usage, searchResults: result.searchResults, processSteps: result.processSteps,
      ...(result.thinkingMs !== undefined ? { thinkingMs: result.thinkingMs } : {}) };
  }

  /**
   * 新建网页会话并发送第一条消息（文档 §4.1）。
   *
   * 说明（版本差异，文档 §4.1/§8）：
   * - createSession 不接收调用方的 sessionId；
   * - 内部先 POST /api/v0/chat_session/create 拿 id（两种 body 依次尝试：`{}` 与 `{target_path}`+PoW），
   *   再带上该 id 调 completion；
   * - 若 SSE 帧里带回了 chat_session_id，以 SSE 为准（本方法最终返回它）；
   * - 若 create 端点两种写法都失败，则退化为「不带 chat_session_id 的 completion」，此时完全依赖 SSE 帧里的会话 id。
   *
   * @param {object} options
   * @param {string} options.prompt 第一条用户消息
   * @param {boolean} [options.thinking] DeepThink 开关
   * @param {boolean} [options.search] 联网搜索开关
   * @param {(delta: {type: 'text'|'thinking', text: string}|{type: 'search', results: object[]}) => void} [options.onDelta] 文本与汇总来源增量
   * @param {(delta: object) => void} [options.onProcess] 有序 process-step / process-text / process-reset 增量
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<{sessionId: string, messageId: number|null, parentMessageId: number|null, reply: string, thinking: string, usage: number}>}
   *   `messageId` = 本轮 assistant 消息 id；`parentMessageId` = 下一轮续聊应使用的 parent（同值，见 continueSession 说明）。
   */
  async createSession({ prompt, fileIds = [], thinking = false, search = false, onDelta, onProcess, signal } = {}) {
    fileIds = normalizeFileIds(fileIds);
    assertPrompt(prompt, 'createSession', fileIds);

    let createdId = '';
    let createError = null;
    try {
      createdId = await this.#createChatSession(signal);
    } catch (err) {
      if (err?.code === 'aborted' || err?.code === 'timeout') throw err;
      createError = err;
    }

    let result;
    try {
      result = await this.#runCompletion({
        sessionId: createdId,
        parentMessageId: null,
        prompt,
        fileIds,
        thinking,
        search,
        onDelta,
        onProcess,
        signal,
      });
    } catch (err) {
      if (createError) {
        throw new DeepSeekWebError(
          `新建会话失败：chat_session/create 报错「${truncate(createError.message, 200)}」，` +
            `且不带 chat_session_id 的 completion 也失败「${truncate(err.message, 200)}」。`,
          {
            code: err?.code || createError?.code || 'api_error',
            status: err?.status || createError?.status || 0,
            bizCode: err?.bizCode ?? createError?.bizCode ?? null,
            body: { createSessionError: createError?.body ?? createError?.message, completionError: err?.body ?? err?.message },
            cause: err,
          },
        );
      }
      throw err;
    }

    const finalSessionId = result.sessionId || createdId;
    if (!finalSessionId) {
      throw new DeepSeekWebError(
        '新建会话成功但无法确定 chat_session_id：create_session 未返回 id，SSE 帧里也没有会话 id。可改用 listSessions 读取最新会话 id。',
        { code: 'missing_session_id', body: { messageId: result.messageId } },
      );
    }
    return {
      sessionId: finalSessionId,
      messageId: result.messageId ?? null,
      // 下一轮续聊的 parent = 本轮 assistant 消息 id（文档 §4.1）
      parentMessageId: result.messageId ?? null,
      reply: result.reply,
      thinking: result.thinking,
      usage: result.usage,
      ...(result.requestMessageId != null ? { requestMessageId: result.requestMessageId } : {}),
      ...(result.searchResults?.length ? { searchResults: result.searchResults } : {}),
      ...(result.processSteps?.length ? { processSteps: result.processSteps } : {}),
      ...(result.thinkingMs !== undefined ? { thinkingMs: result.thinkingMs } : {}),
    };
  }

  // --------------------------------------------------------- 内部：新建会话 / PoW

  /** 新建会话（文档 §4.1）：`{}` 失败后重试 `{target_path}` + PoW。 */
  async #createChatSession(signal) {
    let firstError = null;
    try {
      const data = await this.#requestJson('POST', '/api/v0/chat_session/create', { body: {}, signal });
      const id = extractSessionId(data);
      if (id) return id;
      throw new DeepSeekWebError('chat_session/create 响应里没有 chat_session.id（或旧版 biz_data.id）。', {
        code: 'bad_response',
        body: data,
      });
    } catch (err) {
      if (err?.code === 'aborted' || err?.code === 'timeout') throw err;
      firstError = err;
    }
    try {
      const powHeader = await this.#powHeader('/api/v0/chat/completion', signal);
      const data = await this.#requestJson('POST', '/api/v0/chat_session/create', {
        body: { target_path: '/api/v0/chat/completion' },
        headers: { 'x-ds-pow-response': powHeader },
        signal,
      });
      const id = extractSessionId(data);
      if (id) return id;
      throw new DeepSeekWebError('chat_session/create（带 PoW）响应里没有会话 id。', {
        code: 'bad_response',
        body: data,
      });
    } catch (err) {
      if (err?.code === 'aborted' || err?.code === 'timeout') throw err;
      throw new DeepSeekWebError(
        `新建会话失败：create_session 的两种请求体都失败。` +
          `首次（body={}）：${truncate(firstError?.message || String(firstError), 200)}；` +
          `带 PoW（body={target_path}）：${truncate(err?.message || String(err), 200)}。`,
        {
          code: err?.code || firstError?.code || 'api_error',
          status: err?.status || firstError?.status || 0,
          bizCode: err?.bizCode ?? firstError?.bizCode ?? null,
          body: { first: firstError?.body ?? firstError?.message, second: err?.body ?? err?.message },
          cause: err,
        },
      );
    }
  }

  /**
   * 申请 + 求解 PoW，返回 x-ds-pow-response 头的值（文档 §5）。
   * challenge 一次性、短 TTL：每次 completion 前都必须重新申请、重新求解。
   */
  async #powHeader(targetPath, signal) {
    const data = await this.#requestJson('POST', '/api/v0/chat/create_pow_challenge', {
      body: { target_path: targetPath },
      signal,
    });
    const challenge = unwrapChallengeObject(data?.challenge ?? data);
    if (!challenge || typeof challenge !== 'object') {
      throw new DeepSeekWebError('PoW 响应里没有 challenge 对象（文档 §5.1）。', { code: 'pow_invalid', body: data });
    }
    if (String(challenge.algorithm || '') !== 'DeepSeekHashV1') {
      throw new DeepSeekWebError(
        `不支持的 PoW 算法「${challenge.algorithm || '空'}」：本客户端只实现 DeepSeekHashV1，若上游换算法需要官方 WASM。`,
        { code: 'pow_invalid', body: data },
      );
    }
    if (challenge.target_path && challenge.target_path !== targetPath) {
      throw new DeepSeekWebError('PoW challenge 的目标路径与当前操作不一致。', { code: 'pow_invalid' });
    }
    const answer = solveChallenge(challenge);
    return buildPowResponseHeader(challenge, answer, targetPath);
  }

  // -------------------------------------------------------------- 内部：completion

  /** 单次 completion：申请 PoW → POST SSE → 解析流。 */
  async #runCompletion({ sessionId, parentMessageId = null, prompt, fileIds = [], regenerateChildId, thinking = false, search = false, onDelta, onProcess, signal }) {
    const powHeader = await this.#powHeader('/api/v0/chat/completion', signal);

    // 文档 §4.2：prompt 只放最新一条用户文本；续聊不带 model_type。
    const body = regenerateChildId != null ? {
      chat_session_id: String(sessionId), child_message_id: regenerateChildId,
      thinking_enabled: !!thinking, search_enabled: !!search, user_options: null,
    } : {
      parent_message_id: parentMessageId ?? null,
      prompt: String(prompt),
      ref_file_ids: fileIds,
      thinking_enabled: !!thinking,
      search_enabled: !!search,
      action: null,
      preempt: false,
    };
    if (sessionId) body.chat_session_id = String(sessionId);

    const headers = { 'x-ds-pow-response': powHeader };
    if (this.#hifLeim) headers['x-hif-leim'] = this.#hifLeim; // 只有显式传入才发送（文档 §1.2）

    // A completion mutates the web account. A failed connection cannot tell us
    // whether the prompt was committed, so never replay this POST automatically.
    const handle = await this.#open('POST', regenerateChildId != null ? '/api/v0/chat/regenerate' : '/api/v0/chat/completion', {
      body,
      headers,
      signal,
      timeoutMs: STREAM_TIMEOUT_MS,
      sse: true,
      retry: 0,
    });

    try {
      const contentType = String(handle.res.headers.get('content-type') || '');
      if (!/text\/event-stream/i.test(contentType)) {
        // 鉴权/禁言等错误可能以普通 JSON 信封返回（文档 §6.4 最后一条）
        let text = '';
        try {
          text = await handle.res.text();
        } catch (err) {
          throw this.#convertError(err, handle, signal);
        }
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          // 非 JSON
        }
        if (json && typeof json === 'object') throw errorFromEnvelope(json, handle.res.status);
        throw new DeepSeekWebError(
          `completion 返回了非 SSE 响应（HTTP ${handle.res.status}，content-type=${contentType || '无'}）：${truncate(text)}`,
          { code: 'bad_response', status: handle.res.status, body: truncate(text, 1_000) },
        );
      }

      try {
        return await this.#consumeCompletion(handle, { signal, onDelta, onProcess, sessionIdHint: sessionId || '' });
      } catch (err) {
        if (err?.code === 'network_error') {
          throw new DeepSeekWebError('回复连接中断，网页端可能已保存这条消息。请刷新会话确认结果后再发送。', {
            code: 'incomplete_stream', cause: err,
          });
        }
        throw err;
      }
    } finally {
      handle.dispose();
    }
  }

  /**
   * 解析 completion 的 SSE 流（文档 §4.3–§4.7）。
   *
   * 同时做两件事：
   * 1) 通用状态树更新（SET/APPEND/BATCH，支持负索引 / fragments）；
   * 2) 最终正文只从 fragments（RESPONSE/THINK）取，`response/content` 仅作兜底，
   *    这样 TIP / TOOL_* 不会污染正文（文档 §4.6）。
   */
  async #consumeCompletion(handle, { signal, onDelta, onProcess, sessionIdHint = '' } = {}) {
    // 状态树根：response 是文档 §4.4 快照的字段集合
    const root = {
      response: { fragments: [], content: '', status: 'WIP', accumulated_token_usage: 0 },
    };
    let currentPath = ''; // 跨帧持久的「当前路径」（文档 §4.5）
    let currentOp = 'SET'; // 跨帧持久的「当前操作」，初始默认 SET
    let messageId = null;
    let requestMessageId = null;
    let sseSessionId = '';
    let title = '';
    let sawFinish = false;
    let emittedText = '';
    let emittedThinking = '';

    const fragmentsOf = () => (Array.isArray(root.response.fragments) ? root.response.fragments : []);
    const extractText = () => {
      let out = '';
      for (const fragment of fragmentsOf()) {
        if (String(fragment?.type || '').toUpperCase() === 'RESPONSE' && typeof fragment.content === 'string') {
          out += fragment.content;
        }
      }
      // 没有 fragments 时用 response/content 兜底（thinking=off 的主文本路径）
      if (!out && typeof root.response.content === 'string') out = root.response.content;
      return out;
    };
    const extractThinking = () => {
      let out = '';
      for (const fragment of fragmentsOf()) {
        if (String(fragment?.type || '').toUpperCase() === 'THINK' && typeof fragment.content === 'string') {
          out += fragment.content;
        }
      }
      return out;
    };
    const emitDelta = (type, text) => {
      if (!text || typeof onDelta !== 'function') return;
      try { onDelta({ type, text }); } catch { /* A UI callback must not interrupt the response. */ }
    };
    /** 把「当前完整文本」与「已推送文本」做前缀差分，只推送新增部分。 */
    let emittedSources = '', processState = new Map(), previousProcessIds = [];
    const emitProcess = value => { try { onProcess?.(value); } catch { /* A view must not interrupt completion. */ } };
    const syncProcess = () => {
      if (typeof onProcess !== 'function') return;
      const steps = messageProcessSteps(root.response), ids = steps.map(step => step.id);
      const reset = previousProcessIds.some((id, index) => ids[index] !== id);
      if (reset) { emitProcess({ type: 'process-reset', steps }); processState = new Map(); }
      for (const step of steps) {
        const { text = '', ...metadata } = step;
        const meta = JSON.stringify(metadata), previous = processState.get(step.id);
        if (!reset) {
          if (!previous) emitProcess({ type: 'process-step', step });
          else {
            if (meta !== previous.meta) emitProcess({ type: 'process-step', step: { ...metadata, elapsedMs: step.elapsedMs ?? null } });
            if (text !== previous.text) emitProcess({ type: 'process-text', id: step.id,
              text: text.startsWith(previous.text) ? text.slice(previous.text.length) : text, replace: !text.startsWith(previous.text) });
          }
        }
        processState.set(step.id, { text, meta });
      }
      previousProcessIds = ids;
    };
    const syncDeltas = () => {
      syncProcess();
      const text = extractText();
      if (text.length > emittedText.length) {
        if (text.startsWith(emittedText)) emitDelta('text', text.slice(emittedText.length));
        emittedText = text;
      }
      const thinkingText = extractThinking();
      if (thinkingText.length > emittedThinking.length) {
        if (thinkingText.startsWith(emittedThinking)) emitDelta('thinking', thinkingText.slice(emittedThinking.length));
        emittedThinking = thinkingText;
      }
      const results = extractSearchResults(root.response);
      const signature = JSON.stringify(results);
      if ((results.length || emittedSources) && signature !== emittedSources) {
        emittedSources = signature;
        try { onDelta?.({ type: 'search', results }); } catch { /* A view must not interrupt completion. */ }
      }
    };

    /** 应用一条路径补丁（含 BATCH 递归、fragments 负索引）。 */
    const apply = (path, op, value) => {
      const p = String(path ?? '');
      const o = String(op ?? 'SET').toUpperCase();
      if (o === 'BATCH') {
        if (Array.isArray(value)) {
          for (const sub of value) {
            if (sub && typeof sub === 'object') apply(joinPath(p, sub.p), sub.o ?? 'SET', sub.v);
          }
        }
        return;
      }
      // 新 fragment 开始：APPEND 一个数组到 response/fragments
      if (p === 'response/fragments' && o === 'APPEND' && Array.isArray(value)) {
        const list = Array.isArray(root.response.fragments) ? root.response.fragments : (root.response.fragments = []);
        for (const fragment of value) {
          if (fragment && typeof fragment === 'object') list.push({ ...fragment });
        }
        // 之后的裸 token 归到新片段（文档 §4.5 重建算法）
        currentPath = 'response/fragments/-1/content';
        currentOp = 'APPEND';
        syncDeltas();
        return;
      }
      this.#applyNode(root, p, o, value);
      if (p === 'response' || p === 'response/content' || p.startsWith('response/fragments') || p.endsWith('/content')) {
        syncDeltas();
      }
    };

    for await (const frame of this.#sseFrames(handle, signal)) {
      if (!frame) continue;
      const eventName = String(frame.event || 'message');
      const data = frame.data;

      if (eventName === 'done') { sawFinish = true; break; }
      if (eventName === 'close') break;
      if (!data || typeof data !== 'object') continue;

      // 任何帧里出现会话 id 都记下来（新建会话时用于确定 chat_session_id）
      const sid =
        data.chat_session_id || data.session_id || data.chat_session?.id || data.response?.chat_session_id;
      if (typeof sid === 'string' && sid) sseSessionId = sid;

      if (eventName === 'ready') {
        if (Number.isFinite(Number(data.response_message_id))) messageId = Number(data.response_message_id);
        if (Number.isSafeInteger(Number(data.request_message_id)) && Number(data.request_message_id) > 0) requestMessageId = Number(data.request_message_id);
        continue;
      }
      if (eventName === 'update_session') continue; // updated_at 等元信息，不影响正文
      if (eventName === 'title') {
        if (typeof data.content === 'string') title = data.content;
        continue;
      }
      if (eventName === 'finish') {
        sawFinish = true;
        continue;
      }
      if (eventName === 'hint' || eventName === 'toast') {
        if (isErrorFrame(data)) throw streamFrameError(data, eventName);
        continue; // 非错误提示（版本提示等）忽略，不打断生成
      }

      // 其余都按 message（默认事件）处理
      const event = data;
      // 1) 初始快照：{"v":{"response":{...}}}
      if (event.v && typeof event.v === 'object' && event.v.response && typeof event.v.response === 'object') {
        apply('response', 'SET', event.v.response);
        currentPath = 'response/fragments/-1/content';
        currentOp = 'APPEND';
        continue;
      }
      // 2) 路径补丁：{"p":...,"o":...,"v":...}（o 缺省沿用上一条）
      if ('p' in event) {
        currentPath = String(event.p ?? '');
        currentOp = String(event.o ?? currentOp).toUpperCase();
        apply(currentPath, currentOp, event.v);
        continue;
      }
      // 3) 裸 token：{"v":"..."}，沿用上一条 p/o
      if ('v' in event) {
        const value = event.v;
        if (typeof value === 'string') {
          if (/^response\/fragments(\/-\d+\/content)?$/.test(currentPath)) {
            const list = Array.isArray(root.response.fragments)
              ? root.response.fragments
              : (root.response.fragments = []);
            if (list.length === 0) list.push({ id: null, type: 'RESPONSE', content: '' });
            apply('response/fragments/-1/content', currentOp === 'SET' ? 'SET' : 'APPEND', value);
          } else {
            // 文档 §4.5：裸 token 一律追加到正文（path 为空 / response/content）
            apply('response/content', 'APPEND', value);
          }
        }
        continue;
      }
      // 其他形态（未知控制帧）忽略，不能中断解析
    }

    const reply = extractText();
    const thinking = extractThinking();
    const usageRaw = Number(root.response.accumulated_token_usage);
    const usage = Number.isFinite(usageRaw) ? usageRaw : 0;
    const status = String(root.response.status || 'WIP');
    if (!sawFinish && status !== 'FINISHED') {
      throw new DeepSeekWebError('回复尚未结束，连接已关闭。请刷新网页会话确认完整结果后再发送。', {
        code: 'incomplete_stream', body: { messageId, status },
      });
    }
    if (messageId == null) {
      const snapshotId = Number(root.response.message_id);
      if (Number.isFinite(snapshotId)) messageId = snapshotId;
    }
    if (!title && typeof root.response.title === 'string') title = root.response.title;
    if (requestMessageId == null && Number.isSafeInteger(Number(root.response.parent_id)) && Number(root.response.parent_id) > 0) requestMessageId = Number(root.response.parent_id);
    return {
      reply,
      thinking,
      searchResults: extractSearchResults(root.response),
      processSteps: messageProcessSteps(root.response),
      thinkingMs: processThinkingMs(messageProcessSteps(root.response)),
      usage,
      status,
      messageId,
      requestMessageId,
      sessionId: sseSessionId,
      title,
      sawFinish,
    };
  }

  /** 通用状态树写节点：支持对象/数组、负索引、APPEND 字符串或数组、SET 合并。 */
  #applyNode(root, path, op, value) {
    const segments = String(path || '')
      .split('/')
      .filter((segment) => segment !== '');
    if (segments.length === 0) {
      if (value && typeof value === 'object' && !Array.isArray(value)) Object.assign(root, value);
      return;
    }
    let node = root;
    for (let i = 0; i < segments.length - 1; i++) {
      node = this.#descend(node, segments[i], segments[i + 1]);
      if (!node) return; // 路径不存在：忽略（不能中断解析）
    }
    let key = segments[segments.length - 1];
    if (Array.isArray(node)) {
      const index = Number(key);
      if (!Number.isInteger(index)) return;
      key = index < 0 ? node.length + index : index;
      if (key < 0) return;
    }
    const old = node[key];
    if (op === 'APPEND') {
      if (Array.isArray(old)) {
        node[key] = old.concat(Array.isArray(value) ? value : [value]);
      } else if (typeof old === 'string' && typeof value === 'string') {
        node[key] = old + value;
      } else if (value !== undefined) {
        node[key] = value;
      }
      return;
    }
    // SET
    if (Array.isArray(old) && Array.isArray(value)) {
      node[key] = value.slice();
      return;
    }
    if (old && typeof old === 'object' && !Array.isArray(old) && value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(old, value);
      return;
    }
    if (value !== undefined) node[key] = value;
  }

  /** 沿路径下钻并自动创建中间容器；数组支持负索引。 */
  #descend(node, segment, nextSegment) {
    if (!node || typeof node !== 'object') return null;
    let key = segment;
    if (Array.isArray(node)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return null;
      key = index < 0 ? node.length + index : index;
      if (key < 0) return null;
    }
    let next = node[key];
    if (!next || typeof next !== 'object') {
      next = /^-?\d+$/.test(String(nextSegment ?? '')) ? [] : {};
      node[key] = next;
    }
    return next;
  }

  /** 把 SSE 字节流解析成 {event, data} 帧（文档 §4.3）。 */
  async *#sseFrames(handle, signal) {
    const body = handle.res?.body;
    if (!body) return;
    const decoder = new TextDecoder();
    const parser = createSseFrameParser();
    let buffer = '';
    const toFrame = (frame) => {
      const raw = String(frame.raw ?? '').trim();
      if (!raw) return null;
      if (raw === '[DONE]') return { event: 'done', data: null }; // 防御性哨兵（文档 §4.3）
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new DeepSeekWebError(`SSE 帧不是合法 JSON：${truncate(raw, 200)}`, {
          code: 'bad_stream',
          body: truncate(raw, 1_000),
        });
      }
      return { event: frame.event || 'message', data };
    };
    try {
      for await (const chunk of body) {
        buffer += decoder.decode(chunk, { stream: true });
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          const frame = parser.pushLine(line);
          if (!frame) continue;
          const parsed = toFrame(frame);
          if (parsed) yield parsed;
        }
      }
      buffer += decoder.decode();
      if (buffer) {
        const frame = parser.pushLine(buffer);
        if (frame) {
          const parsed = toFrame(frame);
          if (parsed) yield parsed;
        }
      }
      const last = parser.end();
      if (last) {
        const parsed = toFrame(last);
        if (parsed) yield parsed;
      }
    } catch (err) {
      throw this.#convertError(err, handle, signal);
    }
  }
}
