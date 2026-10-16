import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { caseListExample } from "@prototype-studio/dsl-schema/example";
import type { PageDSL } from "@prototype-studio/dsl-schema";
import { listPages, readBoard } from "@prototype-studio/project-store";
import { MemoryMetadataStore } from "./metadata";
import { ProjectSpaceManager } from "./spaces";
import { CloudMcpService, CloudMcpValidationError } from "./mcp/service";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "ps-ai-pipeline-"));
  roots.push(root);
  const metadata = new MemoryMetadataStore();
  const spaces = new ProjectSpaceManager(metadata, join(root, "spaces"));
  const user = await metadata.createUser("流水线", "pipeline@example.com", "hash", "user-pipeline");
  const service = new CloudMcpService(metadata, spaces, "http://127.0.0.1:8787");
  const project = await service.createProject(user.id, "AI 流水线项目");
  return { service, user, project };
}

function makePage(id: string, title = id): PageDSL {
  const dsl = structuredClone(caseListExample) as PageDSL;
  dsl.page.id = id;
  dsl.page.title = title;
  const renameIds = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (typeof record.id === "string" && record.id.startsWith("case-list")) {
      record.id = record.id.replace(/^case-list/, id);
    }
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) value.forEach(renameIds);
      else if (value && typeof value === "object") renameIds(value);
    }
  };
  renameIds(dsl);
  return dsl;
}

describe("AI 生成链路：批量建页与页面/画布编排", () => {
  it("批量校验失败时整批不写入，并给出逐项诊断", async () => {
    const { service, user, project } = await setup();
    const broken = makePage("bad-page");
    delete (broken as { overlays?: unknown }).overlays;

    let caught: unknown;
    try {
      await service.createPages(user.id, project.id, [makePage("page-a"), makePage("page-b"), broken]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as { details?: unknown }).details).toBeDefined();
    const issues = (caught as { details: Array<{ index: number; code: string; path?: string }> }).details;
    expect(issues.some((issue) => issue.index === 2 && typeof issue.path === "string")).toBe(true);

    const path = await service.projectPath(user.id, project.id);
    expect(await listPages(path)).toHaveLength(0);
  });

  it("批量建页成功后默认把页面铺到默认画布", async () => {
    const { service, user, project } = await setup();
    const result = await service.createPages(user.id, project.id, [makePage("page-a"), makePage("page-b"), makePage("page-c")]);

    expect(result.created_count).toBe(3);
    expect(result.placement?.added_page_ids).toHaveLength(3);

    const path = await service.projectPath(user.id, project.id);
    const board = await readBoard(path);
    const placed = board.objects.filter((object) => object.type === "page").map((object) => (object as { pageId: string }).pageId);
    expect(placed).toEqual(["page-a", "page-b", "page-c"]);
  });

  it("单页校验失败返回结构化错误而不是一句话", async () => {
    const { service, user, project } = await setup();
    const broken = makePage("bad-single");
    delete (broken as { overlays?: unknown }).overlays;

    let caught: unknown;
    try {
      await service.createPage(user.id, project.id, broken);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CloudMcpValidationError);
    const error = caught as CloudMcpValidationError;
    expect(error.code).toBe("INVALID_INPUT");
    expect(Array.isArray(error.details)).toBe(true);
    expect((error.details as Array<{ path?: string }>).length).toBeGreaterThan(0);
  });

  it("重复铺同一批页面时跳过已放置项", async () => {
    const { service, user, project } = await setup();
    await service.createPages(user.id, project.id, [makePage("page-a"), makePage("page-b")], { placeOnBoard: "none" });
    const first = await service.placePagesOnBoard(user.id, project.id, "main", ["page-a", "page-b"]);
    expect(first.added_page_ids).toEqual(["page-a", "page-b"]);

    const second = await service.placePagesOnBoard(user.id, project.id, "main", ["page-b", "page-c"].filter((id) => id !== "page-c"));
    expect(second.added_page_ids).toEqual([]);
    expect(second.skipped_page_ids).toEqual(["page-b"]);
  });

  it("on_conflict=skip 支持断点续跑（整批重试不会失败）", async () => {
    const { service, user, project } = await setup();
    await service.createPages(user.id, project.id, [makePage("page-a"), makePage("page-b")], { placeOnBoard: "none" });

    const retry = await service.createPages(
      user.id,
      project.id,
      [makePage("page-a"), makePage("page-b"), makePage("page-c")],
      { onConflict: "skip" }
    );

    expect(retry.created_count).toBe(1);
    expect([...retry.skipped_page_ids].sort()).toEqual(["page-a", "page-b"]);
    const path = await service.projectPath(user.id, project.id);
    expect((await listPages(path)).map((page) => page.id).sort()).toEqual(["page-a", "page-b", "page-c"]);
  });

  it("组件级工具走命令引擎并逐步推进 revision", async () => {
    const { service, user, project } = await setup();
    await service.createPages(user.id, project.id, [makePage("page-x")], { placeOnBoard: "none" });
    const start = await service.getPageDsl(user.id, project.id, "page-x");

    const created = await service.createOverlay(
      user.id, project.id, "page-x", start.revision,
      { id: "modal-check", type: "modal", title: "确认" }, undefined, "codex"
    );
    expect(created.revision).toBe(start.revision + 1);

    const updated = await service.updateOverlay(user.id, project.id, "page-x", created.revision, "modal-check", { title: "确认核销" }, "codex");
    expect(updated.revision).toBe(created.revision + 1);

    const bumped = await service.updateComponent(user.id, project.id, "page-x", updated.revision, "search.status", { label: "状态" }, "codex");
    expect(bumped.revision).toBe(updated.revision + 1);

    const deleted = await service.deleteComponent(user.id, project.id, "page-x", bumped.revision, "modal-check", "codex");
    expect(deleted.revision).toBe(bumped.revision + 1);

    const fresh = await service.getPageDsl(user.id, project.id, "page-x");
    expect(fresh.overlays.some((overlay) => overlay.id === "modal-check")).toBe(false);
  });

  it("修订冲突返回 currentRevision，便于 AI 直接重试", async () => {
    const { service, user, project } = await setup();
    await service.createPages(user.id, project.id, [makePage("page-r")], { placeOnBoard: "none" });
    await service.updateComponent(user.id, project.id, "page-r", 1, "search.status", { label: "状态A" }, "codex");

    let caught: unknown;
    try {
      await service.updateComponent(user.id, project.id, "page-r", 1, "search.status", { label: "状态B" }, "codex");
    } catch (error) {
      caught = error;
    }

    expect((caught as { code?: string }).code).toBe("REVISION_CONFLICT");
    expect((caught as { details?: unknown }).details).toMatchObject({ currentRevision: 2, baseRevision: 1 });
  });

  it("项目概览会指出未放入画布的页面", async () => {
    const { service, user, project } = await setup();
    await service.createPages(user.id, project.id, [makePage("page-a")], { placeOnBoard: "none" });
    await service.createPages(user.id, project.id, [makePage("page-b")], { placeOnBoard: "default" });

    const overview = await service.project(user.id, project.id) as {
      pages_not_on_any_board: string[];
      boards: Array<{ id: string; placed_page_ids: string[] }>;
      workflow_hint: string;
    };
    expect(overview.pages_not_on_any_board).toEqual(["page-a"]);
    expect(overview.boards[0]?.placed_page_ids).toEqual(["page-b"]);
    expect(overview.workflow_hint).toContain("prototype_place_pages_on_board");
  });
});
