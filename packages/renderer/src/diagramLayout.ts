import type { BoardErEntity, BoardErObject, BoardFlowNode, BoardFlowchartObject } from "@prototype-studio/dsl-schema";

export const FLOW_NODE_SIZE = { width: 168, height: 64 };
export const ER_ENTITY_WIDTH = 220;

export function flowNodeLayout(node: BoardFlowNode, index: number): Required<Pick<BoardFlowNode, "position" | "size">> {
  if (node.kind === "lane") return {
    position: node.position ?? { x: 32, y: 32 + index * 220 },
    size: node.size ?? { width: 760, height: 190 }
  };
  return {
    position: node.position ?? { x: 296, y: 40 + index * 116 },
    size: node.size ?? FLOW_NODE_SIZE
  };
}

export function erEntityLayout(entity: BoardErEntity, index: number): { position: { x: number; y: number }; width: number } {
  return {
    position: entity.position ?? { x: 40 + (index % 3) * 280, y: 40 + Math.floor(index / 3) * 250 },
    width: entity.width ?? ER_ENTITY_WIDTH
  };
}

export function materializeFlowchart(flowchart: BoardFlowchartObject["flowchart"]): BoardFlowchartObject["flowchart"] {
  return {
    nodes: flowchart.nodes.map((node, index) => ({
      ...node,
      kind: node.kind ?? (index === 0 ? "start" : index === flowchart.nodes.length - 1 ? "end" : "process"),
      ...flowNodeLayout(node, index)
    })),
    edges: flowchart.edges.map((edge) => ({ lineType: "orthogonal", color: "#64748b", strokeWidth: 2, ...edge }))
  };
}

export function materializeEr(er: BoardErObject["er"]): BoardErObject["er"] {
  return {
    entities: er.entities.map((entity, entityIndex) => ({
      ...entity,
      ...erEntityLayout(entity, entityIndex),
      fields: entity.fields.map((field, fieldIndex) => ({ id: field.id ?? `${entity.id}-field-${fieldIndex + 1}`, nullable: field.nullable ?? true, ...field }))
    })),
    relations: er.relations.map((relation) => ({ lineType: "orthogonal", color: "#7c3aed", strokeWidth: 2, ...relation }))
  };
}

export function diagramPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  type: "straight" | "curve" | "orthogonal" = "orthogonal",
  waypoints: Array<{ x: number; y: number }> = []
): string {
  if (waypoints.length) {
    const points = [from, ...waypoints, to];
    if (type === "straight") {
      return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
    }
    if (type === "orthogonal") {
      let path = `M ${from.x} ${from.y}`;
      for (let index = 0; index < waypoints.length; index += 1) {
        const point = waypoints[index]!;
        const previous = points[index]!;
        if (index % 2 === 0) {
          path += ` L ${point.x} ${previous.y} L ${point.x} ${point.y}`;
        } else {
          path += ` L ${previous.x} ${point.y} L ${point.x} ${point.y}`;
        }
      }
      const last = waypoints[waypoints.length - 1]!;
      const tailStart = points[points.length - 2]!;
      if (waypoints.length % 2 === 1) {
        path += ` L ${to.x} ${last.y} L ${to.x} ${to.y}`;
      } else {
        path += ` L ${tailStart.x} ${to.y} L ${to.x} ${to.y}`;
      }
      return path;
    }
    // curve：逐段三次贝塞尔，控制点沿 x 方向偏移，保证路径平滑经过每个拐点
    let path = `M ${from.x} ${from.y}`;
    for (let index = 0; index < waypoints.length; index += 1) {
      const start = points[index]!;
      const end = waypoints[index]!;
      const bend = Math.max(48, Math.abs(end.x - start.x) * 0.45);
      path += ` C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`;
    }
    const last = waypoints[waypoints.length - 1]!;
    const bend = Math.max(48, Math.abs(to.x - last.x) * 0.45);
    path += ` C ${last.x + bend} ${last.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
    return path;
  }
  if (type === "straight") return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  if (type === "curve") {
    const bend = Math.max(60, Math.abs(to.x - from.x) * 0.45);
    return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
  }
  const middleY = Math.round((from.y + to.y) / 2);
  return `M ${from.x} ${from.y} L ${from.x} ${middleY} L ${to.x} ${middleY} L ${to.x} ${to.y}`;
}
