import { describe, expect, it } from "vitest";
import { materializeEr, materializeFlowchart } from "./diagramLayout";

describe("diagram compatibility layout", () => {
  it("lays out legacy flow nodes deterministically without mutating input", () => {
    const legacy = { nodes: [{ id: "a", label: "开始" }, { id: "b", label: "结束" }], edges: [{ id: "e", from: "a", to: "b" }] };
    const first = materializeFlowchart(legacy);
    const second = materializeFlowchart(structuredClone(legacy));
    expect(first).toEqual(second);
    expect(first.nodes[0]).toMatchObject({ kind: "start", position: { x: 296, y: 40 }, size: { width: 168, height: 64 } });
    expect(first.nodes[1]).toMatchObject({ kind: "end", position: { x: 296, y: 156 } });
    expect(legacy.nodes[0]).not.toHaveProperty("position");
  });

  it("adds stable field handles and entity positions to legacy ER data", () => {
    const er = materializeEr({ entities: [{ id: "case", name: "案件", fields: [{ name: "id", type: "string", key: true }] }], relations: [] });
    expect(er.entities[0]).toMatchObject({ position: { x: 40, y: 40 }, width: 220 });
    expect(er.entities[0]?.fields[0]).toMatchObject({ id: "case-field-1", nullable: true });
  });
});
