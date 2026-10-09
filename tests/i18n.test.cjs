const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

test("all static interface translation calls have English entries with matching placeholders", async () => {
  const { english } = await import(pathToFileURL(path.resolve("src/locales/en.ts")));
  const missing = [];
  for (const file of fs.readdirSync("src").filter(file => /\.(tsx|ts)$/.test(file))) {
    const source = fs.readFileSync(path.join("src", file), "utf8");
    for (const match of source.matchAll(/\btr\(("(?:[^"\\]|\\.)*")/g)) {
      const key = JSON.parse(match[1]);
      if (!/[\u3400-\u9fff]/.test(key)) continue;
      if (!english[key]) missing.push(`${file}: ${key}`);
      else {
        const placeholders = text => [...new Set(text.match(/\{\d+\}/g) || [])].sort();
        assert.deepEqual(placeholders(english[key]), placeholders(key), `${file}: ${key}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("reference metadata labels and their action states have English translations", async () => {
  const { english } = await import(pathToFileURL(path.resolve("src/locales/en.ts")));
  const source = fs.readFileSync("src/ReferenceOverview.tsx", "utf8");
  const map = source.match(/const labels:[\s\S]*?= \{([\s\S]*?)\n\};/);
  assert.ok(map, "Reference labels must remain discoverable to translation checks");
  const labels = [...map[1].matchAll(/\w+:\s*"([^"]+)"/g)].map(row => row[1]);
  const missing = [...labels, "请先选择章节", "正在核对引用", "引用待核对", "可查看引用清单", "蒸馏只读目标原文"].filter(key => !english[key]);
  assert.deepEqual(missing, []);
});
