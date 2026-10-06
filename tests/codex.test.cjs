const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const { CodexClient } = require("../electron/codex.cjs");
function mock(t, mode = "normal") {
  const calls = [];
  let child, turn;
  const spawn = () => {
    child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    const send = (m) => child.stdout.write(JSON.stringify(m) + "\n");
    child.stdin = new Writable({
      write(chunk, enc, cb) {
        const m = JSON.parse(chunk.toString());
        calls.push(m);
        if (m.id && m.method) {
          let result = {};
          if (m.method === "account/read")
            result = {
              account: { type: "chatgpt", email: "private@example.test" },
            };
          if (m.method === "model/list")
            result = {
              data: [
                {
                  model: "available-model",
                  displayName: "Available",
                  isDefault: true,
                },
              ],
              nextCursor: null,
            };
          if (m.method === "config/read")
            result = {
              config: {
                mcp_servers: { example: { enabled: true } },
                plugins: { "example@test": { enabled: true } },
              },
            };
          if (m.method === "thread/start")
            result = {
              thread: { id: "thread-1" },
              activePermissionProfile: {
                id: mode === "bad-permission" ? "other" : "xingmiao-text-only",
              },
            };
          if (m.method === "turn/start") {
            result = { turn: { id: "turn-1" } };
            turn = () => {
              send({
                method: "item/agentMessage/delta",
                params: { threadId: "thread-1", delta: "模型回复" },
              });
              send({
                method: "item/completed",
                params: {
                  threadId: "thread-1",
                  item: { type: "agentMessage", text: "模型回复" },
                },
              });
              send({
                method: "turn/completed",
                params: {
                  threadId: "thread-1",
                  turn: { id: "turn-1", status: "completed" },
                },
              });
            };
            if (mode !== "abort") setImmediate(turn);
          }
          send({ id: m.id, result });
        }
        cb();
      },
    });
    return child;
  };
  const client = new CodexClient("mock.exe", { spawn });
  t.after(() => client.close());
  return { client, calls };
}
test("Codex 协议：动态模型、流式输出、独立受限会话且关闭继承工具", async (t) => {
  const { client, calls } = mock(t);
  await client.start();
  const status = await client.status();
  assert.equal(status.models[0].id, "available-model");
  assert.equal(JSON.stringify(status).includes("private@example.test"), false);
  let output = "";
  await client.write(
    { model: "available-model" },
    [{ role: "user", content: "写作资料" }],
    (s) => (output += s),
    new AbortController().signal,
  );
  assert.equal(output, "模型回复");
  const thread = calls.find((c) => c.method === "thread/start").params;
  assert.equal(thread.ephemeral, true);
  assert.equal(thread.approvalPolicy, "never");
  assert.equal(thread.config.mcp_servers.example.enabled, false);
  assert.equal(thread.config.plugins["example@test"].enabled, false);
  assert.equal(thread.config.features.shell_tool, false);
  assert.equal(thread.config.features.apps, false);
});
test("Codex 不确认受限权限时拒绝发送写作资料", async (t) => {
  const { client, calls } = mock(t, "bad-permission");
  await client.start();
  await assert.rejects(
    client.write(
      {},
      [{ role: "user", content: "正文" }],
      () => {},
      new AbortController().signal,
    ),
    /未确认受限/,
  );
  assert.equal(
    calls.some((c) => c.method === "turn/start"),
    false,
  );
});
test("Codex 取消时中断当前轮次，不将半截输出标为完成", async (t) => {
  const { client, calls } = mock(t, "abort");
  await client.start();
  const controller = new AbortController();
  const writing = client.write(
    {},
    [{ role: "user", content: "写作资料" }],
    () => {},
    controller.signal,
  );
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(writing, /已取消/);
  assert.ok(calls.some((c) => c.method === "turn/interrupt"));
});
