import tools from "../electron/creative-tool-tags.json";
import chapterTools from "../electron/creative-task-map.json";
import { tr } from "./i18n";
import "./creative-tool-tags.css";
export { tools as creativeTools };
export const toolTasks = (tasks: string[]) => {
  const explicit = tasks.filter(t => t.startsWith("tool:")).map(t => t.slice(5)).filter(t => tools.some(tool => tool.id === t));
  return [...new Set(explicit.length ? explicit : [...tasks, ...tasks.flatMap(t => (chapterTools as Record<string, string[]>)[t] || [])].filter(t => tools.some(tool => tool.id === t)))];
};
export default function CreativeToolTags({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  return <fieldset className="creative-tool-tags">
    <legend>{tr("工具箱专项标签")}</legend>
    <p>{tr("可多选；工具箱只展示带有对应标签的 Skill 和提示词。未标注的内容保留在原资料库。")}</p>
    <div>{tools.map(tool => <label key={tool.id}><input type="checkbox" checked={value.includes(tool.id)} onChange={e => onChange(e.target.checked ? [...value, tool.id] : value.filter(id => id !== tool.id))} />{tr(tool.label)}</label>)}</div>
  </fieldset>;
}
