/**
 * ordering.test.js — 会话历史顺序的回归测试。
 *
 * 背景（2026-10 真实抓包）：网页端 assistant 消息的 inserted_at 可能比它回答的
 * user 消息小几毫秒（user .832 / assistant .827）。若只按时间排序，历史会变成
 * 「先回答、后提问」。这里锁定：message_id 单调递增时应优先按 message_id 排序。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DeepSeekWebApi } from '../lib/deepseek-api.js';

function envelope(bizData) {
  return { code: 0, msg: '', data: { biz_code: 0, biz_msg: '', biz_data: bizData } };
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

function makeApi(fetchImpl) {
  return new DeepSeekWebApi({ token: 'test-token', fetchImpl });
}

test('getHistory：assistant 的 inserted_at 略早于 user 时仍排成 user → assistant', async () => {
  const biz = {
    chat_session: { title: 'ordering' },
    chat_messages: [
      {
        message_id: 1,
        parent_id: null,
        role: 'USER',
        status: 'FINISHED',
        inserted_at: 1793348987.832,
        fragments: [{ type: 'REQUEST', content: '问' }]
      },
      {
        message_id: 2,
        parent_id: 1,
        role: 'ASSISTANT',
        status: 'FINISHED',
        inserted_at: 1793348987.827,
        fragments: [{ type: 'RESPONSE', content: '答' }]
      }
    ]
  };
  const api = makeApi(async () => jsonResponse(envelope(biz)));
  const history = await api.getHistory('session-1');
  assert.deepEqual(
    history.messages.map((message) => message.role),
    ['user', 'assistant']
  );
  assert.deepEqual(
    history.messages.map((message) => message.text),
    ['问', '答']
  );
});

test('getHistory：多轮对话按 message_id 保持提问/回答成对且升序', async () => {
  const rows = [
    [1, null, 'USER', 100.5, 'q1'],
    [2, 1, 'ASSISTANT', 100.4, 'a1'],
    [3, 2, 'USER', 200.9, 'q2'],
    [4, 3, 'ASSISTANT', 200.1, 'a2']
  ];
  const biz = {
    chat_session: { title: 'multi' },
    chat_messages: rows.map(([id, parent, role, insertedAt, content]) => ({
      message_id: id,
      parent_id: parent,
      role,
      status: 'FINISHED',
      inserted_at: insertedAt,
      fragments: [{ type: role === 'USER' ? 'REQUEST' : 'RESPONSE', content }]
    }))
  };
  const api = makeApi(async () => jsonResponse(envelope(biz)));
  const history = await api.getHistory('session-2');
  assert.deepEqual(
    history.messages.map((message) => message.text),
    ['q1', 'a1', 'q2', 'a2']
  );
});
