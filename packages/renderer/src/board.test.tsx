import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DSL_VERSION, type BoardDSL } from "@prototype-studio/dsl-schema";
import { caseListExample } from "@prototype-studio/dsl-schema/example";
import { BoardRenderer } from "./index";

const board: BoardDSL = {
  dslVersion: DSL_VERSION,
  id: "board-test",
  name: "测试画布",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  revision: 1,
  objects: [
    { id: "obj-home", type: "page", pageId: "case-list", x: 120, y: 80, width: 960, height: 640, source: "default" },
    { id: "note-1", type: "note", x: 1180, y: 100, width: 280, height: 90, text: "上限 500 条", source: "explicit" },
    {
      id: "marker-1",
      type: "marker",
      number: 1,
      tone: "orange",
      text: "分配后是否支持撤回",
      source: "inferred",
      anchor: { pageObjectId: "obj-home", componentId: "search.status", offsetX: 20, offsetY: -10 }
    },
    {
      id: "flow-1",
      type: "flowchart",
      x: 120,
      y: 780,
      width: 480,
      height: 300,
      flowchart: {
        nodes: [{ id: "a", label: "勾选案件" }, { id: "b", label: "批量分配" }],
        edges: [{ id: "e1", from: "a", to: "b", label: "≤500" }]
      }
    },
    {
      id: "er-1",
      type: "er",
      x: 700,
      y: 780,
      width: 480,
      height: 300,
      er: {
        entities: [{ id: "case", name: "案件", fields: [{ name: "caseNo", type: "string", key: true }] }],
        relations: []
      }
    }
  ],
  links: [{ id: "link-1", from: "obj-home", to: "note-1", label: "约束", fromComponentId: "search.status", lineType: "orthogonal", strokeWidth: 4, color: "#dc2626" }]
};

describe("BoardRenderer", () => {
  it("renders page frames, notes, diagrams and links deterministically", () => {
    const first = renderToStaticMarkup(
      <BoardRenderer board={board} pages={{ "case-list": caseListExample }} interactive={false} />
    );
    const second = renderToStaticMarkup(
      <BoardRenderer board={structuredClone(board)} pages={{ "case-list": structuredClone(caseListExample) }} interactive={false} />
    );

    expect(first).toBe(second);
    expect(first).toContain('data-board-object="obj-home"');
    expect(first).toContain('data-board-object="note-1"');
    expect(first).toContain("上限 500 条");
    expect(first).toContain('data-board-object="flow-1"');
    expect(first).toContain('data-board-object="er-1"');
    expect(first).toContain('data-board-link="link-1"');
    expect(first).toContain('data-line-type="orthogonal"');
    expect(first).toContain('stroke="#dc2626"');
    expect(first).toContain('stroke-width="4"');
    expect(first.indexOf('data-board-object="obj-home"')).toBeLessThan(first.indexOf('data-board-link="link-1"'));
    expect(first).toContain('data-board-marker="marker-1"');
    expect(first).toContain('data-marker-anchor="obj-home:search.status:20:-10"');
    expect(first).toContain("勾选案件");
    expect(first).toContain("案件");
  });

  it("marks the canvas as picking so page frames become click-to-pick targets", () => {
    const markup = renderToStaticMarkup(
      <BoardRenderer board={board} pages={{ "case-list": caseListExample }} interactive picking />
    );
    expect(markup).toContain('class="board-canvas is-picking"');
    expect(markup).toMatch(/board-object--page\s+is-picking/);
  });

  it("shows draggable endpoint handles for the selected link", () => {
    const markup = renderToStaticMarkup(
      <BoardRenderer board={board} pages={{ "case-list": caseListExample }} interactive selectedLinkId="link-1" />
    );
    expect(markup).toContain('data-link-endpoint="from"');
    expect(markup).toContain('data-link-endpoint="to"');
    expect(markup).toContain("board-link-handle--to");
  });
});
