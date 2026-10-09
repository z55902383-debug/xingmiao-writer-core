const { dialog, shell, app } = require("electron");
const fs = require("node:fs/promises");
const { join, basename } = require("node:path");
const { assert, text } = require("./store.cjs");
const { parseSkill, exportSkill, KINDS } = require("./extensions.cjs");
const { randomUUID } = require("node:crypto");

const { inspectCodex, CodexClient, findCodex } = require("./codex.cjs");

const release = require("../release.json");
let loginClient = null;
async function closeLogin() {
  await loginClient?.close();
  loginClient = null;
}
function settingsActions({ store, window, publicConfig, saveFile, running,  }) {
  return {
    ...require("./memo-actions.cjs").memoActions(store),
    "manuscript:get": () => require("./manuscript-format.mjs").normalizeManuscriptFormat(store.setting("manuscript-formatting", {})),
    "manuscript:set": (d) => {
      const prefs = require("./manuscript-format.mjs").normalizeManuscriptFormat(d);
      store.putSetting("manuscript-formatting", prefs);
      return prefs;
    },

    "profiles:select": (d) => {
      store.selectProfile(d.id);
      return publicConfig();
    },
    "profiles:delete": (d) => {
      store.deleteProfile(d.id);
      return publicConfig();
    },
    "skills:list": () => store.skills(),
    "skill:save": (d) => {
      store.saveSkill(d);
      return store.skills();
    },
    "skill:delete": (d) => {
      store.deleteSkill(d.id);
      return store.skills();
    },
    "skill:import": async (d) => {
      const r = await dialog.showOpenDialog(window(), {
        properties: [d?.folder ? "openDirectory" : "openFile"],
        filters: [{ name: "Skill 指令文件", extensions: ["md"] }],
      });
      if (r.canceled) return null;
      const p = d?.folder ? join(r.filePaths[0], "SKILL.md") : r.filePaths[0];
      const content = await fs.readFile(p, "utf8");
      assert(!content.includes("\uFFFD"), "请使用 UTF-8 编码的 Skill 文件");
      store.saveSkill(parseSkill(content, basename(p)));
      return store.skills();
    },
    "skill:export": (d) => {
      const s = store.skills().find((s) => s.id === d.id);
      assert(s, "Skill 不存在");
      return saveFile(
        `${s.name.replace(/[<>:"/\\|?*]/g, "_")}.md`,
        exportSkill(s),
        "md");
    },
    
    
    
    
    
    "trash:list": () =>
      store
        .trash()
        .map((e) => ({ ...e, bookTitle: store.rawBook(e.bookId).title })),
    "trash:restore": (d) => store.restoreTrash(d.id),
    "book:delete": (d) => {
      assert(
        ![...running.keys()].some((j) => store.job(j).bookId === d.id),
        "请先停止本书的生成任务");
      return store.deleteBook(d.id);
    },
    "chapter:delete": (d) => {
      assert(
        ![...running.keys()].some((j) => store.job(j).chapterId === d.id),
        "请先停止本章的生成任务");
      return store.deleteChapter(d.id);
    },
    "chapter:duplicate": (d) => store.duplicateChapter(d.id),
    "character:delete": (d) => store.deleteCharacter(d.bookId, d.id),
    "reference:delete": (d) => store.clearReference(d.bookId),
    "chapter:export": (d) => {
      const c = store.chapter(d.id);
      return saveFile(
        `${c.title.replace(/[<>:"/\\|?*]/g, "_")}.txt`,
        `${c.title}\n\n${c.body}`,
        "txt");
    },
    "app:info": () => ({ version: app.getVersion(), channel: "开源核心版", packaged: app.isPackaged, changelog: release.changelog }),
    
    
    
    
    
    
    "codex:detect": (d) => inspectCodex(d.cliPath || ""),
    "codex:choose": async () => {
      const r = await dialog.showOpenDialog(window(), {
        properties: ["openFile"],
        filters: [{ name: "Codex 程序", extensions: ["exe"] }],
      });
      return r.canceled ? null : r.filePaths[0];
    },
    "codex:login": async (d) => {
      await closeLogin();
      loginClient = new CodexClient(await findCodex(d.cliPath || ""));
      await loginClient.start();
      const r = await loginClient.request("account/login/start", {
        type: "chatgpt",
      });
      const u = new URL(r.authUrl);
      assert(
        u.protocol === "https:" &&
          ["auth.openai.com", "auth0.openai.com", "chatgpt.com"].includes(
            u.hostname),
        "Codex 返回了无法识别的登录地址");
      await shell.openExternal(u.href);
      return "已打开官方登录页面。完成后点击“检测连接与模型”刷新。";
    },
  };
}
module.exports = { settingsActions, closeLogin };
