import { describe, expect, it } from "vitest";
import type { PageDSL, WireframeElement } from "@prototype-studio/dsl-schema";
import { validateDSL, validateWireframe } from "./index";

function wireframePage(elements: unknown[] = []): PageDSL {
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
    dataSource: { type: "mock", ref: "repayment-plan-mock" },
    wireframe: { width: 1440, height: 900, background: "#ffffff", elements: elements as WireframeElement[] }
  };
}

describe("线框页校验", () => {
  it("接受覆盖全部元件类别的手绘线框页", () => {
    const page = wireframePage([
      { id: "wf-shell", type: "rect", x: 0, y: 0, width: 1440, height: 56 },
      { id: "wf-title", type: "text", x: 24, y: 18, width: 200, height: 24, text: "还款计划", align: "left", fontSize: 16, fontWeight: 600 },
      { id: "wf-filter", type: "input", x: 24, y: 80, width: 220, height: 32, text: "客户姓名" },
      { id: "wf-status", type: "select", x: 260, y: 80, width: 180, height: 32, text: "全部状态" },
      { id: "wf-search", type: "button", x: 456, y: 80, width: 88, height: 32, text: "查询", align: "center" },
      { id: "wf-icon", type: "icon", x: 560, y: 84, width: 24, height: 24, icon: "search" },
      { id: "wf-divider", type: "line", x: 24, y: 128, width: 1360, height: 2 },
      { id: "wf-table", type: "table", x: 24, y: 144, width: 920, height: 320, cols: 5, rows: 6 },
      { id: "wf-card", type: "card", x: 968, y: 144, width: 300, height: 180, text: "本期应还" },
      { id: "wf-tabs", type: "tabs", x: 24, y: 500, width: 360, height: 36, items: ["明细", "日志"] },
      { id: "wf-next", type: "arrow", x: 420, y: 512, width: 120, height: 2 },
      { id: "wf-modal", type: "modal", x: 420, y: 560, width: 420, height: 240, text: "登记还款" },
      { id: "wf-avatar", type: "image", x: 880, y: 560, width: 120, height: 120 },
      { id: "wf-badge", type: "roundRect", x: 1040, y: 560, width: 96, height: 32, radius: 16 },
      { id: "wf-dot", type: "ellipse", x: 1180, y: 560, width: 32, height: 32 }
    ]);
    expect(validateDSL(page)).toMatchObject({ valid: true, errors: [] });
  });

  it("线框页没有 wireframe 内容时报错", () => {
    const page = wireframePage();
    delete page.wireframe;
    const result = validateDSL(page);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "SCHEMA_INVALID", path: "$.wireframe" }));
  });

  it("拒绝重复 id 与未知元件类型", () => {
    const issues = validateWireframe({
      width: 1440,
      height: 900,
      elements: [
        { id: "dup", type: "rect", x: 0, y: 0, width: 10, height: 10 },
        { id: "dup", type: "unknown-widget", x: 0, y: 0, width: 10, height: 10 }
      ]
    });
    expect(issues.errors.some((error) => error.code === "DUPLICATE_COMPONENT_ID")).toBe(true);
    expect(issues.errors.some((error) => error.code === "INVALID_COMPONENT_TYPE")).toBe(true);
  });

  it("拒绝非法画板尺寸与缺失的元件坐标", () => {
    const issues = validateWireframe({
      width: 0,
      height: 900,
      elements: [{ id: "wf-1", type: "rect", x: 0, y: 0, width: 10 }]
    });
    expect(issues.errors.some((error) => error.path === "$.wireframe.width")).toBe(true);
    expect(issues.errors.some((error) => error.path === "$.wireframe.elements[0].height")).toBe(true);
  });

  it("非线框页携带 wireframe 内容时只告警", () => {
    const page = wireframePage([{ id: "wf-1", type: "rect", x: 0, y: 0, width: 10, height: 10 }]);
    page.page.type = "list";
    const result = validateDSL(page);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((warning) => warning.path === "$.wireframe")).toBe(true);
  });
});
