import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applySavedTheme } from "./theme";
import "./styles.css";
import "./ui-polish.css";
applySavedTheme();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
