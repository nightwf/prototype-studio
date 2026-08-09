import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { BoardDSL, BoardLink, BoardObject, BoardPageObject, PageDSL } from "@prototype-studio/dsl-schema";
import { PrototypeRenderer } from "./index";
import "./board.css";

export interface BoardRendererProps {
  board: BoardDSL;
  pages: Record<string, PageDSL>;
  selectedId?: string;
  interactive?: boolean;
  picking?: boolean;
  onSelectObject?: (id: string) => void;
  onOpenPage?: (pageId: string) => void;
  scale?: number;
  onMoveObject?: (id: string, x: number, y: number) => void;
  onMoveMarker?: (id: string, offsetX: number, offsetY: number) => void;
  onPickComponent?: (pageObjectId: string, componentId: string, offsetX: number, offsetY: number) => void;
}

interface Point {
  x: number;
  y: number;
}

export interface BoardObjectViewProps {
  object: BoardObject;
  pages: Record<string, PageDSL>;
}

export type BoardObjectView = (props: BoardObjectViewProps) => ReactNode;

const boardObjectViews = new Map<string, BoardObjectView>();

/** Registers a structured canvas object renderer; new content kinds plug in here without changing the board core. */
export function registerBoardObjectRenderer(type: string, view: BoardObjectView): void {
  boardObjectViews.set(type, view);
}

function objectCenter(object: BoardObject, pins: Record<string, Point>): Point {
  if (object.type === "marker") {
    const pin = pins[object.id];
    return pin ? { x: pin.x + 14, y: pin.y + 14 } : { x: 0, y: 0 };
  }
  return { x: object.x + object.width / 2, y: object.y + object.height / 2 };
}

function linkPath(from: Point, to: Point): string {
  return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
}

function FlowchartView({ object }: { object: Extract<BoardObject, { type: "flowchart" }> }) {
  const nodes = object.flowchart.nodes;
  const edges = object.flowchart.edges;
  const row = 64;
  return (
    <div className="board-flowchart">
      <svg className="board-flowchart-edges" viewBox={`0 0 ${object.width} ${object.height}`} preserveAspectRatio="none">
        {edges.map((edge) => {
          const fromIndex = nodes.findIndex((node) => node.id === edge.from);
          const toIndex = nodes.findIndex((node) => node.id === edge.to);
          if (fromIndex < 0 || toIndex < 0) return null;
          return (
            <g key={edge.id}>
              <line
                x1={object.width / 2}
                y1={fromIndex * row + 24}
                x2={object.width / 2}
                y2={toIndex * row + 24}
                stroke="#94a3b8"
                strokeWidth={1.2}
                markerEnd="url(#board-arrow)"
              />
              {edge.label ? (
                <text x={object.width / 2 + 8} y={((fromIndex + toIndex) / 2) * row + 24} fill="#64748b" fontSize={8}>
                  {edge.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="board-flowchart-nodes">
        {nodes.map((node, index) => (
          <div className="board-flow-node" key={node.id} style={{ top: index * row }}>
            {node.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function ErView({ object }: { object: Extract<BoardObject, { type: "er" }> }) {
  const { entities, relations } = object.er;
  return (
    <div className="board-er">
      <svg className="board-er-edges" viewBox={`0 0 ${object.width} ${object.height}`} preserveAspectRatio="none">
        {relations.map((relation) => {
          const fromIndex = entities.findIndex((entity) => entity.id === relation.from);
          const toIndex = entities.findIndex((entity) => entity.id === relation.to);
          if (fromIndex < 0 || toIndex < 0) return null;
          const fromX = 0;
          const fromY = fromIndex * 100 + 40;
          const toX = object.width;
          const toY = toIndex * 100 + 40;
          return (
            <g key={relation.id}>
              <line x1={fromX} y1={fromY} x2={toX} y2={toY} stroke="#a78bfa" strokeWidth={1.2} />
              <text x={(fromX + toX) / 2} y={(fromY + toY) / 2 - 5} fill="#a78bfa" fontSize={8} textAnchor="middle">
                {relation.cardinality ?? "relation"}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="board-er-entities">
        {entities.map((entity) => (
          <div className="board-er-entity" key={entity.id}>
            <strong>{entity.name}</strong>
            {entity.fields.map((field) => (
              <span key={field.name}>
                {field.key ? "🔑 " : ""}{field.name} · {field.type}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function BoardRenderer({
  board,
  pages,
  selectedId,
  interactive = true,
  picking = false,
  onSelectObject,
  onOpenPage,
  scale = 1,
  onMoveObject,
  onMoveMarker,
  onPickComponent
}: BoardRendererProps) {
  const frameRefs = useRef(new Map<string, HTMLDivElement>());
  const [pins, setPins] = useState<Record<string, Point>>({});
  const dragRef = useRef<{ id: string; startX: number; startY: number; originX: number; originY: number } | undefined>(undefined);
  const markerDragRef = useRef<{ id: string; startX: number; startY: number; offsetX: number; offsetY: number } | undefined>(undefined);

  useLayoutEffect(() => {
    const next: Record<string, Point> = {};
    for (const object of board.objects) {
      if (object.type !== "marker") continue;
      const frame = frameRefs.current.get(object.anchor.pageObjectId);
      if (!frame) continue;
      const component = frame.querySelector<HTMLElement>(`[data-component-id="${object.anchor.componentId}"]`);
      if (!component) continue;
      const frameRect = frame.getBoundingClientRect();
      const componentRect = component.getBoundingClientRect();
      next[object.id] = {
        x: componentRect.left - frameRect.left + frame.scrollLeft + (object.anchor.offsetX ?? 14),
        y: componentRect.top - frameRect.top + frame.scrollTop + (object.anchor.offsetY ?? -12)
      };
    }
    setPins((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
  }, [board, pages]);

  const select = (id: string) => {
    if (interactive) onSelectObject?.(id);
  };

  const content = { x: 0, y: 0, width: 1600, height: 1200 };
  board.objects.forEach((object) => {
    if (object.type === "marker") return;
    content.x = Math.min(content.x, object.x);
    content.y = Math.min(content.y, object.y);
    content.width = Math.max(content.width, object.x + object.width);
    content.height = Math.max(content.height, object.y + object.height);
  });

  const markerObjects = board.objects.filter((object): object is Extract<BoardObject, { type: "marker" }> => object.type === "marker");
  const panelX = content.width + 60;

  const renderObject = (object: BoardObject): ReactNode => {
    const selected = object.id === selectedId;
    if (object.type === "marker") {
      const pin = pins[object.id];
      const startMarkerDrag = (event: PointerEvent<HTMLButtonElement>) => {
        if (!interactive) return;
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        markerDragRef.current = {
          id: object.id,
          startX: event.clientX,
          startY: event.clientY,
          offsetX: object.anchor.offsetX ?? 0,
          offsetY: object.anchor.offsetY ?? 0
        };
      };
      const moveMarkerDrag = (event: PointerEvent<HTMLButtonElement>) => {
        const drag = markerDragRef.current;
        if (!drag || drag.id !== object.id) return;
        const offsetX = Math.round(drag.offsetX + (event.clientX - drag.startX) / scale);
        const offsetY = Math.round(drag.offsetY + (event.clientY - drag.startY) / scale);
        setPins((previous) => ({ ...previous, [object.id]: { x: (pin?.x ?? 0) + (event.clientX - drag.startX) / scale, y: (pin?.y ?? 0) + (event.clientY - drag.startY) / scale } }));
        onMoveMarker?.(drag.id, offsetX, offsetY);
      };
      const endMarkerDrag = () => { markerDragRef.current = undefined; };
      return (
        <button
          key={object.id}
          type="button"
          className={`board-marker-pin board-marker-pin--${object.tone} ${selected ? "is-selected" : ""}`}
          style={{ left: pin?.x ?? 0, top: pin?.y ?? 0 }}
          data-board-marker={object.id}
          data-marker-number={object.number}
          data-marker-anchor={`${object.anchor.pageObjectId}:${object.anchor.componentId}:${object.anchor.offsetX ?? 0}:${object.anchor.offsetY ?? 0}`}
          onClick={(event) => { event.stopPropagation(); select(object.id); }}
          onPointerDown={startMarkerDrag}
          onPointerMove={moveMarkerDrag}
          onPointerUp={endMarkerDrag}
          onPointerCancel={endMarkerDrag}
        >
          {object.number}
        </button>
      );
    }
    const startDrag = (event: PointerEvent<HTMLDivElement>) => {
      if (!interactive || picking) return;
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { id: object.id, startX: event.clientX, startY: event.clientY, originX: object.x, originY: object.y };
    };
    const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.id !== object.id) return;
      const x = Math.round(drag.originX + (event.clientX - drag.startX) / scale);
      const y = Math.round(drag.originY + (event.clientY - drag.startY) / scale);
      onMoveObject?.(drag.id, x, y);
    };
    const endDrag = () => { dragRef.current = undefined; };
    return (
      <div
        key={object.id}
        className={`board-object board-object--${object.type} ${selected ? "is-selected" : ""} ${picking ? "is-picking" : ""}`}
        style={{ left: object.x, top: object.y, width: object.width, height: object.height }}
        data-board-object={object.id}
        data-object-type={object.type}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={(event) => { event.stopPropagation(); select(object.id); }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (object.type === "page") onOpenPage?.((object as BoardPageObject).pageId);
        }}
      >
        {object.type === "page" ? (
          <>
            <div className="board-page-head"><span>{pages[object.pageId]?.page.title ?? object.pageId}</span><small>{object.pageId}</small></div>
            <div
              className="board-page-body"
              ref={(node) => { if (node) frameRefs.current.set(object.id, node); else frameRefs.current.delete(object.id); }}
              onClick={(event) => {
                if (!picking) return;
                event.stopPropagation();
                const target = (event.target as HTMLElement).closest?.("[data-component-id]") as HTMLElement | null;
                if (!target) return;
                const componentRect = target.getBoundingClientRect();
                const offsetX = Math.round((event.clientX - componentRect.left) / scale);
                const offsetY = Math.round((event.clientY - componentRect.top) / scale);
                onPickComponent?.(object.id, target.getAttribute("data-component-id") ?? "", offsetX, offsetY);
              }}
            >
              {pages[object.pageId] ? <PrototypeRenderer dsl={pages[object.pageId]!} interactive={false} /> : <div className="board-page-missing">页面不存在：{object.pageId}</div>}
            </div>
          </>
        ) : object.type === "note" ? (
          <div className="board-note-text">{object.text}</div>
        ) : boardObjectViews.has(object.type) ? (
          boardObjectViews.get(object.type)!({ object, pages })
        ) : (
          <div className="board-generic">
            <strong>{object.type}</strong>
            <pre>{JSON.stringify(object, null, 2)}</pre>
          </div>
        )}
      </div>
    );
  };

  const centers = new Map<string, Point>();
  board.objects.forEach((object) => centers.set(object.id, objectCenter(object, pins)));

  return (
    <div className={`board-canvas ${picking ? "is-picking" : ""}`} style={{ width: content.width + 420, height: content.height + 120 }}>
      <svg className="board-links" width={content.width + 420} height={content.height + 120}>
        <defs>
          <marker id="board-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#fb923c" />
          </marker>
        </defs>
        {board.links.map((link: BoardLink) => {
          const from = centers.get(link.from);
          const to = centers.get(link.to);
          if (!from || !to) return null;
          const path = linkPath(from, to);
          return (
            <g key={link.id} data-board-link={link.id}>
              <path d={path} fill="none" stroke="#fb923c" strokeWidth={1.5} strokeDasharray="5,3" markerEnd="url(#board-arrow)" />
              {link.label ? (
                <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 6} fill="#fb923c" fontSize={9} textAnchor="middle">
                  {link.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {board.objects.map((object) => (object.type === "marker" ? null : renderObject(object)))}
      {board.objects.map((object) => (object.type === "marker" ? renderObject(object) : null))}
      {markerObjects.length ? (
        <div className="board-annotation-panel" style={{ left: panelX }}>
          <div className="board-annotation-head"><strong>标注</strong><span>{markerObjects.length}</span></div>
          {markerObjects.map((marker) => (
            <button
              type="button"
              key={marker.id}
              className={`board-annotation-item ${marker.id === selectedId ? "is-selected" : ""}`}
              data-board-annotation={marker.id}
              onClick={() => select(marker.id)}
            >
              <i className={`board-marker-pin board-marker-pin--${marker.tone}`}>{marker.number}</i>
              <span>{marker.text}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

registerBoardObjectRenderer("flowchart", ({ object }) => <FlowchartView object={object as Extract<BoardObject, { type: "flowchart" }>} />);
registerBoardObjectRenderer("er", ({ object }) => <ErView object={object as Extract<BoardObject, { type: "er" }>} />);
