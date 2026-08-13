import { useCallback, useMemo, useRef, useState, type CSSProperties } from "react";
import dagre from "@dagrejs/dagre";
import {
  BaseEdge,
  Background,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  NodeResizer,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  reconnectEdge,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnNodeDrag,
  type ReactFlowInstance,
  useReactFlow
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowDown, ArrowRight, ArrowUp, Check, Database, Diamond, GitBranch, Minus, Plus, Redo2, RotateCcw, Save, Trash2, Undo2, X } from "lucide-react";
import type { BoardErEntity, BoardErField, BoardFlowNode, BoardFlowchartObject, BoardObject } from "@prototype-studio/dsl-schema";
import { diagramPath, materializeEr, materializeFlowchart } from "@prototype-studio/renderer";
import "./diagramEditor.css";

type DiagramObject = Extract<BoardObject, { type: "flowchart" | "er" }>;
type DiagramNodeData = Record<string, unknown> & {
  label: string;
  description?: string;
  kind?: BoardFlowNode["kind"];
  color?: string;
  fill?: string;
  laneId?: string;
  entity?: BoardErEntity;
};
type DiagramEdgeData = Record<string, unknown> & {
  label?: string;
  condition?: string;
  cardinality?: string;
  color?: string;
  strokeWidth?: number;
  lineType?: "straight" | "curve" | "orthogonal";
  waypoints?: Array<{ x: number; y: number }>;
};
type DiagramNode = Node<DiagramNodeData>;
type DiagramEdge = Edge<DiagramEdgeData>;
interface DiagramSnapshot { nodes: DiagramNode[]; edges: DiagramEdge[] }

function stableSnapshot(snapshot: DiagramSnapshot): string {
  return JSON.stringify({
    nodes: snapshot.nodes.map((node) => ({ id: node.id, position: node.position, width: node.width ?? node.style?.width, height: node.height ?? node.style?.height, data: node.data })),
    edges: snapshot.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle, type: edge.type, data: edge.data }))
  });
}

export interface DiagramEditorProps {
  object: DiagramObject;
  boardRevision: number;
  onSave: (object: DiagramObject, baseRevision: number) => Promise<boolean>;
  onClose: () => void;
}

const clone = <T,>(value: T): T => structuredClone(value);
const dimension = (...values: Array<number | string | undefined>): number => {
  for (const value of values) { const numeric = Number(value); if (Number.isFinite(numeric) && numeric > 0) return numeric; }
  return 1;
};

function initialSnapshot(object: DiagramObject): DiagramSnapshot {
  if (object.type === "flowchart") {
    const flowchart = materializeFlowchart(object.flowchart);
    return {
      nodes: flowchart.nodes.map((node) => ({
        id: node.id,
        type: "flow",
        position: node.position!,
        width: node.size!.width,
        height: node.size!.height,
        data: { label: node.label, description: node.description, kind: node.kind, laneId: node.laneId, color: node.color, fill: node.fill },
        style: { width: node.size!.width, height: node.size!.height, zIndex: node.kind === "lane" ? 0 : 1 }
      })),
      edges: flowchart.edges.map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        sourceHandle: edge.fromHandle,
        targetHandle: edge.toHandle,
        label: edge.label,
        type: "diagram",
        data: { label: edge.label, condition: edge.condition, color: edge.color, strokeWidth: edge.strokeWidth, lineType: edge.lineType ?? "orthogonal", waypoints: edge.waypoints ?? [] },
        style: { stroke: edge.color, strokeWidth: edge.strokeWidth },
        markerEnd: { type: "arrowclosed" as never, color: edge.color }
      }))
    };
  }
  const er = materializeEr(object.er);
  const handleFor = (entityId: string, fieldName: string, explicit?: string) => explicit ?? er.entities.find((entity) => entity.id === entityId)?.fields.find((field) => field.name === fieldName)?.id ?? fieldName;
  return {
    nodes: er.entities.map((entity) => ({
      id: entity.id,
      type: "entity",
      position: entity.position!,
      width: entity.width,
      data: { label: entity.name, entity },
      style: { width: entity.width }
    })),
    edges: er.relations.map((relation) => ({
      id: relation.id,
      source: relation.from,
      target: relation.to,
      sourceHandle: handleFor(relation.from, relation.fromField, relation.fromHandle),
      targetHandle: handleFor(relation.to, relation.toField, relation.toHandle),
      label: relation.label || relation.cardinality,
      type: "diagram",
      data: { label: relation.label, cardinality: relation.cardinality, color: relation.color, strokeWidth: relation.strokeWidth, lineType: relation.lineType ?? "orthogonal", waypoints: relation.waypoints ?? [] },
      style: { stroke: relation.color, strokeWidth: relation.strokeWidth }
    }))
  };
}

function FlowNodeView({ data, selected }: NodeProps<DiagramNode>) {
  const kind = data.kind ?? "process";
  const style = { "--diagram-border": data.color ?? "#2563eb", "--diagram-fill": data.fill ?? "#ffffff" } as CSSProperties;
  return <div className={`diagram-node diagram-node--${kind}`} style={style}>
    <NodeResizer isVisible={selected} minWidth={100} minHeight={46} />
    <Handle type="target" position={Position.Top} id="top" />
    <Handle type="source" position={Position.Right} id="right" />
    <Handle type="source" position={Position.Bottom} id="bottom" />
    <Handle type="target" position={Position.Left} id="left" />
    <div className="diagram-node-content"><strong>{data.label}</strong>{data.description ? <small>{data.description}</small> : null}</div>
  </div>;
}

function EntityNodeView({ data, selected }: NodeProps<DiagramNode>) {
  const entity = data.entity!;
  return <div className="diagram-entity" style={{ "--entity-accent": entity.color ?? "#7c3aed" } as CSSProperties}>
    <NodeResizer isVisible={selected} minWidth={180} minHeight={90} />
    <header><Database size={13} /><strong>{entity.name}</strong></header>
    <div>{entity.fields.map((field, index) => {
      const id = field.id ?? `${entity.id}-field-${index + 1}`;
      return <div className="diagram-entity-field" key={id}>
        <Handle type="target" position={Position.Left} id={id} />
        <span>{field.key ? "PK" : field.nullable === false ? "NN" : ""}</span><strong>{field.name}</strong><code>{field.type}</code>
        <Handle type="source" position={Position.Right} id={id} />
      </div>;
    })}</div>
  </div>;
}

const nodeTypes = { flow: FlowNodeView, entity: EntityNodeView };

function DiagramEdgeView({ id, sourceX, sourceY, targetX, targetY, style, markerEnd, selected, data, label }: EdgeProps<DiagramEdge>) {
  const { screenToFlowPosition, setEdges } = useReactFlow<DiagramNode, DiagramEdge>();
  const dragRef = useRef<number | undefined>(undefined);
  const lineType = (data?.lineType ?? "orthogonal") as "straight" | "curve" | "orthogonal";
  const waypoints = data?.waypoints ?? [];
  const path = diagramPath({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, lineType, waypoints);

  const updateWaypoints = (updater: (items: Array<{ x: number; y: number }>) => Array<{ x: number; y: number }>) => {
    setEdges((items) => items.map((edge) => edge.id === id ? { ...edge, data: { ...edge.data, waypoints: updater(edge.data?.waypoints ?? []) } } : edge));
  };

  const startWaypointDrag = (index: number) => (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = index;
    const onMove = (moveEvent: PointerEvent) => {
      const current = dragRef.current;
      if (current === undefined) return;
      const point = screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
      updateWaypoints((items) => items.map((item, itemIndex) => itemIndex === current ? { x: Math.round(point.x), y: Math.round(point.y) } : item));
    };
    const onUp = () => {
      dragRef.current = undefined;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      {selected ? waypoints.map((point, index) => (
        <g key={`${id}-wp-${index}`} className="diagram-waypoint" transform={`translate(${point.x} ${point.y})`}>
          <circle r={9} className="diagram-waypoint-hit" onPointerDown={startWaypointDrag(index)} onDoubleClick={(event) => { event.stopPropagation(); updateWaypoints((items) => items.filter((_, itemIndex) => itemIndex !== index)); }} />
          <circle r={4} className="diagram-waypoint-dot" />
        </g>
      )) : null}
      {label || data?.label ? (
        <EdgeLabelRenderer>
          <div className="diagram-edge-label" style={{ transform: `translate(-50%, -50%) translate(${(sourceX + targetX) / 2}px, ${(sourceY + targetY) / 2}px)` }}>
            {String(label ?? data?.label ?? "")}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const edgeTypes = { diagram: DiagramEdgeView };

function nodeLabel(kind: BoardFlowNode["kind"]): string {
  return ({ start: "开始", end: "结束", process: "处理", decision: "判断", subprocess: "子流程", data: "数据", lane: "泳道" } as const)[kind ?? "process"];
}

function DiagramEditorInner({ object, boardRevision, onSave, onClose }: DiagramEditorProps) {
  const first = useMemo(() => initialSnapshot(object), [object]);
  const initialRef = useRef(stableSnapshot(first));
  const [nodes, setNodes] = useState<DiagramNode[]>(first.nodes);
  const [edges, setEdges] = useState<DiagramEdge[]>(first.edges);
  const [history, setHistory] = useState<DiagramSnapshot[]>([]);
  const [future, setFuture] = useState<DiagramSnapshot[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [layoutDirection, setLayoutDirection] = useState<"TB" | "LR">("TB");
  const [saving, setSaving] = useState(false);
  const instanceRef = useRef<ReactFlowInstance<DiagramNode, DiagramEdge> | undefined>(undefined);
  const clipboardRef = useRef<DiagramSnapshot | undefined>(undefined);
  const resizingRef = useRef(false);
  const dirty = stableSnapshot({ nodes, edges }) !== initialRef.current;
  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId);
  const scheduleFit = useCallback(() => window.setTimeout(() => instanceRef.current?.fitView({ padding: 0.24, duration: 300 }), 120), []);

  const remember = useCallback(() => {
    setHistory((items) => [...items.slice(-49), clone({ nodes, edges })]);
    setFuture([]);
  }, [edges, nodes]);

  const undo = useCallback(() => {
    const previous = history.at(-1);
    if (!previous) return;
    setFuture((items) => [clone({ nodes, edges }), ...items]);
    setNodes(previous.nodes); setEdges(previous.edges); setHistory((items) => items.slice(0, -1));
  }, [edges, history, nodes]);

  const redo = useCallback(() => {
    const next = future[0];
    if (!next) return;
    setHistory((items) => [...items, clone({ nodes, edges })]);
    setNodes(next.nodes); setEdges(next.edges); setFuture((items) => items.slice(1));
  }, [edges, future, nodes]);

  const onNodesChange = useCallback((changes: NodeChange<DiagramNode>[]) => {
    const resizing = changes.some((change) => change.type === "dimensions" && change.resizing);
    if (resizing && !resizingRef.current) remember();
    resizingRef.current = resizing;
    setNodes((items) => applyNodeChanges(changes, items));
  }, [remember]);
  const onEdgesChange = useCallback((changes: EdgeChange<DiagramEdge>[]) => setEdges((items) => applyEdgeChanges(changes, items)), []);
  const onConnect = useCallback((connection: Connection) => {
    remember();
    setEdges((items) => addEdge({ ...connection, id: `edge-${Date.now()}`, type: "diagram", markerEnd: object.type === "flowchart" ? { type: "arrowclosed" as never, color: "#64748b" } : undefined, data: { cardinality: object.type === "er" ? "one-to-many" : undefined, color: object.type === "er" ? "#7c3aed" : "#64748b", strokeWidth: 2, lineType: "orthogonal", waypoints: [] } }, items));
  }, [object.type, remember]);

  const assignLaneAfterDrag = useCallback<OnNodeDrag<DiagramNode>>((_event, dragged) => {
    if (object.type !== "flowchart" || dragged.data.kind === "lane") return;
    const width = dimension(dragged.measured?.width, dragged.width, dragged.style?.width as number | string | undefined, 168);
    const height = dimension(dragged.measured?.height, dragged.height, dragged.style?.height as number | string | undefined, 64);
    const center = { x: dragged.position.x + width / 2, y: dragged.position.y + height / 2 };
    const lane = nodes.find((node) => {
      if (node.data.kind !== "lane") return false;
      const laneWidth = dimension(node.measured?.width, node.width, node.style?.width as number | string | undefined, 720);
      const laneHeight = dimension(node.measured?.height, node.height, node.style?.height as number | string | undefined, 180);
      return center.x >= node.position.x && center.x <= node.position.x + laneWidth && center.y >= node.position.y && center.y <= node.position.y + laneHeight;
    });
    setNodes((items) => items.map((node) => node.id === dragged.id ? { ...node, data: { ...node.data, laneId: lane?.id } } : node));
  }, [nodes, object.type]);

  const addFlowNode = (kind: BoardFlowNode["kind"]) => {
    remember();
    const id = `${kind}-${Date.now()}`;
    setNodes((items) => [...items, { id, type: "flow", position: { x: 100 + (items.length % 4) * 220, y: 90 + Math.floor(items.length / 4) * 140 }, data: { label: nodeLabel(kind), kind }, style: { width: kind === "lane" ? 720 : 168, height: kind === "lane" ? 180 : 64, zIndex: kind === "lane" ? 0 : 1 } }]);
    setSelectedNodeId(id); setSelectedEdgeId(undefined);
    scheduleFit();
  };

  const addEntity = () => {
    remember();
    const id = `entity-${Date.now()}`;
    const entity: BoardErEntity = { id, name: "新实体", width: 220, fields: [{ id: `${id}-id`, name: "id", type: "string", key: true, nullable: false }] };
    setNodes((items) => [...items, { id, type: "entity", position: { x: 80 + (items.length % 3) * 280, y: 80 + Math.floor(items.length / 3) * 230 }, data: { label: entity.name, entity }, style: { width: 220 } }]);
    setSelectedNodeId(id); setSelectedEdgeId(undefined);
    scheduleFit();
  };

  const updateNodeData = (changes: Partial<DiagramNodeData>) => {
    if (!selectedNode) return;
    remember();
    setNodes((items) => items.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, ...changes } } : node));
  };

  const updateEntity = (updater: (entity: BoardErEntity) => BoardErEntity) => {
    if (!selectedNode?.data.entity) return;
    remember();
    setNodes((items) => items.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, entity: updater(clone(node.data.entity!)) } } : node));
  };

  const updateEdge = (changes: Partial<DiagramEdgeData> & { type?: string }) => {
    if (!selectedEdge) return;
    remember();
    setEdges((items) => items.map((edge) => edge.id === selectedEdge.id ? {
      ...edge,
      ...(changes.type ? { type: changes.type } : {}),
      label: changes.label ?? edge.label,
      data: { ...edge.data, ...changes },
      style: { ...edge.style, stroke: changes.color ?? edge.data?.color, strokeWidth: changes.strokeWidth ?? edge.data?.strokeWidth },
      ...(object.type === "flowchart" && changes.color ? { markerEnd: { type: "arrowclosed" as never, color: changes.color } } : {})
    } : edge));
  };

  const addWaypointToSelectedEdge = () => {
    if (!selectedEdge) return;
    const source = nodes.find((node) => node.id === selectedEdge.source);
    const target = nodes.find((node) => node.id === selectedEdge.target);
    if (!source || !target) return;
    const sx = source.position.x + dimension(source.measured?.width, source.width, source.style?.width as number | string | undefined, 168) / 2;
    const sy = source.position.y + dimension(source.measured?.height, source.height, source.style?.height as number | string | undefined, 64) / 2;
    const tx = target.position.x + dimension(target.measured?.width, target.width, target.style?.width as number | string | undefined, 168) / 2;
    const ty = target.position.y + dimension(target.measured?.height, target.height, target.style?.height as number | string | undefined, 64) / 2;
    const point = { x: Math.round((sx + tx) / 2), y: Math.round((sy + ty) / 2) };
    remember();
    setEdges((items) => items.map((edge) => edge.id === selectedEdge.id ? { ...edge, data: { ...edge.data, waypoints: [...(edge.data?.waypoints ?? []), point] } } : edge));
  };

  const deleteSelection = () => {
    if (!selectedNode && !selectedEdge) return;
    if (object.type === "er" && selectedNode && !window.confirm(`删除实体“${selectedNode.data.entity?.name ?? selectedNode.id}”及其所有关系？`)) return;
    remember();
    if (selectedNode) {
      setNodes((items) => items.filter((node) => node.id !== selectedNode.id));
      setEdges((items) => items.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id));
      setSelectedNodeId(undefined);
    } else if (selectedEdge) {
      setEdges((items) => items.filter((edge) => edge.id !== selectedEdge.id));
      setSelectedEdgeId(undefined);
    }
  };

  const autoLayout = () => {
    remember();
    const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
    graph.setGraph({ rankdir: layoutDirection, nodesep: 70, ranksep: 90, marginx: 40, marginy: 40 });
    const layoutIds = new Set(nodes.filter((node) => node.data.kind !== "lane").map((node) => node.id));
    nodes.filter((node) => layoutIds.has(node.id)).forEach((node) => graph.setNode(node.id, { width: dimension(node.measured?.width, node.width, node.style?.width as number | string | undefined, 180), height: dimension(node.measured?.height, node.height, node.style?.height as number | string | undefined, 70) }));
    edges.filter((edge) => layoutIds.has(edge.source) && layoutIds.has(edge.target)).forEach((edge) => graph.setEdge(edge.source, edge.target));
    dagre.layout(graph);
    setNodes((items) => items.map((node) => {
      const point = graph.node(node.id);
      if (!point) return node;
      const width = point.width ?? 180; const height = point.height ?? 70;
      return { ...node, position: { x: point.x - width / 2, y: point.y - height / 2 } };
    }));
    scheduleFit();
  };

  const copySelection = () => {
    const selected = nodes.filter((node) => node.selected || node.id === selectedNodeId);
    if (!selected.length) return;
    const ids = new Set(selected.map((node) => node.id));
    clipboardRef.current = { nodes: clone(selected), edges: clone(edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target))) };
  };

  const pasteSelection = () => {
    const copied = clipboardRef.current;
    if (!copied) return;
    remember();
    const stamp = Date.now();
    const idMap = new Map(copied.nodes.map((node, index) => [node.id, `${node.id}-copy-${stamp + index}`]));
    const handleMap = new Map<string, string>();
    const pasted = copied.nodes.map((node) => {
      const nextId = idMap.get(node.id)!;
      const next = { ...clone(node), id: nextId, position: { x: node.position.x + 36, y: node.position.y + 36 }, selected: true };
      if (next.data.entity) {
        const entity = clone(next.data.entity);
        entity.id = nextId;
        entity.name = `${entity.name} 副本`;
        entity.fields = entity.fields.map((field, index) => {
          const oldHandle = field.id ?? `${node.id}-field-${index + 1}`;
          const newHandle = `${nextId}-field-${index + 1}`;
          handleMap.set(oldHandle, newHandle);
          return { ...field, id: newHandle };
        });
        next.data = { ...next.data, label: entity.name, entity };
      }
      return next;
    });
    setNodes((items) => [...items.map((node) => ({ ...node, selected: false })), ...pasted]);
    setEdges((items) => [...items, ...copied.edges.map((edge, index) => ({ ...clone(edge), id: `edge-copy-${stamp + index}`, source: idMap.get(edge.source)!, target: idMap.get(edge.target)!, sourceHandle: edge.sourceHandle ? handleMap.get(edge.sourceHandle) ?? edge.sourceHandle : null, targetHandle: edge.targetHandle ? handleMap.get(edge.targetHandle) ?? edge.targetHandle : null }))]);
  };

  const close = () => { if (!dirty || window.confirm("当前修改尚未保存，确定放弃吗？")) onClose(); };

  const save = async () => {
    setSaving(true);
    let next: DiagramObject;
    if (object.type === "flowchart") {
      const flowchart: BoardFlowchartObject["flowchart"] = {
        nodes: nodes.map((node) => ({ id: node.id, label: node.data.label, kind: node.data.kind, description: node.data.description, laneId: node.data.laneId, position: node.position, size: { width: dimension(node.measured?.width, node.width, node.style?.width as number | string | undefined, 168), height: dimension(node.measured?.height, node.height, node.style?.height as number | string | undefined, 64) }, color: node.data.color, fill: node.data.fill })),
        edges: edges.map((edge) => ({ id: edge.id, from: edge.source, to: edge.target, fromHandle: edge.sourceHandle ?? undefined, toHandle: edge.targetHandle ?? undefined, label: String(edge.data?.label ?? edge.label ?? "") || undefined, condition: edge.data?.condition, lineType: edge.data?.lineType ?? "orthogonal", color: edge.data?.color, strokeWidth: edge.data?.strokeWidth, waypoints: edge.data?.waypoints?.length ? edge.data.waypoints : undefined }))
      };
      const contentWidth = Math.max(320, ...flowchart.nodes.map((node) => (node.position?.x ?? 0) + (node.size?.width ?? 168) + 40));
      const contentHeight = Math.max(220, ...flowchart.nodes.map((node) => (node.position?.y ?? 0) + (node.size?.height ?? 64) + 40));
      next = { ...object, width: Math.max(object.width, contentWidth), height: Math.max(object.height, contentHeight), flowchart };
    } else {
      const entities: BoardErEntity[] = nodes.map((node) => ({ ...node.data.entity!, position: node.position, width: dimension(node.measured?.width, node.width, node.style?.width as number | string | undefined, 220) }));
      const fieldName = (entityId: string, handle?: string | null) => entities.find((entity) => entity.id === entityId)?.fields.find((field) => field.id === handle || field.name === handle)?.name ?? "";
      const relations = edges.map((edge) => ({ id: edge.id, from: edge.source, to: edge.target, fromField: fieldName(edge.source, edge.sourceHandle), toField: fieldName(edge.target, edge.targetHandle), fromHandle: edge.sourceHandle ?? undefined, toHandle: edge.targetHandle ?? undefined, cardinality: edge.data?.cardinality, label: edge.data?.label, lineType: edge.data?.lineType ?? "orthogonal", color: edge.data?.color, strokeWidth: edge.data?.strokeWidth, waypoints: edge.data?.waypoints?.length ? edge.data.waypoints : undefined }));
      const contentWidth = Math.max(320, ...entities.map((entity) => (entity.position?.x ?? 0) + (entity.width ?? 220) + 40));
      const contentHeight = Math.max(220, ...entities.map((entity) => (entity.position?.y ?? 0) + 62 + entity.fields.length * 27 + 40));
      next = { ...object, width: Math.max(object.width, contentWidth), height: Math.max(object.height, contentHeight), er: { entities, relations } };
    }
    const ok = await onSave(next, boardRevision);
    setSaving(false);
    if (ok) onClose();
  };

  const handleKeys = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select")) return;
    const meta = event.metaKey || event.ctrlKey;
    if (meta && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
    if (meta && event.key.toLowerCase() === "c") { event.preventDefault(); copySelection(); }
    if (meta && event.key.toLowerCase() === "v") { event.preventDefault(); pasteSelection(); }
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteSelection(); }
    if (event.key === "Escape") close();
  };

  return <div className="diagram-editor-shell" tabIndex={-1} onKeyDown={handleKeys} data-diagram-editor={object.type}>
    <header className="diagram-editor-topbar">
      <div className="diagram-editor-title"><span>{object.type === "flowchart" ? <GitBranch size={15} /> : <Database size={15} />}</span><div><small>{object.type === "flowchart" ? "FLOW EDITOR" : "ER EDITOR"}</small><strong>{object.id}</strong></div>{dirty ? <em>未保存</em> : <em className="is-clean">已同步</em>}</div>
      <div className="diagram-editor-actions">
        <button disabled={!history.length} onClick={undo}><Undo2 size={14} />撤销</button><button disabled={!future.length} onClick={redo}><Redo2 size={14} />重做</button>
        <span />
        <button onClick={() => setLayoutDirection((value) => value === "TB" ? "LR" : "TB")}>{layoutDirection === "TB" ? <ArrowDown size={14} /> : <ArrowRight size={14} />}{layoutDirection === "TB" ? "从上到下" : "从左到右"}</button>
        <button onClick={autoLayout}><RotateCcw size={14} />自动布局</button><button onClick={() => instanceRef.current?.zoomOut({ duration: 180 })}><Minus size={14} />缩小</button><button onClick={() => instanceRef.current?.zoomIn({ duration: 180 })}><Plus size={14} />放大</button><button onClick={() => instanceRef.current?.fitView({ padding: .18, duration: 300 })}><Check size={14} />适应视图</button>
      </div>
      <div className="diagram-editor-save"><button onClick={close}><X size={14} />取消</button><button className="is-primary" disabled={saving || !dirty} onClick={() => void save()}><Save size={14} />{saving ? "保存中…" : "保存并退出"}</button></div>
    </header>
    <aside className="diagram-editor-library">
      <small>LIBRARY</small><h3>{object.type === "flowchart" ? "流程节点" : "数据对象"}</h3>
      {object.type === "flowchart" ? <div className="diagram-palette">{(["start", "process", "decision", "subprocess", "data", "end", "lane"] as const).map((kind) => <button key={kind} onClick={() => addFlowNode(kind)}><i className={`diagram-palette-shape is-${kind}`}>{kind === "decision" ? <Diamond size={15} /> : kind === "lane" ? <Minus size={16} /> : <Plus size={14} />}</i><span>{nodeLabel(kind)}</span></button>)}</div> : <button className="diagram-add-entity" onClick={addEntity}><Database size={16} /><span><strong>新建实体</strong><small>添加字段后拖出关系</small></span><Plus size={14} /></button>}
      <div className="diagram-editor-shortcuts"><strong>快捷键</strong><span><kbd>⌘ Z</kbd>撤销 / 重做</span><span><kbd>⌘ C/V</kbd>复制粘贴</span><span><kbd>Delete</kbd>删除</span></div>
    </aside>
    <main className="diagram-editor-canvas">
      <ReactFlow<DiagramNode, DiagramEdge>
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onInit={(instance) => { instanceRef.current = instance; }}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
        onReconnect={(oldEdge, connection) => { remember(); setEdges((items) => reconnectEdge(oldEdge, connection, items)); }}
        onEdgeDoubleClick={(event, edge) => {
          const point = instanceRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY });
          if (!point) return;
          remember();
          setEdges((items) => items.map((item) => item.id === edge.id ? { ...item, data: { ...item.data, waypoints: [...(item.data?.waypoints ?? []), { x: Math.round(point.x), y: Math.round(point.y) }] } } : item));
        }}
        onNodeDragStart={remember} onNodeDragStop={assignLaneAfterDrag} onSelectionChange={({ nodes: selectedNodes, edges: selectedEdges }) => { setSelectedNodeId(selectedNodes.at(-1)?.id); setSelectedEdgeId(selectedEdges.at(-1)?.id); }}
        onPaneClick={() => { setSelectedNodeId(undefined); setSelectedEdgeId(undefined); }}
        fitView fitViewOptions={{ padding: .18 }} snapToGrid snapGrid={[10, 10]} deleteKeyCode={null} selectionOnDrag multiSelectionKeyCode={["Meta", "Control"]} proOptions={{ hideAttribution: true }}
      ><Background gap={20} size={1} color="#cad2d7" /><MiniMap pannable zoomable /><Controls showInteractive={false} /></ReactFlow>
    </main>
    <aside className="diagram-editor-inspector">
      <small>INSPECTOR</small><h3>{selectedNode ? "节点属性" : selectedEdge ? "连线属性" : "选择对象"}</h3>
      {selectedNode && object.type === "flowchart" ? <div className="diagram-form">
        <label><span>名称</span><input value={selectedNode.data.label} onChange={(event) => updateNodeData({ label: event.target.value })} /></label>
        <label><span>说明</span><textarea rows={3} value={selectedNode.data.description ?? ""} onChange={(event) => updateNodeData({ description: event.target.value })} /></label>
        <label><span>类型</span><select value={selectedNode.data.kind ?? "process"} onChange={(event) => updateNodeData({ kind: event.target.value as BoardFlowNode["kind"] })}>{(["start", "process", "decision", "subprocess", "data", "end", "lane"] as const).map((kind) => <option key={kind} value={kind}>{nodeLabel(kind)}</option>)}</select></label>
        {selectedNode.data.kind !== "lane" ? <label><span>所属泳道</span><select value={selectedNode.data.laneId ?? ""} onChange={(event) => updateNodeData({ laneId: event.target.value || undefined })}><option value="">不属于泳道</option>{nodes.filter((node) => node.data.kind === "lane").map((node) => <option key={node.id} value={node.id}>{node.data.label}</option>)}</select></label> : null}
        <div className="diagram-form-grid"><label><span>边框</span><input type="color" value={selectedNode.data.color ?? "#2563eb"} onChange={(event) => updateNodeData({ color: event.target.value })} /></label><label><span>背景</span><input type="color" value={selectedNode.data.fill ?? "#ffffff"} onChange={(event) => updateNodeData({ fill: event.target.value })} /></label></div>
        <button className="is-danger" onClick={deleteSelection}><Trash2 size={13} />删除节点</button>
      </div> : null}
      {selectedNode?.data.entity && object.type === "er" ? <EntityInspector entity={selectedNode.data.entity} onChange={updateEntity} onDelete={deleteSelection} /> : null}
      {selectedEdge ? <div className="diagram-form">
        <label><span>说明</span><input value={String(selectedEdge.data?.label ?? "")} onChange={(event) => updateEdge({ label: event.target.value })} /></label>
        {object.type === "flowchart" ? <label><span>条件</span><input value={String(selectedEdge.data?.condition ?? "")} onChange={(event) => updateEdge({ condition: event.target.value })} placeholder="例如：审批通过" /></label> : <label><span>关系基数</span><select value={String(selectedEdge.data?.cardinality ?? "one-to-many")} onChange={(event) => updateEdge({ cardinality: event.target.value })}><option value="one-to-one">一对一</option><option value="one-to-many">一对多</option><option value="many-to-many">多对多</option></select></label>}
        <label><span>路径</span><select value={String(selectedEdge.data?.lineType ?? "orthogonal")} onChange={(event) => updateEdge({ lineType: event.target.value as "straight" | "curve" | "orthogonal" })}><option value="orthogonal">折线</option><option value="curve">曲线</option><option value="straight">直线</option></select></label>
        <div className="diagram-form-grid"><label><span>颜色</span><input type="color" value={selectedEdge.data?.color ?? (object.type === "er" ? "#7c3aed" : "#64748b")} onChange={(event) => updateEdge({ color: event.target.value })} /></label><label><span>粗细</span><select value={selectedEdge.data?.strokeWidth ?? 2} onChange={(event) => updateEdge({ strokeWidth: Number(event.target.value) })}><option value="1">1px</option><option value="2">2px</option><option value="4">4px</option><option value="6">6px</option></select></label></div>
        <button onClick={addWaypointToSelectedEdge}><Plus size={13} />添加拐点</button>
        <p className="diagram-form-hint">选中连线后：拖动圆点调整形状，双击圆点删除拐点，拖动两端圆点重新连接。</p>
        <button className="is-danger" onClick={deleteSelection}><Trash2 size={13} />删除连线</button>
      </div> : null}
      {!selectedNode && !selectedEdge ? <div className="diagram-inspector-empty"><GitBranch size={24} /><p>点击节点或连线后在这里编辑。</p><span>从左侧添加新对象，拖动节点边缘的圆点创建连线。</span></div> : null}
    </aside>
  </div>;
}

function EntityInspector({ entity, onChange, onDelete }: { entity: BoardErEntity; onChange: (updater: (entity: BoardErEntity) => BoardErEntity) => void; onDelete: () => void }) {
  const updateField = (index: number, changes: Partial<BoardErField>) => onChange((value) => ({ ...value, fields: value.fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...changes } : field) }));
  return <div className="diagram-form">
    <label><span>实体名称</span><input value={entity.name} onChange={(event) => onChange((value) => ({ ...value, name: event.target.value }))} /></label>
    <div className="diagram-fields-title"><strong>字段</strong><button onClick={() => onChange((value) => ({ ...value, fields: [...value.fields, { id: `${value.id}-field-${Date.now()}`, name: "field", type: "string", nullable: true }] }))}><Plus size={12} />字段</button></div>
    <div className="diagram-fields">{entity.fields.map((field, index) => <div key={field.id ?? index} className="diagram-field-row"><input value={field.name} onChange={(event) => updateField(index, { name: event.target.value })} placeholder="名称" /><input value={field.type} onChange={(event) => updateField(index, { type: event.target.value })} placeholder="类型" /><label title="主键"><input type="checkbox" checked={Boolean(field.key)} onChange={(event) => updateField(index, { key: event.target.checked })} />PK</label><label title="允许为空"><input type="checkbox" checked={field.nullable !== false} onChange={(event) => updateField(index, { nullable: event.target.checked })} />NULL</label><button title="字段上移" disabled={index === 0} onClick={() => onChange((value) => { const fields = [...value.fields]; [fields[index - 1], fields[index]] = [fields[index]!, fields[index - 1]!]; return { ...value, fields }; })}><ArrowUp size={11} /></button><button title="字段下移" disabled={index === entity.fields.length - 1} onClick={() => onChange((value) => { const fields = [...value.fields]; [fields[index], fields[index + 1]] = [fields[index + 1]!, fields[index]!]; return { ...value, fields }; })}><ArrowDown size={11} /></button><button title="删除字段" onClick={() => onChange((value) => ({ ...value, fields: value.fields.filter((_, fieldIndex) => fieldIndex !== index) }))}><X size={11} /></button></div>)}</div>
    <label><span>强调色</span><input type="color" value={entity.color ?? "#7c3aed"} onChange={(event) => onChange((value) => ({ ...value, color: event.target.value }))} /></label>
    <button className="is-danger" onClick={onDelete}><Trash2 size={13} />删除实体及关系</button>
  </div>;
}

export default function DiagramEditor(props: DiagramEditorProps) {
  return <ReactFlowProvider><DiagramEditorInner {...props} /></ReactFlowProvider>;
}
