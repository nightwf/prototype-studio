import { describe, expect, it } from "vitest";
import { DSL_VERSION, type BoardDSL, type PageDSL } from "@prototype-studio/dsl-schema";
import { caseListExample } from "@prototype-studio/dsl-schema/example";
import { renderBoardHtml, renderBoardsHtml } from "./export";

const pageDsl = structuredClone(caseListExample) as PageDSL;

const board: BoardDSL = {
  dslVersion: DSL_VERSION,
  id: "main",
  name: "主画布",
  createdAt: "2026-10-16T00:00:00.000Z",
  updatedAt: "2026-10-16T00:00:00.000Z",
  revision: 3,
  objects: [
    { id: "obj-case-list", type: "page", pageId: "case-list", x: 0, y: 0, width: 960, height: 640 },
    { id: "note-1", type: "note", text: "这是一条说明", x: 1000, y: 0, width: 240, height: 80 },
    {
      id: "flow-1",
      type: "flowchart",
      x: 0,
      y: 700,
      width: 400,
      height: 300,
      flowchart: {
        nodes: [
          { id: "n1", label: "开始", kind: "start", position: { x: 40, y: 30 }, size: { width: 120, height: 50 } },
          { id: "n2", label: "结束", kind: "end", position: { x: 40, y: 180 }, size: { width: 120, height: 50 } }
        ],
        edges: [{ id: "e1", from: "n1", to: "n2" }]
      }
    },
    {
      id: "er-1",
      type: "er",
      x: 500,
      y: 700,
      width: 400,
      height: 300,
      er: {
        entities: [{ id: "entity-1", name: "还款流水", position: { x: 40, y: 40 }, width: 200, fields: [{ id: "f1", name: "id", type: "string", key: true }] }],
        relations: []
      }
    },
    { id: "image-1", type: "image", src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", x: 1000, y: 700, width: 200, height: 150, alt: "示意图" },
    {
      id: "component-1",
      type: "component",
      x: 1300,
      y: 0,
      width: 380,
      height: 280,
      component: {
        id: "modal-confirm",
        type: "modal",
        title: "确认核销",
        description: "请确认金额无误",
        fields: [{ id: "modal-confirm.amount", type: "number", label: "核销金额" }],
        actions: [{ id: "modal-confirm.ok", type: "button", text: "确认", variant: "primary" }]
      }
    },
    { id: "marker-1", type: "marker", number: 1, tone: "orange", text: "状态含义", anchor: { pageObjectId: "obj-case-list", componentId: "search.status" } }
  ],
  links: [{ id: "link-1", from: "obj-case-list", to: "note-1", label: "说明" }]
};

describe("页面预览 / 画布导出 一致性", () => {
  it("单画布导出渲染全部对象类型，不落入通用降级卡片", async () => {
    const html = await renderBoardHtml(board, { "case-list": pageDsl }, "一致性项目");

    expect(html).not.toContain('class="board-generic"');
    expect(html).toContain("board-page-body");
    expect(html).toContain("board-note-text");
    expect(html).toContain("board-flowchart");
    expect(html).toContain("board-er");
    expect(html).toContain("board-image");
    expect(html).toContain("board-component-preview");
    expect(html).toContain("board-marker-pin");
    expect(html).toContain("data-board-link");
  });

  it("画布内嵌页面使用页面自身 DSL 渲染，字段与标题一致", async () => {
    const html = await renderBoardHtml(board, { "case-list": pageDsl }, "一致性项目");

    expect(html).toContain("案件管理");
    expect(html).toContain("table.caseNo");
  });

  it("全部画布导出同样包含每种对象，并带画布导航", async () => {
    const html = await renderBoardsHtml([board], { "case-list": pageDsl }, "一致性项目", "main");

    expect(html).not.toContain('class="board-generic"');
    expect(html).toContain("data-board-tab");
    expect(html).toContain("board-component-preview");
    expect(html).toContain("board-image");
  });
});
