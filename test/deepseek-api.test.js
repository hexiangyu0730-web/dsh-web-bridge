/**
 * deepseek-api.test.js — lib/deepseek-api.js 的单元测试
 *
 * 全部离线：不联网、不需要真实 token；网络层通过 fetchImpl 注入 mock。
 * PoW 部分使用文档 §5.5 的自测向量（4 条 hash + 3 条 solve + 1 条真实 challenge）。
 *
 * 运行：node --test test/deepseek-api.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

import {
  DEFAULT_BASE_URL,
  DeepSeekWebApi,
  DeepSeekWebError,
  deepseekHashV1,
  messagesToMarkdown,
  normalizeToken,
  normalizeFileIds,
  messageProcessSteps,
  processThinkingMs,
  selectHistoryPath,
  MAX_FILE_BYTES,
  solveChallenge,
} from '../lib/deepseek-api.js';

test('deleteSession uses one confirmed target and never retries a destructive POST', async () => {
  let calls = 0;
  const api = new DeepSeekWebApi({ token: 'offline', fetchImpl: async (url, init) => {
    calls++;
    assert.equal(new URL(url).pathname, '/api/v0/chat_session/delete');
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), { chat_session_id: 'web-one' });
    return new Response(JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: {} } }));
  } });
  for (const id of ['', '../bad', 'a?b', null]) await assert.rejects(api.deleteSession(id), error => error.code === 'bad_request');
  assert.equal(calls, 0);
  assert.deepEqual(await api.deleteSession('web-one'), { sessionId: 'web-one' });
  assert.equal(calls, 1);
  let failures = 0;
  const broken = new DeepSeekWebApi({ token: 'offline', fetchImpl: async () => { failures++; return new Response('upstream failed', { status: 500 }); } });
  await assert.rejects(broken.deleteSession('web-one'));
  assert.equal(failures, 1);
});

test('renameSession validates a trimmed title and only sends one update_title POST', async () => {
  let calls = 0;
  const api = new DeepSeekWebApi({ token: 'offline', fetchImpl: async (url, init) => {
    calls++;
    assert.equal(new URL(url).pathname, '/api/v0/chat_session/update_title');
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), { chat_session_id: 'web-one', title: '新的标题' });
    return new Response(JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: {} } }));
  } });
  for (const title of ['', '   ', null, 'a'.repeat(201), 'bad\nname']) await assert.rejects(api.renameSession('web-one', title));
  assert.equal(calls, 0);
  assert.deepEqual(await api.renameSession('web-one', ' 新的标题 '), { sessionId: 'web-one', title: '新的标题' });
  assert.equal(calls, 1);
  let failed = 0;
  const broken = new DeepSeekWebApi({ token: 'offline', fetchImpl: async () => { failed++; throw new TypeError('disconnected'); } });
  await assert.rejects(broken.renameSession('web-one', '新的标题'));
  assert.equal(failed, 1);
});

test('attachments validate bytes and ids before any network request', async () => {
  let calls = 0;
  const api = new DeepSeekWebApi({ token: 'test', fetchImpl: async () => { calls++; throw new Error('unexpected'); } });
  for (const file of [{ name: '../secret', bytes: new Uint8Array([1]) }, { name: 'empty.txt', bytes: new Uint8Array() },
    { name: 'large.txt', bytes: new Uint8Array(MAX_FILE_BYTES + 1) }]) {
    await assert.rejects(api.uploadFile(file), (error) => error.code === 'bad_request');
  }
  assert.deepEqual(normalizeFileIds(['file-a', 'file-a', 'file-b']), ['file-a', 'file-b']);
  for (const ids of [null, [''], ['../path'], ['a\n'], Array(11).fill('file-a')]) {
    assert.throws(() => normalizeFileIds(ids), (error) => error.code === 'bad_request');
  }
  await assert.rejects(api.continueSession({ sessionId: 'chat', prompt: 'text', fileIds: ['../bad'] }));
  assert.equal(calls, 0);
});

test('upload sends real multipart bytes with its own PoW and waits for SUCCESS', async () => {
  const keepAlive = setInterval(() => {}, 1000);
  const paths = [];
  let polls = 0;
  const api = new DeepSeekWebApi({ token: 'test', fetchImpl: async (url, init) => {
    const path = new URL(url).pathname;
    paths.push(path);
    if (path.endsWith('create_pow_challenge')) {
      assert.equal(JSON.parse(init.body).target_path, '/api/v0/file/upload_file');
      return jsonResponse(powChallengeEnvelope({ target_path: '/api/v0/file/upload_file' }));
    }
    if (path.endsWith('upload_file')) {
      assert.ok(init.body instanceof FormData);
      const file = init.body.get('file');
      assert.equal(file.name, '示例.txt');
      assert.equal(await file.text(), 'actual contents');
      assert.equal(header(init.headers, 'content-type'), undefined);
      assert.equal(header(init.headers, 'x-file-size'), '15');
      assert.equal(JSON.parse(Buffer.from(header(init.headers, 'x-ds-pow-response'), 'base64')).target_path, path);
      return jsonResponse(envelope({ id: 'file-one', status: 'PENDING' }));
    }
    assert.equal(new URL(url).searchParams.get('file_ids'), 'file-one');
    return jsonResponse(envelope({ files: [{ id: 'file-one', status: ++polls === 1 ? 'PARSING' : 'SUCCESS' }] }));
  } });
  try {
    const file = await api.uploadFile({ name: '示例.txt', bytes: new TextEncoder().encode('actual contents'), pollIntervalMs: 1 });
    assert.deepEqual(file, { id: 'file-one', name: '示例.txt', size: 15, status: 'SUCCESS' });
    assert.equal(paths.filter((path) => path.endsWith('upload_file')).length, 1);
    assert.equal(polls, 2);
  } finally { clearInterval(keepAlive); }
});

test('upload parse failure and HTTP 500 fail without re-uploading', async () => {
  for (const httpError of [false, true]) {
    let writes = 0;
    const api = new DeepSeekWebApi({ token: 'test', fetchImpl: async (url) => {
      if (String(url).endsWith('create_pow_challenge')) return jsonResponse(powChallengeEnvelope({ target_path: '/api/v0/file/upload_file' }));
      writes++;
      return httpError ? textResponse('failure', { status: 500 }) : jsonResponse(envelope({ id: 'file-one', status: 'FAILED' }));
    } });
    await assert.rejects(api.uploadFile({ name: 'a.txt', bytes: new Uint8Array([1]) }), (error) => httpError || error.code === 'file_parse_failed');
    assert.equal(writes, 1);
  }
});

test('upload polling backs off HTTP 200 code 40029 without uploading the attachment a second time', async () => {
  let uploads = 0, polls = 0;
  const api = new DeepSeekWebApi({ token: 'test', fileRequestIntervalMs: 0, fileRateLimitDelayMs: 0, fetchImpl: async url => {
    const path = new URL(url).pathname;
    if (path.endsWith('create_pow_challenge')) return jsonResponse(powChallengeEnvelope({ target_path: '/api/v0/file/upload_file' }));
    if (path.endsWith('upload_file')) { uploads++; return jsonResponse(envelope({ id: 'file-one', status: 'PENDING' })); }
    if (++polls === 1) return jsonResponse({ code: 40029, msg: 'TOO_MANY_REQUESTS', data: { biz_code: 0 } });
    return jsonResponse(envelope({ files: [{ id: 'file-one', status: 'SUCCESS' }] }));
  } });
  const file = await api.uploadFile({ name: 'document.txt', bytes: new Uint8Array([1, 2, 3]) });
  assert.equal(file.status, 'SUCCESS'); assert.equal(uploads, 1); assert.equal(polls, 2);
});

test('completion includes deduplicated file ids and permits attachment-only messages', async () => {
  let completed = false;
  const api = new DeepSeekWebApi({ token: 'test', fetchImpl: async (url, init) => {
    if (String(url).endsWith('create_pow_challenge')) return jsonResponse(powChallengeEnvelope());
    const body = JSON.parse(init.body);
    assert.equal(body.prompt, '');
    assert.deepEqual(body.ref_file_ids, ['file-one']);
    completed = true;
    return sseResponse('data: {"v":{"response":{"status":"FINISHED","content":"ok"}}}\n\n');
  } });
  await api.continueSession({ sessionId: 'chat', prompt: '', fileIds: ['file-one', 'file-one'] });
  assert.equal(completed, true);
});

test('file parsing can be cancelled and never starts another upload', async () => {
  const controller = new AbortController();
  let writes = 0;
  const api = new DeepSeekWebApi({ token: 'test', fetchImpl: async (url) => {
    if (String(url).endsWith('create_pow_challenge')) return jsonResponse(powChallengeEnvelope({ target_path: '/api/v0/file/upload_file' }));
    if (String(url).endsWith('upload_file')) { writes++; return jsonResponse(envelope({ id: 'file-one', status: 'PENDING' })); }
    controller.abort();
    throw new DOMException('cancelled', 'AbortError');
  } });
  await assert.rejects(api.uploadFile({ name: 'a.txt', bytes: new Uint8Array([1]), signal: controller.signal }), (error) => error.code === 'aborted');
  assert.equal(writes, 1);
});

const enc = new TextEncoder();
const hex = (bytes) => Buffer.from(bytes).toString('hex');

// ---------------------------------------------------------------------------
// 测试夹具：统一信封 / 响应构造
// ---------------------------------------------------------------------------

/** 统一信封（文档 §1.4）。 */
function envelope(bizData, { code = 0, msg = '', bizCode = 0, bizMsg = '' } = {}) {
  return { code, msg, data: { biz_code: bizCode, biz_msg: bizMsg, biz_data: bizData } };
}

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function textResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain', ...headers } });
}

/** 把 SSE 文本按固定字节数切块，验证跨 chunk 的缓冲/多字节解码。 */
function sseResponse(text, { status = 200, chunkSize = 37 } = {}) {
  const bytes = enc.encode(text);
  const stream = new ReadableStream({
    start(controller) {
      if (bytes.length === 0) controller.enqueue(new Uint8Array(0));
      for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { 'content-type': 'text/event-stream' } });
}

/** 把若干帧（`event: ...\ndata: ...` 字符串）拼成 SSE 文本。 */
function framesToSse(frames) {
  return frames.map((frame) => `${frame}\n\n`).join('');
}

/** 记录请求的 mock fetch。handler(call, index) 返回 Response。 */
function recorder(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const call = {
      url: String(url),
      method: String(init.method || 'GET').toUpperCase(),
      headers: init.headers || {},
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      signal: init.signal,
    };
    calls.push(call);
    return await handler(call, calls.length - 1);
  };
  fn.calls = calls;
  return fn;
}

function makeApi(fetchImpl, extra = {}) {
  return new DeepSeekWebApi({ token: 'test-token', fetchImpl, ...extra });
}

/** 大小写不敏感地读请求头。 */
function header(headers, name) {
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers || {})) {
    if (key.toLowerCase() === wanted) return headers[key];
  }
  return undefined;
}

function deepEqualHeader(headers, name, expected) {
  assert.equal(header(headers, name), expected, `请求头 ${name} 不符合预期`);
}

// ---------------------------------------------------------------------------
// 测试夹具：PoW（取自文档 §5.5 的自测向量）
// ---------------------------------------------------------------------------

const TEST_SALT = 'testsalt';
const TEST_EXPIRE_AT = 1700000000;
const TEST_ANSWER = 42;
const TEST_DIFFICULTY = 1000;
const TEST_CHALLENGE_HEX = hex(deepseekHashV1(enc.encode(`${TEST_SALT}_${TEST_EXPIRE_AT}_${TEST_ANSWER}`)));

function powChallengeEnvelope(overrides = {}) {
  return envelope({
    challenge: {
      algorithm: 'DeepSeekHashV1',
      challenge: TEST_CHALLENGE_HEX,
      salt: TEST_SALT,
      signature: 'sig-abc',
      difficulty: TEST_DIFFICULTY,
      expire_at: TEST_EXPIRE_AT,
      expire_after: 300000,
      target_path: '/api/v0/chat/completion',
      ...overrides,
    },
  });
}

/** mock：先 PoW challenge，再 completion SSE。 */
function completionFetch(sseText) {
  return recorder((call) => {
    if (call.url.endsWith('/api/v0/chat/create_pow_challenge')) return jsonResponse(powChallengeEnvelope());
    if (call.url.endsWith('/api/v0/chat/completion')) return sseResponse(sseText);
    throw new Error(`unexpected URL: ${call.url}`);
  });
}

test('completion keeps TOOL_SEARCH sources in both live metadata and the final result', async () => {
  const source = { title: '资料', url: 'https://example.com/source', snippet: 'summary' };
  const stream = framesToSse([
    'data: ' + JSON.stringify({ v: { response: { message_id: 2, status: 'WIP', fragments: [{ type: 'THINK', content: '推理' }] } } }),
    'data: ' + JSON.stringify({ p: 'response/fragments', o: 'APPEND', v: [{ type: 'TOOL_SEARCH', results: [source] }] }),
    'data: ' + JSON.stringify({ p: 'response/fragments', o: 'APPEND', v: [{ type: 'RESPONSE', content: '完整回答' }] }),
    'event: finish\ndata: {}',
  ]);
  const api = makeApi(completionFetch(stream)), deltas = [];
  const result = await api.continueSession({ sessionId: 'web', prompt: 'search', search: true, onDelta: value => deltas.push(value) });
  assert.deepEqual(result.searchResults, [source]);
  assert.deepEqual(deltas.find(value => value.type === 'search').results, [source]);
  assert.equal(result.thinking, '推理'); assert.equal(result.reply, '完整回答');
});

test('regenerate uses the native child_message_id endpoint and completion-like PoW, without replaying prompt/files', async () => {
  const source = { title: 'Source', url: 'https://example.com', snippet: '' };
  const calls = [], deltas = [], processes = [];
  const stream = framesToSse([
    'event: ready\ndata: {"request_message_id":1,"response_message_id":8}',
    'data: ' + JSON.stringify({ v: { response: { message_id: 8, parent_id: 1, fragments: [
      { type: 'THINK', content: 'reason', elapsed_secs: 1 }, { type: 'TOOL_SEARCH', results: [source] }, { type: 'RESPONSE', content: 'new answer' },
    ] } } }), 'event: finish\ndata: {}',
  ]);
  const api = makeApi(async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('create_pow_challenge')) {
      assert.equal(JSON.parse(init.body).target_path, '/api/v0/chat/completion');
      return jsonResponse(powChallengeEnvelope());
    }
    assert.ok(url.endsWith('/api/v0/chat/regenerate'));
    assert.deepEqual(JSON.parse(init.body), { chat_session_id: 'web', child_message_id: 2, thinking_enabled: true, search_enabled: true, user_options: null });
    assert.equal(JSON.parse(Buffer.from(header(init.headers, 'x-ds-pow-response'), 'base64')).target_path, '/api/v0/chat/completion');
    return sseResponse(stream);
  });
  const result = await api.regenerateSession({ sessionId: 'web', childMessageId: '2', thinking: true, search: true, onDelta: value => deltas.push(value), onProcess: value => processes.push(value) });
  assert.equal(result.messageId, 8); assert.equal(result.reply, 'new answer');
  assert.equal(result.thinkingMs, 1000); assert.deepEqual(result.searchResults, [source]);
  assert.equal(calls.length, 2); assert.ok(deltas.some(value => value.type === 'text'));
  assert.deepEqual(processes.filter(value => value.type === 'process-step').map(value => value.step.type), ['thinking', 'search']);
});

test('regenerate validates IDs and never retries a mutating POST, including HTTP 500 and partial EOF', async () => {
  let calls = 0;
  const invalid = makeApi(async () => { calls++; throw new Error('must not run'); });
  for (const childMessageId of [undefined, '', 0, -1, 1.5, 'foreign', Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(invalid.regenerateSession({ sessionId: 'web', childMessageId }), error => error.code === 'bad_request');
  }
  assert.equal(calls, 0);
  for (const partial of [false, true]) {
    let posts = 0;
    const api = makeApi(async url => {
      if (url.endsWith('create_pow_challenge')) return jsonResponse(powChallengeEnvelope());
      posts++;
      return partial ? sseResponse(framesToSse(['data: {"v":{"response":{"message_id":8,"status":"WIP","content":"partial"}}}'])) : new Response('failed', { status: 500 });
    });
    await assert.rejects(api.regenerateSession({ sessionId: 'web', childMessageId: 2 }));
    assert.equal(posts, 1);
  }
});

test('history retains all answer versions for the UI but read/import consumers get the selected path only', async () => {
  const api = makeApi(async () => jsonResponse(envelope({ chat_session: { id: 'web', title: 'Branches', current_message_id: 5 }, chat_messages: [
    { message_id: 1, parent_id: null, role: 'USER', content: 'question' },
    { message_id: 2, parent_id: 1, role: 'ASSISTANT', content: 'selected answer', ban_regenerate: false },
    { message_id: 3, parent_id: 1, role: 'ASSISTANT', content: 'other answer', ban_regenerate: true },
    { message_id: 4, parent_id: 2, role: 'USER', content: 'followup' },
    { message_id: 5, parent_id: 4, role: 'ASSISTANT', content: 'selected tail' },
  ] })));
  const history = await api.getHistory('web');
  assert.equal(history.messages.length, 5);
  assert.equal(history.currentMessageId, 5);
  assert.deepEqual(history.activeMessages.map(message => message.id), [1, 2, 4, 5]);
  assert.equal(history.messages.find(message => message.id === 3).banRegenerate, true);
  assert.deepEqual(selectHistoryPath(history.messages, 2).map(message => message.id), [1, 2, 4, 5], 'an ancestor selection restores that branch, not the latest sibling');
});

test('interleaved thinking/search/open stages retain exact order and sum only real elapsed_secs', () => {
  const fragments = [
    { type: 'THINK', content: '第一段思考', elapsed_secs: 1.2 },
    { type: 'TOOL_SEARCH', queries: [{ query: 'first query' }], results: [{ title: 'First', url: 'https://example.com/one' }] },
    { type: 'THINK', content: '第二段思考', elapsed_secs: 2.3 },
    { type: 'TOOL_OPEN', result: { title: 'Page', url: 'https://example.com/one' } },
    { type: 'TOOL_SEARCH', queries: [{ query: 'second query' }], results: [] },
    { type: 'THINK', content: '第三段思考', elapsed_secs: 3.5 },
    { type: 'RESPONSE', content: 'answer' },
  ];
  const steps = messageProcessSteps({ fragments });
  assert.deepEqual(steps.map(item => item.type === 'thinking' ? 'THINK' : item.action), ['THINK', 'search', 'THINK', 'open', 'search', 'THINK']);
  assert.equal(processThinkingMs(steps), 7000);
  assert.equal(steps[4].query, 'second query');
  assert.equal(steps[4].searchResults.length, 0, 'a search with no results is still a real process step');
  assert.equal(processThinkingMs(messageProcessSteps({ fragments: [{ type: 'THINK', content: 'unknown', elapsed_secs: null }] })), undefined);
  assert.equal(processThinkingMs(messageProcessSteps({ fragments: [{ type: 'THINK', content: 'partial', elapsed_secs: -1 }] })), undefined);
});

test('process streaming sends small text deltas and metadata changes without replaying thinking', async () => {
  const events = [
    { v: { response: { message_id: 2, status: 'WIP', fragments: [{ id: 1, type: 'THINK', content: 'a', elapsed_secs: null }] } } },
    { p: 'response/fragments/-1/content', o: 'APPEND', v: 'b' },
    { p: 'response/fragments/-1/elapsed_secs', o: 'SET', v: 1.5 },
    { p: 'response/fragments', o: 'APPEND', v: [{ id: 2, type: 'TOOL_SEARCH', queries: [{ query: 'search' }], results: [] }] },
    { p: 'response/fragments', o: 'APPEND', v: [{ id: 3, type: 'THINK', content: 'again', elapsed_secs: 2 }] },
    { p: 'response/content', o: 'SET', v: 'answer' },
  ];
  const api = makeApi(completionFetch(framesToSse([...events.map(value => 'data: ' + JSON.stringify(value)), 'event: finish\ndata: {}'])));
  const updates = [];
  const result = await api.continueSession({ sessionId: 'web', prompt: 'continue', onProcess: value => updates.push(value) });
  assert.deepEqual(result.processSteps.map(item => item.type), ['thinking', 'search', 'thinking']);
  assert.equal(result.processSteps[0].text, 'ab');
  assert.equal(result.thinkingMs, 3500);
  assert.ok(updates.some(value => value.type === 'process-text' && value.text === 'b'));
  assert.ok(updates.some(value => value.type === 'process-step' && value.step.elapsedMs === 1500 && value.step.text === undefined));
});

test('process replacement removes obsolete stages and rewritten thinking replaces rather than appends', async () => {
  const replacement = [{ id: 3, type: 'TOOL_SEARCH', queries: ['replacement'], results: [] },
    { id: 4, type: 'THINK', content: 'new', elapsed_secs: 2 }];
  const events = [
    { v: { response: { message_id: 2, status: 'WIP', fragments: [
      { id: 1, type: 'THINK', content: 'obsolete' }, { id: 2, type: 'TOOL_OPEN' },
    ] } } },
    { p: 'response/fragments', o: 'SET', v: replacement },
    { p: 'response/fragments/-1/content', o: 'SET', v: 'rewritten' },
    { p: 'response/content', o: 'SET', v: 'answer' },
  ];
  const api = makeApi(completionFetch(framesToSse([...events.map(value => 'data: ' + JSON.stringify(value)), 'event: finish\ndata: {}'])));
  const updates = [];
  const result = await api.continueSession({ sessionId: 'web', prompt: 'continue', onProcess: value => updates.push(value) });
  assert.equal(updates.filter(value => value.type === 'process-reset').length, 1);
  const reset = updates.find(value => value.type === 'process-reset');
  assert.deepEqual(reset.steps.map(step => step.id), ['0:3', '1:4']);
  assert.equal(reset.steps[1].text, 'new');
  assert.ok(updates.some(value => value.type === 'process-text' && value.id === '1:4' && value.replace && value.text === 'rewritten'));
  assert.deepEqual(result.processSteps.map(step => step.id), ['0:3', '1:4']);
  assert.equal(result.processSteps[1].text, 'rewritten');
  assert.equal(result.thinkingMs, 2000);
});

// ---------------------------------------------------------------------------
// normalizeToken / 基础配置
// ---------------------------------------------------------------------------

test('normalizeToken：裸 token 与 localStorage JSON 都能解析，空值抛错', () => {
  assert.equal(DEFAULT_BASE_URL, 'https://chat.deepseek.com');
  assert.equal(normalizeToken('abc'), 'abc');
  assert.equal(normalizeToken('  abc  '), 'abc');
  assert.equal(normalizeToken('{"value":"tok-123","__version":"0"}'), 'tok-123');
  assert.equal(normalizeToken('  {"value":"tok-123","__version":"0"}  '), 'tok-123');
  assert.equal(normalizeToken({ value: 'tok-obj' }), 'tok-obj'); // 兼容调用方已 JSON.parse 的情况

  for (const bad of [undefined, null, '', '   ', '{"value":""}', '{"value":123}']) {
    assert.throws(
      () => normalizeToken(bad),
      (err) => err instanceof DeepSeekWebError && err.code === 'auth_missing_token',
      `应拒绝空 token：${JSON.stringify(bad)}`,
    );
  }
  assert.equal(normalizeToken('{"value":"x"}'), 'x');
  // 看起来是 JSON 但解析失败
  assert.throws(
    () => normalizeToken('{"value": '),
    (err) => err instanceof DeepSeekWebError && err.code === 'auth_missing_token',
  );
});

test('构造参数校验：空 token / 非法 fetchImpl 直接抛错', () => {
  assert.throws(
    () => new DeepSeekWebApi({ token: '' }),
    (err) => err instanceof DeepSeekWebError && err.code === 'auth_missing_token',
  );
  assert.throws(
    () => new DeepSeekWebApi({ token: 't', fetchImpl: null }),
    (err) => err instanceof DeepSeekWebError && err.code === 'bad_config',
  );
  // 非法 baseUrl 不阻塞构造（Origin 回退默认值）
  const api = new DeepSeekWebApi({ token: 't', baseUrl: 'not a url', fetchImpl: async () => jsonResponse({}) });
  assert.ok(api instanceof DeepSeekWebApi);
});

// ---------------------------------------------------------------------------
// listSessions（文档 §2）
// ---------------------------------------------------------------------------

test('listSessions：嵌套点号分页参数、字段归一化、跨页按 id 去重', async () => {
  const page1 = envelope({
    chat_sessions: [
      { id: 's1', title: '会话一', pinned: false, model_type: 'default', updated_at: 1778039195.997 },
      { id: 's2', title: '会话二', pinned: true, model_type: 'expert', updated_at: 1778039000.5 },
    ],
    has_more: true,
  });
  const page2 = envelope({
    chat_sessions: [
      // 边界是 <=，本页第一条会与上一页最后一条重复
      { id: 's2', title: '会话二', pinned: true, model_type: 'expert', updated_at: 1778039000.5 },
      { id: 's3', title: null, pinned: false, model_type: 'default', updated_at: 1778038800.25 },
    ],
    has_more: false,
  });
  const fetchImpl = recorder((call) => {
    const cursor = new URL(call.url).searchParams.get('lte_cursor.updated_at');
    return jsonResponse(cursor ? page2 : page1);
  });
  const api = makeApi(fetchImpl);
  const result = await api.listSessions({ limit: 10 });

  assert.equal(fetchImpl.calls.length, 2, '应翻两页');
  const first = fetchImpl.calls[0];
  const second = fetchImpl.calls[1];

  // 方法 / 头（文档 §1.2 最小头集合）
  assert.equal(first.method, 'GET');
  assert.equal(first.url, 'https://chat.deepseek.com/api/v0/chat_session/fetch_page?lte_cursor.pinned=false&count=100');
  deepEqualHeader(first.headers, 'authorization', 'Bearer test-token');
  assert.equal(header(first.headers, 'content-type'), undefined, 'GET 不应发送 content-type');
  // 文档 §1.2：未确认的头不要发
  assert.equal(header(first.headers, 'x-app-version'), undefined);
  assert.equal(header(first.headers, 'x-device-id'), undefined);
  assert.equal(header(first.headers, 'x-hif-leim'), undefined);

  // 嵌套点号游标（平铺写法会被服务端忽略）
  const firstParams = new URL(first.url).searchParams;
  assert.equal(firstParams.get('lte_cursor.pinned'), 'false');
  assert.equal(firstParams.get('count'), '100');
  assert.equal(firstParams.has('lte_cursor'), false, '不能发平铺 lte_cursor 参数');
  assert.equal(firstParams.has('lte_cursor.updated_at'), false, '首页不带 updated_at');

  const secondParams = new URL(second.url).searchParams;
  assert.equal(secondParams.get('lte_cursor.updated_at'), '1778039000.5', '游标应为上一页最后一条的 updated_at 原样浮点秒');
  assert.equal(secondParams.get('lte_cursor.pinned'), 'false');

  // 归一化结果
  assert.equal(result.hasMore, false);
  assert.equal(result.nextCursor, null);
  assert.deepEqual(
    result.sessions.map((session) => session.id),
    ['s1', 's2', 's3'],
  );
  assert.deepEqual(result.sessions[0], {
    id: 's1',
    title: '会话一',
    pinned: false,
    modelType: 'default',
    updatedAt: 1778039195.997,
  });
  assert.deepEqual(result.sessions[1], {
    id: 's2',
    title: '会话二',
    pinned: true,
    modelType: 'expert',
    updatedAt: 1778039000.5,
  });
  assert.equal(result.sessions[2].title, '', 'null title 归一化为空串');
  assert.equal(typeof result.sessions[2].updatedAt, 'number');
});

test('listSessions：limit 截断时 hasMore/nextCursor 正确，limit<=0 不发请求', async () => {
  const page = envelope({
    chat_sessions: [
      { id: 'a', title: 'A', pinned: false, model_type: 'default', updated_at: 300.5 },
      { id: 'b', title: 'B', pinned: false, model_type: 'default', updated_at: 200.5 },
      { id: 'c', title: 'C', pinned: false, model_type: 'default', updated_at: 100.5 },
    ],
    has_more: true,
  });
  const fetchImpl = recorder(() => jsonResponse(page));
  const api = makeApi(fetchImpl);

  const result = await api.listSessions({ limit: 2 });
  assert.equal(fetchImpl.calls.length, 1);
  assert.deepEqual(
    result.sessions.map((session) => session.id),
    ['a', 'b'],
  );
  assert.equal(result.hasMore, true);
  assert.equal(result.nextCursor, 200.5, 'nextCursor 应是本页返回的最后一条 updatedAt');

  const empty = await api.listSessions({ limit: 0 });
  assert.deepEqual(empty, { sessions: [], hasMore: false, nextCursor: null });
  assert.equal(fetchImpl.calls.length, 1, 'limit<=0 不应发起请求');
});

// ---------------------------------------------------------------------------
// getHistory（文档 §3）
// ---------------------------------------------------------------------------

const HISTORY_SESSION = '97952d9b-c23a-4d37-8bcf-feb53c88ea83';

test('getHistory：只取 REQUEST/RESPONSE/THINK/TOOL_SEARCH，按 inserted_at 升序归一化', async () => {
  const bizData = {
    chat_session_id: HISTORY_SESSION,
    chat_session: { id: HISTORY_SESSION, title: '测试会话' },
    chat_messages: [
      // 故意乱序：assistant 在前，验证会按 inserted_at 重新排序
      {
        message_id: 2,
        parent_id: 1,
        role: 'ASSISTANT',
        model: '',
        status: 'FINISHED',
        inserted_at: 1700000005.5,
        content: '',
        files: [],
        fragments: [
          { id: 1, type: 'THINK', content: '推理过程 A' },
          { id: 2, type: 'TOOL_SEARCH', content: 'found 2 pages', queries: [{ query: 'q' }], results: [
            { url: 'https://a.example', title: 'A', snippet: 's1' },
            { url: 'https://b.example', title: 'B' },
          ] },
          { id: 3, type: 'TOOL_OPEN', content: null, result: { url: 'https://a.example', title: 'A', snippet: 's1' } },
          { id: 4, type: 'RESPONSE', content: '回答正文' },
          { id: 5, type: 'TIP', content: '本回答由 AI 生成，内容仅供参考。', style: 'WARNING' },
        ],
      },
      {
        message_id: 1,
        parent_id: null,
        role: 'USER',
        status: 'FINISHED',
        inserted_at: 1700000000,
        content: '',
        fragments: [{ id: 1, type: 'REQUEST', content: '用户提问' }],
      },
      // 非对话角色：丢弃
      {
        message_id: 99,
        parent_id: 1,
        role: 'SYSTEM',
        status: 'FINISHED',
        inserted_at: 1700000001,
        fragments: [{ id: 1, type: 'RESPONSE', content: '不应出现' }],
      },
      // 附件-only 的用户消息：占位符
      {
        message_id: 3,
        parent_id: 2,
        role: 'USER',
        status: 'FINISHED',
        inserted_at: 1700000010,
        content: '',
        fragments: [],
        files: [{ id: 'file-1' }],
      },
      {
        message_id: 4,
        parent_id: 3,
        role: 'ASSISTANT',
        status: 'FINISHED',
        inserted_at: 1700000012,
        content: '',
        fragments: [
          { id: 1, type: 'RESPONSE', content: '第二答' },
          { id: 2, type: 'THINK', content: '推理 B' },
        ],
      },
    ],
  };

  const fetchImpl = recorder((call) => {
    assert.match(call.url, /\/api\/v0\/chat\/history_messages\?chat_session_id=/);
    return jsonResponse(envelope(bizData));
  });
  const api = makeApi(fetchImpl);
  const history = await api.getHistory(HISTORY_SESSION);

  assert.equal(fetchImpl.calls.length, 1);
  const params = new URL(fetchImpl.calls[0].url).searchParams;
  assert.equal(params.get('chat_session_id'), HISTORY_SESSION);
  assert.equal(params.has('cache_version'), false, '文档 §3.1：不要凭空加 cache_version');

  assert.equal(history.id, HISTORY_SESSION);
  assert.equal(history.title, '测试会话');
  assert.equal(history.messages.length, 4, 'SYSTEM 角色应被丢弃');

  const [user1, assistant1, user2, assistant2] = history.messages;
  assert.deepEqual(user1, {
    id: 1,
    parentId: null,
    role: 'user',
    status: 'FINISHED',
    insertedAt: 1700000000,
    text: '用户提问',
    thinking: '',
    searchResults: [],
  });
  assert.deepEqual(assistant1, {
    id: 2,
    parentId: 1,
    role: 'assistant',
    status: 'FINISHED',
    insertedAt: 1700000005.5,
    text: '回答正文',
    thinking: '推理过程 A',
    searchResults: [
      { title: 'A', url: 'https://a.example', snippet: 's1' },
      { title: 'B', url: 'https://b.example', snippet: '' },
    ],
    processSteps: [
      { id: '0:1', type: 'thinking', text: '推理过程 A' },
      { id: '1:2', type: 'search', action: 'search', query: 'q', searchResults: [
        { title: 'A', url: 'https://a.example', snippet: 's1' }, { title: 'B', url: 'https://b.example', snippet: '' },
      ] },
      { id: '2:3', type: 'search', action: 'open', query: '', searchResults: [{ title: 'A', url: 'https://a.example', snippet: 's1' }] },
    ],
  });
  assert.equal(user2.text, '（仅附件，无文字）');
  assert.deepEqual(assistant2.text, '第二答');
  assert.deepEqual(assistant2.thinking, '推理 B');
  // 排序：inserted_at 升序
  assert.deepEqual(
    history.messages.map((message) => message.id),
    [1, 2, 3, 4],
  );
});

test('getHistory：缺失 inserted_at 用会话最早时间兜底（不用「现在」）', async () => {
  const bizData = {
    chat_session_id: HISTORY_SESSION,
    chat_messages: [
      { message_id: 1, parent_id: null, role: 'USER', status: 'FINISHED', inserted_at: 1700000100, fragments: [{ type: 'REQUEST', content: 'hi' }] },
      { message_id: 2, parent_id: 1, role: 'ASSISTANT', status: 'FINISHED', fragments: [{ type: 'RESPONSE', content: 'yo' }] },
    ],
  };
  const api = makeApi(recorder(() => jsonResponse(envelope(bizData))));
  const history = await api.getHistory(HISTORY_SESSION);
  assert.equal(history.messages.length, 2);
  assert.equal(history.messages[1].insertedAt, 1700000100, '缺失时间应回退到会话最早时间');
  assert.equal(history.title, '', '响应无 chat_session 时标题为空串');
});

test('getHistory / continueSession：非法入参快速失败，不发请求', async () => {
  const fetchImpl = recorder(() => jsonResponse(envelope({})));
  const api = makeApi(fetchImpl);
  await assert.rejects(api.getHistory('  '), (err) => err instanceof DeepSeekWebError && err.code === 'bad_request');
  await assert.rejects(
    api.continueSession({ sessionId: '', prompt: 'hi' }),
    (err) => err instanceof DeepSeekWebError && err.code === 'bad_request',
  );
  await assert.rejects(
    api.continueSession({ sessionId: 's', prompt: '   ' }),
    (err) => err instanceof DeepSeekWebError && err.code === 'bad_request',
  );
  assert.equal(fetchImpl.calls.length, 0);
});

// ---------------------------------------------------------------------------
// SSE 增量解析 / completion（文档 §4）
// ---------------------------------------------------------------------------

/** 一份含 THINK + 多 RESPONSE 片段、APPEND/SET/BATCH 的 SSE 流。 */
function buildContinueSse() {
  const snapshot = {
    v: {
      response: {
        message_id: 2,
        parent_id: 1,
        model: '',
        role: 'ASSISTANT',
        thinking_enabled: true,
        search_enabled: false,
        status: 'WIP',
        accumulated_token_usage: 0,
        files: [],
        inserted_at: 1775410244.214,
        fragments: [{ id: 2, type: 'THINK', content: '我们需要', elapsed_secs: null, references: [], stage_id: 1 }],
        has_pending_fragment: false,
      },
    },
  };
  return framesToSse([
    `event: ready\ndata: ${JSON.stringify({ request_message_id: 1, response_message_id: 2, model_type: 'default' })}`,
    `event: update_session\ndata: ${JSON.stringify({ updated_at: 1775410244.22 })}`,
    `data: ${JSON.stringify(snapshot)}`,
    // 裸 token：沿用上一条 p/o（response/fragments/-1/content + APPEND）
    `data: ${JSON.stringify({ v: '思考' })}`,
    `data: ${JSON.stringify({ p: 'response/fragments/-1/content', o: 'APPEND', v: '，' })}`,
    // 新片段：之后的裸 token 归到新片段
    `data: ${JSON.stringify({ p: 'response/fragments', o: 'APPEND', v: [{ id: 3, type: 'RESPONSE', content: '好的' }] })}`,
    `data: ${JSON.stringify({ p: 'response/fragments', o: 'APPEND', v: [{ id: 4, type: 'RESPONSE', content: '第二段' }] })}`,
    `data: ${JSON.stringify({ v: '续写' })}`,
    // 未知/控制路径不能中断解析
    `data: ${JSON.stringify({ p: 'response/search_triggered', o: 'SET', v: true })}`,
    `data: ${JSON.stringify({ p: 'response/fragments/-1/status', o: 'SET', v: 'FINISHED' })}`,
    // BATCH：子路径拼父路径
    `data: ${JSON.stringify({ p: 'response', o: 'BATCH', v: [
      { p: 'accumulated_token_usage', v: 42 },
      { p: 'quasi_status', v: 'FINISHED' },
    ] })}`,
    `data: ${JSON.stringify({ p: 'response/status', o: 'SET', v: 'FINISHED' })}`,
    `event: finish\ndata: {}`,
    `event: title\ndata: ${JSON.stringify({ content: '测试标题' })}`,
    `event: close\ndata: ${JSON.stringify({ click_behavior: 'none', auto_resume: false })}`,
  ]);
}

test('continueSession：PoW 头、请求体、SSE p/o/v 增量解析、onDelta 增量', async () => {
  const fetchImpl = completionFetch(buildContinueSse());
  const api = makeApi(fetchImpl, { hifLeim: 'hif-test-value' });
  const deltas = [];
  const result = await api.continueSession({
    sessionId: 'sess-1',
    parentMessageId: 7,
    prompt: '你好',
    thinking: true,
    onDelta: (delta) => deltas.push(delta),
  });

  assert.equal(fetchImpl.calls.length, 2);

  // 1) PoW challenge 请求（文档 §5.1）
  const powCall = fetchImpl.calls[0];
  assert.equal(powCall.method, 'POST');
  assert.equal(powCall.url, 'https://chat.deepseek.com/api/v0/chat/create_pow_challenge');
  assert.deepEqual(powCall.body, { target_path: '/api/v0/chat/completion' });
  deepEqualHeader(powCall.headers, 'authorization', 'Bearer test-token');
  deepEqualHeader(powCall.headers, 'content-type', 'application/json');

  // 2) completion 请求体（文档 §4.2）+ PoW 头 + hif 头（显式传入才发）
  const completionCall = fetchImpl.calls[1];
  assert.equal(completionCall.method, 'POST');
  assert.equal(completionCall.url, 'https://chat.deepseek.com/api/v0/chat/completion');
  assert.deepEqual(completionCall.body, {
    parent_message_id: 7,
    prompt: '你好',
    ref_file_ids: [],
    thinking_enabled: true,
    search_enabled: false,
    action: null,
    preempt: false,
    chat_session_id: 'sess-1',
  });
  assert.equal(completionCall.body.model_type, undefined, '续聊不应传 model_type');
  deepEqualHeader(completionCall.headers, 'content-type', 'application/json');
  deepEqualHeader(completionCall.headers, 'x-hif-leim', 'hif-test-value');
  assert.equal(header(powCall.headers, 'x-hif-leim'), undefined, 'hif 只加在 completion 流上');

  const powHeader = header(completionCall.headers, 'x-ds-pow-response');
  assert.ok(typeof powHeader === 'string' && powHeader.length > 0, '必须带 x-ds-pow-response');
  const payload = JSON.parse(Buffer.from(powHeader, 'base64').toString('utf8'));
  assert.deepEqual(payload, {
    algorithm: 'DeepSeekHashV1',
    challenge: TEST_CHALLENGE_HEX,
    salt: TEST_SALT,
    answer: TEST_ANSWER,
    signature: 'sig-abc',
    target_path: '/api/v0/chat/completion',
  });
  assert.equal(payload.difficulty, undefined, '文档 §5.2：header 不带 difficulty');
  assert.equal(payload.expire_at, undefined, '文档 §5.2：header 不带 expire_at');

  // 3) 解析结果：正文只取 RESPONSE，思维链只取 THINK
  //    parentMessageId = 下一轮续聊的 parent = 本轮 assistant 消息 id（文档 §4.1）
  assert.deepEqual(result, {
    sessionId: 'sess-1',
    messageId: 2,
    parentMessageId: 2,
    reply: '好的第二段续写',
    requestMessageId: 1,
    thinking: '我们需要思考，',
    usage: 42,
    processSteps: [{ id: '0:2', type: 'thinking', text: '我们需要思考，' }],
  });

  // 4) onDelta：增量拼接应等于最终文本
  assert.ok(deltas.length > 0);
  assert.deepEqual([...new Set(deltas.map((delta) => delta.type))].sort(), ['text', 'thinking']);
  assert.equal(
    deltas.filter((delta) => delta.type === 'text').map((delta) => delta.text).join(''),
    '好的第二段续写',
  );
  assert.equal(
    deltas.filter((delta) => delta.type === 'thinking').map((delta) => delta.text).join(''),
    '我们需要思考，',
  );
  for (const delta of deltas) assert.ok(delta.text.length > 0, '不应推送空增量');
});

test('continueSession：thinking=off 时用 response/content 兜底正文', async () => {
  const sseText = framesToSse([
    `data: ${JSON.stringify({ v: { response: { message_id: 9, parent_id: 1, role: 'ASSISTANT', status: 'WIP', accumulated_token_usage: 0, fragments: [] } } })}`,
    `data: ${JSON.stringify({ p: 'response/content', o: 'APPEND', v: '直接' })}`,
    `data: ${JSON.stringify({ v: '输出' })}`,
    `data: ${JSON.stringify({ p: 'response/status', o: 'SET', v: 'FINISHED' })}`,
    'event: finish\ndata: {}',
    'event: close\ndata: {}',
  ]);
  const fetchImpl = completionFetch(sseText);
  const api = makeApi(fetchImpl);
  const result = await api.continueSession({ sessionId: 'sess-2', parentMessageId: 1, prompt: 'hi' });
  assert.equal(result.reply, '直接输出');
  assert.equal(result.thinking, '');
  assert.equal(result.messageId, 9);
  assert.equal(result.parentMessageId, 9);
  assert.equal(result.usage, 0);
});

test('continueSession：SSE hint rate_limit_reached 转成限流错误（不重试）', async () => {
  const sseText = framesToSse([
    `event: ready\ndata: ${JSON.stringify({ request_message_id: 1, response_message_id: 2 })}`,
    `event: hint\ndata: ${JSON.stringify({ type: 'error', content: '消息发送过于频繁，请稍后重试', clear_response: true, finish_reason: 'rate_limit_reached' })}`,
    'event: close\ndata: {}',
  ]);
  const fetchImpl = completionFetch(sseText);
  const api = makeApi(fetchImpl);
  await assert.rejects(
    api.continueSession({ sessionId: 'sess-3', parentMessageId: 1, prompt: 'hi' }),
    (err) => {
      assert.ok(err instanceof DeepSeekWebError);
      assert.equal(err.code, 'rate_limited');
      assert.match(err.message, /限流/);
      return true;
    },
  );
  assert.equal(fetchImpl.calls.length, 2, 'SSE 内限流不应触发自动重试（status 是 200）');
});

test('continueSession：completion 返回普通 JSON 信封（禁言）时正确报错', async () => {
  const mutedJson = envelope(
    { mute_until: 1778077771 },
    { bizCode: 5, bizMsg: 'user is muted' },
  );
  const fetchImpl = recorder((call) => {
    if (call.url.endsWith('/api/v0/chat/create_pow_challenge')) return jsonResponse(powChallengeEnvelope());
    if (call.url.endsWith('/api/v0/chat/completion')) return jsonResponse(mutedJson); // 非 SSE！
    throw new Error(`unexpected URL: ${call.url}`);
  });
  const api = makeApi(fetchImpl);
  await assert.rejects(
    api.continueSession({ sessionId: 'sess-4', parentMessageId: 1, prompt: 'hi' }),
    (err) => {
      assert.equal(err.code, 'muted');
      assert.equal(err.bizCode, 5);
      assert.match(err.message, /禁言/);
      assert.match(err.message, /预计解封时间/);
      return true;
    },
  );
});

test('continueSession：PoW 算法不被支持时抛 pow_invalid，且不发起 completion 请求', async () => {
  const fetchImpl = recorder((call) => {
    if (call.url.endsWith('/api/v0/chat/create_pow_challenge')) {
      return jsonResponse(powChallengeEnvelope({ algorithm: 'SHA-256' }));
    }
    throw new Error(`不应请求 completion：${call.url}`);
  });
  const api = makeApi(fetchImpl);
  await assert.rejects(
    api.continueSession({ sessionId: 'sess-5', parentMessageId: 1, prompt: 'hi' }),
    (err) => err instanceof DeepSeekWebError && err.code === 'pow_invalid',
  );
  assert.equal(fetchImpl.calls.length, 1);
});

// ---------------------------------------------------------------------------
// createSession（文档 §4.1）
// ---------------------------------------------------------------------------

function buildCreateSse() {
  return framesToSse([
    `event: ready\ndata: ${JSON.stringify({ request_message_id: 1, response_message_id: 9, model_type: 'default' })}`,
    // SSE 帧里带回会话 id：新建会话时以它为准
    `event: update_session\ndata: ${JSON.stringify({ updated_at: 123.45, chat_session_id: 'sse-sess' })}`,
    `data: ${JSON.stringify({ v: { response: { message_id: 9, parent_id: 1, role: 'ASSISTANT', status: 'WIP', accumulated_token_usage: 0, fragments: [{ id: 2, type: 'RESPONSE', content: '新会话回答' }] } } })}`,
    `data: ${JSON.stringify({ p: 'response/status', o: 'SET', v: 'FINISHED' })}`,
    'event: finish\ndata: {}',
    'event: close\ndata: {}',
  ]);
}

test('createSession：先建会话再 completion，sessionId 以 SSE 帧为准', async () => {
  const fetchImpl = recorder((call) => {
    if (call.url.endsWith('/api/v0/chat_session/create')) {
      return jsonResponse(envelope({ chat_session: { id: 'created-sess', seq_id: 1, title: null }, ttl_seconds: 259200 }));
    }
    if (call.url.endsWith('/api/v0/chat/create_pow_challenge')) return jsonResponse(powChallengeEnvelope());
    if (call.url.endsWith('/api/v0/chat/completion')) return sseResponse(buildCreateSse());
    throw new Error(`unexpected URL: ${call.url}`);
  });
  const api = makeApi(fetchImpl);
  const result = await api.createSession({ prompt: '第一条消息', thinking: false, search: false });

  assert.equal(fetchImpl.calls.length, 3);
  const createCall = fetchImpl.calls[0];
  assert.equal(createCall.method, 'POST');
  assert.equal(createCall.url, 'https://chat.deepseek.com/api/v0/chat_session/create');
  assert.deepEqual(createCall.body, {});
  deepEqualHeader(createCall.headers, 'authorization', 'Bearer test-token');

  const completionCall = fetchImpl.calls[2];
  assert.equal(completionCall.body.chat_session_id, 'created-sess');
  assert.equal(completionCall.body.parent_message_id, null);
  assert.equal(completionCall.body.model_type, undefined);
  assert.equal(header(completionCall.headers, 'x-hif-leim'), undefined, '未显式传 hifLeim 就不发');

  assert.deepEqual(result, {
    sessionId: 'sse-sess', // SSE 帧里的 id 覆盖 create 返回值（任务约定：sessionId 从 SSE 帧里取）
    messageId: 9,
    parentMessageId: 9, // 下一轮续聊的 parent = 本轮 assistant 消息 id
    reply: '新会话回答',
    requestMessageId: 1,
    thinking: '',
    usage: 0,
  });
});

test('createSession：create 端点失败时退化为「不带 chat_session_id 的 completion」', async () => {
  const sseText = framesToSse([
    `event: ready\ndata: ${JSON.stringify({ request_message_id: 1, response_message_id: 2 })}`,
    `event: update_session\ndata: ${JSON.stringify({ chat_session_id: 'sess-from-sse' })}`,
    `data: ${JSON.stringify({ v: { response: { message_id: 2, parent_id: 1, status: 'WIP', fragments: [{ type: 'RESPONSE', content: '兜底成功' }] } } })}`,
    'event: finish\ndata: {}',
    'event: close\ndata: {}',
  ]);
  const fetchImpl = recorder((call) => {
    if (call.url.endsWith('/api/v0/chat_session/create')) {
      return jsonResponse(envelope(null, { bizCode: 1, bizMsg: 'ILLEGAL_CHAT_SESSION_ID' }));
    }
    if (call.url.endsWith('/api/v0/chat/create_pow_challenge')) return jsonResponse(powChallengeEnvelope());
    if (call.url.endsWith('/api/v0/chat/completion')) return sseResponse(sseText);
    throw new Error(`unexpected URL: ${call.url}`);
  });
  const api = makeApi(fetchImpl);
  const result = await api.createSession({ prompt: 'hi' });
  assert.equal(result.sessionId, 'sess-from-sse');
  assert.equal(result.reply, '兜底成功');
  assert.equal(result.messageId, 2);
  assert.equal(result.parentMessageId, 2);
  const completionCalls = fetchImpl.calls.filter((call) => call.url.endsWith('/api/v0/chat/completion'));
  assert.equal(completionCalls.length, 1);
  assert.equal(completionCalls[0].body.chat_session_id, undefined, 'create 失败时 completion 不带 chat_session_id');
});

// ---------------------------------------------------------------------------
// 错误与重试（文档 §6）
// ---------------------------------------------------------------------------

test('信封 40003/40002：中文可操作提示 + 字段完整', async () => {
  const unauthorized = { code: 40003, msg: 'Authorization Failed (invalid token)', data: { biz_code: 0, biz_msg: '', biz_data: null } };
  const api403 = makeApi(recorder(() => jsonResponse(unauthorized)));
  await assert.rejects(api403.listSessions(), (err) => {
    assert.ok(err instanceof DeepSeekWebError);
    assert.equal(err.code, 'auth_invalid_token');
    assert.equal(err.status, 200);
    assert.equal(err.bizCode, 0);
    assert.equal(err.body.code, 40003);
    assert.match(err.message, /token 无效或已过期/);
    assert.match(err.message, /登录/);
    return true;
  });

  const missing = { code: 40002, msg: 'Missing Token', data: { biz_code: 0, biz_msg: '', biz_data: null } };
  const api402 = makeApi(recorder(() => jsonResponse(missing)));
  await assert.rejects(api402.listSessions(), (err) => {
    assert.equal(err.code, 'auth_missing_token');
    assert.match(err.message, /Missing Token/);
    return true;
  });
});

test('biz_code=5 muted / biz_code=10 banned：错误码与提示', async () => {
  const muted = envelope({ mute_until: 1778077771 }, { bizCode: 5, bizMsg: 'user is muted' });
  const apiMuted = makeApi(recorder(() => jsonResponse(muted)));
  await assert.rejects(apiMuted.getHistory(HISTORY_SESSION), (err) => {
    assert.equal(err.code, 'muted');
    assert.equal(err.bizCode, 5);
    assert.match(err.message, /禁言/);
    return true;
  });

  const banned = envelope(null, { bizCode: 10, bizMsg: 'USER_IS_BANNED' });
  const apiBanned = makeApi(recorder(() => jsonResponse(banned)));
  await assert.rejects(apiBanned.listSessions(), (err) => {
    assert.equal(err.code, 'banned');
    assert.match(err.message, /封禁/);
    return true;
  });
});

test('HTTP 500：自动重试一次（小退避），第二次成功', async () => {
  const page = envelope({ chat_sessions: [{ id: 's1', title: 'A', pinned: false, model_type: 'default', updated_at: 1.5 }], has_more: false });
  const fetchImpl = recorder((call, index) => {
    if (index === 0) return textResponse('upstream boom', { status: 500 });
    return jsonResponse(page);
  });
  const api = makeApi(fetchImpl);
  const result = await api.listSessions({ limit: 5 });
  assert.equal(fetchImpl.calls.length, 2, '500 应重试一次');
  assert.equal(result.sessions.length, 1);
});

test('HTTP 429：重试一次仍失败则抛 rate_limited（不无限重试）', async () => {
  const fetchImpl = recorder(() => textResponse('slow down', { status: 429 }));
  const api = makeApi(fetchImpl);
  await assert.rejects(api.listSessions(), (err) => {
    assert.equal(err.code, 'rate_limited');
    assert.equal(err.status, 429);
    assert.match(err.message, /限流|429/);
    return true;
  });
  assert.equal(fetchImpl.calls.length, 2, '最多重试一次');
});

test('AbortSignal：已取消的请求抛 aborted，不重试', async () => {
  const controller = new AbortController();
  controller.abort();
  const fetchImpl = recorder((call) => {
    if (call.signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    return jsonResponse(envelope({ chat_sessions: [], has_more: false }));
  });
  const api = makeApi(fetchImpl);
  await assert.rejects(
    api.listSessions({ signal: controller.signal }),
    (err) => err instanceof DeepSeekWebError && err.code === 'aborted',
  );
  assert.equal(fetchImpl.calls.length, 1);
});

// ---------------------------------------------------------------------------
// PoW（文档 §5.4/§5.5）
// ---------------------------------------------------------------------------

test('DeepSeekHashV1：文档 §5.5 的 4 条 hash 向量', () => {
  const vectors = [
    ['', 'e594808bc5b7151ac160c6d39a02e0a8e261ed588578403099e3561dc40c26b3'],
    ['testsalt_1700000000_42', 'd4a2ea58c89e40887c933484868380c6f803eaa8dc53a3b9df8e431b921a4f09'],
    ['testsalt_1700000000_100000', 'abea2f35796b65486e9be1b36f7878c66cab021e96faa473fdf4decd31f9ba30'],
    ['abc123salt_1700000000_12345', '74b3b7452745b70e85eb32ee7f0a9ec0381d42dd5137b695da915e104fc390e1'],
  ];
  for (const [input, expected] of vectors) {
    assert.equal(hex(deepseekHashV1(enc.encode(input))), expected, `hash 向量失败：${JSON.stringify(input)}`);
  }
  // 注意：node:crypto 的 sha3-256 是 24 轮，算不出上面的值（文档 §5.3）
  assert.notEqual(
    hex(deepseekHashV1(enc.encode(''))),
    'a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a',
    'DeepSeekHashV1 不应等于标准 sha3-256',
  );
});

test('solveChallenge：文档 §5.5 的 3 条求解向量', () => {
  const vectors = [
    { salt: 'testsalt', expireAt: 1700000000, answer: 42, difficulty: 1000 },
    { salt: 'testsalt', expireAt: 1700000000, answer: 500, difficulty: 2000 },
    { salt: 'abc123salt', expireAt: 1700000000, answer: 12345, difficulty: 20000 },
  ];
  for (const vector of vectors) {
    const challengeHex = hex(deepseekHashV1(enc.encode(`${vector.salt}_${vector.expireAt}_${vector.answer}`)));
    const got = solveChallenge({
      algorithm: 'DeepSeekHashV1',
      challenge: challengeHex,
      salt: vector.salt,
      expire_at: vector.expireAt,
      difficulty: vector.difficulty,
      signature: 'sig',
      target_path: '/api/v0/chat/completion',
    });
    assert.equal(got, vector.answer, `求解向量失败：${JSON.stringify(vector)}`);
  }
});

test('solveChallenge：文档 §5.5 真实 challenge（不硬编码 answer，验证哈希原像与耗时）', (t) => {
  const challenge = {
    algorithm: 'DeepSeekHashV1',
    challenge: '7ffc9d19b6eed96a6fca68f8ffe30ee61035d4959e4180f187bf85b356016a96',
    salt: '3bde54628ea8413fee87',
    signature: 'ce4678cf7a1290c2a7ac88c4195a5b8497e5fc4b0e8044e804f5a6f3af6fe462',
    difficulty: 144000,
    expire_at: 1775380966945,
    expire_after: 300000,
    target_path: '/api/v0/chat/completion',
  };
  const t0 = performance.now();
  const answer = solveChallenge(challenge);
  const elapsed = performance.now() - t0;

  // 用求解结果重算哈希，证明它是该 challenge 的原像（不是硬编码答案）
  const prefix = `${challenge.salt}_${challenge.expire_at}_`; // expire_at 原样，不做单位转换
  assert.equal(hex(deepseekHashV1(enc.encode(prefix + answer))), challenge.challenge);
  assert.ok(Number.isInteger(answer) && answer >= 0 && answer < challenge.difficulty, 'answer 必须落在 [0, difficulty)');
  assert.ok(elapsed < 8000, `单次求解耗时 ${elapsed.toFixed(0)}ms，超出合理预算（文档实测约 600ms）`);
  t.diagnostic(`真实 challenge：difficulty=${challenge.difficulty} answer=${answer} 耗时=${elapsed.toFixed(0)}ms`);
});

test('solveChallenge：非法算法 / 非法 challenge 字段抛 pow_invalid', () => {
  assert.throws(
    () => solveChallenge({ algorithm: 'SHA-256', challenge: 'a'.repeat(64), salt: 's', expire_at: 1, difficulty: 10 }),
    (err) => err instanceof DeepSeekWebError && err.code === 'pow_invalid',
  );
  assert.throws(
    () => solveChallenge({ algorithm: 'DeepSeekHashV1', challenge: 'abcd', salt: 's', expire_at: 1, difficulty: 10 }),
    (err) => err instanceof DeepSeekWebError && err.code === 'pow_invalid',
  );
  assert.throws(
    () => solveChallenge({ algorithm: 'DeepSeekHashV1', challenge: 'a'.repeat(64), salt: 's', expire_at: 1, difficulty: 0 }),
    (err) => err instanceof DeepSeekWebError && err.code === 'pow_invalid',
  );
});

// ---------------------------------------------------------------------------
// messagesToMarkdown
// ---------------------------------------------------------------------------

test('messagesToMarkdown：标题、用户/助手小节、思考过程、参考来源、开关', () => {
  const messages = [
    { role: 'user', text: '你好' },
    {
      role: 'assistant',
      text: '这是回答',
      thinking: '这是思考过程',
      searchResults: [{ title: '示例 A', url: 'https://a.example', snippet: '摘要' }],
    },
    { role: 'assistant', text: '', thinking: '' }, // 空消息跳过
    { role: 'system', text: '不应渲染' },
  ];
  const markdown = messagesToMarkdown(messages, { title: '测试标题' });
  assert.match(markdown, /^# 测试标题/);
  assert.match(markdown, /### 用户\n\n你好/);
  assert.match(markdown, /### DeepSeek/);
  assert.match(markdown, /<details>\n<summary>思考过程<\/summary>\n\n这是思考过程\n\n<\/details>/);
  assert.match(markdown, /这是回答/);
  assert.match(markdown, /- \[示例 A\]\(https:\/\/a\.example\)/);
  assert.ok(!markdown.includes('不应渲染'), 'system 角色不应渲染');

  const withoutThinking = messagesToMarkdown(messages, { includeThinking: false });
  assert.ok(!withoutThinking.includes('这是思考过程'), 'includeThinking=false 时不含思考内容');
  assert.ok(withoutThinking.includes('这是回答'));
  assert.match(messagesToMarkdown([], {}), /^# DeepSeek 对话/);
});

test('completion never replays a POST after partial output disconnects, with or without onDelta', async () => {
  for (const withCallback of [false, true]) {
    let posts = 0;
    const partial = 'event: ready\ndata: {"response_message_id":2}\n\ndata: {"p":"response/content","o":"APPEND","v":"partial"}\n\n';
    const fetchImpl = async (url) => {
      if (String(url).endsWith('create_pow_challenge')) return jsonResponse(powChallengeEnvelope());
      posts++;
      let delivered = false;
      return new Response(new ReadableStream({
        pull(controller) {
          if (!delivered) { delivered = true; controller.enqueue(enc.encode(partial)); }
          else controller.error(new TypeError('connection lost after the prompt was committed'));
        },
      }), { headers: { 'content-type': 'text/event-stream' } });
    };
    await assert.rejects(makeApi(fetchImpl).continueSession({
      sessionId: 'existing', prompt: 'one message', ...(withCallback ? { onDelta() {} } : {}),
    }), (error) => error.code === 'incomplete_stream');
    assert.equal(posts, 1, 'a mutating completion must never be replayed');
  }
});

test('completion rejects EOF/close before finish and accepts a completed snapshot', async () => {
  const partial = 'data: {"p":"response/content","v":"half an answer"}\n\n';
  for (const tail of ['', 'event: close\ndata: {}\n\n']) {
    await assert.rejects(makeApi(completionFetch(partial + tail)).continueSession({ sessionId: 's', prompt: 'q' }),
      (error) => error.code === 'incomplete_stream');
  }
  const finished = partial + 'data: {"p":"response/status","v":"FINISHED"}\n\n';
  assert.equal((await makeApi(completionFetch(finished)).continueSession({ sessionId: 's', prompt: 'q' })).reply, 'half an answer');
});

test('completion does not replay HTTP 500 and propagates cancellation while reading SSE', async () => {
  let posts = 0;
  const fetchImpl = async (url) => {
    if (String(url).endsWith('create_pow_challenge')) return jsonResponse(powChallengeEnvelope());
    posts++;
    return textResponse('failed after accepting the message', { status: 500 });
  };
  await assert.rejects(makeApi(fetchImpl).continueSession({ sessionId: 's', prompt: 'q' }));
  assert.equal(posts, 1);
  const controller = new AbortController();
  const abortFetch = async (url, init) => {
    if (String(url).endsWith('create_pow_challenge')) return jsonResponse(powChallengeEnvelope());
    return new Response(new ReadableStream({ start(stream) {
      init.signal.addEventListener('abort', () => stream.error(init.signal.reason), { once: true });
      controller.abort();
    } }), { headers: { 'content-type': 'text/event-stream' } });
  };
  await assert.rejects(makeApi(abortFetch).continueSession({ sessionId: 's', prompt: 'q', signal: controller.signal }),
    (error) => error.code === 'aborted');
});
