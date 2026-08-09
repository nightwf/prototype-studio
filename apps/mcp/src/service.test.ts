import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { caseListExample } from "@prototype-studio/dsl-schema/example";
import { createPage, createProject, getPage } from "@prototype-studio/project-store";
import { PrototypeService, resolveProjectRoot } from "./service.js";

async function temporaryProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "prototype-studio-mcp-test-"));
  await createProject(root, { name: "MCP 测试项目", projectId: "mcp-test" });
  await createPage(root, structuredClone(caseListExample));
  return root;
}

describe("PrototypeService", () => {
  it("requires an explicitly configured Project Root", () => {
    expect(() => resolveProjectRoot(undefined)).toThrow("PROTOTYPE_STUDIO_PROJECT_ROOT");
    expect(resolveProjectRoot("./relative-project")).toBe(path.resolve("./relative-project"));
  });

  it("lists pages with limit/offset pagination", async () => {
    const root = await temporaryProject();
    const second = structuredClone(caseListExample);
    second.page.id = "case-second";
    second.page.title = "第二页";
    await createPage(root, second);
    const service = new PrototypeService({ projectRoot: root });

    const first = await service.listPages({ limit: 1, offset: 0 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data).toMatchObject({ total_count: 2, count: 1, has_more: true, next_offset: 1 });

    const secondPage = await service.listPages({ limit: 1, offset: 1 });
    expect(secondPage.ok).toBe(true);
    if (!secondPage.ok) return;
    expect(secondPage.data).toMatchObject({ total_count: 2, count: 1, has_more: false });
  });

  it("returns a component with its stable DSL path and parent", async () => {
    const service = new PrototypeService({ projectRoot: await temporaryProject() });
    const outcome = await service.getComponent({ page_id: "case-list", component_id: "search.status" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data).toMatchObject({
      page_id: "case-list",
      revision: 1,
      dsl_path: "$.search.fields[2]",
      parent_id: "search"
    });
  });

  it("routes mutations through Command Engine and appends an MCP revision", async () => {
    const root = await temporaryProject();
    const service = new PrototypeService({ projectRoot: root });
    const outcome = await service.updateComponent({
      page_id: "case-list",
      component_id: "search.status",
      base_revision: 1,
      changes: { label: "案件状态" },
      operator: "codex-test"
    });

    expect(outcome.ok).toBe(true);
    expect((await getPage(root, "case-list")).revision).toBe(2);
    const revision = JSON.parse(await readFile(path.join(root, ".prototype/revisions/case-list/000002.json"), "utf8")) as {
      source: string;
      operator: string;
      changedComponentIds: string[];
    };
    expect(revision).toMatchObject({
      source: "mcp",
      operator: "codex-test",
      changedComponentIds: ["search.status"]
    });
  });

  it("returns an actionable revision conflict without an internal stack", async () => {
    const service = new PrototypeService({ projectRoot: await temporaryProject() });
    const outcome = await service.updateOverlay({
      page_id: "case-list",
      component_id: "overlay.batchAssign",
      base_revision: 0,
      changes: { type: "drawer" },
      operator: "codex-test"
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("REVISION_CONFLICT");
    expect(outcome.error.suggestion).toContain("prototype_get_dsl");
    expect(JSON.stringify(outcome)).not.toContain("stack");
  });

  it("validates candidate DSL without writing it", async () => {
    const root = await temporaryProject();
    const service = new PrototypeService({ projectRoot: root });
    const invalid = structuredClone(caseListExample) as unknown as Record<string, unknown>;
    (invalid.page as Record<string, unknown>).title = "";
    const outcome = await service.validateDsl({ dsl: invalid });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data).toMatchObject({ validation: { valid: false } });
    expect((await getPage(root, "case-list")).page.title).toBe(caseListExample.page.title);
  });

  it("returns a revision-pinned local preview URL", async () => {
    const service = new PrototypeService({
      projectRoot: await temporaryProject(),
      previewBaseUrl: "http://127.0.0.1:4173/studio/"
    });
    const outcome = await service.getPreviewUrl({ page_id: "case-list" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data).toMatchObject({ page_id: "case-list", revision: 1, availability: "local" });
    expect((outcome.data as { url: string }).url).toBe("http://127.0.0.1:4173/studio/preview-runtime/case-list?revision=1");
  });
});
