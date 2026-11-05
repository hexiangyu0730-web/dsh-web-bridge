// @xueray/dsh-web-bridge —— Host
//
// 把 chat.deepseek.com 网页端（非官方接口）的对话拉进 DSH，并在两边继续：
//   * 只读能力：列出网页端会话、读取完整历史（仍受上游条款与限流约束）
//   * 导入能力：把网页对话变成本机真实的 DSH 会话历史（seed），或注入当前会话上下文
//   * 续写能力：把一条消息写回网页端会话并取回回复（依赖网页端非公开接口，有风控风险）
//
// Public integration notes: docs/usage.md and THIRD_PARTY_NOTICES.md.
// 本文件不 import 任何 @deepseek-ai 包（零依赖），因此不需要 peerDependencies。

import { randomUUID } from "node:crypto";
import { createWorkspaceArchive, stageAttachment } from "./workspace-files.js";

import {
  DeepSeekWebApi,
  DeepSeekWebError,
  messagesToMarkdown,
  normalizeToken,
  normalizeFileIds,
  MAX_FILE_BYTES
} from "./deepseek-api.js";

export const name = "@xueray/dsh-web-bridge";

// 服务依赖：webServer 提供同源 HTTP 路由，tools 注册模型可见工具，
// credentials 存网页端 token，agents/agentDefaultModel 负责导入成真实会话，
// systemPrompt 负责「导入到当前会话」的上下文注入，workingDirectory 提供会话 cwd。
export const inject = [
  "webServer",
  "tools",
  "credentials",
  "agents",
  "agentDefaultModel",
  "systemPrompt",
  "workingDirectory",
  "sessions",
  "workspaceRegistry",
  "sessionPersistence"
];

const VERSION = "0.4.5";
const CAPABILITIES = { upload: true, imagePreview: true, newConversation: true, streaming: true, processSteps: true, regenerate: true, branches: true, importAttachments: true, workspaceFiles: true, deleteConversation: true, renameConversation: true };
const TOKEN_REF = "DEEPSEEK_WEB_TOKEN";
const MAX_BODY_BYTES = 256 * 1024;
// 注入当前会话的历史上限：超出会显著挤占上下文窗口，宁可拒绝也不悄悄截断。
const MAX_CONTEXT_CHARS = 200_000;
const DEFAULT_BASE_URL = "https://chat.deepseek.com";

// 记录导入进「当前会话」的上下文：dshSessionId -> { title, text, importedAt }
const importedContextBySession = new Map();
// 本插件创建并保活的 Agent handle：插件卸载时统一 dispose
const ownedAgentHandles = new Set();
// Reject simultaneous writes to a web thread instead of creating sibling branches.
const pendingWebSessions = new Set();

function errorWithStatus(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isLoopbackAddress(address) {
  const value = String(address || "").toLowerCase().split("%")[0];
  if (value === "::1" || value === "0:0:0:0:0:0:0:1") return true;
  if (value.startsWith("127.") || value.startsWith("::ffff:127.")) return true;
  return /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(value);
}

function remoteAccessEnabled() {
  return /^(1|true|yes)$/i.test(String(process.env.DSH_DEEPSEEK_WEB_ALLOW_REMOTE || ""));
}

function assertSameOrigin(req) {
  const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw errorWithStatus(403, "cross-origin request denied");
  }
  const origin = req.headers.origin;
  if (origin) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch (_) {
      throw errorWithStatus(403, "invalid origin");
    }
    if (!req.headers.host || parsed.host !== req.headers.host) {
      throw errorWithStatus(403, "origin does not match host");
    }
  }
}

function assertLocalRequest(req) {
  if (!remoteAccessEnabled() && !isLoopbackAddress(req.socket && req.socket.remoteAddress)) {
    throw errorWithStatus(403, "remote access is disabled; use the DSH Web UI on this machine");
  }
  assertSameOrigin(req);
}

function json(res, statusCode, value) {
  if (res.writableEnded) return;
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(JSON.stringify(value));
}

function methodAllowed(req, res, expected) {
  if (req.method === expected) return true;
  res.writeHead(405, { allow: expected, "cache-control": "no-store" });
  res.end();
  return false;
}

async function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw errorWithStatus(413, "request body too large");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_) {
    throw errorWithStatus(400, "invalid JSON body");
  }
}

function normalizeSessionId(value) {
  const id = String(value == null ? "" : value).trim();
  if (!id || id.length > 200 || /[\u0000-\u001f\u007f]/.test(id)) {
    throw errorWithStatus(400, "invalid sessionId");
  }
  return id;
}

function toIsoTime(value) {  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  const millis = number > 1e12 ? number : number * 1000;
  try {
    return new Date(millis).toISOString();
  } catch (_) {
    return null;
  }
}

// 网页端 message_id 是数字；工具参数/HTTP body 里可能是字符串，统一转成数字再回写接口。
function coerceMessageId(value) {  if (value == null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function tokenHint(token) {  const value = String(token || "");
  if (!value) return "";
  if (value.length <= 8) return "****";
  return value.slice(0, 3) + "…" + value.slice(-4);
}

// 网页端的联网搜索引用不是正文 fragment，单独格式化成文字，导入后模型仍能看到参考来源。
function searchRefsText(refs) {
  const items = Array.isArray(refs)
    ? refs.filter((item) => item && (item.title || item.url))
    : [];
  if (!items.length) return "";
  const lines = items.map((item, index) => {
    const title = String(item.title || item.url || "").trim();
    const url = String(item.url || "").trim();
    const snippet = String(item.snippet || "")
      .replace(/\s+/g, " ")
      .trim();
    const head = title + (url && title !== url ? " — " + url : "");
    return index + 1 + ". " + head + (snippet ? "\n   " + snippet : "");
  });
  return "[联网搜索参考]\n" + lines.join("\n");
}

/** 把网页端历史归一化成导入用 transcript（默认带上思维链与联网搜索参考）。 */
export function toTranscript(messages, options = {}) {
  const includeThinking = options.includeThinking !== false;
  const transcript = [];
  for (const message of messages || []) {
    const role = message.role === "assistant" ? "assistant" : message.role === "user" ? "user" : null;
    if (!role) continue;
    let text = String(message.text || "").trim();
    const thinking = includeThinking ? String(message.thinking || "").trim() : "";
    const refs = searchRefsText(message.searchResults);
    if (refs) text = text ? text + "\n\n" + refs : refs;
    const files = Array.isArray(message.files) ? message.files : [];
    if (!text && !thinking && !files.length) continue;
    if (files.length && text === "（仅附件，无文字）") text = "";
    const item = { role, text };
    if (thinking) item.thinking = thinking;
    if (files.length) item.files = files;
    transcript.push(item);
  }
  // 网页端对话通常以 user 开头；若首条是 assistant（例如续写场景），保留但仍在 seed 里合法。
  return transcript;
}

function formatTranscriptText(transcript) {
  return transcript
    .map((item) => {
      const label = item.role === "user" ? "### 用户\n" : "### DeepSeek\n";
      const thinking = item.thinking
        ? "\n<details><summary>思考过程</summary>\n\n" + item.thinking + "\n\n</details>\n"
        : "";
      const files = (item.files || []).map((file) => "[附件：" + file.name + "]").join("\n");
      return label + thinking + item.text + (files ? "\n" + files : "");
    })
    .join("\n\n");
}

function textMessage(text, attachments = []) {
  return {
    id: randomUUID(),
    role: "user",
    content: [...attachments, ...(text ? [{ type: "text", text }] : [])],
    source: { kind: "user" }
  };
}

function assistantMessage(text, provider, model, thinking, attachments = []) {
  const content = [];
  const reasoning = String(thinking || "").trim();
  if (reasoning) content.push({ type: "reasoning", text: reasoning });
  content.push({ type: "text", text: String(text || "") });
  content.push(...attachments);
  return {
    id: randomUUID(),
    role: "assistant",
    content,
    source: { kind: "model", provider, model }
  };
}

/**
 * 构造带预置 user/assistant 消息的 Session seed。
 * 事件形状的硬约束见 research/dsh-plugin-apis.md §3.2：
 * seq 连续、只允许固定键、表面消息必须 surfaceOp:'append'、
 * assistant.message.source 必须 { kind:'model', provider, model }。
 */
export function buildSeed(transcript, provider, model, title = "") {
  const events = [];
  const now = Date.now();
  let seq = 0;
  let turn = 0;
  let step = 0;
  let openTurn = false;
  const push = (type, data, surfaceOp) => {
    const event = { type, seq: seq++, time: now, data };
    if (surfaceOp !== undefined) event.surfaceOp = surfaceOp;
    events.push(event);
  };
  for (const item of transcript) {
    if (item.role === "user") {
      if (openTurn) {
        push("step/end", { turn, step });
        push("turn/end", { turn, reason: { kind: "completed" } });
      }
      turn += 1;
      step = 1;
      openTurn = true;
      push("turn/start", { turn });
      push("step/start", { turn, step });
      push("user/message", textMessage(item.text, item.attachments), "append");
    } else {
      push(
        "assistant/message",
        {
          turn,
          step,
          message: assistantMessage(item.text, provider, model, item.thinking, item.attachments),
          stream: []
        },
        "append"
      );
      if (openTurn) {
        push("step/end", { turn, step });
        push("turn/end", { turn, reason: { kind: "completed" } });
        openTurn = false;
      }
    }
  }
  if (openTurn) {
    push("step/end", { turn, step });
    push("turn/end", { turn, reason: { kind: "completed" } });
  }
  const importedTitle = String(title || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (importedTitle) push("session/title", { title: importedTitle, messageSeqs: [], source: { kind: "user" } });
  return events;
}

function currentModelSelection(ctx) {
  try {
    const selection = ctx.agentDefaultModel.currentSelection();
    if (!selection || typeof selection !== "object") return undefined;
    const provider = typeof selection.provider === "string" ? selection.provider : undefined;
    const model = typeof selection.model === "string" ? selection.model : undefined;
    if (!provider || !model) return undefined;
    return {
      provider,
      model,
      ...(typeof selection.reasoningEffort === "string"
        ? { reasoningEffort: selection.reasoningEffort }
        : {})
    };
  } catch (_) {
    return undefined;
  }
}

function toolText(text) {
  return [{ type: "text", text: String(text) }];
}

function renderSessionList(value) {
  if (!value.sessions.length) return toolText("DeepSeek 网页端没有返回会话。");
  const lines = value.sessions.map((item, index) => {
    const pinned = item.pinned ? " [置顶]" : "";
    const time = item.updatedAt || "未知时间";
    return `${index + 1}. ${item.title || "(无标题)"}${pinned}  ${time}\n   id: ${item.id}`;
  });
  return toolText(
    `DeepSeek 网页端会话（${value.sessions.length} 条${value.hasMore ? "，还有更多" : ""}）：\n\n` +
      lines.join("\n")
  );
}

export function apply(ctx) {
  // ---------------------------------------------------------------------------
  // token 与 API client
  // ---------------------------------------------------------------------------

  async function getToken() {
    const hit = await ctx.credentials.resolve(TOKEN_REF);
    const value = hit && typeof hit.value === "string" ? hit.value.trim() : "";
    return value || undefined;
  }

  async function requireToken() {
    const token = await getToken();
    if (token) return token;
    let configured = false;
    try {
      const info = await ctx.credentials.describe(TOKEN_REF);
      configured = Boolean(info && info.configured);
    } catch (_) {
      /* describe 失败不阻断报错信息 */
    }
    throw new Error(
      (configured ? `${TOKEN_REF} 解析为空。` : `${TOKEN_REF} 尚未配置。`) +
        "请在 DSH 设置 → 插件 → DeepSeek 网页对话 里填入 chat.deepseek.com 的 userToken" +
        "（登录网页端后，浏览器控制台执行 JSON.parse(localStorage.getItem('userToken')).value），" +
        "或在 $DSH_HOME/.credentials.yaml 的 refs 下添加该变量，然后重试。"
    );
  }

  function baseUrl() {
    const override = String(process.env.DSH_DEEPSEEK_WEB_BASE_URL || "").trim();
    return override || DEFAULT_BASE_URL;
  }

  let cachedClient = null, cachedToken = "", cachedBase = "";
  function clearClient() { cachedClient = null; cachedToken = ""; cachedBase = ""; }
  async function createClient() {
    const token = await requireToken();
    const base = baseUrl();
    if (!cachedClient || token !== cachedToken || base !== cachedBase) {
      cachedClient = new DeepSeekWebApi({ token, baseUrl: base });
      cachedToken = token; cachedBase = base;
    }
    return cachedClient;
  }

  async function continueWebConversation({ sessionId, parentMessageId, childMessageId, prompt, fileIds = [], thinking, search, signal, onDelta, onProcess }) {
    const api = await createClient();
    if (!sessionId) return api.createSession({ prompt, fileIds, thinking, search, signal, onDelta, onProcess });
    if (pendingWebSessions.has(sessionId)) {
      throw errorWithStatus(409, "这条网页会话正在生成回复，请等待完成后再发送。");
    }
    pendingWebSessions.add(sessionId);
    try {
      let parent = coerceMessageId(parentMessageId);
      const history = await api.getHistory(sessionId, { signal });
      if (childMessageId != null) {
        const answer = (history.messages || []).find(message => message.role === "assistant" && String(message.id) === String(childMessageId));
        const question = (history.messages || []).find(message => message.role === "user" && String(message.id) === String(answer?.parentId));
        if (!answer || !question) throw errorWithStatus(400, "未找到这条回答及原问题，请刷新会话。");
        if (answer.banRegenerate || ["WIP", "CONTENT_FILTER", "CONTEXT_LENGTH_EXCEEDED"].includes(answer.status)) throw errorWithStatus(409, "这条回答目前不支持重新生成。");
        return await api.regenerateSession({ sessionId, childMessageId: Number(childMessageId), thinking, search, signal, onDelta, onProcess });
      }
      if (parent != null) {
        if (!Number.isSafeInteger(parent) || parent <= 0 || !(history.messages || []).some(message => message.role === "assistant" && Number(message.id) === parent)) {
          throw errorWithStatus(400, "选中的回答已不可用，请刷新会话后再继续。");
        }
      } else {
        // The same account may be used in the web app or another DSH page.
        // Resolve the current server-side tail for every implicit continuation.
        const selected = (history.messages || []).find(message => message.role === "assistant" && Number(message.id) === Number(history.currentMessageId));
        if (selected) parent = coerceMessageId(selected.id);
        for (const message of [...(history.messages || [])].reverse()) {
          if (parent != null) break;
          if (message.role === "assistant" && message.id != null) {
            parent = coerceMessageId(message.id);
            break;
          }
        }
      }
      return await api.continueSession({ sessionId, parentMessageId: parent, prompt, fileIds, thinking, search, signal, onDelta, onProcess });
    } finally {
      pendingWebSessions.delete(sessionId);
    }
  }

  function mapError(error) {
    if (error instanceof DeepSeekWebError) {
      const status = error.code === "rate_limited" ? 429 : error.status && error.status >= 400 && error.status < 600 ? error.status : 502;
      return { status: status === 401 ? 401 : status, message: error.message, code: error.code };
    }
    const status = error && error.statusCode ? error.statusCode : 500;
    return { status, message: String((error && error.message) || error), code: error && error.code };
  }

  // ---------------------------------------------------------------------------
  // 导入：网页对话 -> 真实 DSH 会话（seed，失败退化为单条消息）
  // ---------------------------------------------------------------------------

  // 导入会话应归入用户当前所在的项目目录（workspace 按 cwd 分组），
  // 而不是插件进程的默认目录；拿不到就退回默认目录。
  function cwdOfSession(sessionId) {
    if (!sessionId) return undefined;
    try {
      const session = ctx.sessions.get(sessionId);
      if (!session) return undefined;
      const directory = ctx.workingDirectory.get(session);
      return typeof directory === "string" && directory ? directory : undefined;
    } catch (_) {
      return undefined;
    }
  }

  function cwdOfSkillAgent(agent) {
    try {
      if (!agent || !agent.session) return undefined;
      const directory = ctx.workingDirectory.get(agent.session);
      return typeof directory === "string" && directory ? directory : undefined;
    } catch (_) {
      return undefined;
    }
  }

  function isAbsolutePath(value) {
    return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value) || /^\//.test(value);
  }

  // UI 拖拽投放时带 workspaceId（Host 由注册表解析路径）；工具调用可带 cwd；
  // 否则退回当前 DSH 会话目录（最终由 createImportedSession 退回默认目录）。
  async function resolveImportCwd({ workspaceId, cwd, dshSessionId } = {}) {
    if (workspaceId) {
      const workspace = ctx.workspaceRegistry.get(String(workspaceId));
      if (!workspace) throw errorWithStatus(404, `未知工作区：${workspaceId}`);
      const status = await workspace.status();
      if (status === "missing-dir") throw errorWithStatus(409, `工作区目录不存在：${workspace.path}`);
      return workspace.path;
    }
    const explicit = typeof cwd === "string" ? cwd.trim() : "";
    if (explicit) {
      if (!isAbsolutePath(explicit)) throw errorWithStatus(400, "cwd must be an absolute path");
      return explicit;
    }
    return cwdOfSession(dshSessionId);
  }

  // 新建的会话不会自动进入 workspace 的 sessionIds 账本（那只在会话发布路径里更新），
  // 显式 attach 一次，侧边栏才会把它显示在对应工作区下面。
  async function attachToWorkspace(sessionId, workspaceId, cwd) {
    try {
      let workspace = workspaceId ? ctx.workspaceRegistry.get(String(workspaceId)) : undefined;
      if (!workspace && cwd) {
        workspace = await ctx.workspaceRegistry.resolveByPath(cwd).catch(() => undefined);
      }
      if (!workspace) return false;
      const ids = Array.isArray(workspace.sessionIds) ? workspace.sessionIds.map(String) : [];
      if (ids.indexOf(String(sessionId)) < 0) await workspace.attachSession(sessionId);
      return true;
    } catch (_) {
      return false;
    }
  }

  async function createImportedSession(transcript, title, cwdOverride) {
    const selection = currentModelSelection(ctx);
    const provider = selection ? selection.provider : "deepseek-account";
    const model = selection ? selection.model : "deepseek-chat";
    const sessionId = "deepseek-web-" + randomUUID();
    let cwd = typeof cwdOverride === "string" && cwdOverride ? cwdOverride : undefined;
    if (!cwd) {
      try {
        cwd = ctx.workingDirectory.defaultDirectory;
      } catch (_) {
        cwd = undefined;
      }
    }
    const meta = { isSeeded: true };
    if (typeof cwd === "string" && cwd) meta.cwd = cwd;

    const seed = buildSeed(transcript, provider, model, title);
    try {
      const handle = await ctx.agents.create({
        sessionId,
        seed,
        meta,
        inheritedEventCount: seed.length,
        ...(selection ? { agentOptions: selection } : {})
      });
      ownedAgentHandles.add(handle);
      return { sessionId, mode: "seed", handle };
    } catch (seedError) {
      // 退化路径：只用公开 API 建会话，再以一条 user 消息承载全文。
      const handle = await ctx.agents.create({
        sessionId: "deepseek-web-" + randomUUID(),
        meta: typeof cwd === "string" && cwd ? { cwd } : {},
        ...(selection ? { agentOptions: selection } : {})
      });
      ownedAgentHandles.add(handle);
      const titleEvent = seed.find((event) => event.type === "session/title");
      if (titleEvent && handle.agent.session) handle.agent.session.append("session/title", titleEvent.data);
      const intro =
        "下面是我从 DeepSeek 网页端导入的一段历史对话" +
        (title ? `（原会话标题：${title}）` : "") +
        "。请把它当作上下文背景，等我下一条消息时再接着聊，不要现在就总结或复述它。\n\n" +
        formatTranscriptText(transcript);
      handle.agent.followup(textMessage(intro, transcript.flatMap((item) => item.attachments || [])));
      return { sessionId: handle.agent.id, mode: "message", handle, seedError };
    }
  }

  async function importTranscriptAttachments(transcript, api, signal, { cwd, sessionId } = {}) {
    let store;
    try { store = typeof ctx.get === "function" ? ctx.get("attachments") : ctx.attachments; } catch (_) { /* Optional on old deployments. */ }
    const cache = new Map(), report = { found: 0, imported: 0, images: 0, files: 0, failures: [] };
    if (transcript.some((item) => item.files?.length)) Object.assign(report, {
      workspaceSaved: 0, workspaceDirectory: "", workspaceFailures: [], workspaceFiles: []
    });
    let archivePromise;
    const archive = () => archivePromise || (archivePromise = createWorkspaceArchive(cwd, sessionId));
    let totalBytes = 0;
    for (const item of transcript) {
      item.attachments = [];
      for (const file of item.files || []) {
        signal?.throwIfAborted();
        if (!cache.has(file.id)) {
          report.found++;
          const entry = { block: null, local: null };
          cache.set(file.id, entry);
          let stage;
          try {
            const name = String(file.name || "attachment").replace(/[\\/\u0000-\u001f\u007f]/g, "_").slice(0, 240) || "attachment";
            let image;
            const countBytes = async function* (data) {
              for await (const chunk of data) {
                totalBytes += chunk.byteLength;
                if (totalBytes > 500 * 1024 * 1024) throw new Error("本次附件导入超过 500 MiB 上限");
                yield chunk;
              }
            };
            if (file.isImage) {
              image = await api.getImage(file.id, { signal, original: true });
              stage = await stageAttachment(countBytes([image.bytes]), { signal });
            } else {
              const source = await api.openFile(file.id, { signal });
              try { stage = await stageAttachment(countBytes(source.data), { signal }); }
              finally { await source.dispose(); }
            }
            try {
              const destination = await archive();
              report.workspaceDirectory = destination.directory;
              entry.local = await destination.save(stage, file.name, signal);
              report.workspaceSaved++;
              report.workspaceFiles.push({ id: file.id, ...entry.local });
            } catch (error) {
              signal?.throwIfAborted();
              report.workspaceFailures.push({ name: file.name, error: String(error.message || error) });
            }
            if (!store) throw new Error("当前 DSH 没有可用的附件存储服务");
            let attachment, type = file.isImage ? "image" : "file";
            if (file.isImage) attachment = await store.saveImage({ data: new Uint8Array(image.bytes), mediaType: image.contentType, name });
            else {
              if (typeof store.saveFileStream !== "function") throw new Error("当前 DSH 不支持流式保存文件附件");
              attachment = await store.saveFileStream({ data: stage.read(), name, signal });
            }
            if (!attachment || typeof attachment.attachmentId !== "string") throw new Error("DSH 未返回有效的本地附件引用");
            entry.block = { type, attachment };
            report.imported++; report[type === "image" ? "images" : "files"]++;
          } catch (error) {
            signal?.throwIfAborted();
            report.failures.push({ name: file.name, error: String(error.message || error) });
          } finally { if (stage) await stage.dispose(); }
        }
        const entry = cache.get(file.id);
        if (entry.local) item.text += (item.text ? "\n\n" : "") + "[本地附件：" + entry.local.path + "]";
        if (entry.block) item.attachments.push(entry.block);
        else item.text += (item.text ? "\n\n" : "") + "[附件未导入：" + String(file.name || file.id) + "]";
      }
    }
    return report;
  }

  function contextAttachmentReport(transcript) {
    const files = new Map(transcript.flatMap((item) => (item.files || []).map((file) => [file.id, file])));
    return { found: files.size, imported: 0, images: 0, files: 0,
      failures: [...files.values()].map((file) => ({ name: file.name, error: "当前会话上下文仅支持文本；请导入到工作区以保留附件" })) };
  }

  function setImportedContext(sessionId, title, transcript) {
    const text =
      "以下内容由用户在 DSH 设置中从 DeepSeek 网页端导入，作为本会话的背景上下文" +
      (title ? `（原会话标题：${title}）` : "") +
      "。用户后续提问可能直接引用其中内容：\n\n" +
      formatTranscriptText(transcript);
    if (text.length > MAX_CONTEXT_CHARS) {
      throw errorWithStatus(
        413,
        `这段对话约 ${text.length} 字符，超过可注入上限 ${MAX_CONTEXT_CHARS} 字符；请改用「导入到新会话」。`
      );
    }
    importedContextBySession.set(String(sessionId), {
      title: title || "",
      text,
      importedAt: Date.now()
    });
    try {
      ctx.emit("system-prompt/change");
    } catch (_) {
      /* 事件名不存在时忽略 */
    }
    return text.length;
  }

  // 被导入的上下文在每一步组装 prompt 时注入到「当前会话」。
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: "user:deepseek-web-import",
        order: 55,
        interpolate: false,
        text: (context) => {
          const id =
            context &&
            context.agent &&
            context.agent.session &&
            context.agent.session.header &&
            context.agent.session.header.id;
          if (id == null) return "";
          const entry = importedContextBySession.get(String(id));
          return entry ? entry.text : "";
        }
      }),
    "dsh-deepseek-web: imported conversation context"
  );

  // ---------------------------------------------------------------------------
  // 工具
  // ---------------------------------------------------------------------------

  ctx.effect(
    () =>
      ctx.tools.register({
        name: "deepseek_web_sessions",
        description:
          "List conversations from the user's DeepSeek web account (chat.deepseek.com), newest first. " +
          "Read-only; returns id/title/updated time for each conversation. Use deepseek_web_read with an id to read one.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: {
              type: "integer",
              description: "How many conversations to return (1-100, default 30)."
            },
            cursor: {
              type: "number",
              description: "Pagination cursor from a previous call's nextCursor (updated_at of the last row)."
            }
          }
        },
        output: {
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["count", "sessions", "hasMore", "nextCursor"],
            properties: {
              count: { type: "integer" },
              hasMore: { type: "boolean" },
              nextCursor: { type: "number", description: "0 when there is no next page." },
              sessions: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "title", "updatedAt", "pinned"],
                  properties: {
                    id: { type: "string" },
                    title: { type: "string" },
                    updatedAt: { type: "string", description: "ISO time, empty when unknown." },
                    pinned: { type: "boolean" },
                    modelType: { type: "string", description: "Empty when unknown." }
                  }
                }
              }
            }
          },
          render: (_args, value) => renderSessionList(value)
        },
        async execute(args) {
          const limit = Math.max(1, Math.min(100, Number(args && args.limit) || 30));
          const cursor = Number.isFinite(Number(args && args.cursor)) ? Number(args.cursor) : null;
          const api = await createClient();
          const page = await api.listSessions({ limit, cursor });
          const sessions = (page.sessions || []).map((item) => ({
            id: String(item.id),
            title: String(item.title || ""),
            updatedAt: toIsoTime(item.updatedAt) || "",
            pinned: Boolean(item.pinned),
            modelType: item.modelType == null ? "" : String(item.modelType)
          }));
          return {
            count: sessions.length,
            sessions,
            hasMore: Boolean(page.hasMore),
            nextCursor:
              page.nextCursor && Number.isFinite(Number(page.nextCursor.updatedAt ?? page.nextCursor))
                ? Number(page.nextCursor.updatedAt ?? page.nextCursor)
                : 0
          };
        }
      }),
    "dsh-deepseek-web: deepseek_web_sessions"
  );

  ctx.effect(
    () =>
      ctx.tools.register({
        name: "deepseek_web_workspaces",
        description:
          "List DSH workspaces (project directories) with id, title, path and session count. " +
          "Pass a workspace path as deepseek_web_import's cwd to copy a web conversation into that workspace.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {}
        },
        output: {
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["count", "workspaces"],
            properties: {
              count: { type: "integer" },
              workspaces: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "title", "path", "sessionCount"],
                  properties: {
                    id: { type: "string" },
                    title: { type: "string" },
                    path: { type: "string" },
                    sessionCount: { type: "integer" }
                  }
                }
              }
            }
          },
          render: (_args, value) =>
            toolText(
              value.workspaces.length
                ? value.workspaces
                    .map(
                      (item, index) =>
                        `${index + 1}. ${item.title || "(无标题)"}  ${item.sessionCount} 个会话\n   id: ${item.id}\n   path: ${item.path}`
                    )
                    .join("\n")
                : "当前 DSH 没有工作区。"
            )
        },
        async execute() {
          const workspaces = listWorkspaces();
          return { count: workspaces.length, workspaces };
        }
      }),
    "dsh-deepseek-web: deepseek_web_workspaces"
  );

  ctx.effect(
    () =>
      ctx.tools.register({
        name: "deepseek_web_read",
        description:
          "Read the full transcript of one DeepSeek web conversation as Markdown. Read-only. " +
          "The returned Markdown is complete context the user may then ask you to continue from.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["sessionId"],
          properties: {
            sessionId: { type: "string", description: "Conversation id from deepseek_web_sessions." },
            includeThinking: {
              type: "boolean",
              description: "Include DeepSeek's reasoning/thinking text when available (default true)."
            }
          }
        },
        output: {
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["sessionId", "title", "messageCount", "markdown"],
            properties: {
              sessionId: { type: "string" },
              title: { type: "string" },
              messageCount: { type: "integer" },
              markdown: { type: "string" }
            }
          },
          render: (_args, value) => toolText(value.markdown)
        },
        async execute(args) {
          const sessionId = normalizeSessionId(args && args.sessionId);
          const includeThinking = args && args.includeThinking === false ? false : true;
          const api = await createClient();
          const history = await api.getHistory(sessionId);
          const markdown = messagesToMarkdown(history.activeMessages || history.messages || [], {
            includeThinking,
            title: history.title
          });
          return {
            sessionId,
            title: String(history.title || ""),
            messageCount: (history.activeMessages || history.messages || []).length,
            markdown
          };
        }
      }),
    "dsh-deepseek-web: deepseek_web_read"
  );

  ctx.effect(
    () =>
      ctx.tools.register({
        name: "deepseek_web_import",
        timeoutMs: 600_000,
        isConcurrencySafe: () => false,
        description:
          "Import a DeepSeek web conversation into DSH as a real, resumable DSH session whose history contains the imported user/assistant turns, " +
          "so the user can continue the conversation inside DSH. Returns the new DSH session id.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["sessionId"],
          properties: {
            sessionId: { type: "string", description: "DeepSeek web conversation id." },
            includeThinking: {
              type: "boolean",
              description:
                "Import DeepSeek's reasoning text too, as assistant reasoning blocks (default true; set false to keep the import smaller)."
            },
            target: {
              type: "string",
              enum: ["new", "current"],
              description:
                "'new' (default) creates a dedicated DSH session; 'current' injects the transcript into the calling session's context."
            },
            cwd: {
              type: "string",
              description:
                "Absolute directory for the new DSH session (a workspace path). Defaults to the calling session's working directory."
            }
          }
        },
        output: {
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["dshSessionId", "messageCount", "title", "mode"],
            properties: {
              dshSessionId: { type: "string" },
              messageCount: { type: "integer" },
              title: { type: "string" },
              mode: { type: "string" },
              note: { type: "string" },
              attachmentReport: { type: "object" }
            }
          },
          render: (_args, value) =>
            toolText(
              (value.mode === "context"
                ? `已把 ${value.messageCount} 条消息导入当前会话上下文（原会话：${value.title || "无标题"}）。用户可以直接继续提问。`
                : `已导入 ${value.messageCount} 条消息到新的 DSH 会话：${value.dshSessionId}` +
                    `（原会话：${value.title || "无标题"}）。请让用户在侧边栏打开该会话继续对话。`) +
                    (value.attachmentReport?.found ? ` 附件：${value.attachmentReport.imported}/${value.attachmentReport.found} 已保存到本地。` +
                      value.attachmentReport.failures.map((file) => ` 未导入：${file.name}（${file.error}）`).join("") +
                      (typeof value.attachmentReport.workspaceSaved === "number" ? ` 工作区原文件：${value.attachmentReport.workspaceSaved}/${value.attachmentReport.found}，目录：${value.attachmentReport.workspaceDirectory || "未创建"}。` +
                        (value.attachmentReport.workspaceFailures || []).map((file) => ` 未保存到工作区：${file.name}（${file.error}）`).join("") : "") : "")
            )
        },
        async execute(args, exec) {
          const sessionId = normalizeSessionId(args && args.sessionId);
          const target = args && args.target === "current" ? "current" : "new";
          const signal = exec && exec.signal;
          const api = await createClient();
          const history = await api.getHistory(sessionId, { signal });
          const transcript = toTranscript(history.activeMessages || history.messages, {
            includeThinking: !(args && args.includeThinking === false)
          });
          if (!transcript.length) throw new Error("该网页会话没有可导入的消息");
          const title = String(history.title || "DeepSeek 网页对话");

          if (target === "current") {
            const currentSessionId =
              exec && exec.agent && exec.agent.session && exec.agent.session.header
                ? exec.agent.session.header.id
                : undefined;
            if (currentSessionId == null) throw new Error("无法确定当前 DSH 会话，请改用 target:'new'");
            setImportedContext(currentSessionId, title, transcript);
            return {
              dshSessionId: String(currentSessionId),
              messageCount: transcript.length,
              title,
              mode: "context",
              attachmentReport: contextAttachmentReport(transcript)
            };
          }

          const requestedCwd = args && args.cwd ? String(args.cwd).trim() : "";
          if (requestedCwd && !isAbsolutePath(requestedCwd)) {
            throw new Error("cwd must be an absolute path");
          }
          const importCwd = requestedCwd || cwdOfSkillAgent(exec && exec.agent);
          const attachmentReport = await importTranscriptAttachments(transcript, api, signal, { cwd: importCwd || ctx.workingDirectory.defaultDirectory, sessionId });
          signal?.throwIfAborted();
          const created = await createImportedSession(transcript, title, importCwd);
          await attachToWorkspace(created.sessionId, null, importCwd);
          return {
            dshSessionId: created.sessionId,
            messageCount: transcript.length,
            title,
            mode: created.mode === "seed" ? "seed" : "message",
            attachmentReport,
            note:
              created.mode === "seed"
                ? "会话历史已逐条写入；用户打开该会话即可接着聊。"
                : "已退化为单条消息承载全文（seed 校验未通过）。"
          };
        }
      }),
    "dsh-deepseek-web: deepseek_web_import"
  );

  ctx.effect(
    () =>
      ctx.tools.register({
        name: "deepseek_web_continue",
        description:
          "Send a message into the user's DeepSeek web account and wait for the reply, writing it into the DeepSeek web conversation history. " +
          "Omit sessionId to start a new web conversation. This uses the reverse-engineered web endpoint: it can be rate limited or muted by DeepSeek.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["prompt"],
          properties: {
            sessionId: {
              type: "string",
              description: "Existing DeepSeek web conversation id; omit to create a new web conversation."
            },
            parentMessageId: {
              type: "string",
              description:
                "Assistant message id the new prompt replies to (defaults to the last assistant message of the conversation)."
            },
            prompt: { type: "string", description: "The message to send." },
            thinking: { type: "boolean", description: "Enable DeepSeek thinking mode (default false)." },
            search: { type: "boolean", description: "Enable web search enrichment (default false)." }
          }
        },
        output: {
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["sessionId", "messageId", "parentMessageId", "reply", "thinking"],
            properties: {
              sessionId: { type: "string" },
              messageId: { type: "string", description: "Empty when the endpoint returned none." },
              parentMessageId: { type: "string", description: "Parent for the next continuation; empty when unknown." },
              reply: { type: "string" },
              thinking: { type: "string" }
            }
          },
          render: (_args, value) => toolText(value.reply || "(网页端没有返回文本回复)")
        },
        isConcurrencySafe: () => false,
        timeoutMs: 240_000,
        async execute(args, exec) {
          const prompt = String((args && args.prompt) || "").trim();
          if (!prompt) throw new Error("prompt must be a non-empty string");
          const thinking = args && args.thinking === true;
          const search = args && args.search === true;
          const signal = exec && exec.signal ? exec.signal : undefined;
          const sessionId = args && args.sessionId ? normalizeSessionId(args.sessionId) : null;
          const result = await continueWebConversation({
            sessionId,
            parentMessageId: args && args.parentMessageId,
            prompt,
            thinking,
            search,
            signal
          });
          return {
            sessionId: String(result.sessionId || sessionId || ""),
            messageId: result.messageId == null ? "" : String(result.messageId),
            parentMessageId: result.parentMessageId == null ? "" : String(result.parentMessageId),
            reply: String(result.reply || ""),
            thinking: String(result.thinking || "")
          };
        }
      }),
    "dsh-deepseek-web: deepseek_web_continue"
  );

  // ---------------------------------------------------------------------------
  // HTTP 路由（Client 面板用；同源 + 本机校验）
  // ---------------------------------------------------------------------------

  async function handleStatus(req, res) {
    if (!methodAllowed(req, res, "GET")) return;
    assertLocalRequest(req);
    const token = await getToken();
    let source = null;
    try {
      const info = await ctx.credentials.describe(TOKEN_REF);
      if (info && info.configured) source = info.source || "stored";
    } catch (_) {
      /* 描述失败按未配置显示 */
    }
    json(res, 200, {
      ok: true,
      version: VERSION,
      capabilities: CAPABILITIES,
      hasToken: Boolean(token),
      tokenHint: tokenHint(token),
      tokenSource: source,
      baseUrl: baseUrl(),
      thinkingDefault: false,
      searchDefault: false
    });
  }

  async function handleToken(req, res) {
    if (!methodAllowed(req, res, "POST")) return;
    assertLocalRequest(req);
    const body = await readJsonBody(req);
    const raw = body && typeof body.token === "string" ? body.token : "";
    if (!raw.trim()) {
      await ctx.credentials.unset(TOKEN_REF);
      clearClient();
      json(res, 200, { ok: true, hasToken: false, tokenHint: "" });
      return;
    }
    let token;
    try {
      token = normalizeToken(raw);
    } catch (error) {
      throw errorWithStatus(400, String((error && error.message) || error));
    }
    await ctx.credentials.set(TOKEN_REF, token);
    clearClient();
    json(res, 200, { ok: true, hasToken: true, tokenHint: tokenHint(token) });
  }

  async function handleSessions(req, res, url) {
    if (!methodAllowed(req, res, "GET")) return;
    assertLocalRequest(req);
    const rawCursor = url.searchParams.get("cursor");
    const cursor = rawCursor != null && rawCursor !== "" ? Number(rawCursor) : null;
    if (cursor != null && !Number.isFinite(cursor)) throw errorWithStatus(400, "invalid cursor");
    const api = await createClient();
    const page = await api.listSessions({ limit: 30, cursor });
    json(res, 200, {
      ok: true,
      sessions: (page.sessions || []).map((item) => ({
        id: String(item.id),
        title: String(item.title || ""),
        pinned: Boolean(item.pinned),
        modelType: item.modelType == null ? null : String(item.modelType),
        updatedAt: toIsoTime(item.updatedAt)
      })),
      hasMore: Boolean(page.hasMore),
      nextCursor:
        page.nextCursor && Number.isFinite(Number(page.nextCursor.updatedAt ?? page.nextCursor))
          ? Number(page.nextCursor.updatedAt ?? page.nextCursor)
          : null
    });
  }

  async function handleHistory(req, res, url) {
    if (!methodAllowed(req, res, "GET")) return;
    assertLocalRequest(req);
    const sessionId = normalizeSessionId(url.searchParams.get("sessionId"));
    const api = await createClient();
    const history = await api.getHistory(sessionId);
    const messages = (history.messages || []).map((item) => ({
      id: String(item.id || ""),
      parentId: item.parentId == null ? null : String(item.parentId),
      role: item.role,
      text: String(item.text || ""),
      thinking: String(item.thinking || ""),
      searchResults: Array.isArray(item.searchResults) ? item.searchResults : [],
      processSteps: Array.isArray(item.processSteps) ? item.processSteps : [],
      thinkingMs: Number.isFinite(item.thinkingMs) ? item.thinkingMs : undefined,
      status: String(item.status || ""),
      banRegenerate: item.banRegenerate === true,
      files: Array.isArray(item.files) ? item.files : [],
      insertedAt: toIsoTime(item.insertedAt)
    }));
    json(res, 200, {
      ok: true,
      session: { id: sessionId, title: String(history.title || ""), currentMessageId: history.currentMessageId == null ? null : String(history.currentMessageId) },
      messages,
      activeMessageIds: (history.activeMessages || history.messages || []).map(message => String(message.id)),
      markdown: messagesToMarkdown(history.activeMessages || history.messages || [], {
        includeThinking: true,
        title: history.title
      })
    });
  }

  function listWorkspaces() {
    let workspaces = [];
    try {
      workspaces = ctx.workspaceRegistry.list() || [];
    } catch (_) {
      workspaces = [];
    }
    return workspaces.map((workspace) => ({
      id: String(workspace.id),
      title: String(workspace.title || ""),
      path: String(workspace.path || ""),
      sessionCount: Array.isArray(workspace.sessionIds) ? workspace.sessionIds.length : 0,
      sessionIds: Array.isArray(workspace.sessionIds) ? workspace.sessionIds.map(String) : []
    }));
  }

  async function handleWorkspaces(req, res) {
    if (!methodAllowed(req, res, "GET")) return;
    assertLocalRequest(req);
    json(res, 200, { ok: true, workspaces: listWorkspaces() });
  }

  async function handleRename(req, res) {
    if (!methodAllowed(req, res, "POST")) return;
    assertLocalRequest(req);
    const body = await readJsonBody(req);
    const sessionId = normalizeSessionId(body && body.sessionId);
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(sessionId) || !title || title.length > 200 || /[\u0000-\u001f\u007f]/.test(title)) throw errorWithStatus(400, "会话 ID 或标题无效，标题需为 1–200 个字符。");
    const api = await createClient();
    if (pendingWebSessions.has(sessionId)) throw errorWithStatus(409, "这条网页会话正在发送或修改，请等待完成后再操作。");
    pendingWebSessions.add(sessionId);
    try {
      await api.renameSession(sessionId, title, { signal: req.deepseekWebSignal });
      json(res, 200, { ok: true, sessionId, title });
    } finally { pendingWebSessions.delete(sessionId); }
  }

  async function handleDelete(req, res) {
    if (!methodAllowed(req, res, "POST")) return;
    assertLocalRequest(req);
    const body = await readJsonBody(req);
    const sessionId = normalizeSessionId(body && body.sessionId);
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(sessionId)) throw errorWithStatus(400, "invalid sessionId");
    if (body.confirm !== true) throw errorWithStatus(400, "删除不可恢复，请先确认删除这条网页会话。");
    const api = await createClient();
    if (pendingWebSessions.has(sessionId)) throw errorWithStatus(409, "这条网页会话正在发送或删除，请等待完成后再操作。");
    pendingWebSessions.add(sessionId);
    try {
      await api.deleteSession(sessionId, { signal: req.deepseekWebSignal });
      json(res, 200, { ok: true, sessionId });
    } finally { pendingWebSessions.delete(sessionId); }
  }

  async function handleImport(req, res) {
    if (!methodAllowed(req, res, "POST")) return;
    assertLocalRequest(req);
    const body = await readJsonBody(req);
    const sessionId = normalizeSessionId(body && body.sessionId);
    const target = body && body.target === "current" ? "current" : "new";
    const dshSessionId = body && body.dshSessionId ? normalizeSessionId(body.dshSessionId) : null;
    const signal = req.deepseekWebSignal;
    const api = await createClient();
    const history = await api.getHistory(sessionId, { signal });
    const transcript = toTranscript(history.activeMessages || history.messages, {
      includeThinking: !(body && body.includeThinking === false)
    });
    if (!transcript.length) throw errorWithStatus(422, "该网页会话没有可导入的消息");
    const title = String(history.title || "DeepSeek 网页对话");
    if (target === "current") {
      if (!dshSessionId) throw errorWithStatus(400, "dshSessionId is required for target:'current'");
      const chars = setImportedContext(dshSessionId, title, transcript);
      json(res, 200, {
        ok: true,
        dshSessionId,
        messageCount: transcript.length,
        title,
        mode: "context",
        chars,
        attachmentReport: contextAttachmentReport(transcript)
      });
      return;
    }
    const importCwd = await resolveImportCwd({
      workspaceId: body && body.workspaceId,
      cwd: body && body.cwd,
      dshSessionId
    });
    const attachmentReport = await importTranscriptAttachments(transcript, api, signal, { cwd: importCwd || ctx.workingDirectory.defaultDirectory, sessionId });
    signal?.throwIfAborted();
    const created = await createImportedSession(transcript, title, importCwd);
    await attachToWorkspace(created.sessionId, body && body.workspaceId, importCwd);
    json(res, 200, {
      ok: true,
      dshSessionId: created.sessionId,
      messageCount: transcript.length,
      title,
      mode: created.mode,
      workspaceTitle: body.workspaceId ? String(ctx.workspaceRegistry.get(String(body.workspaceId))?.title || "") : "",
      attachmentReport
    });
  }

  // 从任意文本导入：无需网页端 token，也用于验证 seed 导入路径（以及网页接口失效时的兜底）。
  async function handleImportText(req, res) {
    if (!methodAllowed(req, res, "POST")) return;
    assertLocalRequest(req);
    const body = await readJsonBody(req);
    const sources = Array.isArray(body && body.transcript) ? body.transcript : [];
    const includeThinking = body && body.includeThinking === false ? false : true;
    const transcript = [];
    for (const item of sources) {
      const role = item && (item.role === "assistant" ? "assistant" : item.role === "user" ? "user" : null);
      let text = item && typeof item.text === "string" ? item.text.trim() : "";
      const thinking =
        includeThinking && item && typeof item.thinking === "string" ? item.thinking.trim() : "";
      const refs = searchRefsText(item && item.searchResults);
      if (refs) text = text ? text + "\n\n" + refs : refs;
      if (!role || (!text && !thinking)) continue;
      const entry = { role, text };
      if (thinking) entry.thinking = thinking;
      transcript.push(entry);
    }
    if (!transcript.length) throw errorWithStatus(400, "transcript must contain user/assistant items with text");
    const title = String((body && body.title) || "导入的对话");
    const target = body && body.target === "current" ? "current" : "new";
    const dshSessionId = body && body.dshSessionId ? normalizeSessionId(body.dshSessionId) : null;
    if (target === "current") {
      if (!dshSessionId) throw errorWithStatus(400, "dshSessionId is required for target:'current'");
      const chars = setImportedContext(dshSessionId, title, transcript);
      json(res, 200, { ok: true, dshSessionId, messageCount: transcript.length, title, mode: "context", chars });
      return;
    }
    const importCwd = await resolveImportCwd({
      workspaceId: body && body.workspaceId,
      cwd: body && body.cwd,
      dshSessionId
    });
    const created = await createImportedSession(transcript, title, importCwd);
    await attachToWorkspace(created.sessionId, body && body.workspaceId, importCwd);
    json(res, 200, {
      ok: true,
      dshSessionId: created.sessionId,
      messageCount: transcript.length,
      title,
      mode: created.mode
    });
  }

  async function handleImage(req, res, url) {
    if (!methodAllowed(req, res, "GET")) return;
    assertLocalRequest(req);
    const fileId = url.searchParams.get("fileId");
    normalizeFileIds([fileId]);
    const api = await createClient();
    const image = await api.getImage(fileId, { signal: req.deepseekWebSignal });
    res.writeHead(200, { "content-type": image.contentType, "content-length": image.bytes.length,
      "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" });
    res.end(image.bytes);
  }

  async function handleUpload(req, res) {
    if (!methodAllowed(req, res, "POST")) return;
    assertLocalRequest(req);
    if (String(req.headers["content-type"] || "").split(";")[0].trim() !== "application/octet-stream") {
      throw errorWithStatus(415, "upload requires application/octet-stream");
    }
    let name;
    try { name = decodeURIComponent(String(req.headers["x-file-name"] || "")); }
    catch (_) { throw errorWithStatus(400, "invalid filename"); }
    if (!name || name.length > 255 || /[\\/\u0000-\u001f\u007f]/.test(name)) throw errorWithStatus(400, "invalid filename");
    if (Number(req.headers["content-length"]) > MAX_FILE_BYTES) throw errorWithStatus(413, "file exceeds 20 MiB");
    const api = await createClient();
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += data.length;
      if (size > MAX_FILE_BYTES) throw errorWithStatus(413, "file exceeds 20 MiB");
      chunks.push(data);
    }
    if (!size) throw errorWithStatus(400, "empty file");
    const type = String(req.headers["x-file-type"] || "application/octet-stream");
    if (type.length > 120 || !/^[a-zA-Z0-9.+_-]+\/[a-zA-Z0-9.+_-]+$/.test(type)) throw errorWithStatus(400, "invalid file type");
    const file = await api.uploadFile({ name, bytes: Buffer.concat(chunks), contentType: type,
      thinking: req.headers["x-thinking-enabled"] === "true", signal: req.deepseekWebSignal });
    json(res, 200, { ok: true, file });
  }

  async function handleContinue(req, res, regenerate = false) {
    if (!methodAllowed(req, res, "POST")) return;
    assertLocalRequest(req);
    const body = await readJsonBody(req);
    const prompt = String((body && body.prompt) || "").trim();
    const fileIds = normalizeFileIds(body && body.fileIds);
    if (!regenerate && !prompt && !fileIds.length) throw errorWithStatus(400, "prompt or attachments are required");
    const thinking = body && body.thinking === true;
    const search = body && body.search === true;
    const sessionId = body && body.sessionId ? normalizeSessionId(body.sessionId) : null;
    const childMessageId = regenerate ? Number(body.childMessageId) : undefined;
    if (regenerate && (!sessionId || !Number.isSafeInteger(childMessageId) || childMessageId <= 0)) throw errorWithStatus(400, "sessionId and childMessageId are required");
    const streaming = body && body.stream === true;
    const frame = (value) => {
      // A stalled client must not grow an unbounded server-side output queue.
      if (res.writableLength > 1024 * 1024) { res.destroy(); return; }
      if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(value) + "\n");
    };
    let heartbeat;
    if (streaming) {
      res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" });
      res.flushHeaders?.();
      frame({ type: "start" });
      heartbeat = setInterval(() => frame({ type: "ping" }), 15000);
      heartbeat.unref?.();
    }
    try {
      const result = await continueWebConversation({
      sessionId, parentMessageId: body && body.parentMessageId, childMessageId, prompt, fileIds, thinking, search,
      signal: req.deepseekWebSignal,
      onDelta: streaming ? (delta) => { if (delta.type !== "search" || body.includeProcess === true) frame({ type: "delta", delta }); } : undefined,
      onProcess: streaming && body.includeProcess === true ? (delta) => frame({ type: "delta", delta }) : undefined
      });
      const payload = {
      ok: true,
      sessionId: String(result.sessionId || sessionId || ""),
      messageId: result.messageId == null ? null : String(result.messageId),
      requestMessageId: result.requestMessageId == null ? null : String(result.requestMessageId),
      parentMessageId: result.parentMessageId == null ? null : String(result.parentMessageId),
      reply: String(result.reply || ""),
      thinking: String(result.thinking || ""),
      searchResults: Array.isArray(result.searchResults) ? result.searchResults : [],
      processSteps: Array.isArray(result.processSteps) ? result.processSteps : [],
      thinkingMs: Number.isFinite(result.thinkingMs) ? result.thinkingMs : undefined
      };
      if (streaming) { frame({ type: "done", ...payload }); res.end(); }
      else json(res, 200, payload);
    } catch (error) {
      if (!streaming) throw error;
      if (!req.deepseekWebSignal.aborted && !res.destroyed) {
        const mapped = mapError(error);
        frame({ type: "error", error: mapped.message, code: mapped.code, status: mapped.status });
        res.end();
      }
    } finally { if (heartbeat) clearInterval(heartbeat); }
  }

  async function routeHandler(req, res) {
    const controller = new AbortController();
    const onDisconnect = () => { if (!res.writableEnded) controller.abort(); };
    req.deepseekWebSignal = controller.signal;
    req.once("aborted", onDisconnect);
    res.once("close", onDisconnect);
    try {
      const url = new URL(req.url || "/", "http://local");
      const subpath = url.pathname.replace(/^\/deepseek-web/, "") || "/";
      if (subpath === "/health") {
        if (!methodAllowed(req, res, "GET")) return;
        json(res, 200, { ok: true, version: VERSION, capabilities: CAPABILITIES });
        return;
      }
      if (subpath === "/status") return await handleStatus(req, res);
      if (subpath === "/token") return await handleToken(req, res);
      if (subpath === "/sessions") return await handleSessions(req, res, url);
      if (subpath === "/history") return await handleHistory(req, res, url);
      if (subpath === "/workspaces") return await handleWorkspaces(req, res);
      if (subpath === "/delete") return await handleDelete(req, res);
      if (subpath === "/rename") return await handleRename(req, res);
      if (subpath === "/import") return await handleImport(req, res);
      if (subpath === "/import-text") return await handleImportText(req, res);
      if (subpath === "/continue") return await handleContinue(req, res);
      if (subpath === "/regenerate") return await handleContinue(req, res, true);
      if (subpath === "/upload") return await handleUpload(req, res);
      if (subpath === "/image") return await handleImage(req, res, url);
      res.writeHead(404, { "cache-control": "no-store" });
      res.end();
    } catch (error) {
      if (controller.signal.aborted || res.destroyed) return;
      const mapped = mapError(error);
      json(res, mapped.status, { ok: false, error: mapped.message, ...(mapped.code ? { code: mapped.code } : {}) });
    } finally {
      req.removeListener("aborted", onDisconnect);
      res.removeListener("close", onDisconnect);
    }
  }

  // 历史修复：早期版本导入的会话没有 attach 到工作区，启动时补一次（只处理本插件创建的
  // `deepseek-web-*` 会话，按 header.cwd 找到对应工作区；已 attach 的自动跳过）。
  ctx.effect(
    () => {
      let cancelled = false;
      Promise.resolve()
        .then(async () => {
          try {
            const snapshots = await ctx.sessionPersistence.list();
            if (cancelled) return;
            for (const snapshot of snapshots || []) {
              const header = snapshot && snapshot.header;
              const id = header && header.id ? String(header.id) : "";
              if (!id || id.indexOf("deepseek-web-") !== 0) continue;
              const cwd = header && typeof header.cwd === "string" ? header.cwd : "";
              if (!cwd) continue;
              if (cancelled) return;
              await attachToWorkspace(id, null, cwd);
            }
          } catch (_) {
            /* 历史修复是尽力而为，不影响插件主功能 */
          }
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    },
    "dsh-deepseek-web: attach legacy imported sessions"
  );

  ctx.effect(
    () => ctx.webServer.register({ kind: "prefix", path: "/deepseek-web", handler: routeHandler }),
    "dsh-deepseek-web: routes"
  );

  // 插件卸载时释放本插件创建的 Agent handle（持久化日志保留，用户打开会话时走 resume）。
  ctx.effect(
    () => () => {
      for (const handle of ownedAgentHandles) {
        Promise.resolve()
          .then(() => handle.dispose())
          .catch(() => {});
      }
      ownedAgentHandles.clear();
      importedContextBySession.clear();
      pendingWebSessions.clear();
      clearClient();
    },
    "dsh-deepseek-web: dispose owned agents"
  );
}
