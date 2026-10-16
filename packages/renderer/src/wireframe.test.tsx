import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PageDSL, WireframeElement } from "@prototype-studio/dsl-schema";
import { PrototypeRenderer, WireframeRenderer } from "./index";

function wireframePage(elements: WireframeElement[]): PageDSL {
  return {
    dslVersion: "1.0",
    rendererVersion: "1.0.0",
    designSystemVersion: "1.0.0",
    revision: 1,
    page: { id: "repayment-plan", type: "wireframe", title: "还款计划线框页", status: "Draft" },
    layout: { type: "standard", density: "normal" },
    overlays: [],
    rules: [],
    events: [],
    wireframe: { width: 1440, height: 900, background: "#ffffff", elements }
  };
}

const ALL_TYPES: WireframeElement[] = [
  { id: "wf-rect", type: "rect", x: 0, y: 0, width: 120, height: 60 },
  { id: "wf-round", type: "roundRect", x: 140, y: 0, width: 120, height: 60, radius: 8 },
  { id: "wf-ellipse", type: "ellipse", x: 280, y: 0, width: 60, height: 60 },
  { id: "wf-line", type: "line", x: 0, y: 80, width: 120, height: 2 },
  { id: "wf-arrow", type: "arrow", x: 140, y: 80, width: 120, height: 2 },
  { id: "wf-text", type: "text", x: 280, y: 80, width: 160, height: 24, text: "本期应还" },
  { id: "wf-icon", type: "icon", x: 460, y: 80, width: 24, height: 24, icon: "search" },
  { id: "wf-image", type: "image", x: 500, y: 80, width: 120, height: 80 },
  { id: "wf-button", type: "button", x: 0, y: 140, width: 88, height: 32, text: "登记还款" },
  { id: "wf-input", type: "input", x: 100, y: 140, width: 220, height: 32, text: "客户姓名" },
  { id: "wf-select", type: "select", x: 340, y: 140, width: 180, height: 32, text: "全部状态" },
  { id: "wf-table", type: "table", x: 0, y: 200, width: 640, height: 220, cols: 4, rows: 4 },
  { id: "wf-card", type: "card", x: 660, y: 200, width: 260, height: 140, text: "合同信息" },
  { id: "wf-tabs", type: "tabs", x: 0, y: 440, width: 320, height: 36, items: ["明细", "日志"] },
  { id: "wf-modal", type: "modal", x: 0, y: 500, width: 420, height: 240, text: "登记还款" }
];

describe("线框页渲染", () => {
  it("PrototypeRenderer 对线框页走画板渲染而不是结构化页面", () => {
    const html = renderToStaticMarkup(<PrototypeRenderer dsl={wireframePage(ALL_TYPES)} />);
    expect(html).toContain("proto-wireframe");
    expect(html).not.toContain("proto-root");
    expect(html).toContain('data-wireframe-element="wf-text"');
    expect(html).toContain("本期应还");
  });

  it("全部 15 种元件都能渲染且不抛错", () => {
    expect(() => renderToStaticMarkup(<WireframeRenderer wireframe={wireframePage(ALL_TYPES).wireframe!} />)).not.toThrow();
    const html = renderToStaticMarkup(<WireframeRenderer wireframe={wireframePage(ALL_TYPES).wireframe!} />);
    ALL_TYPES.forEach((element) => expect(html).toContain(`data-wireframe-element="${element.id}"`));
  });

  it("按 z 值从小到大输出，保证遮挡顺序稳定", () => {
    const html = renderToStaticMarkup(<WireframeRenderer wireframe={wireframePage([
      { id: "wf-front", type: "rect", x: 0, y: 0, width: 40, height: 40, z: 9 },
      { id: "wf-back", type: "rect", x: 0, y: 0, width: 40, height: 40, z: 1 }
    ]).wireframe!} />);
    expect(html.indexOf('data-wireframe-element="wf-back"')).toBeLessThan(html.indexOf('data-wireframe-element="wf-front"'));
  });

  it("线框页没有 wireframe 内容时回退到结构化渲染器", () => {
    const page = wireframePage([]);
    delete page.wireframe;
    const html = renderToStaticMarkup(<PrototypeRenderer dsl={page} />);
    expect(html).toContain("proto-root");
  });
});
