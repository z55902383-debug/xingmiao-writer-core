const { assert } = require("./store.cjs");
const { fetch, Agent } = require("undici");
const generationAgent = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
function endpoint(base) {
  const url = new URL(base);
  assert(
    url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)),
    "服务地址须使用 HTTPS；本机模型可使用 HTTP",
  );
  assert(
    !url.username && !url.password && !url.search && !url.hash,
    "请填写不含密码、查询参数的接口基础地址",
  );
  return `${url.href.replace(/\/$/, "").replace(/\/chat\/completions$/, "")}/chat/completions`;
}
async function requestModel(config, key, messages, onChunk, signal, onActivity = () => {}) {
  assert(config.model.trim(), "请先在模型设置中填写模型名称");
  const response = await fetch(endpoint(config.baseUrl), {
    method: "POST",
    dispatcher: generationAgent,
    redirect: "error",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true,
      ...(config.temperature === null
        ? {}
        : { temperature: config.temperature }),
      [config.tokenParam || "max_tokens"]: config.maxTokens,
    }),
  });
  if (!response.ok) {
    const reasons = {
      401: "密钥无效或未填写",
      403: "模型访问被拒绝",
      404: "接口地址或模型名称不正确",
      429: "请求过于频繁或额度不足",
    };
    throw new Error(
      `请求失败（${response.status}）：${reasons[response.status] || "请检查服务商状态和模型配置"}`,
    );
  }
  assert(response.body, "模型服务未返回内容");
  if (
    !(response.headers.get("content-type") || "").includes("text/event-stream")
  ) {
    const value = await response.json();
    const content = value.choices?.[0]?.message?.content;
    assert(
      typeof content === "string" && content.trim(),
      "接口未返回可读取的文本，请确认支持 Chat Completions",
    );
    onChunk(content);
    return {
      usage: value.usage,
      finishReason: value.choices?.[0]?.finish_reason,
    };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    usage,
    finishReason,
    ended = false;
  function line(raw) {
    if (!raw.startsWith("data:")) return;
    const value = raw.slice(5).trim();
    if (!value) return;
    if (value === "[DONE]") {
      ended = true;
      return;
    }
    let event;
    try {
      event = JSON.parse(value);
    } catch {
      throw new Error("模型返回了损坏的数据流，已保留已收到的文本");
    }
    if (event.error) throw new Error("模型服务返回错误，已保留收到的文本");
    const content = event.choices?.[0]?.delta?.content;
    if (typeof content === "string") onChunk(content);
    if (event.usage) usage = event.usage;
    if (event.choices?.[0]?.finish_reason)
      finishReason = event.choices[0].finish_reason;
  }
  try {
    while (!ended) {
      const { done, value } = await reader.read();
      if (done) break;
      onActivity();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const raw of lines) line(raw);
    }
    buffer += decoder.decode();
    if (buffer.trim()) line(buffer.trim());
    if (!ended && !finishReason)
      throw new Error("连接在生成完成前断开，已保留部分文本");
    return { usage, finishReason };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
module.exports = { requestModel, endpoint };
