import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { caseListExample } from "@prototype-studio/dsl-schema/example";
import { DSL_VERSION, type BoardDSL } from "@prototype-studio/dsl-schema";
import { createPage, createProject, ensureBoard, executeBoardCommands, getBoardRevision, readBoard, writeBoard } from "./index";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "prototype-board-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("board persistence", () => {
  it("creates an empty board with a project and round-trips writes", async () => {
    const root = await temporaryRoot();
    const opened = await createProject(root, { name: "画布项目" });

    expect(opened.board).toMatchObject({ revision: 1, objects: [] });
    const next: BoardDSL = {
      ...opened.board,
      revision: 2,
      objects: [{ id: "note-1", type: "note", x: 10, y: 20, width: 200, height: 80, text: "说明" }],
      links: []
    };
    await writeBoard(root, next);
    expect(await readBoard(root)).toEqual(next);
  });

  it("rejects an invalid board and generates a default canvas from pages", async () => {
    const root = await temporaryRoot();
    await createProject(root, { name: "画布项目" });
    await expect(writeBoard(root, { dslVersion: DSL_VERSION, id: "b", revision: 1, objects: [], links: [{ id: "l", from: "a", to: "b" }] }))
      .rejects.toMatchObject({ code: "INVALID_DSL_FILE" });

    await createPage(root, caseListExample);
    await rm(join(root, "board.yaml"));
    const board = await ensureBoard(root);
    expect(board.objects).toEqual([
      expect.objectContaining({ type: "page", pageId: "case-list", width: 960, height: 640 })
    ]);
  });

  it("persists board command revisions and audit entries", async () => {
    const root = await temporaryRoot();
    await createProject(root, { name: "画布项目" });

    const result = await executeBoardCommands(root, {
      baseRevision: 1,
      commands: [
        { type: "ADD_BOARD_OBJECT", object: { id: "note-1", type: "note", x: 10, y: 20, width: 200, height: 80, text: "说明", source: "explicit" } }
      ],
      source: "mcp",
      operator: "codex"
    });

    expect(result.board.revision).toBe(2);
    expect(result.revision.changedObjectIds).toEqual(["note-1"]);
    expect(await getBoardRevision(root, 2)).toMatchObject({ revision: 2, operator: "codex", source: "mcp" });
    const audit = await readFile(join(root, ".prototype/audit.jsonl"), "utf8");
    expect(audit).toContain('"boardId"');
    expect(audit).toContain('"changedObjectIds":["note-1"]');
  });
});
