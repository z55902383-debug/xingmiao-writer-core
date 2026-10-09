const { test } = require("node:test");
const assert = require("node:assert/strict");
const { splitMemoSections } = require("../electron/memo-sections.mjs");
const { buildManualBrainstormPrompt } = require("../electron/manual-brainstorm.cjs");

const content = "姓名：顾舟😀\r\n\r\n秘密：绝不发送此段\r\n\r\n动机：查明雾港事故。";
function book() {
  return {
    id: "book-a", title: "人物笔记测试",
    memos: [
      { id: "memo-a", title: "人物笔记", content },
      { id: "memo-b", title: "其他笔记", content: "未选其他备忘录内容" },
    ],
    get chapters() { throw Error("不允许读取正文"); },
  };
}
const reference = (ranges, sourceContent = content, memoId = "memo-a") => ({ memoId, sourceContent, ranges });
function request(memoReferences, extra = {}, sourceBook = book()) {
  const prompt = buildManualBrainstormPrompt({ requestId: "reference-test", bookId: sourceBook.id,
    idea: "只讨论所选资料", memoReferences, ...extra }, sourceBook);
  const source = JSON.parse(prompt.messages[1].content.split("\n")[2]);
  return { prompt, source };
}

test("Markdown信息分段保留原始CRLF和emoji位置，标题、列表与代码块可理解", () => {
  const input = "# 人物😀\r\n身份：医生\r\n目标：找人\r\n\r\n## 关系\r\n- 林对赵：信任\r\n  原因：共同求生\r\n- 赵对林：隐瞒\r\n\r\n```js\r\n# 代码里的标题\r\n- 不拆分\r\n\r\nconst x = '😀';\r\n```\r\n\r\n独立句子。\r\n第二个句子。\r\n";
  const blocks = splitMemoSections(input);
  assert.deepEqual(blocks.map((block) => input.slice(block.start, block.end)), [
    "# 人物😀", "身份：医生", "目标：找人", "## 关系",
    "- 林对赵：信任\r\n  原因：共同求生", "- 赵对林：隐瞒",
    "```js\r\n# 代码里的标题\r\n- 不拆分\r\n\r\nconst x = '😀';\r\n```",
    "独立句子。", "第二个句子。",
  ]);
  assert.equal(blocks[0].label, "人物😀");
  assert.equal(blocks[4].label, "林对赵：信任");
  assert.equal(blocks[4].section, "人物😀 / 关系");
  assert.equal(blocks[6].section, "人物😀 / 关系");
  assert.equal(blocks[1].start, input.indexOf("身份"));
  assert.ok(blocks.every((block, i) => block.end > block.start && (!i || block.start >= blocks[i - 1].end)));
});

test("未完成的硬折行句子按段归并，纯标题、空稿和无闭合代码块均有稳定边界", () => {
  const input = "这段信息因为手动换行尚未\n结束，仍然是同一个想法。\n\n另一个段落\n仍要保留内部换行";
  assert.deepEqual(splitMemoSections(input).map((block) => input.slice(block.start, block.end)), [
    "这段信息因为手动换行尚未\n结束，仍然是同一个想法。", "另一个段落\n仍要保留内部换行",
  ]);
  assert.deepEqual(splitMemoSections(" \r\n\t\n"), []);
  assert.deepEqual(splitMemoSections(""), []);
  assert.equal(splitMemoSections("## 只有一个标题")[0].label, "只有一个标题");
  const code = "~~~text\r\n保持一个完整块😀\r\n\r\n# 不作为标题";
  assert.equal(splitMemoSections(code).length, 1);
  assert.equal(code.slice(splitMemoSections(code)[0].start, splitMemoSections(code)[0].end), code);
  const setext = "人物资料\r\n======\r\n身份：医生";
  assert.equal(splitMemoSections(setext)[1].section, "人物资料");
});

test("分段ID随原文片段稳定而非随偏移变化，重复文本带独立出现序号", () => {
  const original = "# 原标题\n重复想法。\n\n重复想法。\n\n独有想法。";
  const blocks = splitMemoSections(original);
  const shifted = splitMemoSections(`前面新插入的信息。\n\n${original}`);
  assert.deepEqual(shifted.slice(1).map((block) => block.id), blocks.map((block) => block.id));
  assert.notEqual(blocks[1].id, blocks[2].id);
  assert.match(blocks[1].id, /:1$/);
  assert.match(blocks[2].id, /:2$/);
  const changed = splitMemoSections(original.replace("独有想法。", "独有想法已修改。"));
  assert.notEqual(changed.at(-1).id, blocks.at(-1).id);
  assert.deepEqual(changed.slice(0, -1).map((block) => block.id), blocks.slice(0, -1).map((block) => block.id));
  assert.deepEqual(splitMemoSections(original), blocks);
});

test("单条部分引用只发送选中原文，同ID的旧整篇memoIds不得泄漏全文", () => {
  const range = { start: 0, end: content.indexOf("\r\n\r\n") };
  const { prompt, source } = request([reference([range])], { memoIds: ["memo-a"] });
  assert.deepEqual(source.memos, [{ id: "memo-a", title: "人物笔记", content: "姓名：顾舟😀", ranges: [range] }]);
  const payload = JSON.stringify(prompt);
  assert.doesNotMatch(payload, /绝不发送此段|查明雾港事故|未选其他备忘录内容|sourceContent/);
  assert.equal(payload.split("姓名：顾舟😀").length - 1, 1);
});

test("同memo多段引用按源顺序去重，片段之间不包含未选资料", () => {
  const first = { start: 0, end: content.indexOf("\r\n\r\n") };
  const last = { start: content.indexOf("动机"), end: content.length };
  const { prompt, source } = request([reference([last, first, first]), reference([last])]);
  assert.deepEqual(source.memos[0].ranges, [first, last]);
  assert.equal(source.memos[0].content, "姓名：顾舟😀\n\n动机：查明雾港事故。");
  assert.doesNotMatch(JSON.stringify(prompt), /绝不发送此段|sourceContent|parts/);
});

test("篡改或陈旧sourceContent以及跨书、删除memo引用均拒绝，绝不回退整篇", () => {
  const range = { start: 0, end: 2 };
  assert.throws(() => request([reference([range], `${content}篡改`)], { memoIds: ["memo-a"] }), /已修改/);
  assert.throws(() => request([reference([range], content.replace("顾舟", "旧姓名"))]), /已修改/);
  assert.throws(() => request([{ memoId: "memo-a", ranges: [range] }]), /原文格式/);
  assert.throws(() => request([reference([range], content, "foreign-memo")]), /不存在/);
  const deleted = book(); deleted.memos[0].deletedAt = "2026-10-08T00:00:00.000Z";
  assert.throws(() => request([reference([range])], {}, deleted), /不存在/);
  assert.throws(() => request(null, { memoIds: ["memo-a"] }), /引用格式/);
  assert.throws(() => buildManualBrainstormPrompt({ requestId: "none", idea: "问题", memoReferences: [reference([range])] }), /所属/);
});

test("范围必须非空、整数、有界且不重叠，不能拆开emoji代理对", () => {
  for (const ranges of [[], undefined, [null], [{ start: -1, end: 2 }], [{ start: 1, end: 1 }],
    [{ start: 3, end: 2 }], [{ start: 0.1, end: 2 }], [{ start: 0, end: Infinity }],
    [{ start: NaN, end: 2 }], [{ start: 0, end: content.length + 1 }], [{ start: "0", end: 2 }]]) {
    assert.throws(() => request([reference(ranges)]), /范围无效/);
  }
  assert.throws(() => request([reference([{ start: 0, end: 4 }, { start: 3, end: 7 }])]), /重叠/);
  const emoji = content.indexOf("😀");
  assert.throws(() => request([reference([{ start: emoji + 1, end: emoji + 2 }])]), /特殊字符/);
  assert.throws(() => request([reference([{ start: 0, end: emoji + 1 }])]), /特殊字符/);
  assert.equal(request([reference([{ start: emoji, end: emoji + 2 }])]).source.memos[0].content, "😀");
  assert.equal(request([reference([{ start: 0, end: 2 }, { start: 2, end: 4 }])]).source.memos[0].ranges.length, 2);
});

test("最多100范围与20memo联合计数，长度限制针对发送片段而非核对全文", () => {
  const tiny = { start: 0, end: 1 };
  assert.equal(request([reference(Array(100).fill(tiny))]).source.memos[0].ranges.length, 1);
  assert.throws(() => request([reference(Array(101).fill(tiny))]), /范围无效/);
  assert.throws(() => request([reference(Array(51).fill(tiny)), reference(Array(50).fill(tiny))]), /100/);
  const many = { id: "book-a", title: "多条笔记", memos: Array.from({ length: 21 }, (_, i) => ({ id: `memo-${i}`, title: `笔记${i}`, content: "内容" })) };
  const partial = many.memos.slice(10).map((memo) => reference([tiny], memo.content, memo.id));
  assert.throws(() => request(partial, { memoIds: many.memos.slice(0, 10).map((memo) => memo.id) }, many), /20/);
  const large = book(); large.memos[0].content = "只发这几个字" + "不应发送的长篇".repeat(6000);
  const { prompt, source } = request([reference([{ start: 0, end: 7 }], large.memos[0].content)], {}, large);
  assert.equal(source.memos[0].content, "只发这几个字不");
  assert.doesNotMatch(JSON.stringify(prompt), /不应发送的长篇/);
});

test("旧memoIds整篇引用保持完整原样，空memoReferences与缺省字段均兼容", () => {
  const expected = [{ id: "memo-a", title: "人物笔记", content }];
  assert.deepEqual(request(undefined, { memoIds: ["memo-a", "memo-a"] }).source.memos, expected);
  assert.deepEqual(request([], { memoIds: ["memo-a"] }).source.memos, expected);
});
