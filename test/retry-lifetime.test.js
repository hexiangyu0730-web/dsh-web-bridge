import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('an awaited read retry finishes in a fresh process without any other live handles', () => {
  // A test runner or real fetch socket can mask an unreferenced retry timer.
  // This child has neither: exiting before the second attempt is a failure.
  const source = `
    import { DeepSeekWebApi } from ${JSON.stringify(new URL('../lib/deepseek-api.js', import.meta.url).href)};
    let calls = 0;
    const api = new DeepSeekWebApi({ token: 'offline-fixture', fetchImpl: async () => {
      if (++calls === 1) return new Response('temporary failure', { status: 500 });
      return new Response(JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: { chat_sessions: [] } } }));
    } });
    await api.listSessions();
    if (calls !== 2) throw new Error('read was not retried exactly once');
    console.log('retry completed');
  `;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', source],
    { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(output.trim(), 'retry completed');
});
