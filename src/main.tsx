import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { startVersionWatch } from "./lib/version";
import { installGlobalErrorHandlers } from "./lib/log";
import { toast } from "./store/toastStore";
import "./fonts.css";
import "./index.css";

// Refresh into a newer bundle the moment one is deployed (beats stale caches).
startVersionWatch();

// Capture uncaught errors / promise rejections into the local (never-uploaded)
// log so they're diagnosable instead of vanishing. Surface a single gentle
// notice rather than spamming a toast per error.
let warnedThisSession = false;
installGlobalErrorHandlers(() => {
  if (warnedThisSession) return;
  warnedThisSession = true;
  toast("Something went wrong in the background — your work is safe. Reload if things look off.", "error");
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
