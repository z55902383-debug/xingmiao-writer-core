import { tr } from "./i18n";
import { useState } from "react";
import type { Book, Job, SyncChange } from "./types";
import { api } from "./api";
import { Button, Field, Modal } from "./ui";
export default function SyncReview({
  job,
  onChange,
  flush,
}: {
  job: Job;
  onChange: (b: Book) => void;
  flush: () => Promise<void>;
}) {
  const [rows, setRows] = useState<SyncChange[] | null>(null),
    [chosen, setChosen] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const review = job.review;
  async function retry() {
    setBusy(true);
    setError("");
    try {
      await flush();
      onChange(await api<Book>("sync:analyze", { id: job.id }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!review) return null;
  if (review.status === "analyzing")
    return <p className="notice">{tr("正文已生成，正在分析人物与世界变化…")}</p>;
  if (review.status === "empty") return null;
  if (review.applied) return <p className="notice">{tr("本章变化已确认同步")}</p>;
  const edit = (id: string, key: keyof SyncChange, value: string) =>
    setRows((old) =>
      old!.map((r) => (r.id === id ? { ...r, [key]: value } : r)),
    );
  return (
    <div className="sync-review">
      {review.status === "error" ? (
        <p className="warning">{tr("变化分析未完成：")}{review.error}{tr("。正文不受影响。")}</p>
      ) : (
        <p>{tr("发现")}{" "}{review.changes?.length}{" "}{tr("条待核对变化，可修改、选择后同步。")}</p>
      )}
      {review.status === "ready" && (
        <Button
          onClick={() => {
            setRows(structuredClone(review.changes || []));
            setChosen((review.changes || []).map((c) => c.id));
            setError("");
          }}
        >{tr("查阅变化清单")}</Button>
      )}
      {job.adopted ? (
        <Button disabled={busy} onClick={retry}>{tr("重新分析已采用正文")}</Button>
      ) : (
        <small>{tr("先采用正文，再确认同步。自动分析会额外调用当前模型。")}</small>
      )}
      {error && (
        <p role="alert" className="error-box">
          {tr(error)}
        </p>
      )}
      {rows && (
        <Modal title={tr("核对本章变化")} wide onClose={() => !busy && setRows(null)}>
          <div className="modal-body">
            <p>{tr("仅同步勾选项。确认会将本章定稿，并更新人物档案和本章生效的时间线。新人被其他变化引用时，请同时勾选该新人。")}</p>
            {rows.map((r) => (
              <article className="sync-row" key={r.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={chosen.includes(r.id)}
                    onChange={(e) =>
                      setChosen((old) =>
                        e.target.checked
                          ? [...old, r.id]
                          : old.filter((id) => id !== r.id),
                      )
                    }
                  />
                  {
                    (
                      {
                        newCharacter: "新增人物",
                        character: "人物状态",
                        relation: "人物关系",
                        world: "世界变化",
                      } as Record<string, string>
                    )[r.kind]
                  }
                </label>
                <div className="form-row">
                  <Field label={tr("人物 / 对象")}>
                    <input
                      value={r.subject}
                      onChange={(e) => edit(r.id, "subject", e.target.value)}
                    />
                  </Field>
                  {r.kind === "relation" && (
                    <Field label={tr("关系对象")}>
                      <input
                        value={r.target}
                        onChange={(e) => edit(r.id, "target", e.target.value)}
                      />
                    </Field>
                  )}
                  {r.kind === "newCharacter" ? (
                    <Field label={tr("人物定位")}>
                      <input
                        value={r.role}
                        onChange={(e) => edit(r.id, "role", e.target.value)}
                      />
                    </Field>
                  ) : (
                    <Field label={tr("变化类别")}>
                      <input
                        value={r.attribute}
                        onChange={(e) =>
                          edit(r.id, "attribute", e.target.value)
                        }
                      />
                    </Field>
                  )}
                </div>
                <Field
                  label={
                    r.kind === "newCharacter" ? tr("人物描述") : tr("更新后的状态")
                  }
                >
                  <textarea
                    rows={2}
                    value={r.value}
                    onChange={(e) => edit(r.id, "value", e.target.value)}
                  />
                </Field>
                <Field label={tr("正文证据")}>
                  <textarea
                    rows={2}
                    value={r.evidence}
                    onChange={(e) => edit(r.id, "evidence", e.target.value)}
                  />
                </Field>
              </article>
            ))}
            {error && (
              <p role="alert" className="error-box">
                {tr(error)}
              </p>
            )}
          </div>
          <div className="modal-footer">
            <Button onClick={() => setRows(null)}>{tr("暂不同步")}</Button>
            <Button
              variant="primary"
              disabled={busy || !job.adopted || !chosen.length}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await flush();
                  onChange(
                    await api<Book>("sync:apply", {
                      id: job.id,
                      changes: rows.filter((r) => chosen.includes(r.id)),
                    }),
                  );
                  setRows(null);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >{tr("确认同步并定稿")}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
