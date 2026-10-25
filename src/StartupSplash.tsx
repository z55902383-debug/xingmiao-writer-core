import { useEffect, useRef, useState } from "react";
import icon from "./startup-icon.svg?raw";
import { startStartupMotion } from "./startup-motion";
import { tr } from "./i18n";
import "./startup-splash.css";

export default function StartupSplash({
  ready,
  onDone,
}: {
  ready: boolean;
  onDone: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [finished, setFinished] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const stop = startStartupMotion(root.current!);
    const timer = window.setTimeout(() => setFinished(true), 1700);
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (!ready || !finished) return;
    setLeaving(true);
    const timer = window.setTimeout(onDone, 300);
    return () => clearTimeout(timer);
  }, [ready, finished, onDone]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFinished(true);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  return (
    <div
      ref={root}
      className={`startup-splash${leaving ? " is-leaving" : ""}`}
      aria-label={tr("正在打开创作空间")}
      aria-busy={!ready}
    >
      <canvas aria-hidden="true" />
      <div
        className="startup-art"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: icon }}
      />
      <button
        className="startup-skip"
        aria-label={tr("跳过")}
        title={tr("跳过")}
        onClick={() => setFinished(true)}
      >
        ×
      </button>
    </div>
  );
}
