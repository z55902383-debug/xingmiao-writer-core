import { tr } from "./i18n";
import { useState } from "react";
import { api } from "./api";
import type { Config } from "./types";
import { Button, Field } from "./ui";
type Detection = {
  loggedIn: boolean;
  path: string;
  models: { id: string; name: string }[];
};
export default function ModelSettings({
  config,
  onSaved,
}: {
  config: Config;
  onSaved: (c: Config) => void;
}) {
  const [value, setValue] = useState({
    ...config,
    apiKey: "",
    clearKey: false,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState("");
  const [detection, setDetection] = useState<Detection | null>(null);
  const update = (patch: Partial<typeof value>) => {
    setValue((v) => ({ ...v, ...patch }));
    setResult("");
  };
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
  async function save(test = false) {
    await run(async () => {
      const c = await api<Config>("config:save", value);
      setValue({ ...c, apiKey: "", clearKey: false });
      onSaved(c);
      setResult(
        test
          ? `连接成功 · ${await api<string>("config:test")}`
          : "模型配置已保存",
      );
    });
  }
  return (
    <div className="settings-panel">
      <div className="section-intro">
        <h3>{tr("模型连接")}</h3>
        <p>{tr("保存多套配置，在写作助手中随时切换。")}</p>
      </div>
      <div className="settings-actions">
        <select
          aria-label={tr("已保存的模型")}
          value={value.profileId || "new"}
          disabled={busy}
          onChange={(e) =>
            run(async () => {
              const c = await api<Config>("profiles:select", {
                id: e.target.value,
              });
              setValue({ ...c, apiKey: "", clearKey: false });
              setDetection(null);
              onSaved(c);
            })
          }
        >
          {(config.profiles || [config]).map((p, i) => (
            <option key={p.profileId || i} value={p.profileId || "default"}>
              {p.name || p.model || tr("默认模型")}
            </option>
          ))}
          {value.profileId === null && (
            <option value="new">{tr("新模型（未保存）")}</option>
          )}
        </select>
        <Button
          disabled={busy}
          onClick={() => {
            setValue({
              ...config,
              profileId: null,
              name: "新模型",
              provider: "api",
              baseUrl: "",
              model: "",
              apiKey: "",
              hasKey: false,
              clearKey: false,
              cliPath: "",
            });
            setDetection(null);
            setResult(tr("填写后点击保存设置"));
          }}
        >{tr("添加模型")}</Button>
      </div>
      <Field label={tr("配置名称")}>
        <input
          maxLength={100}
          value={value.name || ""}
          onChange={(e) => update({ name: e.target.value })}
        />
      </Field>
      <Field label={tr("连接方式")}>
        <select
          value={value.provider || "api"}
          onChange={(e) => {
            update({ provider: e.target.value as "api" | "codex", model: "" });
            setDetection(null);
          }}
        >
          <option value="api">{tr("API · 兼容接口 / 本机模型")}</option>
          <option value="codex">{tr("Codex · 使用本机登录")}</option>
        </select>
      </Field>
      {value.provider === "codex" ? (
        <>
          <div className="notice">{tr("通过本机 Codex 生成文字，使用当前登录账号的额度。无需复制账号令牌。只发送本次写作资料。")}</div>
          <Field label={tr("Codex 程序位置")} hint={tr("留空自动查找已安装的 Codex。")}>
            <input
              value={value.cliPath || ""}
              onChange={(e) => update({ cliPath: e.target.value })}
            />
          </Field>
          <div className="settings-actions">
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const p = await api<string | null>("codex:choose");
                  if (p) update({ cliPath: p });
                })
              }
            >{tr("选择程序")}</Button>
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const r = await api<Detection>("codex:detect", {
                    cliPath: value.cliPath,
                  });
                  setDetection(r);
                  setResult(
                    r.loggedIn
                      ? "已登录，模型列表已更新"
                      : "尚未登录，请先完成官方登录",
                  );
                })
              }
            >{tr("检测连接与模型")}</Button>
            <Button
              disabled={busy}
              onClick={() =>
                run(async () =>
                  setResult(
                    await api<string>("codex:login", {
                      cliPath: value.cliPath,
                    }),
                  ),
                )
              }
            >{tr("打开官方登录")}</Button>
          </div>
          <Field
            label={tr("Codex 模型")}
            hint={tr("模型列表来自本机 Codex；默认选项跟随账号可用模型。")}
          >
            <select
              value={value.model}
              onChange={(e) => update({ model: e.target.value })}
            >
              <option value="">{tr("使用 Codex 默认模型")}</option>
              {value.model &&
                !detection?.models.some((m) => m.id === value.model) && (
                  <option value={value.model}>{value.model}</option>
                )}
              {detection?.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
        </>
      ) : (
        <>
          <Field
            label={tr("接口地址")}
            hint={tr("填写服务商基础地址，例如 https://服务商域名/v1；本机支持 http://localhost:端口/v1。")}
          >
            <input
              value={value.baseUrl}
              onChange={(e) => update({ baseUrl: e.target.value })}
            />
          </Field>
          <Field label={tr("模型名称")} hint={tr("填写服务商提供的模型 ID。")}>
            <input
              value={value.model}
              onChange={(e) => update({ model: e.target.value })}
            />
          </Field>
          <Field
            label={tr("API 密钥")}
            hint={
              value.hasKey
                ? tr("已加密保存，留空继续使用。")
                : tr("由 Windows 加密保护，不包含在作品备份中。")
            }
          >
            <input
              type="password"
              autoComplete="off"
              value={value.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
            />
          </Field>
          {value.hasKey && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={value.clearKey}
                onChange={(e) => update({ clearKey: e.target.checked })}
              />{tr("清除已保存的密钥")}</label>
          )}
          <div className="form-row">
            <Field label={tr("创作温度")}>
              <select
                value={
                  value.temperature === null ? "default" : value.temperature
                }
                onChange={(e) =>
                  update({
                    temperature:
                      e.target.value === "default"
                        ? null
                        : Number(e.target.value),
                  })
                }
              >
                <option value="default">{tr("不传温度（模型默认）")}</option>
                <option value="0.3">{tr("0.3 · 更稳定")}</option>
                <option value="0.8">{tr("0.8 · 均衡")}</option>
                <option value="1">{tr("1.0 · 更自由")}</option>
              </select>
            </Field>
            <Field label={tr("输出上限（Token）")}>
              <input
                type="number"
                min={256}
                max={32768}
                value={value.maxTokens}
                onChange={(e) => update({ maxTokens: Number(e.target.value) })}
              />
            </Field>
          </div>
          <Field label={tr("输出长度参数")}>
            <select
              value={value.tokenParam || "max_tokens"}
              onChange={(e) => update({ tokenParam: e.target.value })}
            >
              <option value="max_tokens">{tr("max_tokens（常用兼容接口）")}</option>
              <option value="max_completion_tokens">
                max_completion_tokens
              </option>
            </select>
          </Field>
        </>
      )}
      {error && (
        <p role="alert" className="error-box">
          {tr(error)}
        </p>
      )}
      {result && (
        <p role="status" className="success-box">
          {result}
        </p>
      )}
      <div className="settings-actions">
        <Button disabled={busy} onClick={() => save(true)}>{tr("保存并测试连接")}</Button>
        <Button variant="primary" busy={busy} onClick={() => save()}>{tr("保存设置")}</Button>
      </div>
      {value.profileId && (
        <details className="danger-details">
          <summary>{tr("删除此模型配置")}</summary>
          <p>{tr("只移除连接配置和对应密钥，作品保持完整。至少保留一套配置。")}</p>
          <Button
            disabled={busy || (config.profiles?.length || 1) < 2}
            onClick={() =>
              run(async () => {
                const c = await api<Config>("profiles:delete", {
                  id: value.profileId,
                });
                setValue({ ...c, apiKey: "", clearKey: false });
                onSaved(c);
                setResult(tr("配置已删除"));
              })
            }
          >{tr("确认删除模型配置")}</Button>
        </details>
      )}
    </div>
  );
}
