import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { caseListExample } from "@prototype-studio/dsl-schema/example";
import { buildProductPackage, createBoard, createProject, createPage, executeProjectCommands, getPage, importExternalPage, listPages, openProject, redoRevision, undoRevision } from "./index";

async function temporaryProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "prototype-studio-test-"));
}

describe("project store", () => {
  it("opens the checked-in portable example project", async () => {
    const exampleRoot = path.resolve(process.cwd(), "examples/case-management");
    const opened = await openProject(exampleRoot);
    expect(opened.manifest.id).toBe("case-center-demo");
    expect(opened.pages).toEqual([
      expect.objectContaining({ id: "case-list", revision: 1, status: "InDesign" })
    ]);
  });

  it("creates a portable local project with required folders", async () => {
    const root = await temporaryProject();
    await createProject(root, { name: "案件中台", projectId: "project-test", now: "2026-08-07T10:00:00.000Z" });
    await createPage(root, caseListExample);
    const opened = await openProject(root);
    expect(opened.manifest.name).toBe("案件中台");
    expect(opened.pages).toHaveLength(1);
    expect(await readFile(path.join(root, "project.yaml"), "utf8")).toContain("project-test");
  });

  it("persists commands to YAML and adds revision history", async () => {
    const root = await temporaryProject();
    await createProject(root, { name: "案件中台" });
    await createPage(root, caseListExample);
    const result = await executeProjectCommands(root, "case-list", {
      baseRevision: 1,
      commands: [{ type: "UPDATE_OVERLAY", target: "overlay.batchAssign", changes: { type: "drawer" } }],
      source: "ai",
      operator: "codex"
    });
    expect(result.dsl.overlays[0]!.type).toBe("drawer");
    expect((await getPage(root, "case-list")).revision).toBe(2);
    expect(await readFile(path.join(root, ".prototype/revisions/case-list/000002.json"), "utf8")).toContain("UPDATE_OVERLAY");

    const undo = await undoRevision(root, "case-list", 2, "jojo");
    expect(undo.revision).toBe(3);
    expect((await getPage(root, "case-list")).overlays[0]!.type).toBe("modal");
    const redo = await redoRevision(root, "case-list", 2, "jojo");
    expect(redo.revision).toBe(4);
    expect((await getPage(root, "case-list")).overlays[0]!.type).toBe("drawer");
  });

  it("keeps an invalid external edit out of the valid page index", async () => {
    const root = await temporaryProject();
    await createProject(root, { name: "案件中台" });
    await createPage(root, caseListExample);
    await writeFile(path.join(root, "pages/broken.ui.yaml"), "page: [broken", "utf8");
    const external = await importExternalPage(root, "pages/broken.ui.yaml");
    expect(external.validation.valid).toBe(false);
    expect(await listPages(root)).toHaveLength(1);
  });

  it("builds a portable product package from project files", async () => {
    const root = await temporaryProject();
    await createProject(root, { name: "案件中台", projectId: "case-center" });
    await createPage(root, caseListExample);
    await createBoard(root, { name: "案件流程", pageIds: ["case-list"] });
    const productPackage = await buildProductPackage(root, { now: "2026-08-07T12:00:00.000Z" });
    expect(productPackage.project.id).toBe("case-center");
    expect(productPackage.pages).toHaveLength(1);
    expect(productPackage.formatVersion).toBe("2.0");
    expect(productPackage.boards).toHaveLength(2);
    expect(productPackage.boards[0]).toMatchObject({ id: "main", revision: 1, objects: [] });
    expect(productPackage.preview.type).toBe("local");
  });
});
