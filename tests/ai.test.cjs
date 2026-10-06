const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { requestModel, endpoint } = require("../electron/ai.cjs");
async function server(t, handler) {
  const s = http.createServer(handler);
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  t.after(() => {
    s.closeAllConnections();
    s.close();
  });
  return `http://127.0.0.1:${s.address().port}/v1`;
}
test("流式解析处理拆分数据块、多字节中文与用量", async (t) => {
  const baseUrl = await server(t, (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    const bytes = Buffer.from(
      "data: " +
        JSON.stringify({
          choices: [
            { delta: { content: "你好，故事。" }, finish_reason: null },
          ],
        }) +
        "\n\ndata: " +
        JSON.stringify({
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { total_tokens: 12 },
        }) +
        "\n\ndata: [DONE]\n\n",
    );
    res.write(bytes.subarray(0, 58));
    res.end(bytes.subarray(58));
  });
  let output = "";
  const result = await requestModel(
    { baseUrl, model: "test", temperature: 0.8, maxTokens: 100 },
    "",
    [],
    (c) => (output += c),
    AbortSignal.timeout(3000),
  );
  assert.equal(output, "你好，故事。");
  assert.equal(result.usage.total_tokens, 12);
});
test("异常结束不能假装完成", async (t) => {
  const baseUrl = await server(t, (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end('data: {"choices":[{"delta":{"content":"一半"}}]}\n\n');
  });
  let output = "";
  await assert.rejects(
    requestModel(
      { baseUrl, model: "test" },
      "",
      [],
      (c) => (output += c),
      AbortSignal.timeout(3000),
    ),
    /断开/,
  );
  assert.equal(output, "一半");
});
test("401 错误提示不包含供应商响应中的敏感数据", async (t) => {
  const baseUrl = await server(t, (_req, res) => {
    res.writeHead(401);
    res.end("secret credential echoed");
  });
  await assert.rejects(
    requestModel(
      { baseUrl, model: "test" },
      "test-key",
      [],
      () => {},
      AbortSignal.timeout(3000),
    ),
    (e) => /密钥/.test(e.message) && !e.message.includes("secret"),
  );
});
test("取消停止请求", async (t) => {
  const baseUrl = await server(t, (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('data: {"choices":[{"delta":{"content":"开始"}}]}\n\n');
  });
  const abort = new AbortController();
  await assert.rejects(
    requestModel(
      { baseUrl, model: "test" },
      "",
      [],
      () => abort.abort(),
      abort.signal,
    ),
  );
});
test("端点校验与路径拼接", () => {
  assert.equal(
    endpoint("https://example.com/v1/"),
    "https://example.com/v1/chat/completions",
  );
  assert.equal(
    endpoint("http://localhost:8080/v1/chat/completions"),
    "http://localhost:8080/v1/chat/completions",
  );
  assert.throws(() => endpoint("http://public.example/v1"), /HTTPS/);
  assert.throws(() => endpoint("https://user:pass@example.com/v1"), /密码/);
});
