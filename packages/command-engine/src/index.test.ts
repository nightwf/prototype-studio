import { describe, expect, it } from "vitest";
import { caseListExample } from "@prototype-studio/dsl-schema/example";
import { CommandEngineError, createReapplyRevision, createRevertRevision, executeCommands } from "./index";

describe("executeCommands", () => {
  it("applies a scoped update and creates an immutable revision", () => {
    const result = executeCommands({
      dsl: caseListExample,
      baseRevision: 1,
      commands: [{ type: "UPDATE_COMPONENT", target: "search.status", changes: { validation: { required: true } } }],
      source: "manual",
      operator: "jojo",
      now: "2026-08-07T10:00:00.000Z",
      revisionId: "revision-2"
    });

    expect(result.dsl.revision).toBe(2);
    expect(result.dsl.search!.fields[2]!.validation?.required).toBe(true);
    expect(caseListExample.search!.fields[2]!.validation).toBeUndefined();
    expect(result.revision.changedComponentIds).toEqual(["search.status"]);
  });

  it("rejects stale base revisions without changing the DSL", () => {
    expect(() => executeCommands({
      dsl: caseListExample,
      baseRevision: 0,
      commands: [{ type: "UPDATE_COMPONENT", target: "search.status", changes: { label: "状态" } }],
      source: "manual",
      operator: "jojo"
    })).toThrowError(expect.objectContaining<Partial<CommandEngineError>>({ code: "REVISION_CONFLICT" }));
  });

  it("moves a component within a container without AI", () => {
    const result = executeCommands({
      dsl: caseListExample,
      baseRevision: 1,
      commands: [{ type: "MOVE_COMPONENT", target: "search.status", container: "search.fields", index: 0 }],
      source: "manual",
      operator: "jojo"
    });
    expect(result.dsl.search!.fields.map((field) => field.id)).toEqual([
      "search.status",
      "search.caseNo",
      "search.customer"
    ]);
  });

  it("creates an append-only undo revision", () => {
    const update = executeCommands({
      dsl: caseListExample,
      baseRevision: 1,
      commands: [{ type: "UPDATE_OVERLAY", target: "overlay.batchAssign", changes: { type: "drawer" } }],
      source: "ai",
      operator: "codex"
    });
    const undone = createRevertRevision(update.dsl, update.revision, "jojo");
    expect(undone.dsl.revision).toBe(3);
    expect(undone.dsl.overlays[0]!.type).toBe("modal");
    expect(undone.revision.revertsRevision).toBe(2);

    const redone = createReapplyRevision(undone.dsl, update.revision, "jojo");
    expect(redone.dsl.revision).toBe(4);
    expect(redone.dsl.overlays[0]!.type).toBe("drawer");
    expect(redone.revision.reappliesRevision).toBe(2);
  });
});
