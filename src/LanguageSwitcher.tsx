import { Translate } from "@phosphor-icons/react";
import { setLanguage, tr, useLanguage, type Language } from "./i18n";

export default function LanguageSwitcher({ expanded = false }: { expanded?: boolean }) {
  const language = useLanguage();
  return (
    <label className={`language-switcher ${expanded ? "expanded" : ""}`}>
      <Translate size={17} aria-hidden="true" />
      {expanded && <span>{tr("界面语言")}</span>}
      <select aria-label={tr("界面语言")} value={language}
        onChange={event => setLanguage(event.target.value as Language)}>
        <option value="zh-CN">简体中文</option>
        <option value="en">English</option>
      </select>
    </label>
  );
}
