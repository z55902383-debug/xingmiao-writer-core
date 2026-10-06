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
