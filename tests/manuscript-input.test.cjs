const { test } = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const input = import(
  pathToFileURL(path.resolve(__dirname, "../src/manuscriptInput.ts"))
);
const defaults = {
  indent: 2,
  paragraphSpacing: "blank",
  autoIndent: true,
  formatAi: true,
};
const apply = (text, edit) =>
  text.slice(0, edit.start) + edit.insert + text.slice(edit.end);

test("Enter separates the next paragraph without losing Unicode body characters", async () => {
  const { nextParagraphEdit } = await input;
  const text = "　　风起😀雨落。";
  const edit = nextParagraphEdit(text, 6, 6, defaults);
  assert.equal(apply(text, edit), "　　风起😀\n\n　　雨落。");
  assert.equal(apply(text, edit).replace(/\s/g, ""), text.replace(/\s/g, ""));
});

test("selected text replacement adjusts only indentation at the new paragraph boundary", async () => {
  const { nextParagraphEdit } = await input;
  const text = "　　第一段。多余文字　　下一段。";
  const edit = nextParagraphEdit(text, 6, 10, defaults);
  assert.equal(apply(text, edit), "　　第一段。\n\n　　下一段。");
});

test("compact and flush paragraphs follow the current settings", async () => {
  const { nextParagraphEdit } = await input;
  const text = "前句。后句。";
  assert.equal(
    apply(
      text,
      nextParagraphEdit(text, 3, 3, {
        ...defaults,
        indent: 0,
        paragraphSpacing: "compact",
      }),
    ),
    "前句。\n后句。",
  );
});

test("repeated Enter does not accumulate indentation in blank paragraphs", async () => {
  const { nextParagraphEdit } = await input;
  const text = "　　首段。\n\n　　";
  assert.equal(
    apply(text, nextParagraphEdit(text, text.length, text.length, defaults)),
    "　　首段。\n\n\n　　",
  );
  assert.equal(
    apply("\n后段。", nextParagraphEdit("\n后段。", 0, 0, defaults)),
    "\n　　\n后段。",
  );
});

test("IME confirmation, modifier Enter and non-editable fields retain their native behavior", async () => {
  const { handleManuscriptEnter } = await input;
  for (const override of [
    { nativeEvent: { isComposing: true, keyCode: 13 } },
    { nativeEvent: { isComposing: false, keyCode: 229 } },
    { shiftKey: true },
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { currentTarget: { readOnly: true } },
    { currentTarget: { disabled: true } },
    { key: "a" },
  ]) {
    let prevented = false;
    const event = {
      key: "Enter",
      nativeEvent: {},
      currentTarget: {},
      preventDefault: () => {
        prevented = true;
      },
      ...override,
    };
    assert.equal(
      handleManuscriptEnter(event, defaults, () =>
        assert.fail("should not edit"),
      ),
      false,
    );
    assert.equal(prevented, false);
  }
  assert.equal(
    handleManuscriptEnter(
      { key: "Enter" },
      { ...defaults, autoIndent: false },
      () => assert.fail(),
    ),
    false,
  );
});
