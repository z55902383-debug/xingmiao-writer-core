// 数据目录管理：决定 userData（作品、章节、配置、密钥的存放地）指向哪里。
//
// 设计要点：指针文件固定放在「默认目录」（%APPDATA%\星喵写作）里，
// 绝不跟数据一起搬走。因此无论数据被切到哪个盘、哪个文件夹，
// 下次启动都能顺着默认目录里的指针找回去。
//
// 优先级：XM_DATA_DIR 环境变量（测试/排障用） > 指针文件 > 默认目录。
// 环境变量优先级最高，是为了让自动化测试不被用户设置干扰。
const { app, dialog } = require("electron");
const { join, resolve, relative, isAbsolute, parse } = require("node:path");
const fsp = require("node:fs/promises");
const { DatabaseSync } = require("node:sqlite");
const { assert } = require("./store.cjs");

const DB_NAME = "xingmiao.sqlite";
const POINTER_NAME = "data-location.json";

// resolveDataDir() 的结果留在这里，供 data:info 报告给界面。
let resolved = null;

// 一律用函数取值，不用模块级常量：app.setName() 之后 app.getName() 才是「星喵写作」，
// 过早取值会算成 package.json 里的英文名。
const defaultDir = () => join(app.getPath("appData"), app.getName());
const pointerPath = () => join(defaultDir(), POINTER_NAME);

const samePath = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();

/** child 是否位于 parent 之内（含相等）。用于拦住「把数据放进程序目录」。 */
function isInside(child, parent) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function exists(path) {
  try {
    await fsp.access(path);
    return true;
  } catch {
    return false;
  }
}

async function dirHasDb(dir) {
  return exists(join(dir, DB_NAME));
}

/** 真实写一次，确认目录可写；不是只查权限位。 */
async function probeWritable(dir) {
  const probe = join(dir, ".xingmiao-write-probe");
  try {
    await fsp.writeFile(probe, "ok", "utf8");
  } catch (e) {
    throw new Error(`这个文件夹不可写：${e.message}`);
  }
  await fsp.unlink(probe).catch(() => {});
}

function readPointer() {
  try {
    const raw = require("node:fs").readFileSync(pointerPath(), "utf8");
    const dir = JSON.parse(raw)?.dir;
    return typeof dir === "string" ? dir.trim() : "";
  } catch {
    return ""; // 文件不存在或已损坏，都退回到默认目录
  }
}

async function writePointer(dir) {
  await fsp.mkdir(defaultDir(), { recursive: true });
  await fsp.writeFile(
    pointerPath(),
    JSON.stringify({ dir, updatedAt: new Date().toISOString() }, null, 2),
    "utf8",
  );
}

async function clearPointer() {
  await fsp.rm(pointerPath(), { force: true });
}

/** 同步探一次可写：允许残留探针文件被下次覆盖，但绝不新建目录。 */
function writableSync(dir) {
  const probe = join(dir, ".xingmiao-write-probe");
  try {
    require("node:fs").writeFileSync(probe, "");
    require("node:fs").unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * 启动时决定 userData。必须在 app.whenReady() 之前调用。
 * 返回 { dir, source }，source ∈ env | custom | default。
 *
 * 关键取舍：自定义目录不存在时**绝不建空目录顶上**。
 * 建了就会静默开一个空库，用户看到的就是「作品不见了」——
 * 正是这个功能要消灭的那类事故。所以改为退回默认位置、
 * 保留指针文件、把情况报给界面，等位置恢复后重启即可回来。
 */
function resolveDataDir() {
  const fallback = defaultDir();
  if (process.env.XM_DATA_DIR) {
    app.setPath("userData", process.env.XM_DATA_DIR);
    resolved = { dir: app.getPath("userData"), source: "env" };
    return resolved;
  }
  const custom = readPointer();
  if (custom && !samePath(custom, fallback)) {
    const fs = require("node:fs");
    if (fs.existsSync(custom) && writableSync(custom)) {
      app.setPath("userData", custom);
      resolved = { dir: custom, source: "custom" };
      return resolved;
    }
    resolved = { dir: fallback, source: "default", unreachable: custom };
    return resolved;
  }
  resolved = { dir: fallback, source: "default" };
  return resolved;
}

/** 目标目录体检：拦住危险位置，返回用户能看懂的信息。 */
async function inspectDir(input) {
  assert(typeof input === "string" && input.trim(), "请选择要存放数据的文件夹");
  const dir = resolve(input.trim());
  assert(parse(dir).root !== dir, "不能把数据目录设为磁盘根目录，请在其下建一个文件夹");
  assert(
    !isInside(dir, app.getAppPath()),
    "不能把数据目录设在程序目录里，重新安装或覆盖程序会连带丢失作品",
  );
  const current = app.getPath("userData");
  await fsp.mkdir(dir, { recursive: true });
  await probeWritable(dir);
  const hasData = await dirHasDb(dir);
  let books = 0;
  if (hasData) {
    // 只读试探，读不出来就按 0 处理：这个数字只用于提示文案，不该拦住流程。
    try {
      books = countRows(join(dir, DB_NAME)).books;
    } catch {
      books = 0;
    }
  }
  return {
    dir,
    sameAsCurrent: samePath(dir, current),
    isDefault: samePath(dir, defaultDir()),
    hasData,
    books,
  };
}

/** 数一个库里的表行数，用于迁移前后同口径对比，确认搬全了。 */
function countRows(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const count = (table) =>
      db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    return {
      books: count("books"),
      chapters: count("chapters"),
      versions: count("versions"),
    };
  } finally {
    db.close();
  }
}

/** 当前打开的库的行数（走同一连接，含 WAL 里的最新写入）。 */
function countOpenRows(db) {
  const count = (table) =>
    db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  return {
    books: count("books"),
    chapters: count("chapters"),
    versions: count("versions"),
  };
}

/**
 * 迁移前把目标目录里同名的库文件改名留底，绝不覆盖。
 * 连带处理 -wal / -shm：残留的旧日志会被 SQLite 当成新库的日志，必须一起挪走。
 */
async function stashExisting(targetDb) {
  const stamp = Date.now();
  for (const suffix of ["", "-wal", "-shm"]) {
    const from = targetDb + suffix;
    if (await exists(from)) await fsp.rename(from, `${from}.before-${stamp}`);
  }
}

function dataDirActions({ store, window, running }) {
  return {
    // 第一步：让用户挑文件夹，只做体检，不动任何东西。
    "data:pick": async () => {
      const r = await dialog.showOpenDialog(window(), {
        title: "选择数据存放文件夹",
        buttonLabel: "选择此文件夹",
        properties: ["openDirectory", "createDirectory"],
        defaultPath: app.getPath("userData"),
      });
      if (r.canceled || !r.filePaths[0]) return null;
      try {
        return await inspectDir(r.filePaths[0]);
      } catch (e) {
        return { dir: r.filePaths[0], error: e.message };
      }
    },
    // 第二步：写指针。迁移只在用户明确选择时发生，且从不删除任何原有文件。
    "data:apply": async (d) => {
      assert(
        !running || running.size === 0,
        "请先停止正在进行的生成任务，再更改存储位置",
      );
      const info = await inspectDir(d.dir);
      // 同目录迁移等于把库 VACUUM INTO 自己身上，必须拒绝。
      assert(!info.sameAsCurrent, "当前已经在使用这个文件夹，无需更改");
      const targetDb = join(info.dir, DB_NAME);
      let migrated = null;
      if (d.migrate) {
        await stashExisting(targetDb);
        // VACUUM INTO 会把 WAL 里的内容一起落盘，得到一份一致的完整快照。
        store.db.prepare("VACUUM INTO ?").run(targetDb);
        const before = countOpenRows(store.db);
        const after = countRows(targetDb);
        assert(
          before.books === after.books &&
            before.chapters === after.chapters &&
            before.versions === after.versions,
          `迁移校验未通过（作品 ${before.books}→${after.books}，章节 ${before.chapters}→${after.chapters}），已保留原数据、未切换位置`,
        );
        migrated = after.books;
      }
      if (info.isDefault) await clearPointer();
      else await writePointer(info.dir);
      return {
        previous: app.getPath("userData"),
        next: info.dir,
        migrated,
        mode: d.migrate ? "migrate" : "reuse",
      };
    },
    "data:reset": async () => {
      assert(
        !running || running.size === 0,
        "请先停止正在进行的生成任务，再更改存储位置",
      );
      const previous = app.getPath("userData");
      await clearPointer();
      return {
        previous,
        next: defaultDir(),
        migrated: null,
        mode: "default",
      };
    },
    // 当前数据目录的真实来源，给设置页显示徽标用。
    "data:info": () => ({
      path: app.getPath("userData"),
      defaultPath: defaultDir(),
      pointerPath: pointerPath(),
      isDefault: samePath(app.getPath("userData"), defaultDir()),
      lockedByEnv: !!process.env.XM_DATA_DIR,
      // 自定义位置本次不可达时，在这里如实报出来（指针仍保留，位置恢复即可回来）
      unreachable: resolved?.unreachable || "",
      pending: (() => {
        const target = process.env.XM_DATA_DIR ? "" : readPointer();
        if (!target || samePath(target, app.getPath("userData"))) return "";
        return target;
      })(),
    }),
  };
}

module.exports = {
  resolveDataDir,
  dataDirActions,
  defaultDir,
  pointerPath,
  inspectDir,
  DB_NAME,
};
