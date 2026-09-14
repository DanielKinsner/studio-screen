import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Countdown, RecordingBar } from "./RecordingOverlays";
import "./styles.css";
// The desktop app opens its recording bar and countdown as small extra windows
// of this same page, selected by the URL hash.
const [view, option = ""] = location.hash.slice(1).split("?");
if (view === "bar" || view === "countdown")
  document.documentElement.dataset.view = view;
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {view === "bar" ? (
      <RecordingBar marker={option === "marker"} />
    ) : view === "countdown" ? (
      <Countdown seconds={Math.max(1, Number(option) || 3)} />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
