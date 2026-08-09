import { describe, expect, it } from "vitest";
import { caseListExample } from "@prototype-studio/dsl-schema/example";
import { defineBoardObjectType, validateBoard, validateDSL } from "./index";

describe("validateDSL", () => {
  it("accepts the canonical case-list example", () => {
    expect(validateDSL(caseListExample)).toMatchObject({ valid: true, errors: [] });
  });

  it("reports duplicate component ids with a stable code", () => {
    const invalid = structuredClone(caseListExample);
    invalid.search!.fields[1]!.id = "search.caseNo";
    const result = validateDSL(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.code === "DUPLICATE_COMPONENT_ID")).toBe(true);
  });

  it("reports event targets that do not exist", () => {
    const invalid = structuredClone(caseListExample);
    invalid.toolbar!.actions[0]!.event = { type: "open", target: "overlay.missing" };
    const result = validateDSL(invalid);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "INVALID_EVENT_TARGET" }));
  });
});

describe("validateBoard with open object types", () => {
  it("accepts known types and warns on unknown types instead of failing", () => {
    const base = { dslVersion: "1.0", id: "board", revision: 1, links: [] };
    expect(validateBoard({ ...base, objects: [{ id: "n", type: "note", x: 0, y: 0, width: 100, height: 50, text: "说明" }] })).toMatchObject({ valid: true, errors: [] });

    const unknown = validateBoard({ ...base, objects: [{ id: "c", type: "chart", x: 0, y: 0, width: 100, height: 50 }] });
    expect(unknown.valid).toBe(true);
    expect(unknown.warnings.some((warning) => warning.message.includes("未知画布对象类型"))).toBe(true);
  });

  it("applies validators registered for new object types", () => {
    defineBoardObjectType("chart", (object, path, issues) => {
      if (!object.data || typeof object.data !== "object") {
        issues.errors.push({ code: "SCHEMA_INVALID", message: "图表对象缺少 data。", path: `${path}.data` });
      }
    });
    const valid = validateBoard({
      dslVersion: "1.0",
      id: "board",
      revision: 1,
      objects: [{ id: "c", type: "chart", x: 0, y: 0, width: 100, height: 50, data: {} }],
      links: []
    });
    expect(valid.valid).toBe(true);
    const invalid = validateBoard({
      dslVersion: "1.0",
      id: "board",
      revision: 1,
      objects: [{ id: "c", type: "chart", x: 0, y: 0, width: 100, height: 50 }],
      links: []
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.some((error) => error.message.includes("data"))).toBe(true);
  });
});
