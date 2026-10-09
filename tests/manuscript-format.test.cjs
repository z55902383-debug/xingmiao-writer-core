const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { Store, id } = require("../electron/store.cjs");
const { buildContext } = require("../electron/context.cjs");
const sync = require("../electron/sync-review.cjs");
const {
  DEFAULT_MANUSCRIPT_FORMAT: defaults,
  normalizeManuscriptFormat,
  formatManuscript,
  formatJobOutput,
  candidateManuscriptBody,
  appendManuscript,
} = require("../electron/manuscript-format.mjs");

test("paragraph formatting preserves body characters, is idempotent and supports compact flush text", () => {
  const raw = "\t 风起 😀\r\n\r\n　　雨落。  灯亮了。  \r结尾。";
  const result = formatManuscript(raw);
  assert.equal(result, "　　风起 😀\n\n　　雨落。  灯亮了。\n\n　　结尾。");
  assert.equal(formatManuscript(result), result);
  assert.equal(result.replace(/\s/g, ""), raw.replace(/\s/g, ""));
  assert.equal(
    formatManuscript(result, {
      ...defaults,
      indent: 0,
      paragraphSpacing: "compact",
    }),
    "风起 😀\n雨落。  灯亮了。\n结尾。",
  );
  assert.deepEqual(
    normalizeManuscriptFormat({
      indent: 99,
      paragraphSpacing: "invalid",
      autoIndent: "false",
    }),
    defaults,
  );
});

test("generated prose and partial prose are formatted while structured output and disabled formatting remain exact", () => {
  const raw = "甲。\r\n\r\n乙。 ";
  for (const kind of ["write", "continue", "polish"]) {
    for (const status of ["done", "interrupted", "cancelled", "error"])
      assert.equal(
        formatJobOutput({ kind, output: raw, status }),
        "　　甲。\n\n　　乙。",
      );
    assert.equal(
      formatJobOutput({
        kind,
        output: raw,
        manuscriptFormat: { ...defaults, formatAi: false },
      }),
      raw,
    );
  }
  for (const kind of ["outline", "memory", "check", "style", "chapterPlan"])
    assert.equal(formatJobOutput({ kind, output: raw }), raw);
});

test("continuations preserve existing body bytes and use a shared join for review and adoption", () => {
  const base = "已有正文　\n\n";
  const output = "新段落。\n下一段。";
  assert.equal(
    appendManuscript(base, output),
    base + "　　新段落。\n\n　　下一段。",
  );
  const job = {
    kind: "continue",
    output,
    manuscriptFormat: { ...defaults, paragraphSpacing: "compact" },
  };
  const body = candidateManuscriptBody(base, job, "append");
  assert.ok(body.startsWith(base));
  assert.equal(body, base + "　　新段落。\n　　下一段。");
  assert.equal(
    candidateManuscriptBody(
      "原稿。",
      { ...job, manuscriptFormat: { ...defaults, formatAi: false } },
      "append",
    ),
    "原稿。\n\n" + output,
  );
});

test("only prose prompts receive formatting instructions and captured settings take precedence", (t) => {
  const db = new Store(
    join(mkdtempSync(join(tmpdir(), "xm-format-context-")), "test.sqlite"),
  );
  t.after(() => db.close());
  const book = db.createBook({ title: "排版测试" });
  const chapter = book.chapters[0];
  assert.match(
    buildContext(book, chapter, "write").messages[1].content,
    /自然段首行缩进两个全角空格/,
  );
  assert.doesNotMatch(
    buildContext(book, chapter, "outline").messages[1].content,
    /正文排版：/,
  );
  assert.doesNotMatch(
    buildContext(book, chapter, "write", "", [], {
      manuscriptFormat: { ...defaults, formatAi: false },
    }).messages[1].content,
    /正文排版：/,
  );
  assert.match(
    buildContext(book, chapter, "write", "", [], {
      manuscriptFormat: { ...defaults, indent: 0, paragraphSpacing: "compact" },
    }).messages[1].content,
    /每个自然段顶格/,
  );
});

test("adoption normalizes legacy candidates, preserves original history and keeps matching review hashes", (t) => {
  const db = new Store(
    join(mkdtempSync(join(tmpdir(), "xm-format-store-")), "test.sqlite"),
  );
  t.after(() => db.close());
  const book = db.createBook({ title: "候选排版" });
  let c = db.updateChapter(book.chapters[0].id, { body: "原稿。" }, 1);
  const job = {
    id: id(),
    bookId: book.id,
    chapterId: c.id,
    kind: "continue",
    output: "续段。\n第二段。",
    status: "done",
    adopted: false,
    baseRevision: c.revision,
  };
  const expected = candidateManuscriptBody(c.body, job, "append");
  job.review = { status: "ready", changes: [], bodyHash: sync.hash(expected) };
  db.putJob(job);
  db.adopt(job.id, "append");
  assert.equal(db.chapter(c.id).body, expected);
  assert.equal(db.job(job.id).review.bodyHash, sync.hash(expected));
  assert.equal(db.job(job.id).review.status, "ready");
  assert.ok(db.versions(c.id).some((v) => v.body === "原稿。"));
  c = db.chapter(c.id);
  db.putSetting("manuscript-formatting", {
    ...defaults,
    indent: 0,
    paragraphSpacing: "compact",
  });
  const captured = {
    ...job,
    id: id(),
    kind: "write",
    output: "完整稿。\n尾段。",
    adopted: false,
    baseRevision: c.revision,
    manuscriptFormat: defaults,
    review: { status: "ready", bodyHash: "stale" },
  };
  db.putJob(captured);
  db.adopt(captured.id, "replace");
  assert.equal(db.chapter(c.id).body, "　　完整稿。\n\n　　尾段。");
  assert.equal(db.job(captured.id).review.status, "error");
  c = db.chapter(c.id);
  db.putJob({
    ...captured,
    id: "analysis-failed",
    baseRevision: c.revision,
    output: "下一份正文。",
    review: { status: "error", error: "分析服务暂不可用" },
  });
  db.adopt("analysis-failed", "replace");
  assert.equal(db.job("analysis-failed").review.error, "分析服务暂不可用");
  c = db.chapter(c.id);
  const unformatted = "\t 保持原样。\r\n\r\n下一段。  ";
  db.putJob({
    ...captured,
    id: "no-format",
    baseRevision: c.revision,
    output: unformatted,
    review: undefined,
    manuscriptFormat: { ...defaults, formatAi: false },
  });
  db.adopt("no-format", "replace");
  assert.equal(db.chapter(c.id).body, unformatted);
});
