import { useEffect, useRef, useState } from "react";
import type { PageDSL } from "@prototype-studio/dsl-schema";
import { PrototypeRenderer, type RuntimeEventPayload } from "@prototype-studio/renderer";
import "@prototype-studio/renderer/styles.css";

export function PreviewApp() {
  const [dsl, setDsl] = useState<PageDSL>();
  const [selectedId, setSelectedId] = useState<string>();
  const [aiSelect, setAiSelect] = useState(false);
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || !event.data || typeof event.data !== "object") return;
      if (event.data.type === "prototype:dsl") setDsl(event.data.dsl as PageDSL);
      if (event.data.type === "prototype:selected") setSelectedId(event.data.componentId || undefined);
      if (event.data.type === "prototype:ai-select") {
        setAiSelect(Boolean(event.data.enabled));
        if (!event.data.enabled) {
          setMarquee(null);
          startRef.current = null;
        }
      }
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

  const finishMarquee = (x2: number, y2: number) => {
    const start = startRef.current;
    startRef.current = null;
    setMarquee(null);
    if (!start) return;
    const x1 = Math.min(start.x, x2);
    const y1 = Math.min(start.y, y2);
    const right = Math.max(start.x, x2);
    const bottom = Math.max(start.y, y2);
    const ids: string[] = [];
    document.querySelectorAll<HTMLElement>("[data-component-id]").forEach((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.left < right && rect.right > x1 && rect.top < bottom && rect.bottom > y1) {
        const id = element.dataset.componentId;
        if (id) ids.push(id);
      }
    });
    const unique = [...new Set(ids)];
    if (unique.length) {
      window.parent.postMessage({
        type: "components:selected",
        projectId: "case-center-demo",
        pageId: dsl.page.id,
        componentIds: unique,
        point: { x: x2, y: y2 }
      }, window.location.origin);
    }
  };

  return (
    <div className="preview-ai-wrap">
      <PrototypeRenderer dsl={dsl} selectedId={selectedId} onSelect={select} onRuntimeEvent={runtime} />
      {aiSelect ? (
        <div
          className="preview-ai-overlay"
          onPointerDown={(event) => {
            startRef.current = { x: event.clientX, y: event.clientY };
            setMarquee({ x1: event.clientX, y1: event.clientY, x2: event.clientX, y2: event.clientY });
            event.preventDefault();
          }}
          onPointerMove={(event) => {
            if (startRef.current) {
              setMarquee((current) => current ? { ...current, x2: event.clientX, y2: event.clientY } : current);
            }
          }}
          onPointerUp={(event) => finishMarquee(event.clientX, event.clientY)}
        >
          {marquee ? (
            <div
              className="proto-marquee"
              style={{
                left: Math.min(marquee.x1, marquee.x2),
                top: Math.min(marquee.y1, marquee.y2),
                width: Math.abs(marquee.x2 - marquee.x1),
                height: Math.abs(marquee.y2 - marquee.y1)
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
