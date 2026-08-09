import { useEffect, useState } from "react";
import type { PageDSL } from "@prototype-studio/dsl-schema";
import { PrototypeRenderer, type RuntimeEventPayload } from "@prototype-studio/renderer";
import "@prototype-studio/renderer/styles.css";

export function PreviewApp() {
  const [dsl, setDsl] = useState<PageDSL>();
  const [selectedId, setSelectedId] = useState<string>();

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || !event.data || typeof event.data !== "object") return;
      if (event.data.type === "prototype:dsl") setDsl(event.data.dsl as PageDSL);
      if (event.data.type === "prototype:selected") setSelectedId(event.data.componentId || undefined);
    };
    window.addEventListener("message", receive);
    window.parent.postMessage({ type: "preview:ready" }, window.location.origin);
    return () => window.removeEventListener("message", receive);
  }, []);

  if (!dsl) {
    return <div className="preview-loading">正在加载页面…</div>;
  }

  const select = (componentId: string) => {
    setSelectedId(componentId || undefined);
    window.parent.postMessage({
      type: "component:selected",
      projectId: "case-center-demo",
      pageId: dsl.page.id,
      componentId
    }, window.location.origin);
  };

  const runtime = (payload: RuntimeEventPayload) => {
    window.parent.postMessage({ type: "runtime:event", pageId: dsl.page.id, payload }, window.location.origin);
  };

  return <PrototypeRenderer dsl={dsl} selectedId={selectedId} onSelect={select} onRuntimeEvent={runtime} />;
}
