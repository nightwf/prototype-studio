import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PageDSL, WireframeDSL, WireframeElement, WireframeElementType } from "@prototype-studio/dsl-schema";
import { WIREFRAME_ICON_NAMES, WireframeElementView, WireframeRenderer } from "@prototype-studio/renderer";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowUpRight,
  Box,
  Circle,
  Copy,
  Image as ImageIcon,
  Layers,
  Lock,
  MousePointer2,
  MoveUp,
  Minus,
  Square,
  Type as TypeIcon,
  Unlock,
  X,
  Zap
} from "lucide-react";
import "./wireframeEditor.css";

interface WireframeEditorProps {
  dsl: PageDSL;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onCommit: (wireframe: WireframeDSL) => Promise<boolean> | void;
}

interface PaletteItem {
  type: WireframeElementType;
  label: string;
  hint?: string;
  defaults: Partial<WireframeElement>;
}

const SHAPE_ITEMS: PaletteItem[] = [
  { type: "rect", label: "矩形", defaults: { width: 160, height: 90 } },
  { type: "roundRect", label: "圆角矩形", defaults: { width: 160, height: 90, radius: 8 } },
  { type: "ellipse", label: "圆形", defaults: { width: 90, height: 90 } },
  { type: "line", label: "直线", defaults: { width: 160, height: 2, stroke: "#b3b3b3" } },
  { type: "arrow", label: "箭头", defaults: { width: 160, height: 2, stroke: "#b3b3b3" } },
  { type: "text", label: "文本", defaults: { width: 160, height: 24, text: "文本内容" } },
  { type: "icon", label: "图标", defaults: { width: 32, height: 32, icon: "search" } },
  { type: "image", label: "图片", defaults: { width: 200, height: 120 } }
];

const CONTROL_ITEMS: PaletteItem[] = [
  { type: "button", label: "按钮", defaults: { width: 96, height: 32, text: "按钮" } },
  { type: "input", label: "输入框", defaults: { width: 220, height: 32, text: "请输入" } },
  { type: "select", label: "下拉框", defaults: { width: 220, height: 32, text: "请选择" } },
  { type: "table", label: "表格", defaults: { width: 640, height: 220, cols: 4, rows: 4 } },
  { type: "card", label: "卡片", defaults: { width: 260, height: 140, text: "卡片标题" } },
  { type: "tabs", label: "标签页", defaults: { width: 320, height: 36, items: ["页签一", "页签二", "页签三"] } },
  { type: "modal", label: "弹窗框", defaults: { width: 420, height: 260, text: "弹窗标题" } }
];

const GRID = 8;

function snap(value: number): number {
  return Math.round(value / GRID) * GRID;
}

function elementLabel(element: WireframeElement): string {
  const map: Record<string, string> = {
    rect: "矩形", roundRect: "圆角矩形", ellipse: "圆形", line: "直线", arrow: "箭头",
    text: "文本", icon: "图标", image: "图片", button: "按钮", input: "输入框",
    select: "下拉框", table: "表格", card: "卡片", tabs: "标签页", modal: "弹窗框"
  };
  return map[element.type] ?? element.type;
}

export function WireframeEditor({ dsl, selectedIds, onSelect, onCommit }: WireframeEditorProps) {
  const [elements, setElements] = useState<WireframeElement[]>(() => dsl.wireframe?.elements ?? []);
  const [artboard, setArtboard] = useState(() => ({
    width: dsl.wireframe?.width ?? 1440,
    height: dsl.wireframe?.height ?? 900,
    background: dsl.wireframe?.background ?? "#ffffff"
  }));
  const { width: artboardWidth, height: artboardHeight, background } = artboard;
  const [tool, setTool] = useState<"select" | WireframeElementType>("select");
  const [iconPick, setIconPick] = useState(false);
  const [scale, setScale] = useState(0.62);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const revisionRef = useRef(dsl.revision);

  // 服务端 revision 变化（含撤销/重做、AI 修改）后同步本地内容
  useEffect(() => {
    if (dsl.revision !== revisionRef.current) {
      revisionRef.current = dsl.revision;
      setElements(dsl.wireframe?.elements ?? []);
      setArtboard({
        width: dsl.wireframe?.width ?? 1440,
        height: dsl.wireframe?.height ?? 900,
        background: dsl.wireframe?.background ?? "#ffffff"
      });
    }
  }, [dsl]);

  const boardRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<{ mode: "draw" | "move" | "resize" | "marquee"; startX: number; startY: number; lastX?: number; lastY?: number; handle?: string; origin: WireframeElement[]; element?: WireframeElement } | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  const selected = useMemo(() => elements.filter((element) => selectedIds.includes(element.id)), [elements, selectedIds]);
  const single = selected.length === 1 ? selected[0] : undefined;

  const commit = useCallback((next: WireframeElement[]) => {
    setElements(next);
    onCommit({ width: artboardWidth, height: artboardHeight, background, elements: next });
  }, [artboardHeight, artboardWidth, background, onCommit]);

  const applyArtboard = (patch: Partial<{ width: number; height: number; background: string }>) => {
    const next = { ...artboard, ...patch };
    setArtboard(next);
    onCommit({ ...next, elements });
  };

  const toLocal = useCallback((clientX: number, clientY: number) => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
  }, [scale]);

  const createElement = (item: PaletteItem, x: number, y: number, width: number, height: number): WireframeElement => {
    const id = `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    return {
      // 先铺默认样式，再写入绘制结果，避免默认尺寸覆盖用户拖拽出来的尺寸。
      ...item.defaults,
      id,
      type: item.type,
      x: snapEnabled ? snap(x) : Math.round(x),
      y: snapEnabled ? snap(y) : Math.round(y),
      width: Math.max(4, snapEnabled ? snap(width) : Math.round(width)),
      height: Math.max(2, snapEnabled ? snap(height) : Math.round(height))
    } as WireframeElement;
  };

  const paletteItem = useMemo(() => [...SHAPE_ITEMS, ...CONTROL_ITEMS].find((item) => item.type === tool), [tool]);

  const onBoardPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const point = toLocal(event.clientX, event.clientY);
    boardRef.current?.setPointerCapture?.(event.pointerId);

    if (tool !== "select" && paletteItem) {
      draftRef.current = { mode: "draw", startX: point.x, startY: point.y, handle: undefined, origin: elements };
      setMarquee({ x: point.x, y: point.y, width: 0, height: 0 });
      return;
    }

    // 空白处按下 → 框选
    draftRef.current = { mode: "marquee", startX: point.x, startY: point.y, handle: undefined, origin: elements };
    setMarquee({ x: point.x, y: point.y, width: 0, height: 0 });
    if (!event.shiftKey) onSelect([]);
  };

  const onElementPointerDown = (event: React.PointerEvent<HTMLDivElement>, element: WireframeElement) => {
    if (tool !== "select" || event.button !== 0) return;
    event.stopPropagation();
    const point = toLocal(event.clientX, event.clientY);
    const nextSelection = event.shiftKey
      ? (selectedIds.includes(element.id) ? selectedIds.filter((id) => id !== element.id) : [...selectedIds, element.id])
      : (selectedIds.includes(element.id) ? selectedIds : [element.id]);
    onSelect(nextSelection);
    if (element.locked) return;
    boardRef.current?.setPointerCapture?.(event.pointerId);
    draftRef.current = { mode: "move", startX: point.x, startY: point.y, handle: undefined, origin: elements };
  };

  const onHandlePointerDown = (event: React.PointerEvent<HTMLSpanElement>, handle: string) => {
    event.stopPropagation();
    if (!single) return;
    const point = toLocal(event.clientX, event.clientY);
    boardRef.current?.setPointerCapture?.(event.pointerId);
    draftRef.current = { mode: "resize", startX: point.x, startY: point.y, handle, origin: elements, element: single };
  };

  const onBoardPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const draft = draftRef.current;
    if (!draft) return;
    const point = toLocal(event.clientX, event.clientY);
    // 记录最后一次移动点：指针在画板外抬起时也能拿到真实的结束位置。
    draft.lastX = point.x;
    draft.lastY = point.y;
    if (draft.mode === "marquee" || draft.mode === "draw") {
      setMarquee({
        x: Math.min(draft.startX, point.x),
        y: Math.min(draft.startY, point.y),
        width: Math.abs(point.x - draft.startX),
        height: Math.abs(point.y - draft.startY)
      });
      return;
    }
    if (draft.mode === "move") {
      const dx = point.x - draft.startX;
      const dy = point.y - draft.startY;
      const moving = new Set([...selectedIds]);
      setElements(draft.origin.map((element) => {
        if (!moving.has(element.id) || element.locked) return element;
        const x = element.x + dx;
        const y = element.y + dy;
        return { ...element, x: snapEnabled ? snap(x) : Math.round(x), y: snapEnabled ? snap(y) : Math.round(y) };
      }));
      return;
    }
    if (draft.mode === "resize" && draft.element) {
      const target = draft.element;
      const dx = point.x - draft.startX;
      const dy = point.y - draft.startY;
      let { x, y, width, height } = target;
      if (draft.handle?.includes("e")) width = target.width + dx;
      if (draft.handle?.includes("s")) height = target.height + dy;
      if (draft.handle?.includes("w")) { width = target.width - dx; x = target.x + dx; }
      if (draft.handle?.includes("n")) { height = target.height - dy; y = target.y + dy; }
      setElements(draft.origin.map((element) => element.id === target.id ? {
        ...element,
        x: snapEnabled ? snap(x) : Math.round(x),
        y: snapEnabled ? snap(y) : Math.round(y),
        width: Math.max(4, snapEnabled ? snap(width) : Math.round(width)),
        height: Math.max(2, snapEnabled ? snap(height) : Math.round(height))
      } : element));
    }
  };

  const onBoardPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const draft = draftRef.current;
    draftRef.current = null;
    if (!draft) return;
    const live = toLocal(event.clientX, event.clientY);
    const point = draft.lastX === undefined ? live : { x: draft.lastX, y: draft.lastY ?? live.y };
    setMarquee(null);

    if (draft.mode === "draw" && paletteItem) {
      const width = Math.abs(point.x - draft.startX);
      const height = Math.abs(point.y - draft.startY);
      const useDefault = width < 6 && height < 6;
      const next = createElement(
        paletteItem,
        useDefault ? draft.startX : Math.min(draft.startX, point.x),
        useDefault ? draft.startY : Math.min(draft.startY, point.y),
        useDefault ? (paletteItem.defaults.width ?? 120) : width,
        useDefault ? (paletteItem.defaults.height ?? 40) : height
      );
      commit([...elements, next]);
      onSelect([next.id]);
      setTool("select");
      return;
    }

    if (draft.mode === "marquee") {
      const box = {
        x: Math.min(draft.startX, point.x), y: Math.min(draft.startY, point.y),
        width: Math.abs(point.x - draft.startX), height: Math.abs(point.y - draft.startY)
      };
      if (box.width < 3 && box.height < 3) return;
      const hit = elements.filter((element) =>
        element.x < box.x + box.width && element.x + element.width > box.x &&
        element.y < box.y + box.height && element.y + element.height > box.y
      ).map((element) => element.id);
      onSelect(hit);
      return;
    }

    if (draft.mode === "move" || draft.mode === "resize") {
      const changed = elements.some((element) => {
        const before = draft.origin.find((item) => item.id === element.id);
        return !before || before.x !== element.x || before.y !== element.y || before.width !== element.width || before.height !== element.height;
      });
      if (changed) commit(elements);
    }
  };

  const updateSelected = (patch: Partial<WireframeElement>) => {
    if (!selectedIds.length) return;
    commit(elements.map((element) => selectedIds.includes(element.id) ? { ...element, ...patch } : element));
  };

  const deleteSelected = () => {
    if (!selectedIds.length) return;
    commit(elements.filter((element) => !selectedIds.includes(element.id)));
    onSelect([]);
  };

  const duplicateSelected = () => {
    if (!selected.length) return;
    const copies = selected.map((element, index) => ({
      ...element,
      id: `wf-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 5)}`,
      x: element.x + 16,
      y: element.y + 16,
      groupId: undefined
    }));
    commit([...elements, ...copies]);
    onSelect(copies.map((copy) => copy.id));
  };

  const zOrder = (mode: "top" | "bottom") => {
    if (!selected.length) return;
    const zs = elements.map((element) => element.z ?? 0);
    const target = mode === "top" ? Math.max(...zs, 0) + 1 : Math.min(...zs, 0) - 1;
    commit(elements.map((element) => selectedIds.includes(element.id) ? { ...element, z: target } : element));
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const mod = event.metaKey || event.ctrlKey;
      if (event.key === "Escape") { setTool("select"); setMarquee(null); return; }
      if (!selectedIds.length) return;
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteSelected(); return; }
      if (mod && event.key.toLowerCase() === "d") { event.preventDefault(); duplicateSelected(); return; }
      const step = event.shiftKey ? 10 : 1;
      const deltas: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const delta = deltas[event.key];
      if (delta) {
        event.preventDefault();
        commit(elements.map((element) => selectedIds.includes(element.id) ? { ...element, x: element.x + delta[0], y: element.y + delta[1] } : element));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const scaledWidth = artboardWidth * scale;
  const scaledHeight = artboardHeight * scale;

  return (
    <div className="wf-editor">
      <aside className="wf-palette">
        <div className="wf-palette-group">
          <span className="wf-palette-title">基础图形</span>
          {SHAPE_ITEMS.map((item) => (
            <button key={item.type} className={tool === item.type ? "is-active" : ""} onClick={() => { setTool(item.type); setIconPick(false); }} title={`绘制${item.label}`}>
              <span className="wf-palette-icon"><ShapeIcon type={item.type} /></span>
              {item.label}
            </button>
          ))}
        </div>
        <div className="wf-palette-group">
          <span className="wf-palette-title">后台控件</span>
          {CONTROL_ITEMS.map((item) => (
            <button key={item.type} className={tool === item.type ? "is-active" : ""} onClick={() => { setTool(item.type); setIconPick(false); }} title={`绘制${item.label}`}>
              <span className="wf-palette-icon"><Box size={13} /></span>
              {item.label}
            </button>
          ))}
        </div>
      </aside>

      <div className="wf-stage">
        <div className="wf-toolbar">
          <button className={tool === "select" ? "is-active" : ""} onClick={() => setTool("select")}><MousePointer2 size={13} />选择</button>
          <button className={snapEnabled ? "is-active" : ""} onClick={() => setSnapEnabled((value) => !value)}><Zap size={13} />吸附 8px</button>
          <span className="wf-toolbar-divider" />
          <button onClick={() => setScale((value) => Math.max(0.25, Math.round((value - 0.1) * 100) / 100))}>−</button>
          <span className="wf-zoom">{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale((value) => Math.min(1.5, Math.round((value + 0.1) * 100) / 100))}>+</button>
          <button onClick={() => setScale(0.62)}>适配</button>
          <span className="wf-toolbar-hint">
            {tool === "select" ? "拖动移动 · 框选多选 · Delete 删除 · ⌘D 复制 · 方向键微调" : `按住拖拽绘制「${paletteItem?.label ?? ""}」`}
          </span>
        </div>

        <div className="wf-scroll">
          <div className="wf-scale" style={{ width: scaledWidth, height: scaledHeight }}>
            <div className="wf-board" ref={boardRef} style={{ width: artboardWidth, height: artboardHeight, transform: `scale(${scale})`, cursor: tool === "select" ? "default" : "crosshair" }}
              onPointerDown={onBoardPointerDown} onPointerMove={onBoardPointerMove} onPointerUp={onBoardPointerUp} onPointerLeave={onBoardPointerUp}
            >
              <WireframeRenderer wireframe={{ width: artboardWidth, height: artboardHeight, background, elements }} />
              <div className="wf-overlay">
                {elements.map((element) => (
                  <div
                    key={element.id}
                    className={`wf-hit ${selectedIds.includes(element.id) ? "is-selected" : ""} ${element.locked ? "is-locked" : ""}`}
                    style={{ left: element.x, top: element.y, width: element.width, height: element.height }}
                    onPointerDown={(event) => onElementPointerDown(event, element)}
                  />
                ))}
                {single && !single.locked && tool === "select" ? (
                  <>
                    {(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const).map((handle) => (
                      <span
                        key={handle}
                        className={`wf-handle wf-handle--${handle}`}
                        style={handleStyle(handle, single)}
                        onPointerDown={(event) => onHandlePointerDown(event, handle)}
                      />
                    ))}
                  </>
                ) : null}
                {marquee ? <div className="wf-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} /> : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      <aside className="wf-inspector">
        {!selected.length ? (
          <>
            <div className="wf-inspector-empty">
              <strong>画板设置</strong>
              <p>从左侧选择元件后在画板拖拽绘制；点击画板上的元件可编辑样式。当前画板共 {elements.length} 个元件。</p>
            </div>
            <span className="wf-section">画板尺寸</span>
            <div className="wf-grid2">
              <NumberField label="宽" value={artboardWidth} onChange={(value) => applyArtboard({ width: Math.max(240, value) })} />
              <NumberField label="高" value={artboardHeight} onChange={(value) => applyArtboard({ height: Math.max(240, value) })} />
            </div>
            <ColorField label="背景" value={background} onChange={(value) => applyArtboard({ background: value })} />
            <span className="wf-section">常用尺寸</span>
            <div className="wf-presets">
              <button onClick={() => applyArtboard({ width: 1440, height: 900 })}>桌面 1440 × 900</button>
              <button onClick={() => applyArtboard({ width: 1280, height: 800 })}>后台 1280 × 800</button>
              <button onClick={() => applyArtboard({ width: 375, height: 812 })}>移动 375 × 812</button>
            </div>
          </>
        ) : (
          <>
            <div className="wf-inspector-head">
              <span><Layers size={13} />{selected.length === 1 ? elementLabel(selected[0]!) : `${selected.length} 个元件`}</span>
              <div className="wf-inspector-actions">
                <button onClick={duplicateSelected} title="复制"><Copy size={12} /></button>
                <button onClick={() => zOrder("top")} title="置顶"><MoveUp size={12} /></button>
                <button onClick={() => updateSelected({ locked: !single?.locked })} title={single?.locked ? "解锁" : "锁定"}>{single?.locked ? <Unlock size={12} /> : <Lock size={12} />}</button>
                <button className="is-danger" onClick={deleteSelected} title="删除"><X size={12} /></button>
              </div>
            </div>

            {single ? (
              <>
                <span className="wf-section">位置与尺寸</span>
                <div className="wf-grid2">
                  <NumberField label="X" value={single.x} onChange={(value) => updateSelected({ x: value })} />
                  <NumberField label="Y" value={single.y} onChange={(value) => updateSelected({ y: value })} />
                  <NumberField label="宽" value={single.width} onChange={(value) => updateSelected({ width: Math.max(4, value) })} />
                  <NumberField label="高" value={single.height} onChange={(value) => updateSelected({ height: Math.max(2, value) })} />
                </div>

                <span className="wf-section">样式</span>
                <div className="wf-grid2">
                  <ColorField label="填充" value={single.fill ?? (single.type === "text" || single.type === "line" || single.type === "arrow" ? "" : "#fafafa")} onChange={(value) => updateSelected({ fill: value || undefined })} />
                  <ColorField label="描边" value={single.stroke ?? "#d6d6d6"} onChange={(value) => updateSelected({ stroke: value })} />
                  <NumberField label="圆角" value={single.radius ?? 0} onChange={(value) => updateSelected({ radius: Math.max(0, value) })} />
                  <NumberField label="线宽" value={single.strokeWidth ?? 1} onChange={(value) => updateSelected({ strokeWidth: Math.max(0, value) })} />
                </div>

                {["text", "button", "input", "select", "card", "modal"].includes(single.type) ? (
                  <>
                    <span className="wf-section">文字</span>
                    <label className="wf-field"><span>内容</span>
                      <input value={single.text ?? ""} onChange={(event) => updateSelected({ text: event.target.value })} />
                    </label>
                  </>
                ) : null}
                {single.type === "tabs" ? (
                  <>
                    <span className="wf-section">页签</span>
                    <label className="wf-field"><span>用逗号分隔</span>
                      <input value={(single.items ?? []).join(",")} onChange={(event) => updateSelected({ items: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} />
                    </label>
                  </>
                ) : null}
                {single.type === "table" ? (
                  <>
                    <span className="wf-section">表格</span>
                    <div className="wf-grid2">
                      <NumberField label="列数" value={single.cols ?? 4} onChange={(value) => updateSelected({ cols: Math.max(1, Math.min(12, value)) })} />
                      <NumberField label="行数" value={single.rows ?? 4} onChange={(value) => updateSelected({ rows: Math.max(1, Math.min(20, value)) })} />
                    </div>
                  </>
                ) : null}
                {single.type === "icon" ? (
                  <>
                    <span className="wf-section">图标</span>
                    <button className="wf-icon-trigger" onClick={() => setIconPick((value) => !value)}>{single.icon ?? "search"}</button>
                    {iconPick ? (
                      <div className="wf-icon-picker">
                        {WIREFRAME_ICON_NAMES.map((name) => (
                          <button key={name} className={single.icon === name ? "is-active" : ""} onClick={() => { updateSelected({ icon: name }); setIconPick(false); }} title={name}>
                            <WireframeElementView element={{ id: "preview", type: "icon", x: 0, y: 0, width: 20, height: 20, icon: name }} />
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : null}
                {["text", "button"].includes(single.type) ? (
                  <>
                    <div className="wf-grid2">
                      <NumberField label="字号" value={single.fontSize ?? 13} onChange={(value) => updateSelected({ fontSize: Math.max(8, value) })} />
                      <ColorField label="字色" value={single.color ?? "#666666"} onChange={(value) => updateSelected({ color: value })} />
                    </div>
                    <div className="wf-align">
                      <button className={(single.align ?? "left") === "left" ? "is-active" : ""} title="左对齐" onClick={() => updateSelected({ align: "left" })}><AlignLeft size={12} /></button>
                      <button className={(single.align ?? "left") === "center" ? "is-active" : ""} title="水平居中" onClick={() => updateSelected({ align: "center" })}><AlignCenter size={12} /></button>
                      <button className={(single.align ?? "left") === "right" ? "is-active" : ""} title="右对齐" onClick={() => updateSelected({ align: "right" })}><AlignRight size={12} /></button>
                    </div>
                  </>
                ) : null}
              </>
            ) : (
              <div className="wf-multi">
                <span className="wf-section">多选</span>
                <p>已选中 {selected.length} 个元件，可整体拖动、删除或复制。</p>
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(Math.round(value)));
  useEffect(() => { setDraft(String(Math.round(value))); }, [value]);
  return (
    <label className="wf-field">
      <span>{label}</span>
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => { const parsed = Number(draft); onChange(Number.isFinite(parsed) ? parsed : value); }}
        onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
      />
    </label>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="wf-field wf-field--color">
      <span>{label}</span>
      <div>
        <input type="color" value={value || "#ffffff"} onChange={(event) => onChange(event.target.value)} />
        <code>{value || "无"}</code>
      </div>
    </label>
  );
}

function ShapeIcon({ type }: { type: WireframeElementType }) {
  if (type === "ellipse") return <Circle size={13} />;
  if (type === "line") return <Minus size={13} />;
  if (type === "arrow") return <ArrowUpRight size={13} />;
  if (type === "text") return <TypeIcon size={13} />;
  if (type === "image") return <ImageIcon size={13} />;
  return <Square size={13} />;
}

function handleStyle(handle: string, element: WireframeElement): React.CSSProperties {
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const map: Record<string, { left: number; top: number; cursor: string }> = {
    nw: { left: element.x, top: element.y, cursor: "nwse-resize" },
    n: { left: cx, top: element.y, cursor: "ns-resize" },
    ne: { left: element.x + element.width, top: element.y, cursor: "nesw-resize" },
    e: { left: element.x + element.width, top: cy, cursor: "ew-resize" },
    se: { left: element.x + element.width, top: element.y + element.height, cursor: "nwse-resize" },
    s: { left: cx, top: element.y + element.height, cursor: "ns-resize" },
    sw: { left: element.x, top: element.y + element.height, cursor: "nesw-resize" },
    w: { left: element.x, top: cy, cursor: "ew-resize" }
  };
  const spot = map[handle] ?? map.se!;
  return { left: spot.left, top: spot.top, cursor: spot.cursor };
}
