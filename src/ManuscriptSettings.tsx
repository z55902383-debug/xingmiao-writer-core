import { useCallback, useEffect, useState } from "react";
import { TextAlignLeft } from "@phosphor-icons/react";
import { api } from "./api";
import { tr } from "./i18n";
import { Button, Field, Modal } from "./ui";
import {
  DEFAULT_MANUSCRIPT_FORMAT,
  normalizeManuscriptFormat,
  formatManuscript,
  type ManuscriptFormat,
} from "../electron/manuscript-format.mjs";
import "./manuscript-settings.css";

let cached = { ...DEFAULT_MANUSCRIPT_FORMAT };
let generation = 0;
const listeners = new Set<(value: ManuscriptFormat) => void>();
const publish = (value: ManuscriptFormat) => {
  cached = normalizeManuscriptFormat(value);
  generation++;
  for (const listener of listeners) listener(cached);
};

export function useManuscriptFormat() {
  const [format, setFormat] = useState<ManuscriptFormat>(cached);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const at = generation;
    listeners.add(setFormat);
    void api<ManuscriptFormat>("manuscript:get")
      .then((value) => {
        if (!active) return;
        if (at === generation) publish(value);
        else setFormat(cached);
        setError("");
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      listeners.delete(setFormat);
    };
  }, []);
  const save = useCallback(async (value: ManuscriptFormat) => {
    const result = await api<ManuscriptFormat>(
      "manuscript:set",
      normalizeManuscriptFormat(value),
    );
    publish(result);
    setError("");
  }, []);
  return { format, loading, error, save };
}

export default function ManuscriptSettings({
  value,
  onSave,
  onClose,
  onApply,
  applyDisabled = false,
}: {
  value: ManuscriptFormat;
  onSave: (value: ManuscriptFormat) => Promise<void>;
  onClose: () => void;
  onApply?: (value: ManuscriptFormat) => void | Promise<void>;
  applyDisabled?: boolean;
}) {
  const [form, setForm] = useState(() => normalizeManuscriptFormat(value));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (patch: Partial<ManuscriptFormat>) =>
    setForm((old) => ({ ...old, ...patch }));
  const submit = async (apply: boolean) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onSave(form);
      if (apply) await onApply?.(form);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const sample = tr(
    "晚风掠过书页，她提笔写下故事的开头。\n窗外的灯亮了，新的一段也由此开始。",
  );
  return (
    <Modal
      title={tr("正文排版")}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="modal-body manuscript-settings">
        <p className="manuscript-settings-intro">
          {tr(
            "AI 写作与人工码字共用这套规则。修改设置后，已有正文可单独整理。",
          )}
        </p>
        <fieldset className="manuscript-settings-fields" disabled={busy}>
          <div className="manuscript-format-selects">
            <Field label={tr("首行缩进")}>
              <select
                value={form.indent}
                onChange={(e) =>
                  update({ indent: Number(e.target.value) as 0 | 2 })
                }
              >
                <option value={2}>{tr("缩进两格（推荐）")}</option>
                <option value={0}>{tr("不缩进")}</option>
              </select>
            </Field>
            <Field label={tr("段落间距")}>
              <select
                value={form.paragraphSpacing}
                onChange={(e) =>
                  update({
                    paragraphSpacing: e.target.value as "blank" | "compact",
                  })
                }
              >
                <option value="blank">{tr("段间空一行")}</option>
                <option value="compact">{tr("紧凑段落")}</option>
              </select>
            </Field>
          </div>
          <label className="manuscript-format-toggle">
            <input
              aria-label={tr("回车自动缩进")}
              type="checkbox"
              checked={form.autoIndent}
              onChange={(e) => update({ autoIndent: e.target.checked })}
            />
            <span>
              <b>{tr("回车自动缩进")}</b>
              <small>
                {tr("Enter 按设置开始新段；Shift + Enter 普通换行。")}
              </small>
            </span>
          </label>
          <label className="manuscript-format-toggle">
            <input
              aria-label={tr("AI 生成自动排版")}
              type="checkbox"
              checked={form.formatAi}
              onChange={(e) => update({ formatAi: e.target.checked })}
            />
            <span>
              <b>{tr("AI 生成自动排版")}</b>
              <small>
                {tr("新生成的正文、续写和润色按此排版，提纲与设定保持原格式。")}
              </small>
            </span>
          </label>
        </fieldset>
        <section
          className="manuscript-format-preview"
          aria-label={tr("排版预览")}
        >
          <span>{tr("排版预览")}</span>
          <p>{formatManuscript(sample, form)}</p>
        </section>
        <p className="manuscript-format-note">
          {tr(
            "整理只调整段落空白，保留正文文字与标点，原稿可恢复。字号与行距可在显示设置中调整。",
          )}
        </p>
        {error && (
          <p className="manuscript-format-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="modal-footer manuscript-format-footer">
        <Button
          disabled={busy}
          onClick={() => setForm({ ...DEFAULT_MANUSCRIPT_FORMAT })}
        >
          {tr("恢复默认")}
        </Button>
        <div>
          {onApply && (
            <Button
              disabled={busy || applyDisabled}
              onClick={() => void submit(true)}
            >
              <TextAlignLeft size={16} />
              {tr("整理当前正文")}
            </Button>
          )}
          <Button
            variant="primary"
            busy={busy}
            onClick={() => void submit(false)}
          >
            {tr("保存设置")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
