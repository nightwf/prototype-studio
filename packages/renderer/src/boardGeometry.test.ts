import { describe, expect, it } from "vitest";
import { DSL_VERSION, type BoardDSL } from "@prototype-studio/dsl-schema";
import {
  boardContentBounds,
  fitView,
  rectsIntersect,
  snapValue,
  visibleWorldRect,
  zoomAtCursor,
  type BoardView
} from "./boardGeometry";

const board: BoardDSL = {
  dslVersion: DSL_VERSION,
  id: "board-test",
  name: "测试画布",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  revision: 1,
  objects: [
    { id: "obj-home", type: "page", pageId: "home", x: 120, y: 80, width: 960, height: 640, source: "default" },
    { id: "note-1", type: "note", x: 1180, y: 100, width: 280, height: 90, text: "说明", source: "explicit" },
    {
      id: "marker-1",
      type: "marker",
      number: 1,
      tone: "orange",
      text: "标注",
      anchor: { pageObjectId: "obj-home", componentId: "search.status", offsetX: 20, offsetY: -10 }
    }
  ],
  links: []
};

describe("boardGeometry", () => {
  it("zooms toward the cursor while keeping the world point under it fixed", () => {
    const view: BoardView = { x: 120, y: 60, zoom: 1 };
    const next = zoomAtCursor(view, 1.25, 400, 300);
    expect(next.zoom).toBeCloseTo(1.25);
    // 光标下的世界点 (400-120)/1 = 280 应仍映射到屏幕 400
    expect(next.x + 280 * next.zoom).toBeCloseTo(400);
    expect(next.y + 240 * next.zoom).toBeCloseTo(300);
    expect(zoomAtCursor(view, 0.5, 0, 0).zoom).toBe(0.5);
  });

  it("clamps zoom to the allowed range", () => {
    expect(zoomAtCursor({ x: 0, y: 0, zoom: 1 }, 100, 0, 0).zoom).toBe(4);
    expect(zoomAtCursor({ x: 0, y: 0, zoom: 1 }, 0.001, 0, 0).zoom).toBe(0.05);
  });

  it("snaps values to the grid step", () => {
    expect(snapValue(23)).toBe(20);
    expect(snapValue(26)).toBe(30);
    expect(snapValue(4, 5)).toBe(5);
  });

  it("computes content bounds over objects and anchored markers", () => {
    const bounds = boardContentBounds(board, { "marker-1": { x: 280, y: 140 } });
    expect(bounds).toEqual({ minX: 120, minY: 80, maxX: 1460, maxY: 720 });
  });

  it("skips markers without a computed pin when measuring bounds", () => {
    const bounds = boardContentBounds(board, {});
    expect(bounds.minX).toBe(120);
    expect(bounds.maxY).toBe(720);
  });

  it("falls back to a default canvas area for an empty board", () => {
    const empty: BoardDSL = {
      dslVersion: DSL_VERSION,
      id: "e",
      name: "空画布",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      revision: 1,
      objects: [],
      links: []
    };
    expect(boardContentBounds(empty, {})).toEqual({ minX: 0, minY: 0, maxX: 1600, maxY: 1200 });
  });

  it("computes the visible world rect with margin for virtualization", () => {
    const rect = visibleWorldRect({ x: 100, y: 50, zoom: 2 }, 800, 600);
    expect(rect.minX).toBe(-250);
    expect(rect.minY).toBe(-225);
    expect(rect.maxX).toBe(550);
    expect(rect.maxY).toBe(475);
  });

  it("detects rectangle intersection with bounds", () => {
    expect(rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { minX: 5, minY: 5, maxX: 20, maxY: 20 })).toBe(true);
    expect(rectsIntersect({ x: 0, y: 0, width: 4, height: 4 }, { minX: 5, minY: 5, maxX: 20, maxY: 20 })).toBe(false);
  });

  it("fits the view to content bounds centered with padding", () => {
    const view = fitView({ minX: 100, minY: 100, maxX: 500, maxY: 300 }, 800, 600);
    expect(view.zoom).toBeCloseTo(1.25);
    expect(view.x + 300 * view.zoom).toBeCloseTo(400);
    expect(view.y + 200 * view.zoom).toBeCloseTo(300);
  });
});
