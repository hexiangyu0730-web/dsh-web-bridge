import assert from 'node:assert/strict';
import test from 'node:test';
import { DeepSeekWebApi, messageFiles } from '../lib/deepseek-api.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1sAAAAASUVORK5CYII=', 'base64');
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const envelope = files => json({ code: 0, data: { biz_code: 0, biz_data: { files } } });
const rateLimit = () => json({ code: 40029, msg: 'TOO_MANY_REQUESTS', data: { biz_code: 0, biz_data: null } });
const descriptor = id => ({ id, status: 'SUCCESS', signed_path: '/file/' + id });
const apiFor = (fetchImpl, extra) => new DeepSeekWebApi({ token: 'offline', fileRequestIntervalMs: 0, fileRateLimitDelayMs: 0, fetchImpl, ...extra });

test('24 simultaneous previews share a paced metadata lane and recover from HTTP 200 code 40029', async () => {
  let reads = 0, active = 0, peak = 0;
  const api = apiFor(async url => {
    if (url.includes('fetch_files')) {
      active++; peak = Math.max(peak, active); reads++;
      await new Promise(resolve => setTimeout(resolve, 2)); active--;
      if (reads === 4) return rateLimit();
      return envelope([descriptor(new URL(url).searchParams.get('file_ids'))]);
    }
    return new Response(png);
  });
  const images = await Promise.all(Array.from({ length: 24 }, (_, i) => api.getImage('file-' + i)));
  assert.equal(images.length, 24); assert.equal(reads, 25); assert.equal(peak, 1);
  for (const image of images) assert.deepEqual(image.bytes, png);
});

test('the shared cooldown spaces file reads instead of retrying every failed image independently', async () => {
  const starts = []; let reads = 0;
  const api = apiFor(async url => {
    if (url.includes('fetch_files')) {
      starts.push(Date.now());
      if (++reads === 1) return rateLimit();
      return envelope([descriptor(new URL(url).searchParams.get('file_ids'))]);
    }
    return new Response(png);
  }, { fileRequestIntervalMs: 20, fileRateLimitDelayMs: 60 });
  await Promise.all(['a', 'b', 'c'].map(id => api.getImage(id)));
  assert.ok(starts[1] - starts[0] >= 55);
  assert.ok(starts[2] - starts[1] >= 15 && starts[3] - starts[2] >= 15);
});

test('persistent metadata throttling is bounded and recognized as rate_limited, never cached', async () => {
  let reads = 0;
  const api = apiFor(async () => { reads++; return rateLimit(); });
  await assert.rejects(api.getImage('a'), error => error.code === 'rate_limited' && error.body.code === 40029);
  assert.equal(reads, 3);
  await assert.rejects(api.getImage('a'), error => error.code === 'rate_limited');
  assert.equal(reads, 6);
});

test('cancelling a queued preview rejects promptly, skips its request, and leaves the next attachment intact', async () => {
  let finish, entered;
  const blocked = new Promise(resolve => { finish = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const ids = [];
  const api = apiFor(async url => {
    if (url.includes('fetch_files')) {
      const id = new URL(url).searchParams.get('file_ids'); ids.push(id);
      if (id === 'first') { entered(); await blocked; }
      return envelope([descriptor(id)]);
    }
    return new Response(png);
  });
  const first = api.getImage('first'); await started;
  const controller = new AbortController();
  const cancelled = api.getImage('cancelled', { signal: controller.signal });
  const last = api.openFile('last');
  controller.abort();
  await assert.rejects(cancelled, error => error.code === 'aborted');
  finish(); await first;
  const stream = await last;
  try { for await (const chunk of stream.data) assert.deepEqual(Buffer.from(chunk), png); }
  finally { await stream.dispose(); }
  assert.deepEqual(ids, ['first', 'last']);
});

test('a missing image does not poison the lane or prevent other images and documents from loading', async () => {
  const api = apiFor(async url => url.includes('fetch_files') ? envelope(new URL(url).searchParams.get('file_ids') === 'missing' ? [] : [descriptor(new URL(url).searchParams.get('file_ids'))]) : new Response(png));
  const results = await Promise.allSettled(['first', 'missing', 'last'].map(id => api.getImage(id)));
  assert.deepEqual(results.map(item => item.status), ['fulfilled', 'rejected', 'fulfilled']);
  assert.equal(results[1].reason.code, 'file_not_found');
  const file = await api.openFile('document'); await file.dispose();
});

test('duplicate references share only brief successful metadata; a failed CDN refresh bypasses it', async () => {
  let metadata = 0, downloads = 0;
  const api = apiFor(async url => {
    if (url.includes('fetch_files')) { metadata++; return envelope([descriptor('same')]); }
    return ++downloads === 2 ? new Response('', { status: 403 }) : new Response(png);
  });
  await api.getImage('same');
  await api.getImage('same', { retryDelayMs: 0 });
  assert.equal(metadata, 2); assert.equal(downloads, 3);
});

test('partial metadata for repeated file IDs does not erase known image flags or dimensions', () => {
  const files = messageFiles({ files: [{ id: 'a', name: 'picture', is_image: true, width: 640, height: 480 }, { id: 'b', name: 'same.txt' }], fragments: [
    { type: 'FILE', files: [{ id: 'a', size: 100 }, { id: 'b', size: 20 }, { id: 'c', name: 'same.txt', size: 30 }] },
  ] });
  assert.equal(files.length, 3);
  assert.equal(files[0].isImage, true); assert.equal(files[0].width, 640); assert.equal(files[0].height, 480);
  assert.equal(files[1].id, 'b'); assert.equal(files[2].id, 'c');
});
