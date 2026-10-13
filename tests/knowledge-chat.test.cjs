const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { Store } = require("../electron/store.cjs");
const {
  createKnowledgeChat,
  buildPrompt,
  checkedProposal,
} = require("../electron/knowledge-chat.cjs");
function setup(t) {
  const store = new Store(
    join(mkdtempSync(join(tmpdir(), "xm-knowledge-")), "test.sqlite"),
  );
  t.after(() => store.close());
  const book = store.createBook({ title: "知识库测试" });
  const raw = store.rawBook(book.id);
  Object.assign(raw, {
    premise: "书店重逢",
    outline: "原有总纲",
    world: "雨港禁止使用魔法",
    characters: [
      { id: "p1", name: "林舟", role: "调查员", description: "寻找失踪父亲" },
      { id: "p2", name: "周伯", role: "管理员", description: "保管钥匙" },
    ],
    memories: [
      {
        id: "m1",
        subject: "林舟",
        relation: "信任",
        object: "周伯",
        evidence: "CHAPTER-EVIDENCE-PRIVATE",
        sourceChapterId: book.chapters[0].id,
        sourceRevision: 1,
        stale: false,
      },
    ],
    timeline: [],
  });
  store.putBook(raw);
  store.updateChapter(
    book.chapters[0].id,
    {
      title: "CHAPTER-TITLE-PRIVATE",
      body: "CHAPTER-BODY-PRIVATE",
      outline: "CHAPTER-OUTLINE-PRIVATE",
    },
    book.chapters[0].revision,
  );
  return { store, book: store.book(book.id) };
}
function manager(store, reply, options = {}) {
  let resolve;
  const done = new Promise((r) => (resolve = r));
  const calls = [];
  const service = createKnowledgeChat({
    getStore: () => store,
    getConfig: () => ({
      model: "fixture",
      provider: options.provider || "api",
    }),
    getKey: async () => "",
    requestModel: async (...args) => {
      calls.push(args[2]);
      if (options.wait)
        await new Promise((r) =>
          args[4].addEventListener("abort", r, { once: true }),
        );
      args[3](JSON.stringify(reply));
      return { finishReason: options.length ? "length" : "stop" };
    },
    requestCodex: async (...args) => {
      calls.push(args[2]);
      args[3](JSON.stringify(reply));
      return {};
    },
    emit: (value) => {
      if (value.messages.at(-1)?.status !== "running") resolve(value);
    },
  });
  return { service, done, calls };
}
test("knowledge prompts never include chapters, chapter evidence, styles, memos or candidates", (t) => {
  const { book } = setup(t);
  book.style = "STYLE-PRIVATE";
  book.reference = "REFERENCE-PRIVATE";
  book.memos = [{ content: "MEMO-PRIVATE" }];
  book.candidates = [{ output: "CANDIDATE-PRIVATE" }];
  const prompt = JSON.stringify(buildPrompt(book, [], "列出现有的人物"));
  for (const privateValue of [
    "CHAPTER-TITLE-PRIVATE",
    "CHAPTER-BODY-PRIVATE",
    "CHAPTER-OUTLINE-PRIVATE",
    "CHAPTER-EVIDENCE-PRIVATE",
    "STYLE-PRIVATE",
    "REFERENCE-PRIVATE",
    "MEMO-PRIVATE",
    "CANDIDATE-PRIVATE",
  ])
    assert.ok(!prompt.includes(privateValue));
  assert.match(prompt, /寻找失踪父亲/);
  assert.match(prompt, /原有总纲/);
  assert.match(prompt, /禁止使用魔法/);
});
test("queries persist per book and never modify knowledge or manuscript", async (t) => {
  const { store, book } = setup(t),
    before = JSON.stringify(store.book(book.id));
  const { service, done } = manager(store, {
    reply: "林舟信任周伯。",
    changes: [],
  });
  service.start({ bookId: book.id, message: "列出现有关系" });
  await done;
  assert.equal(JSON.stringify(store.book(book.id)), before);
  const reloaded = manager(store, {}).service.get(book.id);
  assert.equal(reloaded.messages.at(-1).content, "林舟信任周伯。");
  const other = store.createBook({ title: "另一作品" });
  assert.deepEqual(service.get(other.id).messages, []);
});
test("only stored proposals can apply; selected updates are atomic, undoable and preserve chapters", async (t) => {
  const { store, book } = setup(t),
    chapters = JSON.stringify(store.chapters(book.id));
  const { service, done } = manager(store, {
    reply: "建议调整角色和规则。",
    changes: [
      {
        target: "character",
        id: "p2",
        operation: "update",
        fields: { role: "退休管理员" },
      },
      {
        target: "book",
        id: "",
        operation: "update",
        fields: { world: "雨港只能使用一次魔法" },
      },
    ],
  });
  service.start({ bookId: book.id, message: "调整身份和世界" });
  const proposal = (await done).messages.at(-1).proposal;
  assert.equal(store.rawBook(book.id).characters[1].role, "管理员");
  assert.throws(() =>
    service.apply({
      bookId: book.id,
      proposalId: proposal.id,
      changeIds: ["forged"],
    }),
  );
  const applied = service.apply({
    bookId: book.id,
    proposalId: proposal.id,
    changeIds: [proposal.changes[0].key],
  });
  assert.equal(applied.book.characters[1].role, "退休管理员");
  assert.equal(applied.book.world, book.world);
  assert.deepEqual(applied.session.messages.at(-1).proposal.appliedIds, [
    proposal.changes[0].key,
  ]);
  assert.deepEqual(
    manager(store, {}).service.get(book.id).messages.at(-1).proposal.appliedIds,
    [proposal.changes[0].key],
  );
  assert.equal(JSON.stringify(store.chapters(book.id)), chapters);
  assert.throws(() =>
    service.apply({
      bookId: book.id,
      proposalId: proposal.id,
      changeIds: [proposal.changes[0].key],
    }),
  );
  const other = store.createBook({ title: "other" });
  assert.throws(() =>
    service.undo({ bookId: other.id, proposalId: proposal.id }),
  );
  const undone = service.undo({ bookId: book.id, proposalId: proposal.id });
  assert.equal(undone.book.characters[1].role, "管理员");
  assert.equal(JSON.stringify(store.chapters(book.id)), chapters);
});
test("changes after the request block apply and changes after apply block undo", async (t) => {
  const { store, book } = setup(t);
  const options = {
    reply: "修改总纲",
    changes: [
      {
        target: "book",
        id: "",
        operation: "update",
        fields: { outline: "新的总纲" },
      },
    ],
  };
  const first = manager(store, options);
  first.service.start({ bookId: book.id, message: "调整总纲" });
  const proposal = (await first.done).messages.at(-1).proposal;
  store.updateBook(book.id, { world: "作者刚刚手动修改" });
  assert.throws(
    () =>
      first.service.apply({
        bookId: book.id,
        proposalId: proposal.id,
        changeIds: proposal.changes.map((row) => row.key),
      }),
    /资料已变化/,
  );
  const second = manager(store, options);
  second.service.start({ bookId: book.id, message: "调整总纲" });
  const next = (await second.done).messages.at(-1).proposal;
  second.service.apply({
    bookId: book.id,
    proposalId: next.id,
    changeIds: next.changes.map((row) => row.key),
  });
  store.updateBook(book.id, { world: "新的手动修改" });
  assert.throws(
    () => second.service.undo({ bookId: book.id, proposalId: next.id }),
    /后续修改/,
  );
});
test("forbidden fields, foreign IDs and dangling relationships reject the whole proposal", (t) => {
  const { book } = setup(t);
  for (const change of [
    { target: "book", id: "", operation: "update", fields: { chapters: [] } },
    {
      target: "chapter",
      id: book.chapters[0].id,
      operation: "update",
      fields: { body: "bad" },
    },
    {
      target: "character",
      id: "foreign-person",
      operation: "delete",
      fields: {},
    },
    {
      target: "book",
      id: "foreign-book",
      operation: "update",
      fields: { world: "bad" },
    },
  ])
    assert.throws(() =>
      checkedProposal(
        JSON.stringify({ reply: "bad", changes: [change] }),
        book,
      ),
    );
  book.timeline = [
    {
      id: "r1",
      kind: "relation",
      title: "同盟",
      characterId: "p1",
      targetId: "p2",
      attribute: "关系",
      value: "同盟",
      phase: "confirmed",
    },
  ];
  assert.throws(
    () =>
      checkedProposal(
        JSON.stringify({
          reply: "删除",
          changes: [
            { target: "character", id: "p2", operation: "delete", fields: {} },
          ],
        }),
        book,
      ),
    /人物不存在/,
  );
});
test("edited chapter-sourced memories become author settings without forged chapter evidence", (t) => {
  const { book } = setup(t);
  const change = checkedProposal(
    JSON.stringify({
      reply: "调整信任关系",
      changes: [
        {
          target: "memory",
          id: "m1",
          operation: "update",
          fields: { relation: "怀疑" },
        },
      ],
    }),
    book,
  ).changes[0];
  assert.equal(change.after.relation, "怀疑");
  assert.equal(change.after.sourceChapterId, "");
  assert.equal(change.after.evidence, "");
  assert.equal(change.after.sourceRevision, 0);
});
test("unrelated edits tolerate pre-existing stale records, but never introduce new dangling references", (t) => {
  const { book } = setup(t);
  book.timeline = [
    {
      id: "old",
      kind: "relation",
      title: "旧关系",
      characterId: "already-deleted",
      targetId: "p2",
      attribute: "关系",
      value: "同盟",
      phase: "confirmed",
      stale: true,
    },
  ];
  assert.equal(
    checkedProposal(
      JSON.stringify({
        reply: "修改世界",
        changes: [
          {
            target: "book",
            id: "",
            operation: "update",
            fields: { world: "新的规则" },
          },
        ],
      }),
      book,
    ).changes.length,
    1,
  );
  assert.throws(
    () =>
      checkedProposal(
        JSON.stringify({
          reply: "删除",
          changes: [
            { target: "character", id: "p2", operation: "delete", fields: {} },
          ],
        }),
        book,
      ),
    /人物不存在/,
  );
});
test("new and deleted knowledge records remain reversible without touching chapter rows", async (t) => {
  const { store, book } = setup(t),
    original = JSON.stringify(store.chapters(book.id));
  const first = manager(store, {
    reply: "新增设定",
    changes: [
      {
        target: "worldRecord",
        id: "",
        operation: "create",
        fields: {
          category: "规则",
          title: "登记制度",
          description: "所有魔法须登记",
          certainty: "provisional",
        },
      },
    ],
  });
  first.service.start({ bookId: book.id, message: "新增登记制度" });
  const proposal = (await first.done).messages.at(-1).proposal;
  const saved = first.service.apply({
    bookId: book.id,
    proposalId: proposal.id,
    changeIds: proposal.changes.map((row) => row.key),
  });
  const id = saved.book.worldRecords[0].id;
  assert.ok(id);
  const second = manager(store, {
    reply: "删除记录",
    changes: [{ target: "worldRecord", id, operation: "delete", fields: {} }],
  });
  second.service.start({ bookId: book.id, message: "删除登记制度" });
  const deletion = (await second.done).messages.at(-1).proposal;
  second.service.apply({
    bookId: book.id,
    proposalId: deletion.id,
    changeIds: deletion.changes.map((row) => row.key),
  });
  assert.equal(store.rawBook(book.id).worldRecords.length, 0);
  second.service.undo({ bookId: book.id, proposalId: deletion.id });
  assert.equal(store.rawBook(book.id).worldRecords[0].title, "登记制度");
  assert.equal(JSON.stringify(store.chapters(book.id)), original);
});
test("knowledge deletions survive later edits and conversation clearing through the recycle bin", async (t) => {
  const { store, book } = setup(t),
    instance = manager(store, {
      reply: "删除人物",
      changes: [
        { target: "character", id: "p1", operation: "delete", fields: {} },
      ],
    });
  instance.service.start({ bookId: book.id, message: "删除林舟" });
  const proposal = (await instance.done).messages.at(-1).proposal;
  instance.service.apply({
    bookId: book.id,
    proposalId: proposal.id,
    changeIds: proposal.changes.map((row) => row.key),
  });
  const entry = store.trash().find((row) => row.type === "character");
  assert.equal(entry.item.id, "p1");
  store.updateBook(book.id, { world: "后续修改" });
  instance.service.clear(book.id);
  store.restoreTrash(entry.id);
  assert.equal(
    store.rawBook(book.id).characters.filter((row) => row.id === "p1").length,
    1,
  );
  assert.equal(store.rawBook(book.id).world, "后续修改");
  assert.equal(store.trash().length, 0);
});
test("undo removes only the recycle entries from that proposal and restores deleted custom records", async (t) => {
  const { store, book } = setup(t);
  const raw = store.rawBook(book.id);
  raw.worldRecords = [
    {
      id: "w1",
      category: "规则",
      title: "规则",
      description: "desc",
      certainty: "fixed",
    },
  ];
  raw.foreshadows = [
    {
      id: "f1",
      title: "钥匙",
      note: "note",
      status: "open",
      plantedChapterId: "",
    },
  ];
  store.putBook(raw);
  const unrelated = store.recycle("character", book.id, {
    id: "unrelated",
    name: "旧人物",
  });
  const instance = manager(store, {
    reply: "删除旧资料",
    changes: [
      { target: "worldRecord", id: "w1", operation: "delete", fields: {} },
      { target: "foreshadow", id: "f1", operation: "delete", fields: {} },
    ],
  });
  instance.service.start({ bookId: book.id, message: "删除" });
  const proposal = (await instance.done).messages.at(-1).proposal;
  instance.service.apply({
    bookId: book.id,
    proposalId: proposal.id,
    changeIds: proposal.changes.map((row) => row.key),
  });
  assert.equal(store.trash().length, 3);
  instance.service.undo({ bookId: book.id, proposalId: proposal.id });
  assert.deepEqual(
    store.trash().map((row) => row.id),
    [unrelated.id],
  );
  assert.equal(store.rawBook(book.id).worldRecords[0].id, "w1");
  store.recycle("worldRecord", book.id, {
    id: "w2",
    category: "规则",
    title: "新规则",
    description: "desc",
    certainty: "fixed",
  });
  const entry = store.trash().find((row) => row.type === "worldRecord");
  store.restoreTrash(entry.id);
  assert.equal(
    store.rawBook(book.id).worldRecords.filter((row) => row.id === "w2").length,
    1,
  );
});
test("book, deletion recovery and proposal status roll back together when confirmation persistence fails", async (t) => {
  const { store, book } = setup(t),
    instance = manager(store, {
      reply: "删除人物",
      changes: [
        { target: "character", id: "p1", operation: "delete", fields: {} },
      ],
    });
  instance.service.start({ bookId: book.id, message: "删除" });
  const proposal = (await instance.done).messages.at(-1).proposal;
  const original = store.putSetting;
  store.putSetting = function (key, value) {
    if (key.startsWith("knowledge-chat:")) throw Error("写入失败");
    return original.call(this, key, value);
  };
  assert.throws(
    () =>
      instance.service.apply({
        bookId: book.id,
        proposalId: proposal.id,
        changeIds: proposal.changes.map((row) => row.key),
      }),
    /写入失败/,
  );
  store.putSetting = original;
  assert.ok(store.rawBook(book.id).characters.some((row) => row.id === "p1"));
  assert.equal(store.trash().length, 0);
  assert.equal(
    instance.service.get(book.id).messages.at(-1).proposal.status,
    "pending",
  );
});
test("rechecking unadopted suggestions uses fresh knowledge rather than accepting the old basis", async (t) => {
  const { store, book } = setup(t),
    instance = manager(store, {
      reply: "修改",
      changes: [
        {
          target: "character",
          id: "p2",
          operation: "update",
          fields: { role: "退休管理员" },
        },
        {
          target: "book",
          id: "",
          operation: "update",
          fields: { world: "新规则" },
        },
      ],
    });
  instance.service.start({ bookId: book.id, message: "修改" });
  const proposal = (await instance.done).messages.at(-1).proposal;
  instance.service.apply({
    bookId: book.id,
    proposalId: proposal.id,
    changeIds: [proposal.changes[0].key],
  });
  store.updateBook(book.id, { world: "刚刚手动改动的规则" });
  instance.service.recheck({ bookId: book.id, proposalId: proposal.id });
  await new Promise((r) => setImmediate(r));
  assert.match(JSON.stringify(instance.calls.at(-1)), /刚刚手动改动的规则/);
  assert.match(instance.calls.at(-1).at(-1).content, /未采纳/);
  assert.equal(store.rawBook(book.id).world, "刚刚手动改动的规则");
  assert.deepEqual(store.backup().excludedHistory, [
    "knowledge-chat",
    "knowledge-proposal-undo",
  ]);
  assert.ok(!Object.hasOwn(store.backup(), "knowledgeChats"));
});
test("invalid or truncated outputs and cancelled requests create no applicable changes", async (t) => {
  const { store, book } = setup(t);
  const first = manager(
    store,
    {
      reply: "x",
      changes: [
        {
          target: "book",
          id: "",
          operation: "update",
          fields: { world: "new" },
        },
      ],
    },
    { length: true },
  );
  first.service.start({ bookId: book.id, message: "modify" });
  assert.equal((await first.done).messages.at(-1).status, "error");
  const second = manager(store, { reply: "x", changes: [] }, { wait: true });
  second.service.start({ bookId: book.id, message: "cancel" });
  await new Promise((r) => setImmediate(r));
  second.service.cancel(book.id);
  assert.equal((await second.done).messages.at(-1).status, "cancelled");
  assert.equal(store.rawBook(book.id).world, book.world);
});
