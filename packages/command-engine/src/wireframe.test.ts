import { describe, expect, it } from "vitest";
import type { PageDSL, WireframeDSL } from "@prototype-studio/dsl-schema";
import { executeCommands } from "./index";

function basePage(): PageDSL {
  return {
    dslVersion: "1.0",
    rendererVersion: "1.0.0",
    designSystemVersion: "1.0.0",
    revision: 4,
    page: { id: "repayment-plan", type: "wireframe", title: "还款计划线框页", status: "Draft" },
    layout: { type: "standard", density: "normal" },
    overlays: [],
    rules: [],
    events: [],
    wireframe: {
      width: 1440,
      height: 900,
      background: "#ffffff",
      elements: [{ id: "wf-keep", type: "rect", x: 24, y: 24, width: 160, height: 90 }]
    }
  };
}

function nextWireframe(): WireframeDSL {
  return {
    width: 1440,
    height: 900,
    background: "#ffffff",
    elements: [
      { id: "wf-keep", type: "rect", x: 40, y: 40, width: 200, height: 100 },
      { id: "wf-new", type: "table", x: 40, y: 180, width: 640, height: 220, cols: 4, rows: 4 }
    ]
  };
}

describe("SET_WIREFRAME", () => {
  it("整块替换线框内容并推进 revision", () => {
    const page = basePage();
    const result = executeCommands({
      dsl: page,
      baseRevision: 4,
      commands: [{ type: "SET_WIREFRAME", wireframe: nextWireframe() }],
      source: "manual",
      operator: "jojo",
      now: "2026-10-16T08:00:00.000Z",
      revisionId: "revision-5"
    });

    expect(result.dsl.revision).toBe(5);
    expect(result.dsl.wireframe?.elements.map((element) => element.id)).toEqual(["wf-keep", "wf-new"]);
    expect(result.dsl.wireframe?.elements[0]?.x).toBe(40);
    expect(result.revision.changedComponentIds.sort()).toEqual(["wf-keep", "wf-new"]);
    // 原始 DSL 不被就地修改
    expect(page.wireframe?.elements.map((element) => element.id)).toEqual(["wf-keep"]);
    expect(page.wireframe?.elements[0]?.x).toBe(24);
  });

  it("删除元件时把被删除的 id 一并标记为变更", () => {
    const page = basePage();
    page.wireframe?.elements.push({ id: "wf-drop", type: "text", x: 24, y: 140, width: 160, height: 24, text: "待删除" });
    const result = executeCommands({
      dsl: page,
      baseRevision: 4,
      commands: [{ type: "SET_WIREFRAME", wireframe: nextWireframe() }],
      source: "manual",
      operator: "jojo"
    });
    expect(result.revision.changedComponentIds.sort()).toEqual(["wf-drop", "wf-keep", "wf-new"]);
  });

  it("拒绝基于过期 revision 的提交", () => {
    expect(() => executeCommands({
      dsl: basePage(),
      baseRevision: 3,
      commands: [{ type: "SET_WIREFRAME", wireframe: nextWireframe() }],
      source: "manual",
      operator: "jojo"
    })).toThrowError(expect.objectContaining({ code: "REVISION_CONFLICT" }));
  });
});
