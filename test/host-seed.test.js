// dsh-deepseek-web —— 导入 seed 构造的单元测试（无网络、无 DSH 运行时依赖）。

import assert from "node:assert/strict";
import test from "node:test";

import { buildSeed, toTranscript } from "../lib/index.js";

const ALLOWED_EVENT_KEYS = new Set(["type", "seq", "time", "data", "surfaceOp", "sourceEventSeqs", "ignorable"]);
const SURFACE_TYPES = new Set([
  "user/message",
  "assistant/message",
  "system/message",
  "developer/message",
  "tool/result"
]);

function assertSeedShape(events) {
  events.forEach((event, index) => {
    assert.equal(event.seq, index, `seq at index ${index} must be contiguous`);
    for (const key of Object.keys(event)) {
      assert.ok(ALLOWED_EVENT_KEYS.has(key), `unexpected event key ${key}`);
    }
    assert.equal(typeof event.type, "string");
    assert.ok(event.time > 0);
    assert.equal(typeof event.data, "object");
    if (SURFACE_TYPES.has(event.type)) {
      assert.equal(event.surfaceOp, "append", `${event.type} must carry surfaceOp:'append'`);
    }
  });
}

test("two complete exchanges produce balanced turn/step events", () => {
  const events = buildSeed(
    [
      { role: "user", text: "你好" },
      { role: "assistant", text: "你好，有什么可以帮你？" },
      { role: "user", text: "介绍一下你自己" },
      { role: "assistant", text: "我是 DeepSeek。" }
    ],
    "deepseek-account",
    "deepseek-chat"
  );
  assertSeedShape(events);
  const types = events.map((event) => event.type);
  assert.deepEqual(
    types,
    [
      "turn/start",
      "step/start",
      "user/message",
      "assistant/message",
      "step/end",
      "turn/end",
      "turn/start",
      "step/start",
      "user/message",
      "assistant/message",
      "step/end",
      "turn/end"
    ]
  );
  const turns = events.filter((event) => event.type === "turn/start").map((event) => event.data.turn);
  assert.deepEqual(turns, [1, 2]);
  const assistant = events.find((event) => event.type === "assistant/message");
  assert.deepEqual(assistant.data.message.source, {
    kind: "model",
    provider: "deepseek-account",
    model: "deepseek-chat"
  });
  assert.deepEqual(assistant.data.stream, []);
  const user = events.find((event) => event.type === "user/message");
  assert.equal(user.data.role, "user");
  assert.deepEqual(user.data.source, { kind: "user" });
  assert.deepEqual(user.data.content, [{ type: "text", text: "你好" }]);
  assert.equal(typeof user.data.id, "string");
  assert.ok(user.data.id.length > 0);
});

test("transcript ending with a user message closes the open turn", () => {
  const events = buildSeed(
    [
      { role: "user", text: "只问不答？" },
      { role: "assistant", text: "答" },
      { role: "user", text: "追问" }
    ],
    "p",
    "m"
  );
  assertSeedShape(events);
  assert.deepEqual(events[events.length - 1], {
    type: "turn/end",
    seq: events.length - 1,
    time: events[events.length - 1].time,
    data: { turn: 2, reason: { kind: "completed" } }
  });
});

test("transcript starting with an assistant message stays structurally valid", () => {
  const events = buildSeed(
    [
      { role: "assistant", text: "导入的开场白" },
      { role: "user", text: "继续" }
    ],
    "p",
    "m"
  );
  assertSeedShape(events);
  assert.equal(events[0].type, "assistant/message");
});

test("toTranscript keeps only user/assistant text and trims blanks", () => {
  const transcript = toTranscript([
    { role: "user", text: "  问题  " },
    { role: "tool", text: "忽略" },
    { role: "assistant", text: "" },
    { role: "assistant", text: "回答" }
  ]);
  assert.deepEqual(transcript, [
    { role: "user", text: "问题" },
    { role: "assistant", text: "回答" }
  ]);
});

test("toTranscript 默认带上思维链，并把联网搜索参考写进助手正文", () => {
  const transcript = toTranscript([
    { role: "user", text: "搜一下今天的新闻" },
    {
      role: "assistant",
      text: "今天有一条新闻。",
      thinking: "先搜索再总结",
      searchResults: [
        { title: "新闻标题", url: "https://example.com/news", snippet: "新闻摘要" },
        { title: "第二条", url: "https://example.com/two", snippet: "" }
      ]
    }
  ]);
  assert.equal(transcript.length, 2);
  assert.equal(transcript[1].thinking, "先搜索再总结");
  assert.match(transcript[1].text, /今天有一条新闻/);
  assert.match(transcript[1].text, /\[联网搜索参考\]/);
  assert.match(transcript[1].text, /1\. 新闻标题 — https:\/\/example\.com\/news/);
  assert.match(transcript[1].text, /2\. 第二条 — https:\/\/example\.com\/two/);
  assert.match(transcript[1].text, /新闻摘要/);
});

test("toTranscript includeThinking:false 去掉思考但仍保留搜索参考", () => {
  const transcript = toTranscript(
    [
      {
        role: "assistant",
        text: "答案",
        thinking: "不该出现",
        searchResults: [{ title: "参考", url: "https://example.com/ref" }]
      }
    ],
    { includeThinking: false }
  );
  assert.equal(transcript[0].thinking, undefined);
  assert.match(transcript[0].text, /\[联网搜索参考\]/);
});

test("buildSeed 把思维链写成 assistant 的 reasoning 内容块", () => {
  const events = buildSeed(
    [
      { role: "user", text: "问题" },
      { role: "assistant", text: "回答", thinking: "推理过程" }
    ],
    "p",
    "m"
  );
  const assistant = events.find((event) => event.type === "assistant/message");
  assert.deepEqual(assistant.data.message.content, [
    { type: "reasoning", text: "推理过程" },
    { type: "text", text: "回答" }
  ]);
});
