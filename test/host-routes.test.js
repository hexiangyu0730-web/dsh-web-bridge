import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, basename, join, relative, resolve } from 'node:path';
import { apply } from '../lib/index.js';
import { DeepSeekWebApi } from '../lib/deepseek-api.js';

async function host(t, overrides = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-web-host-test-'));
  t.after(async () => {
    assert.equal(dirname(cwd), resolve(tmpdir()));
    assert.ok(basename(cwd).startsWith('dsh-web-host-test-'));
    await rm(cwd, { recursive: true, force: true });
  });
  let handler;
  const sections = [], creates = [], disposers = [], titles = [], followups = [];
  const ctx = {
    effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') disposers.push(cleanup); },
    emit() {},
    systemPrompt: { section(value) { sections.push(value); return () => {}; } },
    tools: { register() { return () => {}; } },
    webServer: { register(value) { handler = value.handler; return () => {}; } },
    credentials: { async resolve() { return { value: 'offline-test-token' }; }, async describe() { return { configured: true }; } },
    agentDefaultModel: { currentSelection() { return { provider: 'test-provider', model: 'test-model' }; } },
    workingDirectory: { defaultDirectory: cwd, get() { return cwd; } },
    sessions: { get() { return {}; } },
    agents: { async create(options) {
      creates.push(options);
      return { agent: { id: options.sessionId, session: { append(type, data) { titles.push({ type, data }); } }, followup(message) { followups.push(message); } }, dispose() {} };
    } },
    workspaceRegistry: { async resolveByPath() { return null; }, list() { return []; } },
    sessionPersistence: { async list() { return []; } },
    ...overrides,
  };
  apply(ctx);
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    for (const dispose of disposers.reverse()) dispose();
  });
  return { base, cwd, sections, creates, titles, followups, post: (path, body, signal) => fetch(base + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal,
  }) };
}

const transcript = [{ role: 'user', text: 'Vue template: {{foo}}' }, { role: 'assistant', text: 'Use {{bar}}.' }];

test('image route returns same-origin bytes privately and reports loaded capabilities', async (t) => {
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  t.mock.method(DeepSeekWebApi.prototype, 'getImage', async (id, options) => {
    assert.equal(id, 'file-photo');
    assert.ok(options.signal instanceof AbortSignal);
    return { bytes, contentType: 'image/png' };
  });
  const app = await host(t);
  const response = await fetch(app.base + '/deepseek-web/image?fileId=file-photo');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.equal((await fetch(app.base + '/deepseek-web/image?fileId=..%2Fa')).status, 400);
  assert.equal((await fetch(app.base + '/deepseek-web/image?fileId=file-photo', { headers: { origin: 'https://other.test' } })).status, 403);
  const health = await (await fetch(app.base + '/deepseek-web/health')).json();
  assert.equal(health.capabilities.upload, true);
  assert.equal(health.capabilities.imagePreview, true);
  assert.equal(health.capabilities.processSteps, true);
});

test('new web conversation uses createSession and subsequent turns use its real id, not a local agent', async (t) => {
  let created = 0, continued = 0;
  t.mock.method(DeepSeekWebApi.prototype, 'createSession', async (options) => {
    created++;
    assert.equal(options.prompt, 'first web turn');
    assert.deepEqual(options.fileIds, ['file-photo']);
    return { sessionId: 'new-web-session', messageId: 2, reply: 'first reply' };
  });
  t.mock.method(DeepSeekWebApi.prototype, 'getHistory', async () => ({ messages: [{ role: 'assistant', id: 2 }] }));
  t.mock.method(DeepSeekWebApi.prototype, 'continueSession', async (options) => {
    continued++;
    assert.equal(options.sessionId, 'new-web-session');
    assert.equal(options.parentMessageId, 2);
    return { sessionId: options.sessionId, messageId: 4, reply: 'next reply' };
  });
  const app = await host(t);
  assert.equal((await app.post('/deepseek-web/continue', { prompt: 'first web turn', fileIds: ['file-photo'] })).status, 200);
  assert.equal((await app.post('/deepseek-web/continue', { sessionId: 'new-web-session', prompt: 'next' })).status, 200);
  assert.equal(created, 1);
  assert.equal(continued, 1);
  assert.equal(app.creates.length, 0);
});

test('separate preview and original-file requests reuse the account client; token rotation never reuses it', async t => {
  const clients = []; let token = 'offline-one';
  t.mock.method(DeepSeekWebApi.prototype, 'getImage', async function () { clients.push(this); return { bytes: new Uint8Array([1]), contentType: 'image/png' }; });
  const app = await host(t, { credentials: { async resolve() { return { value: token }; } } });
  await fetch(app.base + '/deepseek-web/image?fileId=first');
  await fetch(app.base + '/deepseek-web/image?fileId=second');
  token = 'offline-two';
  await fetch(app.base + '/deepseek-web/image?fileId=first');
  assert.equal(clients.length, 3); assert.equal(clients[0], clients[1]); assert.notEqual(clients[0], clients[2]);
});

test('upload route forwards exact bytes and attachments reach continuation once', async (t) => {
  t.mock.method(DeepSeekWebApi.prototype, 'uploadFile', async (options) => {
    assert.equal(options.name, '示例.txt');
    assert.equal(options.bytes.toString('utf8'), 'literal {{data}}');
    assert.equal(options.contentType, 'text/plain');
    assert.ok(options.signal instanceof AbortSignal);
    return { id: 'file-one', name: options.name, size: options.bytes.length, status: 'SUCCESS' };
  });
  t.mock.method(DeepSeekWebApi.prototype, 'getHistory', async () => ({ messages: [] }));
  t.mock.method(DeepSeekWebApi.prototype, 'continueSession', async (options) => {
    assert.deepEqual(options.fileIds, ['file-one']);
    assert.equal(options.prompt, '');
    return { sessionId: options.sessionId, messageId: 2, reply: 'read' };
  });
  const app = await host(t);
  const response = await fetch(app.base + '/deepseek-web/upload', { method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('示例.txt'), 'x-file-type': 'text/plain' }, body: 'literal {{data}}' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).file.id, 'file-one');
  const completion = await app.post('/deepseek-web/continue', { sessionId: 'web', prompt: '', fileIds: ['file-one', 'file-one'] });
  assert.equal(completion.status, 200);
  assert.equal((await completion.json()).reply, 'read');
  assert.equal((await app.post('/deepseek-web/continue', { sessionId: 'web', prompt: 'a', fileIds: ['../bad'] })).status, 400);
});

test('upload route rejects cross-origin, invalid filename, wrong type and empty body', async (t) => {
  const app = await host(t);
  for (const [headers, expected, body = 'data'] of [
    [{ origin: 'https://other.test', 'content-type': 'application/octet-stream', 'x-file-name': 'a.txt' }, 403],
    [{ 'content-type': 'application/json', 'x-file-name': 'a.txt' }, 415],
    [{ 'content-type': 'application/octet-stream', 'x-file-name': '..%2Fa.txt' }, 400],
    [{ 'content-type': 'application/octet-stream', 'x-file-name': 'a.txt' }, 400, ''],
  ]) {
    assert.equal((await fetch(app.base + '/deepseek-web/upload', { method: 'POST', headers, body })).status, expected);
  }
});

test('HTTP imports preserve literal prompt braces and the original session title', async (t) => {
  const app = await host(t);
  const context = await app.post('/deepseek-web/import-text', { target: 'current', dshSessionId: 'current', transcript });
  assert.equal(context.status, 200);
  const section = app.sections.find((item) => item.name === 'user:deepseek-web-import');
  assert.equal(section.interpolate, false);
  assert.match(section.text({ agent: { session: { header: { id: 'current' } } } }), /\{\{foo\}\}/);
  const imported = await app.post('/deepseek-web/import-text', { title: 'Original web title', transcript });
  assert.equal(imported.status, 200);
  const title = app.creates[0].seed.find((event) => event.type === 'session/title');
  assert.equal(title.data.title, 'Original web title');
});

test('continuations re-read the latest web parent after an external turn', async (t) => {
  let reads = 0;
  const parents = [];
  t.mock.method(DeepSeekWebApi.prototype, 'getHistory', async () => ({ messages: [{ role: 'assistant', id: ++reads === 1 ? 2 : 6 }] }));
  t.mock.method(DeepSeekWebApi.prototype, 'continueSession', async (options) => {
    parents.push(options.parentMessageId);
    return { sessionId: options.sessionId, messageId: 4, parentMessageId: 4, reply: 'answer' };
  });
  const app = await host(t);
  for (const prompt of ['first', 'after an external turn']) {
    const response = await app.post('/deepseek-web/continue', { sessionId: 'web', prompt });
    assert.equal(response.status, 200);
  }
  assert.deepEqual(parents, [2, 6]);
});

test('selected older answers are honored for continuation and unknown branch IDs fail closed', async t => {
  const parents = [];
  t.mock.method(DeepSeekWebApi.prototype, 'getHistory', async () => ({ currentMessageId: 2, messages: [
    { id: 1, role: 'user' }, { id: 2, role: 'assistant', parentId: 1 }, { id: 8, role: 'assistant', parentId: 1 },
  ] }));
  t.mock.method(DeepSeekWebApi.prototype, 'continueSession', async options => { parents.push(options.parentMessageId); return { sessionId: 'web', messageId: 10, reply: 'answer' }; });
  const app = await host(t);
  assert.equal((await app.post('/deepseek-web/continue', { sessionId: 'web', prompt: 'default' })).status, 200);
  assert.equal((await app.post('/deepseek-web/continue', { sessionId: 'web', parentMessageId: '8', prompt: 'chosen' })).status, 200);
  for (const parentMessageId of ['foreign', 1, 99, 1.5, -1]) assert.equal((await app.post('/deepseek-web/continue', { sessionId: 'web', parentMessageId, prompt: 'invalid' })).status, 400);
  assert.deepEqual(parents, [2, 8]);
});

test('regeneration validates the existing answer and question, streams a sibling, and never creates/replays user input', async t => {
  let calls = 0, locked = false;
  t.mock.method(DeepSeekWebApi.prototype, 'getHistory', async () => ({ messages: [
    { id: 1, role: 'user', files: [{ id: 'file-one' }] }, { id: 2, parentId: 1, role: 'assistant', banRegenerate: locked },
  ] }));
  t.mock.method(DeepSeekWebApi.prototype, 'regenerateSession', async options => {
    calls++; assert.equal(options.childMessageId, 2); assert.equal(options.search, true);
    assert.equal(options.prompt, undefined); assert.equal(options.fileIds, undefined);
    options.onDelta?.({ type: 'text', text: 'new answer' });
    return { sessionId: 'web', messageId: 8, reply: 'new answer' };
  });
  const app = await host(t);
  for (const childMessageId of [0, 'bad', 1, 99]) assert.equal((await app.post('/deepseek-web/regenerate', { sessionId: 'web', childMessageId })).status, 400);
  locked = true;
  assert.equal((await app.post('/deepseek-web/regenerate', { sessionId: 'web', childMessageId: 2 })).status, 409);
  locked = false;
  const frames = (await (await app.post('/deepseek-web/regenerate', { sessionId: 'web', childMessageId: 2, search: true, stream: true })).text()).trim().split('\n').map(JSON.parse);
  assert.equal(frames.at(-1).messageId, '8'); assert.equal(frames.at(-1).reply, 'new answer');
  assert.equal(calls, 1); assert.equal(app.creates.length, 0);
  assert.equal((await fetch(app.base + '/deepseek-web/regenerate', { method: 'POST', headers: { origin: 'https://other.test', 'content-type': 'application/json' }, body: '{}' })).status, 403);
});

test('imports and Markdown follow the website-selected branch without flattening alternate answers', async t => {
  const active = [{ id: 1, role: 'user', text: 'question' }, { id: 2, parentId: 1, role: 'assistant', text: 'selected' }];
  t.mock.method(DeepSeekWebApi.prototype, 'getHistory', async () => ({ currentMessageId: 2, messages: [...active, { id: 3, parentId: 1, role: 'assistant', text: 'UNSELECTED' }], activeMessages: active }));
  const app = await host(t);
  const history = await (await fetch(app.base + '/deepseek-web/history?sessionId=web')).json();
  assert.equal(history.messages.length, 3); assert.deepEqual(history.activeMessageIds, ['1', '2']);
  assert.ok(!history.markdown.includes('UNSELECTED'));
  const imported = await (await app.post('/deepseek-web/import', { sessionId: 'web' })).json();
  assert.equal(imported.messageCount, 2);
  assert.ok(!JSON.stringify(app.creates[0].seed).includes('UNSELECTED'));
});

test('simultaneous web writes return conflict and a client disconnect aborts upstream', async (t) => {
  let started;
  const inFlight = new Promise((resolve) => { started = resolve; });
  let cancelled;
  const aborted = new Promise((resolve) => { cancelled = resolve; });
  t.mock.method(DeepSeekWebApi.prototype, 'getHistory', async () => ({ messages: [{ role: 'assistant', id: 2 }] }));
  t.mock.method(DeepSeekWebApi.prototype, 'continueSession', async ({ signal }) => new Promise((resolve, reject) => {
    started();
    signal.addEventListener('abort', () => { cancelled(); reject(new Error('aborted')); }, { once: true });
  }));
  const app = await host(t);
  const controller = new AbortController();
  const first = app.post('/deepseek-web/continue', { sessionId: 'web', prompt: 'first' }, controller.signal);
  await inFlight;
  const conflict = await app.post('/deepseek-web/continue', { sessionId: 'web', prompt: 'second' });
  assert.equal(conflict.status, 409);
  controller.abort();
  await assert.rejects(first, (error) => error.name === 'AbortError');
  await aborted;
});

test('HTTP streaming emits reasoning and text before completion, then exactly one terminal result', async (t) => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  t.after(() => finish());
  t.mock.method(DeepSeekWebApi.prototype, 'getHistory', async () => ({ messages: [] }));
  t.mock.method(DeepSeekWebApi.prototype, 'continueSession', async ({ onDelta }) => {
    onDelta({ type: 'thinking', text: '先思考🙂' });
    onDelta({ type: 'text', text: '逐字回复' });
    await pending;
    return { sessionId: 'web', messageId: 2, reply: '逐字回复完成', thinking: '先思考🙂' };
  });
  const app = await host(t);
  const response = await app.post('/deepseek-web/continue', { sessionId: 'web', prompt: 'stream', stream: true });
  assert.match(response.headers.get('content-type'), /application\/x-ndjson/);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let received = '';
  while (!received.includes('逐字回复')) received += decoder.decode((await reader.read()).value, { stream: true });
  assert.ok(!received.includes('"done"'), 'first tokens must arrive before upstream completes');
  assert.match(received, /先思考🙂/);
  finish();
  for (;;) { const part = await reader.read(); if (part.done) break; received += decoder.decode(part.value, { stream: true }); }
  const frames = received.trim().split('\n').map(JSON.parse);
  assert.equal(frames.filter(frame => frame.type === 'done').length, 1);
  assert.equal(frames.at(-1).reply, '逐字回复完成');
});

test('partial upstream streaming error is in-band and never reported as done or replayed', async (t) => {
  let calls = 0;
  t.mock.method(DeepSeekWebApi.prototype, 'createSession', async ({ onDelta }) => {
    calls++; onDelta({ type: 'text', text: 'partial' }); throw new Error('connection interrupted');
  });
  const app = await host(t);
  const response = await app.post('/deepseek-web/continue', { prompt: 'new', stream: true });
  const frames = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(calls, 1);
  assert.equal(frames.at(-1).type, 'error');
  assert.ok(frames.some(frame => frame.delta?.text === 'partial'));
  assert.ok(!frames.some(frame => frame.type === 'done'));
});

test('HTTP streaming transports live sources and preserves them in the terminal frame', async (t) => {
  const sources = [{ title: 'Source', url: 'https://example.com/one' }];
  t.mock.method(DeepSeekWebApi.prototype, 'createSession', async ({ onDelta }) => {
    onDelta({ type: 'search', results: sources });
    return { sessionId: 'web', messageId: 2, reply: 'answer', thinking: 'reasoning', searchResults: sources };
  });
  const app = await host(t);
  const frames = (await (await app.post('/deepseek-web/continue', { prompt: 'search', search: true, stream: true, includeProcess: true })).text()).trim().split('\n').map(JSON.parse);
  assert.deepEqual(frames.find(item => item.delta?.type === 'search').delta.results, sources);
  assert.deepEqual(frames.at(-1).searchResults, sources);
});

test('history and live HTTP preserve the same interleaved process without dropping bottom sources', async (t) => {
  const sources = [{ title: 'Source', url: 'https://example.com/one' }];
  const steps = [
    { id: '0:1', type: 'thinking', text: 'first', elapsedMs: 1200 },
    { id: '1:2', type: 'search', action: 'search', query: 'query', searchResults: sources },
    { id: '2:3', type: 'thinking', text: 'second', elapsedMs: 2300 },
    { id: '3:4', type: 'search', action: 'open', searchResults: [] },
  ];
  t.mock.method(DeepSeekWebApi.prototype, 'getHistory', async () => ({ title: 'Web', messages: [
    { id: 2, role: 'assistant', text: 'answer', thinking: 'first\n\nsecond', searchResults: sources, processSteps: steps, thinkingMs: 3500 },
  ] }));
  t.mock.method(DeepSeekWebApi.prototype, 'createSession', async ({ onProcess, onDelta }) => {
    for (const step of steps) onProcess?.({ type: 'process-step', step });
    onDelta({ type: 'search', results: sources });
    return { sessionId: 'web', messageId: 2, reply: 'answer', thinking: 'firstsecond', searchResults: sources, processSteps: steps, thinkingMs: 3500 };
  });
  const app = await host(t);
  const history = await (await fetch(app.base + '/deepseek-web/history?sessionId=web')).json();
  assert.deepEqual(history.messages[0].processSteps, steps);
  assert.equal(history.messages[0].thinkingMs, 3500);
  const frames = (await (await app.post('/deepseek-web/continue', { prompt: 'search', stream: true, includeProcess: true })).text()).trim().split('\n').map(JSON.parse);
  assert.deepEqual(frames.filter(item => item.delta?.type === 'process-step').map(item => item.delta.step), steps);
  assert.deepEqual(frames.at(-1).processSteps, steps);
  assert.equal(frames.at(-1).thinkingMs, 3500);
  assert.deepEqual(frames.at(-1).searchResults, sources);
  const legacyFrames = (await (await app.post('/deepseek-web/continue', { prompt: 'legacy', stream: true })).text()).trim().split('\n').map(JSON.parse);
  assert.ok(!legacyFrames.some(item => item.delta?.type === 'process-step' || item.delta?.type === 'search'), 'old clients must not receive unrecognized delta types');
  assert.deepEqual(legacyFrames.at(-1).searchResults, sources);
});

test('cancelling an active HTTP stream cancels its upstream request', async (t) => {
  let cancelled;
  const aborted = new Promise(resolve => { cancelled = resolve; });
  t.mock.method(DeepSeekWebApi.prototype, 'createSession', async ({ signal, onDelta }) => {
    onDelta({ type: 'text', text: 'one' });
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => {
      cancelled(); reject(new Error('aborted'));
    }, { once: true }));
  });
  const app = await host(t);
  const controller = new AbortController();
  const response = await app.post('/deepseek-web/continue', { prompt: 'new', stream: true }, controller.signal);
  await response.body.getReader().read();
  controller.abort();
  await aborted;
});

function mockImportHistory(t) {
  t.mock.method(DeepSeekWebApi.prototype, 'getHistory', async () => ({ title: 'With attachments', messages: [
    { role: 'user', text: '（仅附件，无文字）', files: [
      { id: 'photo', name: 'photo.png', isImage: true }, { id: 'document', name: 'notes.bin', isImage: false },
    ] },
    { role: 'assistant', text: 'Read.' },
    { role: 'user', text: 'Again', files: [{ id: 'photo', name: 'photo.png', isImage: true }] },
  ] }));
}

test('imports persist original image and file bytes as native attachments on the right messages, deduplicating downloads', async (t) => {
  mockImportHistory(t);
  const image = Buffer.from('image fixture'), document = Buffer.from([0, 255, 9, 3]);
  let imageReads = 0, fileReads = 0, disposed = 0;
  t.mock.method(DeepSeekWebApi.prototype, 'getImage', async (id, options) => {
    assert.equal(id, 'photo'); assert.equal(options.original, true); imageReads++;
    return { bytes: image, contentType: 'image/png' };
  });
  t.mock.method(DeepSeekWebApi.prototype, 'openFile', async (id) => {
    assert.equal(id, 'document'); fileReads++;
    return { data: (async function* () { yield document.subarray(0, 2); yield document.subarray(2); })(), async dispose() { disposed++; } };
  });
  const app = await host(t, { get(name) {
    assert.equal(name, 'attachments');
    return {
      async saveImage({ data, mediaType, name }) {
        assert.deepEqual(Buffer.from(data), image); assert.equal(mediaType, 'image/png'); assert.equal(name, 'photo.png');
        return { attachmentId: 'sha256:image', mediaType, width: 1, height: 1 };
      },
      async saveFileStream({ data, name }) {
        const chunks = []; for await (const chunk of data) chunks.push(chunk);
        assert.deepEqual(Buffer.concat(chunks), document); assert.equal(name, 'notes.bin');
        return { attachmentId: 'sha256:file', name, bytes: document.length };
      },
    };
  } });
  const response = await app.post('/deepseek-web/import', { sessionId: 'web' });
  assert.equal(response.status, 200);
  const report = (await response.json()).attachmentReport;
  assert.equal(report.found, 2); assert.equal(report.imported, 2); assert.deepEqual(report.failures, []);
  assert.equal(report.workspaceSaved, 2); assert.deepEqual(report.workspaceFailures, []);
  // Windows runners may give TEMP an 8.3 alias; the archive returns realpath.
  assert.equal(dirname(report.workspaceDirectory), join(await realpath(app.cwd), 'deepseek-web-attachments'));
  assert.deepEqual(await readFile(join(app.cwd, report.workspaceFiles[0].path)), image);
  assert.deepEqual(await readFile(join(app.cwd, report.workspaceFiles[1].path)), document);
  assert.equal(imageReads, 1); assert.equal(fileReads, 1); assert.equal(disposed, 1);
  const users = app.creates[0].seed.filter(event => event.type === 'user/message').map(event => event.data);
  assert.equal(users.length, 2);
  assert.deepEqual(users[0].content.map(block => block.type), ['image', 'file', 'text']);
  assert.match(users[0].content[2].text, /本地附件：deepseek-web-attachments/);
  assert.equal(users[1].content[0].attachment.attachmentId, 'sha256:image');
  assert.ok(!JSON.stringify(users).includes('https://'));
});

test('failed or unavailable attachment storage is reported and marked in the imported message', async (t) => {
  mockImportHistory(t);
  t.mock.method(DeepSeekWebApi.prototype, 'getImage', async () => ({ bytes: Buffer.from('fixture'), contentType: 'image/png' }));
  t.mock.method(DeepSeekWebApi.prototype, 'openFile', async () => ({ data: [Buffer.from('document')], async dispose() {} }));
  const app = await host(t);
  const response = await app.post('/deepseek-web/import', { sessionId: 'web' });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.attachmentReport.imported, 0);
  assert.equal(result.attachmentReport.failures.length, 2);
  assert.equal(result.attachmentReport.workspaceSaved, 2, 'original workspace copies must not depend on the native store');
  assert.match(JSON.stringify(app.creates[0].seed), /附件未导入：photo.png/);
  const context = await (await app.post('/deepseek-web/import', { sessionId: 'web', target: 'current', dshSessionId: 'current' })).json();
  assert.equal(context.attachmentReport.imported, 0);
  assert.match(context.attachmentReport.failures[0].error, /仅支持文本/);
});

test('a mixed multi-attachment import keeps every message reference and same-name original without overwriting', async t => {
  const files = Array.from({ length: 10 }, (_, i) => ({ id: 'mixed-' + i, name: i < 5 ? 'same.png' : 'same.txt', isImage: i < 5 }));
  const bytes = file => Buffer.from('original bytes ' + file.id);
  const downloaded = [], saved = [];
  t.mock.method(DeepSeekWebApi.prototype, 'getHistory', async () => ({ title: 'Mixed', messages: [
    { role: 'user', text: '', files }, { role: 'assistant', text: 'first answer' }, { role: 'user', text: 'again', files: files.slice(0, 3) },
  ] }));
  t.mock.method(DeepSeekWebApi.prototype, 'getImage', async id => { downloaded.push(id); return { bytes: bytes({ id }), contentType: 'image/png' }; });
  t.mock.method(DeepSeekWebApi.prototype, 'openFile', async id => { downloaded.push(id); return { data: [bytes({ id })], async dispose() {} }; });
  const app = await host(t, { attachments: {
    async saveImage({ data }) { saved.push(Buffer.from(data)); return { attachmentId: 'image-' + saved.length }; },
    async saveFileStream({ data }) { const chunks = []; for await (const chunk of data) chunks.push(chunk); saved.push(Buffer.concat(chunks)); return { attachmentId: 'file-' + saved.length }; },
  } });
  const result = await (await app.post('/deepseek-web/import', { sessionId: 'mixed' })).json();
  const report = result.attachmentReport;
  assert.equal(report.found, 10); assert.equal(report.imported, 10); assert.equal(report.workspaceSaved, 10);
  assert.deepEqual(report.failures, []); assert.deepEqual(report.workspaceFailures, []);
  assert.equal(new Set(downloaded).size, 10); assert.equal(downloaded.length, 10); assert.equal(saved.length, 10);
  assert.equal(new Set(report.workspaceFiles.map(file => file.path)).size, 10);
  for (const file of report.workspaceFiles) assert.deepEqual(await readFile(join(app.cwd, file.path)), bytes(file));
  const users = app.creates[0].seed.filter(event => event.type === 'user/message').map(event => event.data);
  assert.equal(users[0].content.filter(block => block.type === 'image').length, 5);
  assert.equal(users[0].content.filter(block => block.type === 'file').length, 5);
  assert.equal(users[1].content.filter(block => block.type === 'image').length, 3);
  assert.deepEqual(users[1].content[0].attachment, users[0].content[0].attachment);
});

test('one unavailable file does not discard successfully stored image attachments', async (t) => {
  mockImportHistory(t);
  t.mock.method(DeepSeekWebApi.prototype, 'getImage', async () => ({ bytes: Buffer.from('fixture'), contentType: 'image/png' }));
  t.mock.method(DeepSeekWebApi.prototype, 'openFile', async () => { throw new Error('expired'); });
  const app = await host(t, { attachments: {
    async saveImage() { return { attachmentId: 'sha256:image' }; }, async saveFileStream() { throw new Error('should not run'); },
  } });
  const result = await (await app.post('/deepseek-web/import', { sessionId: 'web' })).json();
  assert.equal(result.attachmentReport.imported, 1);
  assert.deepEqual(result.attachmentReport.failures, [{ name: 'notes.bin', error: 'expired' }]);
  assert.match(JSON.stringify(app.creates[0].seed), /sha256:image/);
});

test('seed fallback keeps the downloaded native attachments in its context message', async (t) => {
  mockImportHistory(t);
  t.mock.method(DeepSeekWebApi.prototype, 'getImage', async () => ({ bytes: Buffer.from('fixture'), contentType: 'image/png' }));
  t.mock.method(DeepSeekWebApi.prototype, 'openFile', async () => { throw new Error('expired'); });
  const followups = [];
  const app = await host(t, { attachments: { async saveImage() { return { attachmentId: 'sha256:image' }; }, async saveFileStream() {} },
    agents: { async create(options) {
      if (options.seed) throw new Error('seed unsupported');
      return { agent: { id: options.sessionId, session: { append() {} }, followup(message) { followups.push(message); } }, dispose() {} };
    } },
  });
  const result = await (await app.post('/deepseek-web/import', { sessionId: 'web' })).json();
  assert.equal(result.mode, 'message');
  assert.equal(followups[0].content[0].attachment.attachmentId, 'sha256:image');
  assert.match(followups[0].content.at(-1).text, /附件未导入：notes.bin/);
});

test('cancelling an attachment import does not create a half-imported DSH session', async (t) => {
  mockImportHistory(t);
  let started, cancelled;
  const inFlight = new Promise(resolve => { started = resolve; });
  const aborted = new Promise(resolve => { cancelled = resolve; });
  t.mock.method(DeepSeekWebApi.prototype, 'getImage', async (id, { signal }) => {
    started();
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => { cancelled(); reject(new Error('aborted')); }, { once: true }));
  });
  const app = await host(t, { attachments: {} });
  const controller = new AbortController();
  const request = app.post('/deepseek-web/import', { sessionId: 'web' }, controller.signal);
  await inFlight;
  controller.abort();
  await assert.rejects(request, error => error.name === 'AbortError');
  await aborted;
  assert.equal(app.creates.length, 0);
});

test('drag-import workspaceId stores originals in that workspace, never the default cwd', async (t) => {
  mockImportHistory(t);
  t.mock.method(DeepSeekWebApi.prototype, 'getImage', async () => ({ bytes: Buffer.from('original-image'), contentType: 'image/png' }));
  t.mock.method(DeepSeekWebApi.prototype, 'openFile', async () => ({ data: [Buffer.from('original-file')], async dispose() {} }));
  let target;
  const app = await host(t, { workspaceRegistry: {
    get(id) { assert.equal(id, 'chosen'); return { path: target, async status() { return 'ready'; }, sessionIds: [], async attachSession() {} }; },
  }, attachments: { async saveImage() { return { attachmentId: 'sha256:photo' }; }, async saveFileStream({ data }) {
    for await (const chunk of data) {} return { attachmentId: 'sha256:document' };
  } } });
  target = join(app.cwd, 'selected-workspace'); await mkdir(target);
  const response = await app.post('/deepseek-web/import', { sessionId: 'web', workspaceId: 'chosen' });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(app.creates[0].meta.cwd, target);
  assert.equal(dirname(result.attachmentReport.workspaceDirectory), join(await realpath(target), 'deepseek-web-attachments'));
  assert.equal(result.attachmentReport.workspaceSaved, 2);
  assert.deepEqual(await readFile(join(target, result.attachmentReport.workspaceFiles[0].path)), Buffer.from('original-image'));
});

test('workspace-copy failure is explicit, keeps native attachments and leaves existing files unchanged', async (t) => {
  mockImportHistory(t);
  t.mock.method(DeepSeekWebApi.prototype, 'getImage', async () => ({ bytes: Buffer.from('image'), contentType: 'image/png' }));
  t.mock.method(DeepSeekWebApi.prototype, 'openFile', async () => ({ data: [Buffer.from('file')], async dispose() {} }));
  const app = await host(t, { attachments: { async saveImage() { return { attachmentId: 'sha256:photo' }; },
    async saveFileStream({ data }) { for await (const chunk of data) {} return { attachmentId: 'sha256:document' }; },
  } });
  await writeFile(join(app.cwd, 'deepseek-web-attachments'), 'user-owned');
  const report = (await (await app.post('/deepseek-web/import', { sessionId: 'web' })).json()).attachmentReport;
  assert.equal(report.imported, 2); assert.equal(report.workspaceSaved, 0);
  assert.equal(report.workspaceFailures.length, 2);
  assert.equal(await readFile(join(app.cwd, 'deepseek-web-attachments'), 'utf8'), 'user-owned');
});

test('remote delete requires explicit confirmation, validates its target and touches no local session', async (t) => {
  let calls = 0;
  t.mock.method(DeepSeekWebApi.prototype, 'deleteSession', async (id, { signal }) => {
    calls++; assert.equal(id, 'web-one'); assert.ok(signal instanceof AbortSignal);
  });
  const app = await host(t);
  for (const body of [{ sessionId: 'web-one' }, { sessionId: '../bad', confirm: true }, { sessionId: 'web-one', confirm: 'true' }]) {
    assert.equal((await app.post('/deepseek-web/delete', body)).status, 400);
  }
  assert.equal(calls, 0);
  const crossOrigin = await fetch(app.base + '/deepseek-web/delete', { method: 'POST', headers: {
    origin: 'https://other.test', 'content-type': 'application/json',
  }, body: JSON.stringify({ sessionId: 'web-one', confirm: true }) });
  assert.equal(crossOrigin.status, 403);
  const response = await app.post('/deepseek-web/delete', { sessionId: 'web-one', confirm: true });
  assert.deepEqual(await response.json(), { ok: true, sessionId: 'web-one' });
  assert.equal(calls, 1); assert.equal(app.creates.length, 0);
});

test('remote deletion is exclusive with sending and never replays an uncertain mutation', async (t) => {
  let release, started, calls = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const inFlight = new Promise(resolve => { started = resolve; });
  t.after(() => release());
  t.mock.method(DeepSeekWebApi.prototype, 'deleteSession', async () => { calls++; started(); await pending; throw new Error('uncertain'); });
  const app = await host(t);
  const deletion = app.post('/deepseek-web/delete', { sessionId: 'web-one', confirm: true });
  await inFlight;
  assert.equal((await app.post('/deepseek-web/continue', { sessionId: 'web-one', prompt: 'no' })).status, 409);
  assert.equal((await app.post('/deepseek-web/delete', { sessionId: 'web-one', confirm: true })).status, 409);
  release();
  assert.equal((await deletion).status, 500);
  assert.equal(calls, 1);
});

test('rename route validates, trims and returns only the requested web title without changing local sessions', async (t) => {
  let calls = 0;
  t.mock.method(DeepSeekWebApi.prototype, 'renameSession', async (id, title, { signal }) => {
    calls++; assert.equal(id, 'web-one'); assert.equal(title, '新的网页标题'); assert.ok(signal instanceof AbortSignal);
  });
  const app = await host(t);
  for (const body of [{ sessionId: '../bad', title: 'new' }, { sessionId: 'web-one', title: ' ' }, { sessionId: 'web-one', title: 'a'.repeat(201) }, { sessionId: 'web-one', title: 'bad\nname' }]) {
    assert.equal((await app.post('/deepseek-web/rename', body)).status, 400);
  }
  const result = await (await app.post('/deepseek-web/rename', { sessionId: 'web-one', title: ' 新的网页标题 ' })).json();
  assert.deepEqual(result, { ok: true, sessionId: 'web-one', title: '新的网页标题' });
  assert.equal(calls, 1); assert.deepEqual(app.titles, []); assert.deepEqual(app.creates, []);
});
