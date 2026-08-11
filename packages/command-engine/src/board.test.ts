import { describe, expect, it } from "vitest";
import { DSL_VERSION, type BoardDSL, type BoardNoteObject } from "@prototype-studio/dsl-schema";
import { applyBoardCommands, createBoardRestoreCommands, BoardEngineError } from "./index";

function board(): BoardDSL {
  return {
    dslVersion: DSL_VERSION,
    id: "test-board",
    name: "测试画布",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    revision: 3,
    objects: [
      {
        id: "obj-home",
        type: "page",
        pageId: "home",
        x: 120,
        y: 80,
        width: 960,
        height: 640,
        source: "default"
      }
    ],
    links: []
  };
}

describe("board command engine", () => {
  it("adds, moves and links canvas objects with a new revision", () => {
    const note: BoardNoteObject = {
      id: "note-1",
      type: "note",
      x: 1200,
      y: 100,
      width: 280,
      height: 90,
      text: "批量分配上限 500 条",
      source: "explicit"
    };
    const result = applyBoardCommands({
      board: board(),
      baseRevision: 3,
      source: "manual",
      operator: "jojo",
      commands: [
        { type: "ADD_BOARD_OBJECT", object: note },
        { type: "MOVE_BOARD_OBJECT", target: "note-1", x: 1300, y: 200 },
        { type: "ADD_BOARD_LINK", link: { id: "link-1", from: "obj-home", to: "note-1", label: "约束" } }
      ]
    });

    expect(result.board.revision).toBe(4);
    expect(result.revision.baseRevision).toBe(3);
    expect(result.board.objects[1]).toMatchObject({ id: "note-1", x: 1300, y: 200 });
    expect(result.board.links).toEqual([{ id: "link-1", from: "obj-home", to: "note-1", label: "约束" }]);
    expect(result.revision.changedObjectIds.sort()).toEqual(["link-1", "note-1"]);
  });

  it("deleting an object removes links that reference it", () => {
    const base = board();
    base.links = [{ id: "link-1", from: "obj-home", to: "note-1" }];
    const result = applyBoardCommands({
      board: base,
      baseRevision: 3,
      source: "manual",
      operator: "jojo",
      commands: [{ type: "DELETE_BOARD_OBJECT", target: "obj-home" }]
    });
    expect(result.board.objects).toHaveLength(0);
    expect(result.board.links).toHaveLength(0);
  });

  it("updates link anchors and visual style", () => {
    const base = board();
    base.objects.push({ id: "obj-target", type: "page", pageId: "target", x: 1200, y: 80, width: 960, height: 640 });
    base.links = [{ id: "link-1", from: "obj-home", to: "obj-target" }];
    const result = applyBoardCommands({
      board: base,
      baseRevision: 3,
      source: "manual",
      operator: "jojo",
      commands: [{ type: "UPDATE_BOARD_LINK", target: "link-1", changes: { fromComponentId: "toolbar.submit", toComponentId: "detail.title", lineType: "orthogonal", strokeWidth: 4, color: "#dc2626" } }]
    });
    expect(result.board.links[0]).toMatchObject({ fromComponentId: "toolbar.submit", toComponentId: "detail.title", lineType: "orthogonal", strokeWidth: 4, color: "#dc2626" });
  });

  it("rejects stale revisions and dangling links", () => {
    expect(() =>
      applyBoardCommands({
        board: board(),
        baseRevision: 2,
        source: "manual",
        operator: "jojo",
        commands: [{ type: "ADD_BOARD_LINK", link: { id: "l", from: "obj-home", to: "missing" } }]
      })
    ).toThrowError(BoardEngineError);

    expect(() =>
      applyBoardCommands({
        board: board(),
        baseRevision: 3,
        source: "manual",
        operator: "jojo",
        commands: [{ type: "ADD_BOARD_LINK", link: { id: "l", from: "obj-home", to: "obj-home" } }]
      })
    ).toThrowError(BoardEngineError);

    expect(() =>
      applyBoardCommands({ board: board(), baseRevision: 3, source: "manual", operator: "jojo", commands: [] })
    ).toThrowError(/commands 不能为空/);
  });

  it("generates restore commands that return the board to a previous state", () => {
    const base = board();
    base.objects.push({ id: "obj-target", type: "page", pageId: "target", x: 1200, y: 80, width: 960, height: 640 });
    base.links = [{ id: "link-1", from: "obj-home", to: "obj-target" }];

    const changed = applyBoardCommands({
      board: base,
      baseRevision: 3,
      source: "manual",
      operator: "jojo",
      commands: [
        { type: "MOVE_BOARD_OBJECT", target: "obj-home", x: 300, y: 400 },
        { type: "UPDATE_BOARD_LINK", target: "link-1", changes: { lineType: "orthogonal", color: "#dc2626" } },
        { type: "ADD_BOARD_OBJECT", object: { id: "note-1", type: "note", x: 10, y: 10, width: 120, height: 60, text: "说明", source: "explicit" } }
      ]
    });

    const restore = createBoardRestoreCommands(base, changed.board);
    expect(restore.length).toBeGreaterThan(0);
    const restored = applyBoardCommands({
      board: changed.board,
      baseRevision: changed.board.revision,
      source: "undo",
      operator: "jojo",
      commands: restore
    });
    expect(restored.board.objects).toEqual(base.objects);
    expect(restored.board.links).toEqual(base.links);
    expect(restored.board.revision).toBe(5);
  });

  it("restore commands also cover deleted objects and links", () => {
    const base = board();
    base.objects.push({ id: "note-1", type: "note", x: 10, y: 10, width: 120, height: 60, text: "说明", source: "explicit" });
    base.links = [{ id: "link-1", from: "obj-home", to: "note-1", label: "约束" }];

    const changed = applyBoardCommands({
      board: base,
      baseRevision: 3,
      source: "manual",
      operator: "jojo",
      commands: [{ type: "DELETE_BOARD_OBJECT", target: "note-1" }]
    });

    const restore = createBoardRestoreCommands(base, changed.board);
    const restored = applyBoardCommands({
      board: changed.board,
      baseRevision: changed.board.revision,
      source: "undo",
      operator: "jojo",
      commands: restore
    });
    expect(restored.board.objects).toEqual(base.objects);
    expect(restored.board.links).toEqual(base.links);
  });
});
