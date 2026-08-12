import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PreviewApp } from "./PreviewApp";
import { ShareViewer } from "./ShareViewer";
import "@prototype-studio/design-system/styles.css";
import "./styles.css";

const isPreview = window.location.pathname.startsWith("/preview-runtime");
const isShare = /^\/share\/[^/]+$/.test(window.location.pathname);

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isShare ? <ShareViewer /> : isPreview ? <PreviewApp /> : <App />}</StrictMode>
);
