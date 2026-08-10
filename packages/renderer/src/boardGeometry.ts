import type { BoardDSL, BoardObject } from "@prototype-studio/dsl-schema";

export interface Point {
  x: number;
  y: number;
}

export interface BoardView {
  x: number;
  y: number;
  zoom: number;
}

export interface BoardBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 1.25;
export const GRID_STEP = 20;
export const SNAP_STEP = 10;
export const CONTENT_PADDING = 120;
export const VIRTUAL_MARGIN = 200;
export const MARKER_PIN_SIZE = 28;
export const ANNOTATION_PANEL_WIDTH = 300;
export const ANNOTATION_PANEL_GAP = 60;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** 以屏幕坐标 cursor 为锚点缩放：光标下的世界点保持不动。 */
export function zoomAtCursor(view: BoardView, factor: number, cursorX: number, cursorY: number): BoardView {
  const zoom = clampZoom(view.zoom * factor);
  const nextZoom = zoom / view.zoom;
  return {
    x: cursorX - (cursorX - view.x) * nextZoom,
    y: cursorY - (cursorY - view.y) * nextZoom,
    zoom
  };
}

export function screenToWorld(view: BoardView, clientX: number, clientY: number, originX: number, originY: number): Point {
  return { x: (clientX - originX - view.x) / view.zoom, y: (clientY - originY - view.y) / view.zoom };
}

export function worldToScreen(view: BoardView, x: number, y: number, originX: number, originY: number): Point {
  return { x: originX + view.x + x * view.zoom, y: originY + view.y + y * view.zoom };
}

/** 视口可见的世界范围（含余量），用于虚拟化过滤。 */
export function visibleWorldRect(view: BoardView, containerWidth: number, containerHeight: number, margin = VIRTUAL_MARGIN): BoardBounds {
  return {
    minX: -view.x / view.zoom - margin,
    minY: -view.y / view.zoom - margin,
    maxX: (containerWidth - view.x) / view.zoom + margin,
    maxY: (containerHeight - view.y) / view.zoom + margin
  };
}

export function rectsIntersect(rect: Rect, bounds: BoardBounds): boolean {
  return rect.x < bounds.maxX && rect.x + rect.width > bounds.minX
    && rect.y < bounds.maxY && rect.y + rect.height > bounds.minY;
}

export function snapValue(value: number, step = SNAP_STEP): number {
  return Math.round(value / step) * step;
}

export function objectRect(object: BoardObject, pins: Record<string, Point>): Rect {
  if (object.type === "marker") {
    const pin = pins[object.id];
    const pinRect = pin
      ? { x: pin.x, y: pin.y, width: MARKER_PIN_SIZE, height: MARKER_PIN_SIZE }
      : { x: -MARKER_PIN_SIZE, y: -MARKER_PIN_SIZE, width: MARKER_PIN_SIZE, height: MARKER_PIN_SIZE };
    if (object.noteX === undefined || object.noteY === undefined) return pinRect;
    const noteRect = { x: object.noteX, y: object.noteY, width: 280, height: 64 };
    const minX = Math.min(pinRect.x, noteRect.x);
    const minY = Math.min(pinRect.y, noteRect.y);
    const maxX = Math.max(pinRect.x + pinRect.width, noteRect.x + noteRect.width);
    const maxY = Math.max(pinRect.y + pinRect.height, noteRect.y + noteRect.height);
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
  return { x: object.x, y: object.y, width: object.width, height: object.height };
}

/** 内容边界：所有对象（含标注钉点）与连线端点的并集。 */
export function boardContentBounds(board: BoardDSL, pins: Record<string, Point>): BoardBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (x: number, y: number, w: number, h: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };
  for (const object of board.objects) {
    if (object.type === "marker" && !pins[object.id]) continue;
    const rect = objectRect(object, pins);
    include(rect.x, rect.y, rect.width, rect.height);
  }
  const objectCenterOf = (id: string): Point | undefined => {
    const object = board.objects.find((item) => item.id === id);
    if (!object) return undefined;
    if (object.type === "marker") return pins[object.id];
    return { x: object.x + object.width / 2, y: object.y + object.height / 2 };
  };
  for (const link of board.links) {
    const from = objectCenterOf(link.from);
    const to = objectCenterOf(link.to);
    if (from) include(from.x, from.y, 0, 0);
    if (to) include(to.x, to.y, 0, 0);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1600, maxY: 1200 };
  return { minX, minY, maxX, maxY };
}

/** 把内容边界换算成适配视口的 view（含留白）。 */
export function fitView(bounds: BoardBounds, containerWidth: number, containerHeight: number, padding = CONTENT_PADDING): BoardView {
  const width = Math.max(1, bounds.maxX - bounds.minX + padding * 2);
  const height = Math.max(1, bounds.maxY - bounds.minY + padding * 2);
  const zoom = clampZoom(Math.min(containerWidth / width, containerHeight / height));
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return {
    zoom,
    x: containerWidth / 2 - centerX * zoom,
    y: containerHeight / 2 - centerY * zoom
  };
}

/** 视口可见的世界矩形。 */
export function viewWorldRect(view: BoardView, containerWidth: number, containerHeight: number): BoardBounds {
  return {
    minX: -view.x / view.zoom,
    minY: -view.y / view.zoom,
    maxX: (containerWidth - view.x) / view.zoom,
    maxY: (containerHeight - view.y) / view.zoom
  };
}
