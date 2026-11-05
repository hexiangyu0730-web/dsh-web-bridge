import test from 'node:test';
import assert from 'node:assert/strict';
import { DeepSeekWebApi, messageFiles, signedImageUrl, signedFileUrl, MAX_IMAGE_BYTES, MAX_IMPORT_FILE_BYTES } from '../lib/deepseek-api.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1sAAAAASUVORK5CYII=', 'base64');
const envelope = (biz) => new Response(JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: biz } }), { headers: { 'content-type': 'application/json' } });

test('FILE fragments and legacy file descriptors preserve images, aliases and deduplicate ids', () => {
  const files = messageFiles({ files: [{ id: 'file-photo', name: 'photo.png' }], fragments: [
    { type: 'FILE', files: [{ file_id: 'file-photo', file_name: '截图.png', file_size: 123, is_image: true, width: 640, height: 480 },
      { fileId: 'file-document', fileName: 'notes.txt', size: 12 }, { id: '../bad', name: 'unsafe.png' }] },
    { type: 'RESPONSE', files: [{ id: 'ignored', name: 'ignored.png' }] },
  ] });
  assert.equal(files.length, 2);
  assert.deepEqual(files[0], { id: 'file-photo', name: '截图.png', size: 123, isImage: true, width: 640, height: 480 });
  assert.equal(files[1].isImage, false);
});

test('history retains attachment-only FILE fragment images', async () => {
  const api = new DeepSeekWebApi({ token: 'test', fetchImpl: async () => envelope({ chat_messages: [
    { role: 'USER', message_id: 1, fragments: [{ type: 'FILE', files: [{ id: 'file-photo', file_name: 'a.png', is_image: true }] }] },
  ] }) });
  const history = await api.getHistory('chat');
  assert.equal(history.messages[0].text, '（仅附件，无文字）');
  assert.equal(history.messages[0].files[0].isImage, true);
});

test('image read refreshes signed path, adds ty=p and never forwards token to CDN', async () => {
  const calls = [];
  const api = new DeepSeekWebApi({ token: 'private-test-token', fetchImpl: async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) return envelope({ files: [{ id: 'file-photo', signed_path: '/file/picture?signature=example' }] });
    return new Response(png, { headers: { 'content-type': 'application/octet-stream' } });
  } });
  const image = await api.getImage('file-photo');
  assert.equal(image.contentType, 'image/png');
  assert.deepEqual(image.bytes, png);
  assert.match(calls[0].init.headers.Authorization, /^Bearer /);
  assert.equal(new URL(calls[1].url).origin, 'https://files.deepseeksvc.com');
  assert.equal(new URL(calls[1].url).searchParams.get('ty'), 'p');
  assert.equal(calls[1].init.headers.Authorization, undefined);
  assert.equal(calls[1].init.headers.Cookie, undefined);
  assert.equal(calls[1].init.redirect, 'manual');
  assert.equal(calls[1].init.credentials, 'omit');
});

test('image paths cannot select another host, local service or non-HTTPS origin', () => {
  for (const path of ['http://127.0.0.1/api/image', 'https://evil.test/api/a', '//127.0.0.1/a',
    'https://files.deepseeksvc.com@evil.test/api/a', '/../../secret', '/bad\\path', '/file\na',
    'http://files.deepseeksvc.com/api/a']) {
    assert.throws(() => signedImageUrl(path), (error) => error.code === 'bad_response');
  }
  assert.equal(new URL(signedImageUrl('/file/a?ty=r')).searchParams.get('ty'), 'p');
});

test('image redirect, HTML disguised as a picture and oversize responses are refused', async () => {
  for (const mode of ['redirect', 'html', 'too-large']) {
    let calls = 0;
    const api = new DeepSeekWebApi({ token: 'test', fetchImpl: async () => {
      if (++calls === 1) return envelope({ files: [{ id: 'file-photo', signed_path: '/file/a' }] });
      if (mode === 'redirect') return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/' } });
      if (mode === 'html') return new Response('<html>not an image</html>', { headers: { 'content-type': 'image/png' } });
      return new Response(png, { headers: { 'content-length': String(MAX_IMAGE_BYTES + 1) } });
    } });
    await assert.rejects(api.getImage('file-photo'), (error) => ['image_unavailable', 'bad_response', 'too_large'].includes(error.code));
    assert.equal(calls, 2);
  }
});

test('image size limit is enforced on chunked bodies without content-length', async () => {
  let calls = 0;
  const api = new DeepSeekWebApi({ token: 'test', fetchImpl: async () => {
    if (++calls === 1) return envelope({ files: [{ id: 'file-photo', signed_path: '/file/a' }] });
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_IMAGE_BYTES + 1)); controller.close(); } }));
  } });
  await assert.rejects(api.getImage('file-photo'), (error) => error.code === 'too_large');
});

test('image retrieval supports cancellation and missing files fail explicitly', async () => {
  const controller = new AbortController();
  let calls = 0;
  const api = new DeepSeekWebApi({ token: 'test', fetchImpl: async () => {
    if (++calls === 1) return envelope({ files: [{ id: 'file-photo', signed_path: '/file/a' }] });
    controller.abort();
    throw new DOMException('cancelled', 'AbortError');
  } });
  await assert.rejects(api.getImage('file-photo', { signal: controller.signal }), (error) => error.code === 'aborted');
  const missing = new DeepSeekWebApi({ token: 'test', fetchImpl: async () => envelope({ files: [] }) });
  await assert.rejects(missing.getImage('file-photo'), (error) => error.status === 404);
});

test('image first-load pending metadata and CDN propagation failures refresh automatically', async () => {
  let metadata = 0, downloads = 0;
  const api = new DeepSeekWebApi({ token: 'test', fetchImpl: async (url) => {
    if (url.includes('fetch_files')) return envelope({ files: [{ id: 'file-photo', status: ++metadata === 1 ? 'PENDING' : 'SUCCESS', signed_path: '/file/a' }] });
    return ++downloads === 1 ? new Response('pending', { status: 403 }) : new Response(png);
  } });
  const result = await api.getImage('file-photo', { retryDelayMs: 0, original: true });
  assert.deepEqual(result.bytes, png);
  assert.equal(metadata, 3); assert.equal(downloads, 2);
});

test('original file downloads preserve exact bytes with ty=r, no CDN token and explicit disposal', async () => {
  const bytes = Buffer.from([0, 255, 128, 1, 10]);
  const api = new DeepSeekWebApi({ token: 'private', fetchImpl: async (url, init) => {
    if (url.includes('fetch_files')) return envelope({ files: [{ id: 'file-doc', signed_path: '/file/a?sig=test' }] });
    assert.equal(new URL(url).searchParams.get('ty'), 'r');
    assert.equal(init.headers.Authorization, undefined); assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'manual');
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.subarray(0, 2)); controller.enqueue(bytes.subarray(2)); controller.close(); } }));
  } });
  const source = await api.openFile('file-doc'), chunks = [];
  try { for await (const chunk of source.data) chunks.push(chunk); } finally { await source.dispose(); }
  assert.deepEqual(Buffer.concat(chunks), bytes);
  assert.equal(new URL(signedFileUrl('/file/a?ty=p')).searchParams.get('ty'), 'r');
});

test('original file downloads refuse redirects, large declared and large chunked bodies', async () => {
  for (const mode of ['redirect', 'declared', 'chunked']) {
    const api = new DeepSeekWebApi({ token: 'test', fetchImpl: async (url) => {
      if (url.includes('fetch_files')) return envelope({ files: [{ id: 'doc', signed_path: '/file/a' }] });
      if (mode === 'redirect') return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/' } });
      if (mode === 'declared') return new Response('large', { headers: { 'content-length': String(MAX_IMPORT_FILE_BYTES + 1) } });
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_IMPORT_FILE_BYTES + 1)); controller.close(); } }));
    } });
    await assert.rejects(async () => {
      const source = await api.openFile('doc');
      try { for await (const chunk of source.data) { /* drain and enforce limit */ } } finally { await source.dispose(); }
    }, error => ['too_large', 'file_unavailable'].includes(error.code));
  }
});
