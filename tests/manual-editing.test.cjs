const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const editing = import(
  pathToFileURL(path.resolve(__dirname, "../src/manualEditing.ts"))
);

test("empty queries never select or replace manuscript text", async () => {
  const { findTextMatches, replaceTextMatches } = await editing;
  assert.deepEqual(findTextMatches("风起😀", ""), []);
  assert.deepEqual(replaceTextMatches("风起😀", "", "新"), {
    text: "风起😀",
    count: 0,
  });
  assert.deepEqual(findTextMatches("", "风"), []);
});

test("search treats regular-expression syntax as literal text", async () => {
  const { findTextMatches } = await editing;
  const query = "[风](雨)+.*?^${}\\|";
  const text = `${query} / ${query}`;
  assert.deepEqual(findTextMatches(text, query), [
    { start: 0, end: query.length },
    { start: query.length + 3, end: text.length },
  ]);
  assert.deepEqual(findTextMatches("aaaa", "aa"), [
    { start: 0, end: 2 },
    { start: 2, end: 4 },
  ]);
});

test("Unicode searches keep original UTF-16 positions for textarea selections", async () => {
  const { findTextMatches } = await editing;
  assert.deepEqual(findTextMatches("😀甲😀甲", "甲"), [
    { start: 2, end: 3 },
    { start: 5, end: 6 },
  ]);
  assert.deepEqual(findTextMatches("风😀雨😀", "😀"), [
    { start: 1, end: 3 },
    { start: 4, end: 6 },
  ]);
  // Lowercasing the entire string would expand İ and shift ABC's offset.
  assert.deepEqual(findTextMatches("İxABC", "abc"), [{ start: 2, end: 5 }]);
  assert.deepEqual(findTextMatches("KkK", "k"), [
    { start: 0, end: 1 },
    { start: 1, end: 2 },
    { start: 2, end: 3 },
  ]);
});

test("case-sensitive search and replacement respect the requested case", async () => {
  const { findTextMatches, replaceTextMatches } = await editing;
  assert.deepEqual(findTextMatches("Ab aB AB ab", "ab", true), [
    { start: 9, end: 11 },
  ]);
  assert.deepEqual(replaceTextMatches("Ab aB AB ab", "ab", "新", true), {
    text: "Ab aB AB 新",
    count: 1,
  });
  assert.deepEqual(replaceTextMatches("Ab aB AB ab", "ab", "新"), {
    text: "新 新 新 新",
    count: 4,
  });
});

test("replacement text preserves dollar sequences, emoji and line breaks literally", async () => {
  const { replaceTextMatches } = await editing;
  const replacement = "$&$$$1$`$'😀\n风";
  assert.deepEqual(replaceTextMatches("甲[雨]乙[雨]丙", "[雨]", replacement), {
    text: `甲${replacement}乙${replacement}丙`,
    count: 2,
  });
  assert.deepEqual(replaceTextMatches("aaaa", "aa", ""), {
    text: "",
    count: 2,
  });
  assert.deepEqual(replaceTextMatches("原文", "其他", replacement), {
    text: "原文",
    count: 0,
  });
});

test("formatting applies two full-width spaces and one empty line per paragraph", async () => {
  const { formatManuscript } = await editing;
  const text = "\r\n \t风起 内部  空格\t \r\n\r\n　　第二段💫　\r\n\r\n";
  const formatted = "　　风起 内部  空格\n\n　　第二段💫";
  assert.equal(formatManuscript(text), formatted);
  assert.equal(formatManuscript(formatted), formatted);
  assert.equal(
    formatted.replace(/\s/g, ""),
    text.replace(/\s/g, ""),
  );
});

test("formatting handles blank drafts, adjacent paragraphs and mixed newline styles", async () => {
  const { formatManuscript } = await editing;
  assert.equal(formatManuscript(" \r\n\t\n　　 \r"), "");
  assert.equal(formatManuscript(""), "");
  assert.equal(formatManuscript(" 第一段\r第二段\n第三段\r\n第四段 "),
    "　　第一段\n\n　　第二段\n\n　　第三段\n\n　　第四段");
  assert.equal(formatManuscript("\t对白：‘你好！’ 中间\t间隔　保留\t"),
    "　　对白：‘你好！’ 中间\t间隔　保留");
});
