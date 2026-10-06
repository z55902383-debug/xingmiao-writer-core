import { currentLanguage } from "./i18n";
import "./types";
export async function api<T>(action: string, data: unknown = {}): Promise<T> {
  if (!window.xingmiao)
    throw new Error("请通过项目中的“启动星喵写作.cmd”打开桌面软件");
  const result = await window.xingmiao.invoke(action, data);
  if (!result.ok) throw new Error(result.error || "操作失败");
  return result.data as T;
}
export const count = (text: string) => text.replace(/\s/g, "").length;
export const number = (value: number) =>
  new Intl.NumberFormat(currentLanguage()).format(value);
export const date = (value: string) =>
  new Date(value).toLocaleString(currentLanguage(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export const copyText = (text: string) => api("clipboard:write", { text });
