import {
  forwardRef,
  useCallback,
  useEffect,
  Fragment,
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
import { DocumentEr, DocumentFlowchart, DocumentTable, PrototypeRenderer } from "./index";
import {
  ANNOTATION_PANEL_GAP,
  ANNOTATION_PANEL_WIDTH,
  CONTENT_PADDING,
  GRID_STEP,
  ZOOM_STEP,
  clampZoom,
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
  zoomAtCursor
} from "./boardGeometry";
import { diagramPath, materializeEr, materializeFlowchart } from "./diagramLayout";
import "./board.css";

export interface BoardRendererProps {
  board: BoardDSL;
  pages: Record<string, PageDSL>;
  selectedId?: string;
  selectedIds?: string[];
  selectedLinkId?: string;
  interactive?: boolean;
  picking?: boolean;
  aiSelectMode?: boolean;
  onSelectObject?: (id: string) => void;
  onSelectMany?: (ids: string[]) => void;
  onSelectComplete?: (ids: string[], point: { x: number; y: number }) => void;
  onSelectLink?: (id: string) => void;
  onRelink?: (linkId: string, endpoint: "from" | "to", objectId: string, componentId?: string) => void;
  onMoveLinkWaypoint?: (linkId: string, x: number, y: number) => void;
  onAddLink?: (fromObjectId: string, toObjectId: string, fromComponentId?: string, toComponentId?: string) => void;
  onOpenPage?: (pageId: string) => void;
  onOpenDiagram?: (id: string) => void;
  onMoveObject?: (id: string, x: number, y: number) => void;
  onMoveObjects?: (ids: string[], dx: number, dy: number) => void;
  onResizeObject?: (id: string, x: number, y: number, width: number, height: number) => void;
  onMoveMarker?: (id: string, offsetX: number, offsetY: number) => void;
  onMoveMarkerNote?: (id: string, x: number, y: number) => void;
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
  setZoom(zoom: number): void;
  resetView(): void;
  fitToContent(): void;
}

export interface BoardObjectViewProps {
  object: BoardObject;
  pages: Record<string, PageDSL>;
  boardId: string;
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

function isModuleDescriptionPage(dsl: PageDSL | undefined): boolean {
  return Boolean(dsl && dsl.page.title.includes("模块说明"));
}

function linkPath(from: Point, to: Point, type: BoardLink["lineType"] = "curve", waypoint?: { x: number; y: number }): string {
  if (!waypoint) {
    if (type === "straight") return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
    if (type === "orthogonal") {
      const middleX = Math.round((from.x + to.x) / 2);
      return `M ${from.x} ${from.y} L ${middleX} ${from.y} L ${middleX} ${to.y} L ${to.x} ${to.y}`;
    }
  } else {
    if (type === "straight") return `M ${from.x} ${from.y} L ${waypoint.x} ${waypoint.y} L ${to.x} ${to.y}`;
    if (type === "orthogonal") {
      return `M ${from.x} ${from.y} L ${waypoint.x} ${from.y} L ${waypoint.x} ${waypoint.y} L ${to.x} ${waypoint.y} L ${to.x} ${to.y}`;
    }
    const bend1 = Math.max(80, Math.hypot(waypoint.x - from.x, waypoint.y - from.y) * 0.4) * (waypoint.x >= from.x ? 1 : -1);
    const bend2 = Math.max(80, Math.hypot(to.x - waypoint.x, to.y - waypoint.y) * 0.4) * (to.x >= waypoint.x ? 1 : -1);
    return `M ${from.x} ${from.y} C ${from.x + bend1} ${from.y}, ${waypoint.x - bend1} ${waypoint.y}, ${waypoint.x} ${waypoint.y} C ${waypoint.x + bend2} ${waypoint.y}, ${to.x - bend2} ${to.y}, ${to.x} ${to.y}`;
  }
  const distance = Math.abs(to.x - from.x);
  const bend = Math.max(60, distance * 0.45);
  const direction = to.x >= from.x ? 1 : -1;
  return `M ${from.x} ${from.y} C ${from.x + bend * direction} ${from.y}, ${to.x - bend * direction} ${to.y}, ${to.x} ${to.y}`;
}

function linkDefaultWaypoint(from: Point, to: Point, type: BoardLink["lineType"] = "curve"): Point {
  if (type === "orthogonal") {
    const middleX = Math.round((from.x + to.x) / 2);
    return { x: middleX, y: Math.round((from.y + to.y) / 2) };
  }
  return { x: Math.round((from.x + to.x) / 2), y: Math.round((from.y + to.y) / 2) };
}

function objectBoundaryPoint(object: BoardObject, toward: Point, pins: Record<string, Point>, canvasX: number, canvasY: number): Point {
  const center = objectCenter(object, pins, canvasX, canvasY);
  if (object.type === "marker") return center;
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (!dx && !dy) return center;
  const halfWidth = object.width / 2;
  const halfHeight = object.height / 2;
  const scale = Math.min(dx ? halfWidth / Math.abs(dx) : Infinity, dy ? halfHeight / Math.abs(dy) : Infinity);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

interface LinkAnchorRect extends Point {
  width: number;
  height: number;
}

function anchorCenter(rect: LinkAnchorRect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function anchorBoundaryPoint(rect: LinkAnchorRect, toward: Point): Point {
  const center = anchorCenter(rect);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (!dx && !dy) return { x: rect.x + rect.width, y: center.y };
  const scale = Math.min(dx ? rect.width / 2 / Math.abs(dx) : Infinity, dy ? rect.height / 2 / Math.abs(dy) : Infinity);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

function FlowchartView({ object, boardId }: { object: Extract<BoardObject, { type: "flowchart" }>; boardId: string }) {
  const { nodes, edges } = materializeFlowchart(object.flowchart);
  const markerId = `board-arrow-${boardId.replace(/[^a-zA-Z0-9_-]/g, "-")}-${object.id.replace(/[^a-zA-Z0-9_-]/g, "-")}-flow`;
  return (
    <div className="board-flowchart">
      <svg className="board-flowchart-edges" viewBox={`0 0 ${object.width} ${object.height}`} preserveAspectRatio="none">
        <defs><marker id={markerId} markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><polygon points="0 0, 10 4, 0 8" fill="#94a3b8" /></marker></defs>
        {edges.map((edge) => {
          const from = nodes.find((node) => node.id === edge.from);
          const to = nodes.find((node) => node.id === edge.to);
          if (!from?.position || !from.size || !to?.position || !to.size) return null;
          const start = { x: from.position.x + from.size.width / 2, y: from.position.y + from.size.height };
          const end = { x: to.position.x + to.size.width / 2, y: to.position.y };
          return (
            <g key={edge.id}>
              <path
                d={diagramPath(start, end, edge.lineType)}
                fill="none"
                stroke={edge.color ?? "#94a3b8"}
                strokeWidth={edge.strokeWidth ?? 2}
                markerEnd={`url(#${markerId})`}
              />
              {edge.label ? (
                <text x={(start.x + end.x) / 2 + 8} y={(start.y + end.y) / 2 - 6} fill="#94a3b8" fontSize={9}>
                  {edge.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="board-flowchart-nodes">
        {nodes.map((node) => (
          <div className={`board-flow-node board-flow-node--${node.kind ?? "process"}`} key={node.id} style={{ left: node.position?.x, top: node.position?.y, width: node.size?.width, height: node.size?.height, borderColor: node.color, background: node.fill }}>
            <strong>{node.label}</strong>{node.description ? <small>{node.description}</small> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function ErView({ object }: { object: Extract<BoardObject, { type: "er" }> }) {
  const { entities, relations } = materializeEr(object.er);
  return (
    <div className="board-er">
      <svg className="board-er-edges" viewBox={`0 0 ${object.width} ${object.height}`} preserveAspectRatio="none">
        {relations.map((relation) => {
          const from = entities.find((entity) => entity.id === relation.from);
          const to = entities.find((entity) => entity.id === relation.to);
          if (!from?.position || !to?.position) return null;
          const fromHeight = 38 + from.fields.length * 24;
          const toHeight = 38 + to.fields.length * 24;
          const start = { x: from.position.x + (from.width ?? 220), y: from.position.y + fromHeight / 2 };
          const end = { x: to.position.x, y: to.position.y + toHeight / 2 };
          return (
            <g key={relation.id}>
              <path d={diagramPath(start, end, relation.lineType)} fill="none" stroke={relation.color ?? "#a78bfa"} strokeWidth={relation.strokeWidth ?? 2} />
              <text x={(start.x + end.x) / 2} y={(start.y + end.y) / 2 - 6} fill={relation.color ?? "#a78bfa"} fontSize={9} textAnchor="middle">
                {relation.label || relation.cardinality || "relation"}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="board-er-entities">
        {entities.map((entity) => (
          <div className="board-er-entity" key={entity.id} style={{ left: entity.position?.x, top: entity.position?.y, width: entity.width, borderColor: entity.color }}>
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

registerBoardObjectRenderer("flowchart", ({ object, boardId }) => <FlowchartView object={object as Extract<BoardObject, { type: "flowchart" }>} boardId={boardId} />);
registerBoardObjectRenderer("er", ({ object }) => <ErView object={object as Extract<BoardObject, { type: "er" }>} />);

export const BoardRenderer = forwardRef<BoardRendererHandle, BoardRendererProps>(function BoardRenderer({
  board,
  pages,
  selectedId,
  selectedIds = [],
  selectedLinkId,
  interactive = true,
  picking = false,
  aiSelectMode = false,
  onSelectObject,
  onSelectMany,
  onSelectComplete,
  onSelectLink,
  onRelink,
  onMoveLinkWaypoint,
  onAddLink,
  onOpenPage,
  onOpenDiagram,
  onMoveObject,
  onMoveObjects,
  onResizeObject,
  onMoveMarker,
  onMoveMarkerNote,
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
  const [linkAnchors, setLinkAnchors] = useState<Record<string, LinkAnchorRect>>({});
  const [linkDrag, setLinkDrag] = useState<{
    linkId: string;
    endpoint: "from" | "to";
    point: Point;
    snap?: { objectId: string; componentId?: string; label: string; point?: Point };
  }>();
  const [waypointDrag, setWaypointDrag] = useState<{ linkId: string; point: Point }>();
  const [createLink, setCreateLink] = useState<{ from: { objectId: string; componentId?: string }; point: Point; snap?: Point }>();
  const [hoverAnchor, setHoverAnchor] = useState<{ objectId: string; componentId: string; point: Point }>();
  const createLinkRef = useRef<{ from: { objectId: string; componentId?: string }; point: Point; snap?: Point } | undefined>(undefined);
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
  const markerNoteDragRef = useRef<{ id: string; startX: number; startY: number; originX: number; originY: number } | undefined>(undefined);
  const resizeRef = useRef<{ id: string; startX: number; startY: number; originX: number; originY: number; originWidth: number; originHeight: number } | undefined>(undefined);
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
    const nextLinkAnchors: Record<string, LinkAnchorRect> = {};
    const measureLinkAnchor = (objectId: string, componentId: string): void => {
      const frame = frameRefs.current.get(objectId);
      const pageObject = board.objects.find((item) => item.id === objectId);
      if (!frame || !pageObject || pageObject.type !== "page") return;
      const component = frame.querySelector<HTMLElement>(`[data-component-id="${componentId}"]`);
      const objectElement = frame.closest<HTMLElement>("[data-board-object]");
      if (!component || !objectElement) return;
      const objectBounds = objectElement.getBoundingClientRect();
      const componentBounds = component.getBoundingClientRect();
      nextLinkAnchors[`${objectId}:${componentId}`] = {
        x: pageObject.x - canvasX + (componentBounds.left - objectBounds.left) / view.zoom,
        y: pageObject.y - canvasY + (componentBounds.top - objectBounds.top) / view.zoom,
        width: componentBounds.width / view.zoom,
        height: componentBounds.height / view.zoom
      };
    };
    for (const link of board.links) {
      if (link.fromComponentId) measureLinkAnchor(link.from, link.fromComponentId);
      if (link.toComponentId) measureLinkAnchor(link.to, link.toComponentId);
    }
    setLinkAnchors((previous) => (JSON.stringify(previous) === JSON.stringify(nextLinkAnchors) ? previous : nextLinkAnchors));
  }, [board, pages, view.zoom, canvasX, canvasY]);

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
    setZoom: (zoom) => setView((v) => zoomAtCursor(v, clampZoom(zoom) / v.zoom, containerSize.width / 2, containerSize.height / 2)),
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

  const pointerCanvasPoint = (clientX: number, clientY: number): Point => {
    const rect = viewportRect();
    const world = screenToWorld(view, clientX, clientY, rect.left, rect.top);
    return { x: world.x - canvasX, y: world.y - canvasY };
  };

  const findLinkSnap = (clientX: number, clientY: number): { objectId: string; componentId?: string; label: string; point?: Point } | undefined => {
    for (const element of document.elementsFromPoint(clientX, clientY)) {
      const component = element.closest?.("[data-component-id]") as HTMLElement | null;
      const objectElement = (component ?? element).closest?.("[data-board-object]") as HTMLElement | null;
      const objectId = objectElement?.dataset.boardObject;
      if (!objectId) continue;
      const componentId = component?.dataset.componentId;
      if (componentId) {
        const bounds = component.getBoundingClientRect();
        const rectTopLeft = pointerCanvasPoint(bounds.left, bounds.top);
        const componentRect: LinkAnchorRect = { x: rectTopLeft.x, y: rectTopLeft.y, width: bounds.width / view.zoom, height: bounds.height / view.zoom };
        return {
          objectId,
          componentId,
          label: componentId,
          point: anchorBoundaryPoint(componentRect, pointerCanvasPoint(clientX, clientY))
        };
      }
      return { objectId, label: objectId };
    }
    return undefined;
  };

  const startCreateLink = (event: ReactPointerEvent<HTMLElement>, from: { objectId: string; componentId?: string }): void => {
    if (!interactive) return;
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const next = { from, point: pointerCanvasPoint(event.clientX, event.clientY) };
    createLinkRef.current = next;
    setCreateLink(next);
  };

  const moveCreateLink = (event: ReactPointerEvent<HTMLElement>): void => {
    const current = createLinkRef.current;
    if (!current) return;
    const point = pointerCanvasPoint(event.clientX, event.clientY);
    const snap = findLinkSnap(event.clientX, event.clientY);
    let snapPoint: Point | undefined;
    if (snap && snap.objectId !== current.from.objectId) {
      snapPoint = snap.point ?? (objectMap.get(snap.objectId) ? objectBoundaryPoint(objectMap.get(snap.objectId)!, point, pins, canvasX, canvasY) : undefined);
    }
    const next = { from: current.from, point, ...(snapPoint ? { snap: snapPoint } : { snap: undefined }) };
    createLinkRef.current = next;
    setCreateLink(next);
  };

  const endCreateLink = (event: ReactPointerEvent<HTMLElement>): void => {
    const current = createLinkRef.current;
    createLinkRef.current = undefined;
    setCreateLink(undefined);
    setHoverAnchor(undefined);
    if (!current) return;
    const snap = findLinkSnap(event.clientX, event.clientY);
    if (snap && snap.objectId !== current.from.objectId) {
      onAddLink?.(current.from.objectId, snap.objectId, current.from.componentId, snap.componentId);
    }
  };

  const startPanOrMarquee = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    if (target.closest(".board-tool-panel, .board-minimap, .board-context-menu")) return;
    if (!aiSelectMode && target.closest(".board-object, .board-link")) return;
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
      if (moved > 4) onSelectComplete?.(ids, { x: event.clientX, y: event.clientY });
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
      const pinX = (pin ? pin.x : 0) - canvasX;
      const pinY = (pin ? pin.y : 0) - canvasY;
      const noteWorld = {
        x: object.noteX ?? (pin?.x ?? 0) + 38,
        y: object.noteY ?? (pin?.y ?? 0) - 8
      };
      const noteX = noteWorld.x - canvasX;
      const noteY = noteWorld.y - canvasY;
      const startMarkerDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
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
      const moveMarkerDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
        const drag = markerDragRef.current;
        if (!drag || drag.id !== object.id) return;
        const offsetX = Math.round(drag.offsetX + (event.clientX - drag.startX) / view.zoom);
        const offsetY = Math.round(drag.offsetY + (event.clientY - drag.startY) / view.zoom);
        setPins((previous) => ({ ...previous, [object.id]: { x: (pin?.x ?? 0) + (event.clientX - drag.startX) / view.zoom, y: (pin?.y ?? 0) + (event.clientY - drag.startY) / view.zoom } }));
        onMoveMarker?.(drag.id, offsetX, offsetY);
      };
      const endMarkerDrag = (): void => { markerDragRef.current = undefined; };
      const startNoteDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
        if (!interactive) return;
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        markerNoteDragRef.current = {
          id: object.id,
          startX: event.clientX,
          startY: event.clientY,
          originX: noteWorld.x,
          originY: noteWorld.y
        };
      };
      const moveNoteDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
        const drag = markerNoteDragRef.current;
        if (!drag || drag.id !== object.id) return;
        const x = Math.round(drag.originX + (event.clientX - drag.startX) / view.zoom);
        const y = Math.round(drag.originY + (event.clientY - drag.startY) / view.zoom);
        onMoveMarkerNote?.(drag.id, x, y);
      };
      const endNoteDrag = (): void => { markerNoteDragRef.current = undefined; };
      return (
        <Fragment key={object.id}>
          <div
            className={`board-marker-pin-wrap ${selected ? "is-selected" : ""}`}
            style={{ left: pinX, top: pinY }}
            data-board-marker={object.id}
            data-marker-number={object.number}
            data-marker-anchor={`${object.anchor.pageObjectId}:${object.anchor.componentId}:${object.anchor.offsetX ?? 0}:${object.anchor.offsetY ?? 0}`}
            title={object.text}
            onClick={(event) => { event.stopPropagation(); select(object.id); }}
            onContextMenu={(event) => { event.stopPropagation(); openContextMenu(event, [object.id]); }}
            onPointerDown={startMarkerDrag}
            onPointerMove={moveMarkerDrag}
            onPointerUp={endMarkerDrag}
            onPointerCancel={endMarkerDrag}
          >
            <i className={`board-marker-pin board-marker-pin--${object.tone}`}>{object.number}</i>
          </div>
          <div
            className={`board-marker-note ${selected ? "is-selected" : ""}`}
            style={{ left: noteX, top: noteY }}
            data-board-marker-note={object.id}
            data-marker-note-x={object.noteX ?? ""}
            data-marker-note-y={object.noteY ?? ""}
            onClick={(event) => { event.stopPropagation(); select(object.id); }}
            onContextMenu={(event) => { event.stopPropagation(); openContextMenu(event, [object.id]); }}
            onPointerDown={startNoteDrag}
            onPointerMove={moveNoteDrag}
            onPointerUp={endNoteDrag}
            onPointerCancel={endNoteDrag}
          >
            <i className={`board-marker-pin board-marker-pin--${object.tone}`}>{object.number}</i>
            <span className="board-marker-note-text">{object.text}</span>
          </div>
        </Fragment>
      );
    }
    const visualX = object.x - canvasX;
    const visualY = object.y - canvasY;
    const startDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (!interactive || picking || aiSelectMode) return;
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
        className={`board-object board-object--${object.type} ${object.type === "page" && isModuleDescriptionPage(pages[object.pageId]) ? "is-module" : ""} ${selected ? "is-selected" : ""} ${picking ? "is-picking" : ""}`}
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
          if (object.type === "flowchart" || object.type === "er") onOpenDiagram?.(object.id);
        }}
      >
        {object.type === "page" ? (
          isModuleDescriptionPage(pages[object.pageId]) ? (
            <>
              <div className="board-page-head board-page-head--module"><span>{pages[object.pageId]?.page.title ?? object.pageId}</span><small>模块说明</small></div>
              <div className="board-page-module-body">
                <div className="board-module-doc-head">
                  <h3>{(pages[object.pageId]?.page.title ?? object.pageId).replace(/\s*·?\s*模块说明\s*$/, "")}</h3>
                  {pages[object.pageId]?.page.description ? <p>{pages[object.pageId]!.page.description}</p> : null}
                </div>
                {(pages[object.pageId]?.sections ?? []).map((section) => {
                  if (section.type === "table") {
                    return <div className="board-module-block" key={section.id}><DocumentTable table={section} /></div>;
                  }
                  if (section.type === "flowchart") {
                    return <div className="board-module-block" key={section.id}><DocumentFlowchart flowchart={section.flowchart ?? { nodes: [], edges: [] }} /></div>;
                  }
                  if (section.type === "er") {
                    return <div className="board-module-block" key={section.id}><DocumentEr er={section.er ?? { entities: [], relations: [] }} /></div>;
                  }
                  return (
                    <div className="board-module-block" key={section.id}>
                      {section.title ? <strong>{section.title}</strong> : null}
                      {section.description ? <p>{section.description}</p> : null}
                      {(section.children ?? []).filter((child) => child.type === "card").map((child) => (
                        <div className="board-module-item" key={child.id}>
                          {child.title ? <b>{child.title}</b> : null}
                          {child.description ? <p>{child.description}</p> : null}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div className="board-page-head"><span>{pages[object.pageId]?.page.title ?? object.pageId}</span><small>{object.pageId}</small></div>
            <div
              className="board-page-body"
              ref={(node) => { if (node) frameRefs.current.set(object.id, node); else frameRefs.current.delete(object.id); }}
              onPointerDown={(event) => { if (!picking && !aiSelectMode) event.stopPropagation(); }}
              onClick={(event) => { if (!picking && !aiSelectMode) event.stopPropagation(); }}
              onDoubleClick={(event) => { if (!picking && !aiSelectMode) event.stopPropagation(); }}
              onContextMenu={(event) => { if (!picking && !aiSelectMode) event.stopPropagation(); }}
              onWheel={(event) => { if (!picking && !aiSelectMode) event.stopPropagation(); }}
              onPointerMoveCapture={(event) => {
                if (createLinkRef.current) return;
                if (!interactive || picking) { setHoverAnchor(undefined); return; }
                const rawTarget = event.target as HTMLElement;
                if (rawTarget.closest?.(".board-port")) return;
                const target = rawTarget.closest?.("[data-component-id]") as HTMLElement | null;
                if (!target) { setHoverAnchor(undefined); return; }
                const componentId = target.getAttribute("data-component-id") ?? "";
                if (!componentId) { setHoverAnchor(undefined); return; }
                const bounds = target.getBoundingClientRect();
                const frameRect = event.currentTarget.getBoundingClientRect();
                const contentX = (bounds.left - frameRect.left + event.currentTarget.scrollLeft) / view.zoom;
                const contentY = (bounds.top - frameRect.top + event.currentTarget.scrollTop) / view.zoom;
                const width = bounds.width / view.zoom;
                const height = bounds.height / view.zoom;
                setHoverAnchor({ objectId: object.id, componentId, point: { x: contentX + width, y: contentY + height / 2 } });
              }}
              onPointerLeave={() => setHoverAnchor(undefined)}
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
              {pages[object.pageId] ? <PrototypeRenderer dsl={pages[object.pageId]!} interactive={interactive && !picking && !aiSelectMode} /> : <div className="board-page-missing">页面不存在：{object.pageId}</div>}
              {interactive && !picking && hoverAnchor && hoverAnchor.objectId === object.id ? (
                <span
                  className="board-port board-port--component"
                  style={{ left: hoverAnchor.point.x, top: hoverAnchor.point.y }}
                  title="拖动创建连线（组件）"
                  onPointerDown={(event) => startCreateLink(event, { objectId: hoverAnchor.objectId, componentId: hoverAnchor.componentId })}
                  onPointerMove={moveCreateLink}
                  onPointerUp={endCreateLink}
                  onPointerCancel={() => { createLinkRef.current = undefined; setCreateLink(undefined); }}
                />
              ) : null}
            </div>
            </>
          )
        ) : object.type === "note" ? (
          <div className="board-note-text">{object.text}</div>
        ) : boardObjectViews.has(object.type) ? (
          boardObjectViews.get(object.type)!({ object, pages, boardId: board.id })
        ) : (
          <div className="board-generic">
            <strong>{object.type}</strong>
            <pre>{JSON.stringify(object, null, 2)}</pre>
          </div>
        )}
        {interactive && !picking ? (
          <span
            className="board-port"
            style={{ left: object.width - 15, top: object.height / 2 - 7 }}
            title="拖动创建连线"
            onPointerDown={(event) => startCreateLink(event, { objectId: object.id })}
            onPointerMove={moveCreateLink}
            onPointerUp={endCreateLink}
            onPointerCancel={() => { createLinkRef.current = undefined; setCreateLink(undefined); }}
          />
        ) : null}
        {interactive && selected ? (
          <span
            className="board-resize-handle"
            title="拖动调整大小"
            onPointerDown={(event) => {
              if (!interactive) return;
              event.stopPropagation();
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              resizeRef.current = {
                id: object.id,
                startX: event.clientX,
                startY: event.clientY,
                originX: object.x,
                originY: object.y,
                originWidth: object.width,
                originHeight: object.height
              };
            }}
            onPointerMove={(event) => {
              const drag = resizeRef.current;
              if (!drag || drag.id !== object.id) return;
              const width = Math.max(40, Math.round(drag.originWidth + (event.clientX - drag.startX) / view.zoom));
              const height = Math.max(40, Math.round(drag.originHeight + (event.clientY - drag.startY) / view.zoom));
              onResizeObject?.(drag.id, drag.originX, drag.originY, snapToGrid ? snapValue(width) : width, snapToGrid ? snapValue(height) : height);
            }}
            onPointerUp={() => { resizeRef.current = undefined; }}
            onPointerCancel={() => { resizeRef.current = undefined; }}
          />
        ) : null}
      </div>
    );
  };

  const centers = new Map<string, Point>();
  board.objects.forEach((object) => centers.set(object.id, objectCenter(object, pins, canvasX, canvasY)));
  const objectMap = new Map(board.objects.map((object) => [object.id, object] as const));

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
      {visibleNonMarkers.map((object) => renderObject(object))}
      <svg className="board-links" width={canvasWidth} height={canvasHeight}>
        {board.links.map((link: BoardLink, index) => {
          const fromObject = objectMap.get(link.from);
          const toObject = objectMap.get(link.to);
          const fromCenter = centers.get(link.from);
          const toCenter = centers.get(link.to);
          if (!fromObject || !toObject || !fromCenter || !toCenter) return null;
          const fromAnchor = link.fromComponentId ? linkAnchors[`${link.from}:${link.fromComponentId}`] : undefined;
          const toAnchor = link.toComponentId ? linkAnchors[`${link.to}:${link.toComponentId}`] : undefined;
          const resolvedFrom = fromAnchor
            ? anchorBoundaryPoint(fromAnchor, toAnchor ? anchorCenter(toAnchor) : toCenter)
            : objectBoundaryPoint(fromObject, toAnchor ? anchorCenter(toAnchor) : toCenter, pins, canvasX, canvasY);
          const resolvedTo = toAnchor
            ? anchorBoundaryPoint(toAnchor, fromAnchor ? anchorCenter(fromAnchor) : fromCenter)
            : objectBoundaryPoint(toObject, fromAnchor ? anchorCenter(fromAnchor) : fromCenter, pins, canvasX, canvasY);
          const activeDrag = linkDrag?.linkId === link.id ? linkDrag : undefined;
          const dragPoint = activeDrag?.snap?.point ?? activeDrag?.point;
          const from = activeDrag?.endpoint === "from" && dragPoint ? dragPoint : resolvedFrom;
          const to = activeDrag?.endpoint === "to" && dragPoint ? dragPoint : resolvedTo;
          const waypointDragPoint = waypointDrag?.linkId === link.id ? waypointDrag.point : undefined;
          const waypoint = waypointDragPoint
            ?? (link.waypoint ? { x: link.waypoint.x - canvasX, y: link.waypoint.y - canvasY } : undefined);
          const path = linkPath(from, to, link.lineType, waypoint);
          const handlePoint = waypoint ?? linkDefaultWaypoint(from, to, link.lineType);
          const labelPoint = waypoint ?? { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
          const color = link.color ?? "#2563eb";
          const width = link.strokeWidth ?? 2.5;
          const markerId = `board-arrow-${board.id.replace(/[^a-zA-Z0-9_-]/g, "-")}-${index}`;
          return (
            <g
              key={link.id}
              className={`board-link ${selectedLinkId === link.id ? "is-selected" : ""}`}
              data-board-link={link.id}
              data-link-from={link.from}
              data-link-to={link.to}
              data-from-component={link.fromComponentId}
              data-to-component={link.toComponentId}
              data-line-type={link.lineType ?? "curve"}
              data-waypoint-x={link.waypoint ? link.waypoint.x : ""}
              data-waypoint-y={link.waypoint ? link.waypoint.y : ""}
            >
              <defs>
                <marker id={markerId} markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto" markerUnits="strokeWidth">
                  <polygon points="0 0, 10 4, 0 8" fill={color} />
                </marker>
              </defs>
              <path className="board-link-halo" d={path} fill="none" stroke="white" strokeWidth={width + 4} />
              <path className="board-link-line" d={path} fill="none" stroke={color} strokeWidth={width} markerEnd={`url(#${markerId})`} />
              {interactive ? <path className="board-link-hit" d={path} fill="none" stroke="transparent" strokeWidth={Math.max(20, width + 14)} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); onSelectLink?.(link.id); }} onClick={(event) => event.stopPropagation()} /> : null}
              {link.label ? (
                <text className="board-link-label" x={labelPoint.x} y={labelPoint.y - 8} fill={link.labelColor ?? color} fontSize={link.labelSize ?? 10} fontWeight={700} textAnchor="middle">
                  {link.label}
                </text>
              ) : null}
              {interactive ? ([
                ["from", from],
                ["to", to]
              ] as const).map(([endpoint, point]) => (
                <circle
                  key={endpoint}
                  className={`board-link-handle board-link-handle--${endpoint} ${activeDrag?.endpoint === endpoint ? "is-dragging" : ""}`}
                  data-link-endpoint={endpoint}
                  cx={point.x}
                  cy={point.y}
                  r={endpoint === "to" ? 7 : 6}
                  fill={endpoint === "to" ? color : "white"}
                  stroke={color}
                  strokeWidth={2.5}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setLinkDrag({ linkId: link.id, endpoint, point });
                  }}
                  onPointerMove={(event) => {
                    if (!linkDrag || linkDrag.linkId !== link.id || linkDrag.endpoint !== endpoint) return;
                    const snap = findLinkSnap(event.clientX, event.clientY);
                    setLinkDrag({ linkId: link.id, endpoint, point: pointerCanvasPoint(event.clientX, event.clientY), snap });
                  }}
                  onPointerUp={(event) => {
                    if (!linkDrag || linkDrag.linkId !== link.id || linkDrag.endpoint !== endpoint) return;
                    const snap = findLinkSnap(event.clientX, event.clientY);
                    if (snap) onRelink?.(link.id, endpoint, snap.objectId, snap.componentId);
                    setLinkDrag(undefined);
                  }}
                  onPointerCancel={() => setLinkDrag(undefined)}
                />
              )) : null}
              {interactive ? (
                <circle
                  className={`board-link-handle board-link-handle--waypoint ${waypointDrag?.linkId === link.id ? "is-dragging" : ""}`}
                  data-link-waypoint={link.id}
                  cx={handlePoint.x}
                  cy={handlePoint.y}
                  r={6}
                  fill="white"
                  stroke={color}
                  strokeWidth={2.5}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setWaypointDrag({ linkId: link.id, point: handlePoint });
                  }}
                  onPointerMove={(event) => {
                    if (!waypointDrag || waypointDrag.linkId !== link.id) return;
                    setWaypointDrag({ linkId: link.id, point: pointerCanvasPoint(event.clientX, event.clientY) });
                  }}
                  onPointerUp={(event) => {
                    if (!waypointDrag || waypointDrag.linkId !== link.id) return;
                    const point = pointerCanvasPoint(event.clientX, event.clientY);
                    setWaypointDrag(undefined);
                    onMoveLinkWaypoint?.(link.id, Math.round(point.x + canvasX), Math.round(point.y + canvasY));
                  }}
                  onPointerCancel={() => setWaypointDrag(undefined)}
                />
              ) : null}
              {activeDrag?.snap ? (
                <g className="board-link-snap-label" transform={`translate(${(dragPoint?.x ?? 0) + 12} ${(dragPoint?.y ?? 0) - 12})`}>
                  <rect x="0" y="-18" width={Math.max(76, activeDrag.snap.label.length * 7 + 24)} height="24" rx="6" />
                  <text x="10" y="-2">吸附 · {activeDrag.snap.label}</text>
                </g>
              ) : null}
            </g>
          );
        })}
        {createLink ? (() => {
          const fromObject = objectMap.get(createLink.from.objectId);
          const fromAnchor = createLink.from.componentId ? linkAnchors[`${createLink.from.objectId}:${createLink.from.componentId}`] : undefined;
          const source = fromAnchor
            ? anchorBoundaryPoint(fromAnchor, createLink.point)
            : fromObject ? objectBoundaryPoint(fromObject, createLink.point, pins, canvasX, canvasY) : createLink.point;
          return (
            <g className="board-link-preview">
              <path d={linkPath(source, createLink.point, "curve")} fill="none" stroke="#2563eb" strokeWidth={2.5} strokeDasharray="6 4" />
              {createLink.snap ? <circle cx={createLink.snap.x} cy={createLink.snap.y} r={8} fill="rgba(37, 99, 235, 0.15)" stroke="#2563eb" strokeWidth={1.5} /> : null}
            </g>
          );
        })() : null}
      </svg>
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
    return {
      left: Math.min(marquee.start.x, marquee.current.x) - rect.left,
      top: Math.min(marquee.start.y, marquee.current.y) - rect.top,
      width: Math.abs(marquee.current.x - marquee.start.x),
      height: Math.abs(marquee.current.y - marquee.start.y)
    };
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
      <input
        type="range"
        className="board-zoom-slider"
        min={5}
        max={400}
        step={5}
        value={Math.round(view.zoom * 100)}
        onChange={(event) => {
          const zoom = Number(event.target.value) / 100;
          setView((v) => zoomAtCursor(v, zoom / v.zoom, containerSize.width / 2, containerSize.height / 2));
        }}
        aria-label="缩放比例"
      />
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
