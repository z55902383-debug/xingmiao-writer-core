import LanguageSwitcher from "./LanguageSwitcher";
import { tr } from "./i18n";
import { useEffect, useState, useRef } from "react";
import {
  Translate,
  Plugs,
  
  PuzzlePiece,
  Database,
  Info,
  Plus,
  Trash,
  DownloadSimple,
  FolderOpen,
  FolderSimple,
  ArrowClockwise,
  WarningCircle,
} from "@phosphor-icons/react";
import { api } from "./api";
import type { Config, Skill, Kind, TrashEntry } from "./types";
import { Button, Field, Modal } from "./ui";
import ModelSettings from "./ModelSettings";

const tasks: Record<Kind, string> = {
  bookOutline: "全书总纲",
  volumePlan: "分卷规划",
  chapterPlan: "本卷章节规划",
  chapterDetails: "本卷章节细纲",
  worldBuild: "世界设定",
  characters: "人物档案",
  volumeOutline: "卷大纲",
  volumeDetail: "卷细纲",
  summary: "章节概要",
  timelinePlan: "变化计划",
  write: "写正文",
  continue: "续写",
  polish: "润色",
  outline: "大纲",
  memory: "提取记忆",
  check: "连续性检查",
  style: "分析风格",
};
const blank = (): Skill => ({
  name: "",
  description: "",
  body: "",
  enabled: false,
  tasks: ["write", "continue", "polish"],
});
type DataInfo = {
  path: string;
  defaultPath: string;
  isDefault: boolean;
  lockedByEnv: boolean;
  unreachable: string;
  pending: string;
};
type DirCandidate = {
  dir: string;
  sameAsCurrent?: boolean;
  isDefault?: boolean;
  hasData?: boolean;
  books?: number;
  error?: string;
};
type Applied = {
  previous: string;
  next: string;
  migrated: number | null;
  mode: "migrate" | "reuse" | "default";
};
export default function Settings({
  config,
  onClose,
  onSaved,
  onDataChanged,
  
}: {
  config: Config;
  onClose: () => void;
  onSaved: (c: Config) => void;
  onDataChanged: () => Promise<void>;
  
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState("models"),
    [skills, setSkills] = useState<Skill[]>([]),
    [draft, setDraft] = useState<Skill | null>(null),
    [search, setSearch] = useState("");
  const [trash, setTrash] = useState<TrashEntry[]>([]);
  const [dataInfo, setDataInfo] = useState<DataInfo | null>(null),
    [move, setMove] = useState<DirCandidate | null>(null),
    [applied, setApplied] = useState<Applied | null>(null);
  
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState("");
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [tab]);
  const [remove, setRemove] = useState<Skill | null>(null);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setResult("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void run(async () => {
      const [s, t, d] = await Promise.all([
        api<Skill[]>("skills:list"),
        api<TrashEntry[]>("trash:list"),
        api<DataInfo>("data:info"),
      ]);
      setSkills(s);
      setTrash(t);
      setDataInfo(d);
    });
  }, []);
  // 切换存储位置与恢复默认位置走同一套「选目录 → 确认 → 重启」流程。
  function chooseDir() {
    return run(async () => {
      const picked = await api<DirCandidate | null>("data:pick");
      if (picked) setMove(picked);
    });
  }
  function applyDir(candidate: DirCandidate, migrate: boolean) {
    return run(async () => {
      const r = await api<Applied>("data:apply", {
        dir: candidate.dir,
        migrate,
      });
      setApplied(r);
      setMove(null);
      // 重新取一次，让卡片立刻显示「已改为…重启后生效」。
      setDataInfo(await api<DataInfo>("data:info"));
    });
  }
  function resetDir() {
    return run(async () => {
      const r = await api<{
        previous: string;
        next: string;
      }>("data:reset");
      setApplied({
        previous: r.previous,
        next: r.next,
        migrated: null,
        mode: "default",
      });
      setDataInfo(await api<DataInfo>("data:info"));
    });
  }
  return (
    <Modal title={tr("模型与本地设置")} wide onClose={() => !busy && onClose()}>
      <div className="settings-shell">
        <nav className="settings-nav" aria-label={tr("设置分类")}>
          {[
            { id: "language", label: "语言设置", icon: Translate },
            { id: "models", label: "模型连接", icon: Plugs },
            
            { id: "skills", label: "写作 Skill", icon: PuzzlePiece },
            { id: "data", label: "数据与回收站", icon: Database },
            
          ].map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "active" : ""}
              onClick={() => {
                setTab(t.id);
                setError("");
                setResult("");
              }}
            >
              <t.icon size={19} />
              {tr(t.label)}
            </button>
          ))}
          <div className="settings-brand">
            <img src="./cat-avatar.png" alt={tr("星喵头像")} />
            <span>{tr("星喵写作")}<small>{tr("让故事慢慢长大")}</small>
            </span>
          </div>
        </nav>
        <div className="settings-content" ref={contentRef}>
          {tab === "language" && (
            <div className="settings-panel">
              <div className="section-intro"><h3>{tr("语言设置")}</h3><p>{tr("选择界面使用的语言，即时生效并自动记住。作品正文和资料不会被翻译。")}</p></div>
              <div className="settings-card language-settings"><LanguageSwitcher expanded /></div>
            </div>
          )}
          <div hidden={tab !== "models"}>
            <ModelSettings config={config} onSaved={onSaved} />
          </div>
          
          {tab === "skills" && (
            <div className="settings-panel">
              <div className="section-intro">
                <h3>{tr("写作 Skill")}</h3>
                <p>{tr("把常用写法整理成可复用指令，只在选定任务中生效。")}</p>
              </div>
              <div className="notice">{tr("导入后默认关闭。当前支持 SKILL.md 中的文字指令，不运行脚本或读取引用文件。启用前请查看内容。")}</div>
              <div className="settings-actions">
                <input
                  aria-label={tr("搜索 Skill")}
                  placeholder={tr("搜索名称或说明")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <Button onClick={() => setDraft(blank())}>
                  <Plus />{tr("新建 Skill")}</Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const s = await api<Skill[] | null>("skill:import");
                      if (s) {
                        setSkills(s);
                        setResult(tr("已导入，请检查内容后启用"));
                      }
                    })
                  }
                >{tr("导入文件")}</Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const s = await api<Skill[] | null>("skill:import", {
                        folder: true,
                      });
                      if (s) {
                        setSkills(s);
                        setResult(tr("已导入文件夹中的 SKILL.md"));
                      }
                    })
                  }
                >{tr("导入文件夹")}</Button>
              </div>
              <p className="muted">{tr("已启用")}{" "}{skills.filter((s) => s.enabled).length}{" "}{tr("/ 共")}{" "}
                {skills.length}{" "}{tr("· 相关指令完整发送，不设应用内字数上限")}</p>
              <div className="skill-list">
                {skills
                  .filter((s) =>
                    `${s.name} ${s.description}`
                      .toLowerCase()
                      .includes(search.toLowerCase()))
                  .map((s) => (
                    <article className="skill-row" key={s.id}>
                      <div className="skill-heading">
                        <button
                          className="skill-name"
                          onClick={() => setDraft({ ...s })}
                        >
                          {s.name}
                          <small>
                            v{s.version} · {s.source}
                          </small>
                        </button>
                        <label className="skill-switch">
                          <input
                            type="checkbox"
                            aria-label={tr("启用 {0}", {0: s.name})}
                            checked={s.enabled}
                            disabled={busy}
                            onChange={(e) => {
                              const enabled = e.target.checked;
                              run(async () =>
                                setSkills(
                                  await api<Skill[]>("skill:save", {
                                    ...s,
                                    enabled,
                                  })));
                            }}
                          />
                          <span>{s.enabled ? tr("已启用") : tr("关闭")}</span>
                        </label>
                      </div>
                      <p>{s.description || tr("暂无说明")}</p>
                      <div className="skill-bottom">
                        <span>{s.tasks.map((t) => tasks[t]).join(" · ")}</span>
                        <Button onClick={() => setDraft({ ...s })}>{tr("编辑")}</Button>
                        <Button
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              const p = await api<string | null>(
                                "skill:export",
                                { id: s.id });
                              if (p) setResult(tr("Skill 已导出"));
                            })
                          }
                        >
                          <DownloadSimple size={15} />{tr("导出")}</Button>
                        <Button
                          onClick={() => setRemove(s)}
                          aria-label={tr("删除 {0}", {0: s.name})}
                        >
                          <Trash size={16} />
                        </Button>
                      </div>
                    </article>
                  ))}
              </div>
            </div>
          )}
          {tab === "data" && (
            <div className="settings-panel">
              <div className="section-intro">
                <h3>{tr("数据与回收站")}</h3>
                <p>{tr("作品存在本机。删除的作品、章节和资料可在这里恢复。")}</p>
              </div>
              <div className="settings-card">
                <div className="card-head">
                  <h4>{tr("存储位置")}</h4>
                  {dataInfo && (
                    <span
                      className={`badge ${dataInfo.lockedByEnv ? "warn" : dataInfo.isDefault ? "" : "accent"}`}
                    >
                      {dataInfo.lockedByEnv
                        ? tr("由环境变量指定")
                        : dataInfo.isDefault
                          ? tr("默认位置")
                          : tr("自定义位置")}
                    </span>
                  )}
                </div>
                <p className="path-text">{dataInfo?.path || config.dataPath}</p>
                {dataInfo?.pending ? (
                  <p className="notice-box">
                    <WarningCircle size={16} />{tr("已改为")}{" "}{dataInfo.pending}{tr("，重启软件后生效。")}</p>
                ) : null}
                {dataInfo?.unreachable ? (
                  <p className="alert-box">
                    <WarningCircle size={16} />{tr("自定义位置")}{" "}{dataInfo.unreachable}{tr("现在打不开（盘没接上或被移走），本次已临时使用上面这个位置。设置仍然保留，位置恢复后重启即可回去。")}</p>
                ) : null}
                <p>{tr("作品、章节历史、模型配置和密钥都存在这个文件夹里。可以放到空间更大的盘，或放进自己的同步盘。")}</p>
                <div className="settings-actions">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api("data:open");
                      })
                    }
                  >
                    <FolderOpen size={16} />{tr("打开数据文件夹")}</Button>
                  <Button
                    disabled={busy || !!dataInfo?.lockedByEnv}
                    onClick={chooseDir}
                  >
                    <FolderSimple size={16} />{tr("更改位置…")}</Button>
                  {dataInfo &&
                  (!dataInfo.isDefault || dataInfo.unreachable) &&
                  !dataInfo.lockedByEnv ? (
                    <Button disabled={busy} onClick={resetDir}>
                      <ArrowClockwise size={16} />
                      {dataInfo.unreachable
                        ? tr("放弃这个自定义位置")
                        : tr("恢复默认位置")}
                    </Button>
                  ) : null}
                </div>
                {dataInfo?.lockedByEnv ? (
                  <p className="hint-text">{tr("当前数据目录由 XM_DATA_DIR 环境变量指定，软件内无法更改；清掉该变量后即可使用下面的按钮。")}</p>
                ) : null}
              </div>
              <div className="settings-card">
                <h4>{tr("备份与恢复")}</h4>
                <p>{tr("包含作品、章节历史、写作 Skill 和回收站，不包含账号密钥。恢复会创建副本。")}</p>
                <div className="settings-actions">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const p = await api<string | null>("backup:save");
                        if (p) setResult(tr("完整备份已保存"));
                      })
                    }
                  >{tr("导出全部数据")}</Button>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const n = await api<number | null>("backup:restore");
                        if (n !== null) {
                          await onDataChanged();
                          setSkills(await api<Skill[]>("skills:list"));
                          setTrash(await api<TrashEntry[]>("trash:list"));
                          setResult(tr("已恢复 {0} 部作品副本", {0: n}));
                        }
                      })
                    }
                  >{tr("从备份恢复")}</Button>
                </div>
              </div>
              <h4>{tr("回收站 ·")}{" "}{trash.length}</h4>
              {!trash.length && <p className="muted">{tr("回收站是空的。")}</p>}
              {trash.map((t) => (
                <div className="trash-row" key={t.id}>
                  <div>
                    <b>{t.title}</b>
                    <small>
                      {
                        (
                          {
                            book: "作品",
                            chapter: "章节",
                            character: "人物",
                            memory: "记忆",
                            reference: "参考文章",
                            timeline: "时间线变化",
                            volume: "分卷",
                            planning: "生成前资料",
                          } as Record<string, string>
                        )[t.type]
                      }{" "}
                      · {t.bookTitle} ·{" "}
                      {new Date(t.deletedAt).toLocaleDateString()}
                    </small>
                  </div>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api("trash:restore", { id: t.id });
                        setTrash(await api<TrashEntry[]>("trash:list"));
                        await onDataChanged();
                        setResult(
                          tr("已恢复。来源章节恢复后，相关记忆需重新核对。"));
                      })
                    }
                  >{tr("恢复")}</Button>
                </div>
              ))}
            </div>
          )}
          
          {error && (
            <p className="error-box" role="alert">
              {tr(error)}
            </p>
          )}
          {result && (
            <p className="success-box" role="status">
              {result}
            </p>
          )}
        </div>
      </div>
      {draft && (
        <Modal
          title={draft.id ? tr("编辑 Skill") : tr("新建 Skill")}
          onClose={() => !busy && setDraft(null)}
        >
          <div className="modal-body">
            <Field label={tr("Skill 名称")}>
              <input
                value={draft.name}
                maxLength={100}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field label={tr("说明")}>
              <input
                value={draft.description}
                maxLength={1000}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
              />
            </Field>
            <Field
              label={tr("指令内容")}
              hint={tr("作为写作规则完整注入模型上下文，不截断内容。")}
            >
              <textarea
                rows={9}

                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
            </Field>
            <fieldset className="skill-tasks">
              <legend>{tr("适用任务")}</legend>
              {(Object.keys(tasks) as Kind[]).map((t) => (
                <label key={t}>
                  <input
                    type="checkbox"
                    checked={draft.tasks.includes(t)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        tasks: e.target.checked
                          ? [...draft.tasks, t]
                          : draft.tasks.filter((x) => x !== t),
                      })
                    }
                  />
                  {tr(tasks[t])}
                </label>
              ))}
            </fieldset>
            {error && <p className="error-box">{tr(error)}</p>}
          </div>
          <div className="modal-footer">
            <Button onClick={() => setDraft(null)}>{tr("取消")}</Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  setSkills(await api<Skill[]>("skill:save", draft));
                  setDraft(null);
                  setResult(tr("Skill 已保存"));
                })
              }
            >{tr("保存 Skill")}</Button>
          </div>
        </Modal>
      )}
      {remove && (
        <Modal title={tr("删除 Skill？")} onClose={() => setRemove(null)}>
          <div className="modal-body">
            <p>{tr("将删除「")}{remove.name}{tr("」。需要保留时，可先导出。")}</p>
          </div>
          <div className="modal-footer">
            <Button onClick={() => setRemove(null)}>{tr("取消")}</Button>
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  setSkills(
                    await api<Skill[]>("skill:delete", { id: remove.id }));
                  setRemove(null);
                })
              }
            >{tr("确认删除 Skill")}</Button>
          </div>
        </Modal>
      )}
      {move && (
        <Modal title={tr("更改存储位置")} onClose={() => !busy && setMove(null)}>
          <div className="modal-body">
            <span className="field-label">{tr("新位置")}</span>
            <p className="path-text">{move.dir}</p>
            {move.error ? (
              <p className="notice-box">
                <WarningCircle size={16} />
                {move.error}
              </p>
            ) : move.sameAsCurrent ? (
              <p className="muted">{tr("这就是当前正在使用的位置。")}</p>
            ) : move.hasData ? (
              <p className="notice-box">
                <WarningCircle size={16} />{tr("该文件夹里已有一份星喵数据（")}{move.books ?? 0}{tr("部作品）。迁移会把当前作品复制过去，原有文件先改名留底，不会被覆盖。")}</p>
            ) : (
              <p className="notice-box">
                <WarningCircle size={16} />{tr("该文件夹里没有星喵数据。选「只切换」会得到一个空白书架，当前作品仍留在原位置。")}</p>
            )}
            <p className="muted">{tr("两种方式都只增不删：现在的数据会原样留在原位置，确认新位置没问题后再自行清理。")}</p>
            {error && (
              <p className="error-box" role="alert">
                {tr(error)}
              </p>
            )}
          </div>
          <div className="modal-footer">
            <Button disabled={busy} onClick={() => setMove(null)}>{tr("取消")}</Button>
            {!move.error && !move.sameAsCurrent && (
              <Button disabled={busy} onClick={() => applyDir(move, false)}>{tr("只切换，用该文件夹现有数据")}</Button>
            )}
            {!move.error && (
              <Button
                variant="primary"
                busy={busy}
                onClick={() => applyDir(move, true)}
              >{tr("迁移作品并切换")}</Button>
            )}
          </div>
        </Modal>
      )}
      {applied && (
        <Modal title={tr("需要重启软件")} onClose={() => setApplied(null)}>
          <div className="modal-body">
            <p>
              {applied.mode === "default"
                ? tr("已恢复为默认存储位置。")
                : applied.mode === "migrate"
                  ? tr("已把 {0} 部作品复制到新位置。", {0: applied.migrated ?? 0})
                  : tr("已指向新的存储位置。")}{tr("存储位置在软件启动时才会读取，需要重启一次才会生效。")}</p>
            <p className="path-text">{applied.next}</p>
            <p className="muted">{tr("原位置")}{" "}{applied.previous}{" "}{tr("的数据保持不动，没有做任何删除。")}</p>
            {error && (
              <p className="error-box" role="alert">
                {tr(error)}
              </p>
            )}
          </div>
          <div className="modal-footer">
            <Button disabled={busy} onClick={() => setApplied(null)}>{tr("稍后自己重启")}</Button>
            <Button
              variant="primary"
              busy={busy}
              onClick={() =>
                run(async () => {
                  await api("data:restart");
                })
              }
            >{tr("立即重启")}</Button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
