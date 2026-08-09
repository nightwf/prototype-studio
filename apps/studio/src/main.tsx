import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PreviewApp } from "./PreviewApp";
import "@prototype-studio/design-system/styles.css";
import "./styles.css";

const isPreview = window.location.pathname.startsWith("/preview-runtime");

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isPreview ? <PreviewApp /> : <App />}</StrictMode>
);
