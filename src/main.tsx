import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { useCallback, useState } from "react";
import StartupSplash from "./StartupSplash";
import { applySavedTheme } from "./theme";
import "./styles.css";
import "./ui-polish.css";

import "./manual-typing.css";
import "./reference-controls.css";
import "./section-spacing.css";
import "./display-refinement.css";
import "./page-scroll-regions.css";
applySavedTheme();
function StartupRoot() {
  const [ready, setReady] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const onReady = useCallback(() => setReady(true), []);
  const onDone = useCallback(() => setShowSplash(false), []);
  return <>
    <div inert={showSplash} style={{ display: "contents" }}><App onReady={onReady} /></div>
    {showSplash && <StartupSplash ready={ready} onDone={onDone} />}
  </>;
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <StartupRoot />
  </React.StrictMode>,
);
