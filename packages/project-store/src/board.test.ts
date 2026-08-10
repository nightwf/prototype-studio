import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { caseListExample } from "@prototype-studio/dsl-schema/example";
import { DSL_VERSION, type BoardDSL } from "@prototype-studio/dsl-schema";
import { createBoard, createBoards, createPage, createProject, deleteBoard, ensureBoard, executeBoardCommands, getBoardRevision, listBoards, listTrashedBoards, readBoard, restoreBoard, updateBoard, writeBoard } from "./index";

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
    await expect(writeBoard(root, {
      dslVersion: DSL_VERSION,
      id: "b",
      name: "无效画布",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      revision: 1,
      objects: [],
      links: [{ id: "l", from: "a", to: "b" }]
    }))
      .rejects.toMatchObject({ code: "INVALID_DSL_FILE" });

    await createPage(root, caseListExample);
    await rm(join(root, "boards/main.board.yaml"));
    await writeFile(join(root, "board.yaml"), stringify({
      dslVersion: DSL_VERSION,
      id: "legacy-board",
      revision: 1,
      objects: [{ id: "obj-case-list", type: "page", pageId: "case-list", x: 120, y: 80, width: 960, height: 640 }],
      links: []
    }), "utf8");
    await mkdir(join(root, "requirements"), { recursive: true });
    await writeFile(join(root, "requirements/legacy.md"), "legacy", "utf8");
    const manifest = parse(await readFile(join(root, "project.yaml"), "utf8")) as Record<string, unknown>;
    delete manifest.projectFormatVersion;
    delete manifest.defaultBoardId;
    await writeFile(join(root, "project.yaml"), stringify(manifest), "utf8");
    const board = await ensureBoard(root);
    expect(board.objects).toEqual([
      expect.objectContaining({ type: "page", pageId: "case-list", width: 960, height: 640 })
    ]);
    await expect(stat(join(root, "requirements"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(root, "board.yaml"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(parse(await readFile(join(root, "project.yaml"), "utf8"))).toMatchObject({ projectFormatVersion: 2, defaultBoardId: "main" });
  });

  it("persists board command revisions and audit entries", async () => {
    const root = await temporaryRoot();
    await createProject(root, { name: "画布项目" });

    const result = await executeBoardCommands(root, "main", {
      baseRevision: 1,
      commands: [
        { type: "ADD_BOARD_OBJECT", object: { id: "note-1", type: "note", x: 10, y: 20, width: 200, height: 80, text: "说明", source: "explicit" } }
      ],
      source: "mcp",
      operator: "codex"
    });

    expect(result.board.revision).toBe(2);
    expect(result.revision.changedObjectIds).toEqual(["note-1"]);
    expect(await getBoardRevision(root, "main", 2)).toMatchObject({ revision: 2, operator: "codex", source: "mcp" });
    const audit = await readFile(join(root, ".prototype/audit.jsonl"), "utf8");
    expect(audit).toContain('"boardId"');
    expect(audit).toContain('"changedObjectIds":["note-1"]');
  });

  it("creates, lists and manages independent boards with shared pages", async () => {
    const root = await temporaryRoot();
    await createProject(root, { name: "多画布项目", projectId: "multi-board", now: "2026-01-01T00:00:00.000Z" });
    await createPage(root, caseListExample);
    const second = await createBoard(root, { name: "对账画布", pageIds: ["case-list"], now: "2026-01-02T00:00:00.000Z" });
    expect(second.objects[0]).toMatchObject({ pageId: "case-list", x: 120, y: 80 });
    expect((await listBoards(root)).map((item) => item.name)).toEqual(["主画布", "对账画布"]);
    await expect(createBoard(root, { name: "对账画布" })).rejects.toMatchObject({ code: "BOARD_EXISTS" });
    await expect(createBoard(root, { name: "对账画布".toUpperCase() })).rejects.toMatchObject({ code: "BOARD_EXISTS" });
    await updateBoard(root, second.id, { isDefault: true, description: "月度对账" });
    expect((await listBoards(root))[0]).toMatchObject({ id: second.id, isDefault: true, description: "月度对账" });
    await deleteBoard(root, "main");
    const [trashed] = await listTrashedBoards(root);
    expect(trashed).toMatchObject({ boardId: "main", name: "主画布" });
    if (!trashed) throw new Error("未生成画布回收站记录");
    expect(await restoreBoard(root, trashed.trashId)).toMatchObject({ id: "main", name: "主画布" });
    expect(await listTrashedBoards(root)).toEqual([]);
    await deleteBoard(root, "main");
    await expect(deleteBoard(root, second.id)).rejects.toMatchObject({ code: "LAST_BOARD" });
  });

  it("keeps revisions isolated per board and rolls back an invalid batch", async () => {
    const root = await temporaryRoot();
    await createProject(root, { name: "并发项目" });
    const [alpha, beta] = await createBoards(root, [{ name: "Alpha" }, { name: "Beta" }]);
    expect(alpha).toBeDefined();
    expect(beta).toBeDefined();
    if (!alpha || !beta) throw new Error("批量创建画布结果不完整");
    await Promise.all([
      executeBoardCommands(root, alpha.id, { baseRevision: 1, commands: [{ type: "ADD_BOARD_OBJECT", object: { id: "a-note", type: "note", x: 0, y: 0, width: 100, height: 60, text: "A" } }], source: "api", operator: "test" }),
      executeBoardCommands(root, beta.id, { baseRevision: 1, commands: [{ type: "ADD_BOARD_OBJECT", object: { id: "b-note", type: "note", x: 0, y: 0, width: 100, height: 60, text: "B" } }], source: "api", operator: "test" })
    ]);
    expect(await getBoardRevision(root, alpha.id, 2)).toMatchObject({ boardId: alpha.id, revision: 2 });
    expect(await getBoardRevision(root, beta.id, 2)).toMatchObject({ boardId: beta.id, revision: 2 });
    await expect(createBoards(root, [{ name: "保留失败前状态" }, { name: "坏画布", pageIds: ["missing"] }])).rejects.toMatchObject({ code: "PAGE_NOT_FOUND" });
    expect((await listBoards(root)).some((item) => item.name === "保留失败前状态")).toBe(false);
  });
});
