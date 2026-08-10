import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import type { BoardDSL, BoardLink, BoardMarkerObject, BoardObject, BoardPageObject, PageDSL } from "@prototype-studio/dsl-schema";
import { PrototypeRenderer } from "./index";
import {
  ANNOTATION_PANEL_GAP,
  ANNOTATION_PANEL_WIDTH,
  CONTENT_PADDING,
  GRID_STEP,
  ZOOM_STEP,
  type BoardBounds,
  type BoardView,
  type Point,
  boardContentBounds,
  fitView,
  objectRect,
  rectsIntersect,
  screenToWorld,
  snapValue,
  viewWorldRect,
  visibleWorldRect,
  worldToScreen,
  zoomAtCursor
} from "./boardGeometry";
import "./board.css";

export interface BoardRendererProps {
  board: BoardDSL;
  pages: Record<string, PageDSL>;
  selectedId?: string;
  selectedIds?: string[];
  interactive?: boolean;
  picking?: boolean;
  onSelectObject?: (id: string) => void;
  onSelectMany?: (ids: string[]) => void;
  onOpenPage?: (pageId: string) => void;
  onMoveObject?: (id: string, x: number, y: number) => void;
  onMoveObjects?: (ids: string[], dx: number, dy: number) => void;
  onMoveMarker?: (id: string, offsetX: number, offsetY: number) => void;
  onPickComponent?: (pageObjectId: string, componentId: string, offsetX: number, offsetY: number) => void;
  onViewChange?: (view: BoardView) => void;
  onContentBounds?: (bounds: BoardBounds) => void;
  onDuplicateObject?: (id: string) => void;
  onDeleteObjects?: (ids: string[]) => void;
  onZOrder?: (ids: string[], position: "top" | "bottom") => void;
  snapToGrid?: boolean;
  showAnnotationPanel?: boolean;
}

export interface BoardRendererHandle {
  zoomIn(): void;
  zoomOut(): void;
  resetView(): void;
  fitToContent(): void;
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

function objectCenter(object: BoardObject, pins: Record<string, Point>, canvasX: number, canvasY: number): Point {
  if (object.type === "marker") {
    const pin = pins[object.id];
    return pin ? { x: pin.x - canvasX + 14, y: pin.y - canvasY + 14 } : { x: 0, y: 0 };
  }
  return { x: object.x - canvasX + object.width / 2, y: object.y - canvasY + object.height / 2 };
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

registerBoardObjectRenderer("flowchart", ({ object }) => <FlowchartView object={object as Extract<BoardObject, { type: "flowchart" }>} />);
registerBoardObjectRenderer("er", ({ object }) => <ErView object={object as Extract<BoardObject, { type: "er" }>} />);

export const BoardRenderer = forwardRef<BoardRendererHandle, BoardRendererProps>(function BoardRenderer({
  board,
  pages,
  selectedId,
  selectedIds = [],
  interactive = true,
  picking = false,
  onSelectObject,
  onSelectMany,
  onOpenPage,
  onMoveObject,
  onMoveObjects,
  onMoveMarker,
  onPickComponent,
  onViewChange,
  onContentBounds,
  onDuplicateObject,
  onDeleteObjects,
  onZOrder,
  snapToGrid = false,
  showAnnotationPanel = true
}, ref) {
  const frameRefs = useRef(new Map<string, HTMLDivElement>());
  const viewportRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<BoardView>({ x: 0, y: 0, zoom: 1 });
  const [containerSize, setContainerSize] = useState({ width: 1200, height: 800 });
  const [pins, setPins] = useState<Record<string, Point>>({});
  const [marquee, setMarquee] = useState<{ start: Point; current: Point } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; objectIds: string[] } | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const panRef = useRef<{ startX: number; startY: number; originX: number; originY: number; button: number } | undefined>(undefined);
  const dragRef = useRef<{
    id: string;
    multi: boolean;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    offsets: Record<string, { x: number; y: number }>;
  } | undefined>(undefined);
  const markerDragRef = useRef<{ id: string; startX: number; startY: number; offsetX: number; offsetY: number } | undefined>(undefined);
  const rafRef = useRef<number>(0);

  const bounds = useMemo(() => boardContentBounds(board, pins), [board, pins]);
  const panelReserve = showAnnotationPanel && board.objects.some((object) => object.type === "marker") ? ANNOTATION_PANEL_WIDTH + ANNOTATION_PANEL_GAP : 0;
  const canvasX = bounds.minX - CONTENT_PADDING;
  const canvasY = bounds.minY - CONTENT_PADDING;
  const canvasWidth = bounds.maxX - bounds.minX + CONTENT_PADDING * 2 + panelReserve;
  const canvasHeight = bounds.maxY - bounds.minY + CONTENT_PADDING * 2;

  useEffect(() => { onViewChange?.(view); }, [view, onViewChange]);
  useEffect(() => { onContentBounds?.(bounds); }, [bounds, onContentBounds]);

  useLayoutEffect(() => {
    if (!interactive) return;
    const node = viewportRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [interactive]);

  useLayoutEffect(() => {
    const next: Record<string, Point> = {};
    for (const object of board.objects) {
      if (object.type !== "marker") continue;
      const frame = frameRefs.current.get(object.anchor.pageObjectId);
      if (!frame) continue;
      const component = frame.querySelector<HTMLElement>(`[data-component-id="${object.anchor.componentId}"]`);
      if (!component) continue;
      const objectEl = frame.closest<HTMLElement>("[data-board-object]");
      if (!objectEl) continue;
      const pageObject = board.objects.find((item) => item.id === object.anchor.pageObjectId);
      if (!pageObject || pageObject.type === "marker") continue;
      const objectRect = objectEl.getBoundingClientRect();
      const componentRect = component.getBoundingClientRect();
      next[object.id] = {
        x: pageObject.x + (componentRect.left - objectRect.left + frame.scrollLeft) / view.zoom + (object.anchor.offsetX ?? 14),
        y: pageObject.y + (componentRect.top - objectRect.top + frame.scrollTop) / view.zoom + (object.anchor.offsetY ?? -12)
      };
    }
    setPins((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
  }, [board, pages, view.zoom]);

  const viewportRect = useCallback(() => viewportRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 }, []);

  const schedule = useCallback((update: () => void) => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(update);
  }, []);

  const fitToContent = useCallback(() => {
    setView(fitView(bounds, containerSize.width, containerSize.height));
  }, [bounds, containerSize]);

  useImperativeHandle(ref, () => ({
    zoomIn: () => setView((v) => zoomAtCursor(v, ZOOM_STEP, containerSize.width / 2, containerSize.height / 2)),
    zoomOut: () => setView((v) => zoomAtCursor(v, 1 / ZOOM_STEP, containerSize.width / 2, containerSize.height / 2)),
    resetView: () => setView({ x: 0, y: 0, zoom: 1 }),
    fitToContent
  }), [containerSize, fitToContent]);

  useEffect(() => {
    if (!interactive) return;
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && (event.key === "=" || event.key === "+")) { event.preventDefault(); setView((v) => zoomAtCursor(v, ZOOM_STEP, containerSize.width / 2, containerSize.height / 2)); return; }
      if (mod && event.key === "-") { event.preventDefault(); setView((v) => zoomAtCursor(v, 1 / ZOOM_STEP, containerSize.width / 2, containerSize.height / 2)); return; }
      if (mod && event.key === "0") { event.preventDefault(); setView({ x: 0, y: 0, zoom: 1 }); return; }
      if (mod && event.key === "1") { event.preventDefault(); fitToContent(); return; }
      if (event.code === "Space" && !mod) { event.preventDefault(); setSpacePressed(true); return; }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedIds.length) { event.preventDefault(); onDeleteObjects?.(selectedIds); return; }
      if (event.key === "Escape") setContextMenu(null);
    };
    const onKeyUp = (event: globalThis.KeyboardEvent): void => {
      if (event.code === "Space") setSpacePressed(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [interactive, containerSize, fitToContent, selectedIds, onDeleteObjects]);

  useEffect(() => {
    if (!interactive) return;
    const node = viewportRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        setView((v) => zoomAtCursor(v, factor, event.clientX - rect.left, event.clientY - rect.top));
      } else {
        setView((v) => ({ ...v, x: v.x - event.deltaX, y: v.y - event.deltaY }));
      }
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [interactive]);

  const select = (id: string): void => {
    if (interactive) onSelectObject?.(id);
  };

  const startPanOrMarquee = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    if (target.closest(".board-object, .board-tool-panel, .board-minimap, .board-context-menu")) return;
    if (picking) return;
    const isPan = spacePressed || event.button === 1;
    if (isPan) {
      panRef.current = { startX: event.clientX, startY: event.clientY, originX: view.x, originY: view.y, button: event.button };
    } else {
      panRef.current = undefined;
      setMarquee({ start: { x: event.clientX, y: event.clientY }, current: { x: event.clientX, y: event.clientY } });
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const movePanOrMarquee = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const pan = panRef.current;
    if (pan) {
      schedule(() => setView((v) => ({ ...v, x: pan.originX + (event.clientX - pan.startX), y: pan.originY + (event.clientY - pan.startY) })));
      return;
    }
    setMarquee((current) => (current ? { ...current, current: { x: event.clientX, y: event.clientY } } : current));
    if (!marquee) return;
    schedule(() => {
      const rect = viewportRect();
      const a = screenToWorld(view, marquee.start.x, marquee.start.y, rect.left, rect.top);
      const b = screenToWorld(view, event.clientX, event.clientY, rect.left, rect.top);
      const selBounds: BoardBounds = { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
      const ids = board.objects.filter((object) => object.type !== "marker" && rectsIntersect(objectRect(object, pins), selBounds))
        .map((object) => object.id);
      onSelectMany?.(ids);
    });
  };

  const endPanOrMarquee = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const pan = panRef.current;
    panRef.current = undefined;
    if (!pan && marquee) {
      const rect = viewportRect();
      const a = screenToWorld(view, marquee.start.x, marquee.start.y, rect.left, rect.top);
      const b = screenToWorld(view, event.clientX, event.clientY, rect.left, rect.top);
      const selBounds: BoardBounds = { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
      const ids = board.objects.filter((object) => object.type !== "marker" && rectsIntersect(objectRect(object, pins), selBounds))
        .map((object) => object.id);
      const moved = Math.hypot(event.clientX - marquee.start.x, event.clientY - marquee.start.y);
      onSelectMany?.(moved > 4 ? ids : []);
      setMarquee(null);
    }
  };

  const openContextMenu = (event: ReactMouseEvent, objectIds: string[]): void => {
    if (!interactive) return;
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, objectIds });
  };

  const renderObject = (object: BoardObject): ReactNode => {
    const selected = object.id === selectedId || selectedIds.includes(object.id);
    if (object.type === "marker") {
      const pin = pins[object.id];
      const startMarkerDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
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
      const moveMarkerDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
        const drag = markerDragRef.current;
        if (!drag || drag.id !== object.id) return;
        const offsetX = Math.round(drag.offsetX + (event.clientX - drag.startX) / view.zoom);
        const offsetY = Math.round(drag.offsetY + (event.clientY - drag.startY) / view.zoom);
        setPins((previous) => ({ ...previous, [object.id]: { x: (pin?.x ?? 0) + (event.clientX - drag.startX) / view.zoom, y: (pin?.y ?? 0) + (event.clientY - drag.startY) / view.zoom } }));
        onMoveMarker?.(drag.id, offsetX, offsetY);
      };
      const endMarkerDrag = (): void => { markerDragRef.current = undefined; };
      const pinX = (pin ? pin.x : 0) - canvasX;
      const pinY = (pin ? pin.y : 0) - canvasY;
      return (
        <button
          key={object.id}
          type="button"
          className={`board-marker-pin board-marker-pin--${object.tone} ${selected ? "is-selected" : ""}`}
          style={{ left: pinX, top: pinY }}
          data-board-marker={object.id}
          data-marker-number={object.number}
          data-marker-anchor={`${object.anchor.pageObjectId}:${object.anchor.componentId}:${object.anchor.offsetX ?? 0}:${object.anchor.offsetY ?? 0}`}
          onClick={(event) => { event.stopPropagation(); select(object.id); }}
          onContextMenu={(event) => { event.stopPropagation(); openContextMenu(event, [object.id]); }}
          onPointerDown={startMarkerDrag}
          onPointerMove={moveMarkerDrag}
          onPointerUp={endMarkerDrag}
          onPointerCancel={endMarkerDrag}
        >
          {object.number}
        </button>
      );
    }
    const visualX = object.x - canvasX;
    const visualY = object.y - canvasY;
    const startDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (!interactive || picking) return;
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      const multi = selectedIds.includes(object.id) && selectedIds.length > 1;
      const offsets: Record<string, { x: number; y: number }> = {};
      if (multi) {
        board.objects.forEach((item) => {
          if (selectedIds.includes(item.id) && item.type !== "marker") offsets[item.id] = { x: item.x, y: item.y };
        });
      }
      dragRef.current = {
        id: object.id,
        multi,
        startX: event.clientX,
        startY: event.clientY,
        originX: object.x,
        originY: object.y,
        offsets
      };
    };
    const moveDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
      const drag = dragRef.current;
      if (!drag || drag.id !== object.id) return;
      const dx = (event.clientX - drag.startX) / view.zoom;
      const dy = (event.clientY - drag.startY) / view.zoom;
      if (drag.multi && onMoveObjects) {
        onMoveObjects(Object.keys(drag.offsets), Math.round(dx), Math.round(dy));
        return;
      }
      const x = snapToGrid ? snapValue(drag.originX + dx) : Math.round(drag.originX + dx);
      const y = snapToGrid ? snapValue(drag.originY + dy) : Math.round(drag.originY + dy);
      onMoveObject?.(drag.id, x, y);
    };
    const endDrag = (): void => { dragRef.current = undefined; };
    return (
      <div
        key={object.id}
        className={`board-object board-object--${object.type} ${selected ? "is-selected" : ""} ${picking ? "is-picking" : ""}`}
        style={{ left: visualX, top: visualY, width: object.width, height: object.height }}
        data-board-object={object.id}
        data-object-type={object.type}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={(event) => { event.stopPropagation(); select(object.id); }}
        onContextMenu={(event) => { event.stopPropagation(); openContextMenu(event, selectedIds.includes(object.id) ? selectedIds : [object.id]); }}
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
              onClickCapture={(event) => {
                if (!picking) return;
                event.stopPropagation();
                const target = (event.target as HTMLElement).closest?.("[data-component-id]") as HTMLElement | null;
                if (!target) return;
                const componentRect = target.getBoundingClientRect();
                const offsetX = Math.round((event.clientX - componentRect.left) / view.zoom);
                const offsetY = Math.round((event.clientY - componentRect.top) / view.zoom);
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
  board.objects.forEach((object) => centers.set(object.id, objectCenter(object, pins, canvasX, canvasY)));

  const visibleNonMarkers = useMemo(() => {
    const nonMarkers = (objects: BoardObject[]): Array<Exclude<BoardObject, BoardMarkerObject>> =>
      objects.filter((object): object is Exclude<BoardObject, BoardMarkerObject> => object.type !== "marker");
    if (!interactive) return nonMarkers(board.objects);
    const rect = visibleWorldRect(view, containerSize.width, containerSize.height);
    return nonMarkers(board.objects).filter((object) => rectsIntersect(objectRect(object, pins), rect))
      .sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
  }, [board.objects, pins, view, containerSize, interactive]);

  const markerObjects = board.objects.filter((object): object is BoardMarkerObject => object.type === "marker");
  const panelX = bounds.maxX - canvasX + ANNOTATION_PANEL_GAP;

  const canvas = (
    <div className={`board-canvas ${picking ? "is-picking" : ""}`} style={{ left: canvasX, top: canvasY, width: canvasWidth, height: canvasHeight }}>
      <svg className="board-links" width={canvasWidth} height={canvasHeight}>
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
      {visibleNonMarkers.map((object) => renderObject(object))}
      {markerObjects.map((object) => renderObject(object))}
      {showAnnotationPanel && markerObjects.length ? (
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

  if (!interactive) return canvas;

  const minimapScale = Math.min(160 / Math.max(1, bounds.maxX - bounds.minX), 100 / Math.max(1, bounds.maxY - bounds.minY));
  const minimapViewport = viewWorldRect(view, containerSize.width, containerSize.height);
  const marqueeStyle = marquee ? (() => {
    const rect = viewportRect();
    const a = screenToWorld(view, marquee.start.x, marquee.start.y, rect.left, rect.top);
    const b = screenToWorld(view, marquee.current.x, marquee.current.y, rect.left, rect.top);
    const left = worldToScreen(view, Math.min(a.x, b.x), 0, rect.left, rect.top).x;
    const top = worldToScreen(view, 0, Math.min(a.y, b.y), rect.left, rect.top).y;
    const width = Math.abs(b.x - a.x) * view.zoom;
    const height = Math.abs(b.y - a.y) * view.zoom;
    return { left, top, width, height };
  })() : undefined;

  return (
    <div
      ref={viewportRef}
      className="board-viewport"
      onPointerDown={startPanOrMarquee}
      onPointerMove={movePanOrMarquee}
      onPointerUp={endPanOrMarquee}
      onPointerCancel={() => { panRef.current = undefined; setMarquee(null); }}
      onDoubleClick={(event) => {
        const target = event.target as HTMLElement;
        if (!target.closest(".board-object, .board-tool-panel, .board-minimap")) fitToContent();
      }}
      onContextMenu={(event) => {
        const target = event.target as HTMLElement;
        if (!target.closest(".board-object")) openContextMenu(event, []);
      }}
      style={{ cursor: spacePressed || panRef.current ? "grabbing" : picking ? "crosshair" : undefined }}
    >
      <div
        className="board-grid-layer"
        style={{
          backgroundSize: `${GRID_STEP * view.zoom}px ${GRID_STEP * view.zoom}px`,
          backgroundPosition: `${view.x}px ${view.y}px`
        }}
      />
      <div className="board-viewport-inner" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, transformOrigin: "0 0" }}>
        {canvas}
      </div>
      {marquee && marqueeStyle ? <div className="board-marquee" style={marqueeStyle} /> : null}
      <div
        className="board-minimap"
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const wx = (event.clientX - rect.left) / minimapScale + bounds.minX;
          const wy = (event.clientY - rect.top) / minimapScale + bounds.minY;
          setView((v) => ({ ...v, x: containerSize.width / 2 - wx * v.zoom, y: containerSize.height / 2 - wy * v.zoom }));
        }}
      >
        <div className="board-minimap-viewport" style={{
          left: (minimapViewport.minX - bounds.minX) * minimapScale,
          top: (minimapViewport.minY - bounds.minY) * minimapScale,
          width: (minimapViewport.maxX - minimapViewport.minX) * minimapScale,
          height: (minimapViewport.maxY - minimapViewport.minY) * minimapScale
        }} />
        {visibleNonMarkers.map((object) => (
          <i
            key={object.id}
            className={`board-minimap-object board-minimap-object--${object.type}`}
            style={{
              left: (object.x - bounds.minX) * minimapScale,
              top: (object.y - bounds.minY) * minimapScale,
              width: Math.max(3, object.width * minimapScale),
              height: Math.max(3, object.height * minimapScale)
            }}
          />
        ))}
      </div>
      {contextMenu ? (
        <div className="board-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          {contextMenu.objectIds.length ? (
            <>
              {contextMenu.objectIds.length === 1 && contextMenu.objectIds[0] ? <button onClick={() => { onDuplicateObject?.(contextMenu.objectIds[0]!); setContextMenu(null); }}>复制</button> : null}
              <button className="is-danger" onClick={() => { onDeleteObjects?.(contextMenu.objectIds); setContextMenu(null); }}>删除（{contextMenu.objectIds.length}）</button>
              <i />
              <button onClick={() => { onZOrder?.(contextMenu.objectIds, "top"); setContextMenu(null); }}>置顶</button>
              <button onClick={() => { onZOrder?.(contextMenu.objectIds, "bottom"); setContextMenu(null); }}>置底</button>
            </>
          ) : (
            <>
              <button onClick={() => { fitToContent(); setContextMenu(null); }}>适配全部内容</button>
              <button onClick={() => { setView({ x: 0, y: 0, zoom: 1 }); setContextMenu(null); }}>重置视图</button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
});
