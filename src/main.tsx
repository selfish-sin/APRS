import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/typography.css";
import "./components/ui/ui.css";
import "./components/storage/storage.css";
import "./styles/app.css";
import "./components/library/library.css";

createRoot(document.getElementById("root")!).render(<App />);

// 装到桌面 / 手机主屏幕以后断网也能打开（单文件预览不用）。
if (!__SINGLE__ && import.meta.env.PROD && "serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => undefined);
  });
}
