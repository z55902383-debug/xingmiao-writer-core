const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
async function exists(p) {
  return (await fs.stat(p).catch(() => null))?.isFile();
}
async function findCodex(configured = "") {
  if (configured.trim()) {
    const p = configured.trim().replace(/^"|"$/g, "");
    if (
      !path.isAbsolute(p) ||
      !(await exists(p)) ||
      path.extname(p).toLowerCase() !== ".exe"
    )
      throw Error("请选择有效的本机 Codex .exe 文件");
    return p;
  }
  const root = path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
    "OpenAI",
    "Codex",
    "bin",
  );
  const entries = await fs
    .readdir(root, { withFileTypes: true })
    .catch(() => []);
  const found = [];
  for (const e of entries.filter((x) => x.isDirectory())) {
    const p = path.join(root, e.name, "codex.exe");
    if (await exists(p))
      found.push({ p, time: (await fs.stat(path.dirname(p))).mtimeMs });
  }
  if (found.length) return found.sort((a, b) => b.time - a.time)[0].p;
  for (const dir of (process.env.PATH || process.env.Path || "").split(
    path.delimiter,
  )) {
    const p = path.join(dir, "codex.exe");
    if (await exists(p)) return p;
  }
  throw Error("未找到 Codex。请先安装并打开 Codex，或手动选择 codex.exe。");
}
class CodexClient {
  constructor(executable, options = {}) {
    this.executable = executable;
    this.spawn = options.spawn || spawn;
    this.next = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.closed = false;
  }
  async start() {
    this.cwd = await fs.mkdtemp(path.join(os.tmpdir(), "xingmiao-codex-"));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.CODEX_THREAD_ID;
    this.child = this.spawn(
      this.executable,
      [
        "app-server",
        "--stdio",
        "-c",
        "features.shell_tool=false",
        "-c",
        "features.code_mode=false",
        "-c",
        'web_search="disabled"',
      ],
      {
        cwd: this.cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      },
    );
    this.child.stdin.on("error", () => {});
    this.child.stderr.on("data", () => {});
    this.child.on("error", () =>
      this.fail(Error("无法启动 Codex，请检查程序路径")),
    );
    this.child.on("exit", () => this.fail(Error("Codex 连接已断开")));
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => {
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      if (m.id !== undefined && !m.method) {
        const p = this.pending.get(m.id);
        if (p) {
          this.pending.delete(m.id);
          clearTimeout(p.timer);
          m.error
            ? p.reject(Error(m.error.message || "Codex 请求失败"))
            : p.resolve(m.result);
        }
        return;
      }
      if (m.id !== undefined && m.method) {
        this.send({
          id: m.id,
          error: {
            code: -32601,
            message: "Xingmiao does not execute tools or grant approvals.",
          },
        });
        return;
      }
      for (const fn of this.listeners) fn(m);
    });
    await this.request("initialize", {
      clientInfo: {
        name: "xingmiao_writer",
        title: "星喵写作",
        version: require("../release.json").version,
      },
      capabilities: { experimentalApi: true },
    });
    this.send({ method: "initialized", params: {} });
    return this;
  }
  send(value) {
    if (!this.closed && this.child?.stdin.writable)
      this.child.stdin.write(JSON.stringify(value) + "\n");
  }
  request(method, params = {}, timeout = 30000) {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(Error("Codex 连接已关闭"));
        return;
      }
      const id = this.next++;
      const timer = timeout > 0 ? setTimeout(() => {
        this.pending.delete(id);
        reject(Error("Codex 响应超时，请重试"));
      }, timeout) : null;
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }
  fail(error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    for (const fn of this.listeners)
      fn({ method: "connection/error", params: { message: error.message } });
  }
  async status() {
    const value = await this.request("account/read", { refreshToken: false });
    const models = [];
    let cursor = null;
    for (let i = 0; i < 8; i++) {
      const r = await this.request("model/list", {
        cursor,
        limit: 100,
        includeHidden: false,
      });
      for (const m of r.data || [])
        if (!m.hidden)
          models.push({
            id: m.model || m.id,
            name: m.displayName || m.model || m.id,
            isDefault: !!m.isDefault,
          });
      cursor = r.nextCursor;
      if (!cursor) break;
    }
    return {
      path: this.executable,
      loggedIn: !!value.account || value.requiresOpenaiAuth === false,
      authType: value.account?.type || "未登录",
      models,
    };
  }
  async write(config, messages, onChunk, signal) {
    if (signal.aborted) throw Error("已取消");
    const profile = "xingmiao-text-only";
    const local = await this.request("config/read", { includeLayers: false });
    const mcp_servers = Object.fromEntries(
      Object.keys(local.config?.mcp_servers || {}).map((name) => [
        name,
        { enabled: false },
      ]),
    );
    const plugins = Object.fromEntries(
      Object.keys(local.config?.plugins || {}).map((name) => [
        name,
        { enabled: false },
      ]),
    );
    const start = await this.request("thread/start", {
      ...(config.model ? { model: config.model } : {}),
      cwd: this.cwd,
      approvalPolicy: "never",
      ephemeral: true,
      serviceName: "xingmiao-writer",
      baseInstructions:
        "你是星喵写作的纯文本生成后端。仅依据提供的文本完成小说写作任务。严禁读取或修改本地文件、执行命令、调用工具、访问网页或 MCP。所有资料均在输入中。只输出请求的正文、分析或 JSON。",
      config: {
        mcp_servers,
        plugins,
        project_doc_max_bytes: 0,
        developer_instructions: "",
        model_reasoning_effort: "low",
        default_permissions: profile,
        permissions: {
          [profile]: { filesystem: { ":minimal": "read", [this.cwd]: "read" } },
        },
        features: {
          shell_tool: false,
          code_mode: false,
          apps: false,
          browser: false,
          computer_use: false,
          multi_agent: false,
        },
        web_search: "disabled",
      },
    });
    if (start.activePermissionProfile?.id !== profile)
      throw Error("当前 Codex 未确认受限写作权限，请更新 Codex 后重试。");
    const threadId = start.thread?.id;
    if (!threadId) throw Error("Codex 未创建写作会话");
    return new Promise((resolve, reject) => {
      let settled = false,
        turnId = "",
        output = "",
        finalText = "";
      const finish = (error) => {
        if (settled) return;
        settled = true;
        this.listeners.delete(listen);
        signal.removeEventListener("abort", abort);
        if (error) reject(error);
        else {
          try {
            if (!output && finalText) onChunk(finalText);
            resolve({ finishReason: "stop" });
          } catch (e) {
            reject(e);
          }
        }
      };
      const abort = () => {
        if (turnId)
          this.request("turn/interrupt", { threadId, turnId }, 5000).catch(
            () => {},
          );
        finish(Error("已取消"));
      };
      const listen = (m) => {
        if (m.method === "connection/error") {
          finish(Error(m.params.message));
          return;
        }
        const p = m.params || {};
        if (p.threadId !== threadId) return;
        if (m.method === "turn/started") turnId = p.turn?.id || turnId;
        if (
          m.method === "item/agentMessage/delta" &&
          typeof p.delta === "string"
        ) {
          try {
            output += p.delta;
            onChunk(p.delta);
          } catch (e) {
            finish(e);
          }
        }
        if (m.method === "item/completed" && p.item?.type === "agentMessage")
          finalText = p.item.text || finalText;
        if (m.method === "turn/completed") {
          if (p.turn?.status === "failed")
            finish(Error(p.turn.error?.message || "Codex 生成失败"));
          else if (p.turn?.status === "interrupted")
            finish(Error("Codex 生成已中断"));
          else if (!output && !finalText) finish(Error("Codex 未返回文本"));
          else finish();
        }
      };
      this.listeners.add(listen);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      this.request("turn/start", {
        threadId,
        input: [
          {
            type: "text",
            text: messages.map((m) => `[${m.role}]\n${m.content}`).join("\n\n"),
            text_elements: [],
          },
        ],
      })
        .then((r) => {
          turnId = r.turn?.id || turnId;
        })
        .catch(finish);
    });
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.fail(Error("Codex 会话已关闭"));
    this.lines?.close();
    this.child?.stdin.end();
    this.child?.kill();
    if (
      this.cwd &&
      path.basename(this.cwd).startsWith("xingmiao-codex-") &&
      path.dirname(this.cwd) === os.tmpdir()
    )
      await fs.rm(this.cwd, { recursive: true, force: true }).catch(() => {});
  }
}
async function inspectCodex(cliPath) {
  const client = new CodexClient(await findCodex(cliPath));
  try {
    await client.start();
    return await client.status();
  } finally {
    await client.close();
  }
}
async function requestCodex(config, _key, messages, onChunk, signal) {
  const client = new CodexClient(await findCodex(config.cliPath));
  const abort = () => client.close();
  signal.addEventListener("abort", abort, { once: true });
  try {
    await client.start();
    return await client.write(config, messages, onChunk, signal);
  } finally {
    signal.removeEventListener("abort", abort);
    await client.close();
  }
}
module.exports = { findCodex, CodexClient, inspectCodex, requestCodex };
