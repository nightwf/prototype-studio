import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import {
  Box,
  Braces,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  Database,
  Download,
  FileCheck2,
  FolderOpen,
  GripVertical,
  GitBranch,
  History,
  Layers3,
  LayoutPanelLeft,
  LayoutGrid,
  LogOut,
  Maximize2,
  MapPin,
  Magnet,
  Monitor,
  MousePointer2,
  MoreHorizontal,
  Pencil,
  PanelLeft,
  PanelRight,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Search,
  KeyRound,
  Settings2,
  Share2,
  StickyNote,
  Table2,
  Trash2,
  Undo2,
  Upload,
  UserRound,
  ArrowDown,
  ArrowUp,
  X,
  Zap
} from "lucide-react";
import { caseListExample } from "@prototype-studio/dsl-schema/example";
import { renderToStaticMarkup } from "react-dom/server";
import boardExportCss from "../../../packages/renderer/src/board.css?raw";
import rendererExportCss from "../../../packages/renderer/src/styles.css?raw";
import {
  DSL_VERSION,
  type BoardCommand,
  type BoardDSL,
  type BoardLink,
  type BoardMarkerObject,
  type BoardNoteObject,
  type BoardObject,
  type Command,
  type ComponentOption,
  type MarkerTone,
  type PageDSL,
  type RevisionRecord,
  type TableColumn,
  type UIComponent
} from "@prototype-studio/dsl-schema";
import { applyBoardCommands, createBoardRestoreCommands, createRevertRevision, executeCommands, type ApplyBoardCommandsResult } from "@prototype-studio/command-engine";
import { collectComponentLocations, getComponentLocation, validateDSL } from "@prototype-studio/dsl-validator";
import {
  ANNOTATION_PANEL_GAP,
  ANNOTATION_PANEL_WIDTH,
  CONTENT_PADDING,
  BoardRenderer,
  boardExportRuntimeScript,
  boardContentBounds,
  snapValue,
  type BoardRendererHandle,
  type BoardView
} from "@prototype-studio/renderer";
import { EmptyState, PanelHeader, StatusDot, ToolButton } from "@prototype-studio/design-system";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  createDesktopPage,
  createDesktopProject,
  exportDesktopBoardHtml,
  getLocalMcpConnectionInfo,
  isDesktopRuntime,
  listenForProjectFiles,
  persistDesktopBoardRevision,
  persistDesktopPageRevision,
  readDesktopPage,
  readDesktopBoard,
  renameDesktopPage,
  reorderDesktopPages,
  selectProjectFolder,
  startLocalMcp,
  startProjectWatcher,
  stopProjectWatcher,
  trashDesktopPage,
  writeDesktopPage,
  writeDesktopBoard,
  type DesktopMcpConnectionInfo,
  type DesktopProjectSnapshot
} from "./desktopBridge";
import { getApiToken, webAuth, webMode, webProjects, webSpace, type BoardSummary, type TrashedBoardSummary, type WebProject, type WebUser } from "./webBridge";
import { AuthScreen } from "./WebScreens";

const DiagramEditor = lazy(() => import("./DiagramEditor"));

type ToastTone = "success" | "warning" | "danger" | "info";
interface Toast { id: number; tone: ToastTone; title: string; detail?: string }
type AppModal =
  | { kind: "prompt"; title: string; label: string; confirmText: string; onConfirm: (value: string) => void }
  | { kind: "confirm"; title: string; message: string; confirmText: string; danger?: boolean; onConfirm: () => void };

type CreatablePageType = "list" | "form" | "detail";

function pageSlug(title: string, existingIds: string[]): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "page";
  const slug = /^[a-z]/.test(base) ? base : `page-${base}`;
  let candidate = slug;
  let suffix = 2;
  while (existingIds.includes(candidate)) candidate = `${slug}-${suffix++}`;
  return candidate;
}

function createMinimalPage(id: string, title: string, type: CreatablePageType): PageDSL {
  const shared: PageDSL = {
    dslVersion: caseListExample.dslVersion,
    rendererVersion: caseListExample.rendererVersion,
    designSystemVersion: caseListExample.designSystemVersion,
    revision: 1,
    page: { id, type, title, status: "Draft", description: `在 Prototype Studio 中创建的${type === "list" ? "列表" : type === "form" ? "表单" : "详情"}页。` },
    layout: { type: "standard", density: "normal" },
    overlays: [],
    rules: [],
    events: [],
    dataSource: { type: "mock", ref: `${id}-mock` }
  };
  if (type === "list") {
    shared.search = {
      id: `${id}.search`,
      fields: [{ id: `${id}.search.keyword`, type: "input", label: "关键词", placeholder: `搜索${title}`, source: "default" }],
      actions: [{ id: `${id}.search.submit`, type: "button", text: "查询", variant: "primary", event: { type: "refresh" }, source: "default" }]
    };
    shared.table = {
      id: `${id}.table`, type: "table", rowKey: "id", columns: [
        { id: `${id}.table.id`, type: "table-column", title: "编号", dataIndex: "id" },
        { id: `${id}.table.name`, type: "table-column", title: "名称", dataIndex: "name" }
      ], rows: [], source: "default"
    };
  } else if (type === "form") {
    shared.form = {
      id: `${id}.form`, type: "form", title,
      fields: [{ id: `${id}.form.name`, type: "input", label: "名称", placeholder: "请输入名称", validation: { required: true, message: "请输入名称" }, source: "default" }],
      actions: [{ id: `${id}.form.submit`, type: "button", text: "提交", variant: "primary", event: { type: "submit", target: `${id}.form` }, source: "default" }],
      source: "default"
    };
  } else {
    shared.detail = { id: `${id}.detail`, type: "description", title, description: "详情内容将在数据接入后展示。", source: "default" };
  }
  return shared;
}

const markerTones: MarkerTone[] = ["orange", "blue", "green", "red", "purple"];

interface MarkerDraft {
  pageObjectId: string;
  componentId: string;
  offsetX?: number;
  offsetY?: number;
  number: string;
  text: string;
  tone: MarkerTone;
}

function defaultBoardFromPages(pages: PageDSL[], id = "main"): BoardDSL {
  return {
    dslVersion: DSL_VERSION,
    id,
    name: "主画布",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    revision: 1,
    objects: pages.map((page, index) => ({
      id: `obj-${page.page.id}`,
      type: "page",
      pageId: page.page.id,
      x: 120,
      y: 80 + index * 720,
      width: 960,
      height: 640,
      source: "default"
    })),
    links: []
  };
}

function MarkerPicker({ boardPageObjects, pages, draft, picking, onChange, onStartPick, onCancel, onAdd }: {
  boardPageObjects: Array<Extract<BoardObject, { type: "page" }>>;
  pages: Record<string, PageDSL>;
  draft: MarkerDraft;
  picking: boolean;
  onChange: (draft: MarkerDraft) => void;
  onStartPick: () => void;
  onCancel: () => void;
  onAdd: (pageObjectId: string, componentId: string, number: string, text: string, tone: MarkerTone) => void;
}) {
  const pageObjectId = draft.pageObjectId;
  const componentId = draft.componentId;
  const pageDsl = pageObjectId ? pages[boardPageObjects.find((object) => object.id === pageObjectId)?.pageId ?? ""] : undefined;
  const components = pageDsl ? collectComponentLocations(pageDsl).map(({ component }) => component.id) : [];
  if (picking) {
    return (
      <div className="board-tool-panel board-tool-panel--picking">
        <div className="board-tool-head"><span>ADD MARKER</span><strong>点选页面元素</strong><button onClick={onCancel} aria-label="取消点选"><X size={13} /></button></div>
        <div className="board-tool-hint">点击画布中页面上的任意元素，标注会自动挂靠到该元素。</div>
        <div className="board-tool-actions">
          <button onClick={onCancel}>取消</button>
        </div>
      </div>
    );
  }
  return (
    <div className="board-tool-panel">
      <div className="board-tool-head"><span>ADD MARKER</span><strong>添加标注</strong><button onClick={onCancel} aria-label="关闭标注面板"><X size={13} /></button></div>
      <button className="board-tool-pick" onClick={onStartPick}><MousePointer2 size={13} />在画布上点选页面元素</button>
      <label><span>挂靠页面</span>
        <select value={pageObjectId} onChange={(event) => onChange({ ...draft, pageObjectId: event.target.value, componentId: "" })}>
          {boardPageObjects.map((object) => <option key={object.id} value={object.id}>{pages[object.pageId]?.page.title ?? object.pageId}</option>)}
        </select>
      </label>
      <label><span>挂靠组件</span>
        <select value={componentId} onChange={(event) => onChange({ ...draft, componentId: event.target.value })} disabled={!pageDsl}>
          <option value="">选择组件</option>
          {components.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      </label>
      <label><span>颜色</span>
        <select value={draft.tone} onChange={(event) => onChange({ ...draft, tone: event.target.value as MarkerTone })}>
          {markerTones.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
      <label><span>标注序号</span><input value={draft.number} onChange={(event) => onChange({ ...draft, number: event.target.value })} placeholder="可自定义，如 A1 / 5 / B-2" /></label>
      <label><span>说明文字</span><input value={draft.text} onChange={(event) => onChange({ ...draft, text: event.target.value })} placeholder="标注内容…" /></label>
      <div className="board-tool-actions">
        <button onClick={onCancel}>取消</button>
        <button className="is-primary" disabled={!pageObjectId || !componentId || !draft.number.trim()} onClick={() => onAdd(pageObjectId, componentId, draft.number.trim(), draft.text, draft.tone)}>添加</button>
      </div>
    </div>
  );
}

const EMPTY_PAGE = createMinimalPage("empty-page", "未选择页面", "detail");

function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="studio-section-title"><span>{children}</span>{action}</div>;
}

function ComponentIcon({ type }: { type: string }) {
  if (["modal", "drawer", "popover"].includes(type)) return <Layers3 size={13} />;
  if (type === "table") return <LayoutPanelLeft size={13} />;
  if (type === "button") return <Zap size={13} />;
  return <Box size={13} />;
}

function OutlineNode({ component, depth = 0, selectedId, onSelect, onMove }: {
  component: UIComponent;
  depth?: number;
  selectedId?: string;
  onSelect: (id: string) => void;
  onMove: (dragged: string, target: string) => void;
}) {
  const nested = [...(component.fields ?? []), ...(component.children ?? []), ...(component.actions ?? [])];
  const [expanded, setExpanded] = useState(true);
  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    const dragged = event.dataTransfer.getData("text/component-id");
    if (dragged && dragged !== component.id) onMove(dragged, component.id);
  };
  return <>
    <div
      className={`outline-node ${selectedId === component.id ? "is-selected" : ""}`}
      style={{ paddingLeft: 11 + depth * 14 }}
      draggable
      onDragStart={(event) => event.dataTransfer.setData("text/component-id", component.id)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
      onClick={() => onSelect(component.id)}
    >
      <GripVertical className="outline-grip" size={11} />
      {nested.length ? <button onClick={(event) => { event.stopPropagation(); setExpanded(!expanded); }}>{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button> : <span className="outline-spacer" />}
      <ComponentIcon type={component.type} />
      <span>{component.label ?? component.title ?? component.text ?? component.id}</span>
      <code>{component.type}</code>
    </div>
    {expanded ? nested.map((child) => <OutlineNode key={child.id} component={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} onMove={onMove} />) : null}
  </>;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} className={`inspector-toggle ${checked ? "is-on" : ""}`} onClick={() => onChange(!checked)}><i /><span>{label}</span></button>;
}

function OptionsEditor({ component, onChange }: { component: UIComponent; onChange: (options: ComponentOption[]) => void }) {
  const signature = JSON.stringify(component.options ?? []);
  const [options, setOptions] = useState<ComponentOption[]>(() => structuredClone(component.options ?? []));
  useEffect(() => { setOptions(structuredClone(component.options ?? [])); }, [component.id, signature]);

  const duplicateValues = new Set<string>();
  const seenValues = new Set<string>();
  options.forEach((option) => {
    const value = String(option.value);
    if (seenValues.has(value)) duplicateValues.add(value);
    seenValues.add(value);
  });
  const commit = (next: ComponentOption[]) => {
    setOptions(next);
    const values = next.map((option) => String(option.value));
    if (new Set(values).size === values.length) onChange(next);
  };
  const updateDraft = (index: number, changes: Partial<ComponentOption>) => setOptions((items) => items.map((option, optionIndex) => optionIndex === index ? { ...option, ...changes } : option));
  const commitDraft = () => commit(options.map((option, index) => ({
    ...option,
    label: option.label.trim() || `选项 ${index + 1}`,
    value: typeof option.value === "string" ? option.value.trim() || `option-${index + 1}` : option.value
  })));
  const addOption = () => {
    let suffix = options.length + 1;
    while (options.some((option) => String(option.value) === `option-${suffix}`)) suffix += 1;
    commit([...options, { label: `选项 ${suffix}`, value: `option-${suffix}` }]);
  };
  const moveOption = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= options.length) return;
    const next = [...options];
    [next[index], next[target]] = [next[target]!, next[index]!];
    commit(next);
  };

  return <div className="option-editor">
    <div className="option-editor-head"><span>显示文字</span><span>选项值</span><i>状态 / 排序</i></div>
    <div className="option-editor-list">
      {options.map((option, index) => <div className={`option-editor-row ${duplicateValues.has(String(option.value)) ? "has-error" : ""}`} key={index}>
        <input aria-label={`选项 ${index + 1} 显示文字`} value={option.label} onChange={(event) => updateDraft(index, { label: event.target.value })} onBlur={commitDraft} />
        <input aria-label={`选项 ${index + 1} 选项值`} value={String(option.value)} onChange={(event) => updateDraft(index, { value: event.target.value })} onBlur={commitDraft} />
        <button type="button" className={option.disabled ? "is-disabled" : ""} aria-label={`${option.disabled ? "启用" : "禁用"}选项 ${index + 1}`} title={option.disabled ? "当前禁用，点击启用" : "点击禁用"} onClick={() => commit(options.map((item, optionIndex) => optionIndex === index ? { ...item, disabled: !item.disabled } : item))}><i /></button>
        <button type="button" aria-label={`上移选项 ${index + 1}`} disabled={index === 0} onClick={() => moveOption(index, -1)}><ArrowUp size={11} /></button>
        <button type="button" aria-label={`下移选项 ${index + 1}`} disabled={index === options.length - 1} onClick={() => moveOption(index, 1)}><ArrowDown size={11} /></button>
        <button type="button" className="is-danger" aria-label={`删除选项 ${index + 1}`} onClick={() => commit(options.filter((_, optionIndex) => optionIndex !== index))}><Trash2 size={11} /></button>
      </div>)}
    </div>
    {duplicateValues.size ? <div className="option-editor-error">选项值不能重复，请修改后再离开输入框。</div> : null}
    {!options.length ? <div className="option-editor-empty">暂无选项，添加后可在原型中选择。</div> : null}
    <button type="button" className="option-editor-add" onClick={addOption}><Plus size={12} />添加选项</button>
  </div>;
}

export function App() {
  const initialPages = useMemo(() => (isDesktopRuntime() ? [] : [structuredClone(caseListExample)]), []);
  const [pages, setPages] = useState<PageDSL[]>(initialPages);
  const [currentPageId, setCurrentPageId] = useState<string | null>(initialPages[0]?.page.id ?? null);
  const pagesRef = useRef<PageDSL[]>(initialPages);
  const currentPageIdRef = useRef<string | null>(initialPages[0]?.page.id ?? null);
  const pageCommandQueuesRef = useRef<Map<string, Promise<boolean>>>(new Map());
  const [selectedId, setSelectedId] = useState<string>(initialPages[0] ? "search.status" : "");
  const [history, setHistory] = useState<RevisionRecord[]>([]);
  const [redoStack, setRedoStack] = useState<RevisionRecord[]>([]);
  const [boardUndoStack, setBoardUndoStack] = useState<BoardDSL[]>([]);
  const [boardRedoStack, setBoardRedoStack] = useState<BoardDSL[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [projectVersions, setProjectVersions] = useState<Array<{ id: string; label: string; createdAt: string }>>([]);
  const [newVersionLabel, setNewVersionLabel] = useState("");
  const [versionBusy, setVersionBusy] = useState(false);
  const [showDsl, setShowDsl] = useState(false);
  const [previewScale, setPreviewScale] = useState(82);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [previewReady, setPreviewReady] = useState(false);
  const [activeWorkspace, setActiveWorkspace] = useState<"pages" | "boards">("pages");
  const [projectName, setProjectName] = useState(() => (isDesktopRuntime() ? "未打开项目" : "案件中台"));
  const [projectRoot, setProjectRoot] = useState<string>();
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [showPageCreator, setShowPageCreator] = useState(false);
  const [newPageTitle, setNewPageTitle] = useState("");
  const [newPageType, setNewPageType] = useState<CreatablePageType>("list");
  const [openPageMenuId, setOpenPageMenuId] = useState<string>();
  const [mcpState, setMcpState] = useState<"stopped" | "running" | "unavailable">("stopped");
  const [showSettings, setShowSettings] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"account" | "connection" | "local">("account");
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishLinks, setPublishLinks] = useState<Array<{ token: string; url: string; expiresAt?: string; createdAt: string }>>([]);
  const [publishExpiry, setPublishExpiry] = useState("30");
  const [publishBusy, setPublishBusy] = useState(false);
  const [boardAiText, setBoardAiText] = useState("");
  const [aiSelectMode, setAiSelectMode] = useState(false);
  const [boardAiBarIds, setBoardAiBarIds] = useState<string[]>([]);
  const [boardAiBarPos, setBoardAiBarPos] = useState<{ x: number; y: number } | null>(null);
  const [pageAiSelectedIds, setPageAiSelectedIds] = useState<string[]>([]);
  const [pageAiBarPos, setPageAiBarPos] = useState<{ x: number; y: number } | null>(null);
  const [pageAiText, setPageAiText] = useState("");
  const [mcpConnection, setMcpConnection] = useState<DesktopMcpConnectionInfo>();
  const [appModal, setAppModal] = useState<AppModal>();
  const [modalValue, setModalValue] = useState("");
  const [board, setBoard] = useState<BoardDSL>(() => defaultBoardFromPages([]));
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [trashedBoards, setTrashedBoards] = useState<TrashedBoardSummary[]>([]);
  const [currentBoardId, setCurrentBoardId] = useState("main");
  const currentBoardIdRef = useRef("main");
  const [showBoardCreator, setShowBoardCreator] = useState(false);
  const [newBoardName, setNewBoardName] = useState("");
  const [newBoardPageIds, setNewBoardPageIds] = useState<string[]>([]);
  const [openBoardMenuId, setOpenBoardMenuId] = useState<string>();
  const [viewMode, setViewMode] = useState<"canvas" | "page">("page");
  const [boardSelectedId, setBoardSelectedId] = useState<string>();
  const [boardSelectedIds, setBoardSelectedIds] = useState<string[]>([]);
  const [boardSelectedLinkId, setBoardSelectedLinkId] = useState<string>();
  const [diagramEditor, setDiagramEditor] = useState<{ boardId: string; objectId: string; baseRevision: number }>();
  const [boardZoom, setBoardZoom] = useState(1);
  const [boardSnap, setBoardSnap] = useState(false);
  const [boardExportOpen, setBoardExportOpen] = useState(false);
  const [boardMoreOpen, setBoardMoreOpen] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(() => typeof localStorage !== "undefined" && localStorage.getItem("ps_panel_left") === "1");
  const [rightCollapsed, setRightCollapsed] = useState(() => typeof localStorage !== "undefined" && localStorage.getItem("ps_panel_right") === "1");
  const boardViewRef = useRef<BoardRendererHandle>(null);
  const boardCacheRef = useRef<Map<string, BoardDSL>>(new Map([[board.id, board]]));
  const boardQueueRefs = useRef<Map<string, Promise<boolean>>>(new Map());
  const boardQueueBaseRefs = useRef<Map<string, number>>(new Map());
  const [boardTool, setBoardTool] = useState<"none" | "page" | "marker">("none");
  const [markerPicking, setMarkerPicking] = useState(false);
  const [markerDraft, setMarkerDraft] = useState<MarkerDraft>({ pageObjectId: "", componentId: "", number: "", text: "", tone: "orange" });
  const [boardDraft, setBoardDraft] = useState<Record<string, unknown>>({});
  const boardSeedDone = useRef(false);
  const [webSession, setWebSession] = useState<WebUser>();
  const [webProjectId, setWebProjectId] = useState<string>();
  const [webBoot, setWebBoot] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const currentPage = useMemo(() => pages.find((page) => page.page.id === currentPageId), [currentPageId, pages]);
  const dsl = currentPage ?? EMPTY_PAGE;
  const setDsl = useCallback((next: PageDSL | ((previous: PageDSL) => PageDSL)) => {
    setPages((items) => items.map((page) => {
      if (page.page.id !== currentPageId) return page;
      return typeof next === "function" ? next(page) : next;
    }));
  }, [currentPageId]);

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  useEffect(() => {
    currentPageIdRef.current = currentPageId;
  }, [currentPageId]);

  const selectedLocation = useMemo(() => selectedId ? getComponentLocation(dsl, selectedId) : undefined, [dsl, selectedId]);
  const selected = selectedLocation?.component;

  const toast = useCallback((tone: ToastTone, title: string, detail?: string) => {
    const id = Date.now();
    setToasts((items) => [...items.slice(-2), { id, tone, title, detail }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 3300);
  }, []);

  const loadWebProject = useCallback(async (projectId: string) => {
    try {
      const tree = await webSpace.tree(projectId);
      const loadedPages: PageDSL[] = [];
      for (const summary of tree.pages) {
        loadedPages.push((await webSpace.getPage(projectId, summary.id)).dsl);
      }
      const requestedBoardId = new URLSearchParams(window.location.search).get("board");
      const requestedPageId = new URLSearchParams(window.location.search).get("page");
      const selectedBoardId = tree.boards.some((item) => item.id === requestedBoardId)
        ? requestedBoardId!
        : tree.manifest.defaultBoardId ?? tree.board.id;
      const selectedBoard = selectedBoardId === tree.board.id ? tree.board : (await webSpace.board(projectId, selectedBoardId)).board;
      setPages(loadedPages);
      setBoards(tree.boards);
      setTrashedBoards((await webSpace.trashedBoards(projectId)).boards);
      setCurrentBoardId(selectedBoardId);
      setBoard(selectedBoard);
      boardCacheRef.current = new Map([[selectedBoardId, selectedBoard]]);
      setProjectName(tree.manifest.name);
      setProjectRoot(`web://${projectId}`);
      setCurrentPageId(loadedPages.some((page) => page.page.id === requestedPageId) ? requestedPageId : loadedPages[0]?.page.id ?? null);
      setSelectedId("");
      setHistory([]);
      setRedoStack([]);
      setViewMode(requestedPageId && loadedPages.some((page) => page.page.id === requestedPageId) ? "page" : "canvas");
      setActiveWorkspace(requestedPageId ? "pages" : "boards");
      setWebProjectId(projectId);
    } catch (error) {
      toast("danger", "无法打开项目", error instanceof Error ? error.message : "未知错误");
    }
  }, [toast]);

  const refreshVersions = useCallback(async () => {
    if (!webMode || !webProjectId) return;
    try {
      const result = await webSpace.versionList(webProjectId);
      setProjectVersions(result.versions);
    } catch { /* 忽略版本列表加载失败 */ }
  }, [webProjectId]);

  const saveNewVersion = async () => {
    const label = newVersionLabel.trim();
    if (!label) {
      toast("warning", "请输入版本编号", "例如 v1.2、评审版、发布版。");
      return;
    }
    if (!webMode || !webProjectId) {
      toast("warning", "版本管理仅网页端可用");
      return;
    }
    setVersionBusy(true);
    try {
      await webSpace.versionSave(webProjectId, label);
      setNewVersionLabel("");
      await refreshVersions();
      toast("success", "版本已保存", label);
    } catch (error) {
      toast("danger", "保存版本失败", error instanceof Error ? error.message : "未知错误");
    } finally {
      setVersionBusy(false);
    }
  };

  const restoreVersion = async (versionId: string, label: string) => {
    if (!webMode || !webProjectId) return;
    setVersionBusy(true);
    try {
      await webSpace.versionRestore(webProjectId, versionId);
      await loadWebProject(webProjectId);
      await refreshVersions();
      setShowVersions(true);
      toast("success", "已切换到版本", `${label} · 编辑后会自动生成新的当前版本`);
    } catch (error) {
      toast("danger", "切换版本失败", error instanceof Error ? error.message : "未知错误");
    } finally {
      setVersionBusy(false);
    }
  };

  const handleLogout = async () => {
    if (!webMode) return;
    await webAuth.logout();
    setWebSession(undefined);
    setWebProjectId(undefined);
    setPages([]);
    setBoard(defaultBoardFromPages([]));
    setShowSettings(false);
  };

  const [projectMenuProjects, setProjectMenuProjects] = useState<WebProject[]>([]);
  const [webOpenFailed, setWebOpenFailed] = useState(false);
  const projectImportRef = useRef<HTMLInputElement>(null);

  const openLatestOrCreate = useCallback(async (): Promise<void> => {
    const listed = await webProjects.list();
    const latest = [...listed.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (latest) {
      await loadWebProject(latest.id);
      return;
    }
    const created = await webProjects.create("我的项目");
    await loadWebProject(created.project.id);
  }, [loadWebProject]);

  const refreshProjectMenu = useCallback(async () => {
    try {
      const listed = await webProjects.list();
      setProjectMenuProjects([...listed.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    } catch { /* 忽略项目列表加载失败 */ }
  }, []);

  const createProjectFromMenu = () => {
    askText({
      title: "新建项目",
      label: "项目名称",
      defaultValue: "",
      confirmText: "创建",
      onConfirm: async (name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        setShowProjectMenu(false);
        try {
          const result = await webProjects.create(trimmed);
          await loadWebProject(result.project.id);
        } catch (error) {
          toast("danger", "创建项目失败", error instanceof Error ? error.message : "未知错误");
        }
      }
    });
  };

  const importProjectFromMenu = async (file: File) => {
    setShowProjectMenu(false);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(new Error("读取文件失败"));
        reader.readAsDataURL(file);
      });
      const result = await webProjects.import(file.name.replace(/\.zip$/i, ""), base64);
      await loadWebProject(result.project.id);
    } catch (error) {
      toast("danger", "导入失败", error instanceof Error ? error.message : "未知错误");
    }
  };

  const handleAuthenticated = useCallback(async (user: WebUser) => {
    setWebSession(user);
    try {
      setWebOpenFailed(false);
      await openLatestOrCreate();
    } catch {
      setWebOpenFailed(true);
      toast("danger", "打开项目失败", "请重试");
    }
  }, [openLatestOrCreate, toast]);

  const copyText = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    toast("success", "已复制", "粘贴到 Codex 设置或对话即可");
  }, [toast]);

  const buildAiInstruction = useCallback((kind: "component" | "page" | "board", targets: string[] = [], request = ""): string => {
    const head = ["【Prototype Studio 修改指令】", `项目：${projectName}`];
    if (kind === "component" && selected) {
      const details: string[] = [];
      if (selected.label ?? selected.title ?? selected.text) details.push(`标题/文本：${selected.label ?? selected.title ?? selected.text}`);
      if (selected.placeholder) details.push(`占位：${selected.placeholder}`);
      if (selected.options?.length) details.push(`选项：${selected.options.map((option) => option.label ?? option.value).join(" / ")}`);
      return [
        ...head,
        `页面：${dsl.page.id}`,
        `对象：组件 ${selected.id}`,
        `路径：${selectedLocation?.path ?? "未知"}`,
        `类型：${selected.type}`,
        ...(details.length ? ["当前内容：", ...details] : []),
        "",
        `需求：${request || "（在这里说明你想怎么修改）"}`,
        "",
        "请调用 prototype_get_page 读取页面后，用 prototype_apply_commands 精确修改该组件。"
      ].join("\n");
    }
    if (kind === "page") {
      return [
        ...head,
        `页面：${dsl.page.id}（${dsl.page.title}）`,
        ...(targets.length ? [`对象：${targets.map((id) => `组件 ${id}`).join("、")}`] : []),
        "",
        `需求：${request || "（在这里说明你想怎么修改这个页面）"}`,
        "",
        "请调用 prototype_get_page 读取页面后，用 prototype_apply_commands 精确修改。"
      ].join("\n");
    }
    return [
      ...head,
      `画布：${board.id}（${board.name}）`,
      targets.length ? `对象：${targets.join("、")}` : "对象：整个画布",
      "",
      `需求：${request || "（在这里说明你想怎么修改，例如：把选中的页面右移并加连线）"}`,
      "",
      "请调用 prototype_get_board 读取画布后，用 prototype_apply_board_commands 精确修改这些对象。"
    ].join("\n");
  }, [board, dsl.page.id, dsl.page.title, projectName, selected, selectedLocation]);


  const askText = useCallback((modal: { title: string; label: string; defaultValue: string; confirmText: string; onConfirm: (value: string) => void }) => {
    setModalValue(modal.defaultValue);
    setAppModal({ kind: "prompt", title: modal.title, label: modal.label, confirmText: modal.confirmText, onConfirm: modal.onConfirm });
  }, []);

  const askConfirm = useCallback((modal: { title: string; message: string; confirmText: string; danger?: boolean; onConfirm: () => void }) => {
    setAppModal({ kind: "confirm", title: modal.title, message: modal.message, confirmText: modal.confirmText, danger: modal.danger, onConfirm: modal.onConfirm });
  }, []);

  const confirmModal = useCallback(() => {
    if (!appModal) return;
    if (appModal.kind === "prompt") appModal.onConfirm(modalValue);
    else appModal.onConfirm();
    setAppModal(undefined);
  }, [appModal, modalValue]);

  const refreshMcpConnection = useCallback(async () => {
    if (!isDesktopRuntime()) return;
    try {
      setMcpConnection(await getLocalMcpConnectionInfo());
    } catch {
      setMcpConnection(undefined);
    }
  }, []);

  const sendPreview = useCallback((message: unknown) => {
    iframeRef.current?.contentWindow?.postMessage(message, window.location.origin);
  }, []);

  const toggleAiSelect = useCallback((enabled: boolean) => {
    setAiSelectMode(enabled);
    if (enabled) {
      setPageAiSelectedIds([]);
      setPageAiText("");
      setBoardAiText("");
      setBoardAiBarIds([]);
      setBoardAiBarPos(null);
      setPageAiBarPos(null);
      setBoardSelectedId(undefined);
      setBoardSelectedIds([]);
      sendPreview({ type: "prototype:ai-select", enabled: true });
    } else {
      setPageAiSelectedIds([]);
      setPageAiText("");
      setBoardAiText("");
      setBoardAiBarIds([]);
      setBoardAiBarPos(null);
      setPageAiBarPos(null);
      sendPreview({ type: "prototype:ai-select", enabled: false });
    }
  }, [sendPreview]);

  /** 弹窗靠近鼠标位置显示，超出视口时自动收拢。 */
  const aiBarStyle = (pos: { x: number; y: number } | null): CSSProperties | undefined => {
    if (!pos) return undefined;
    const width = 560;
    const estHeight = 340;
    const gap = 14;
    const margin = 8;
    let left = pos.x + gap;
    let top = pos.y + gap;
    // 靠近右 / 下边缘时翻转到鼠标另一侧，避免弹窗超出视口
    if (left + width > window.innerWidth - margin) left = pos.x - width - gap;
    if (top + estHeight > window.innerHeight - margin) top = pos.y - estHeight - gap;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    top = Math.max(margin, Math.min(top, window.innerHeight - estHeight - margin));
    return {
      position: "fixed",
      left,
      top,
      zIndex: 320,
      margin: 0,
      transform: "none",
      width: `min(${width}px, calc(100vw - ${margin * 2}px))`,
      maxHeight: `calc(100vh - ${margin * 2}px)`,
      overflowY: "auto",
      boxSizing: "border-box"
    };
  };

  const persistDesktopPage = useCallback(async (page: PageDSL, revision?: RevisionRecord) => {
    if (!projectRoot || !isDesktopRuntime()) return;
    if (revision) {
      await persistDesktopPageRevision(page.page.id, stringifyYaml(page, { lineWidth: 0 }), revision);
    } else {
      await writeDesktopPage(page.page.id, stringifyYaml(page, { lineWidth: 0 }));
    }
  }, [projectRoot]);

  const loadDesktopSnapshot = useCallback(async (snapshot: DesktopProjectSnapshot) => {
    setProjectName(snapshot.manifest.name);
    setProjectRoot(snapshot.root);
    const loadedPages = await Promise.all(snapshot.pageIds.map(async (pageId) => {
      const document = await readDesktopPage(pageId);
      const nextDsl = parseYaml(document.content) as PageDSL;
      const validation = validateDSL(nextDsl);
      if (!validation.valid) throw new Error(`${pageId}: ${validation.errors[0]?.message ?? "页面 DSL 未通过校验"}`);
      return nextDsl;
    }));
    setPages(loadedPages);
    if (isDesktopRuntime()) {
      try {
        const boardText = await readDesktopBoard();
        const nextBoard = parseYaml(boardText) as BoardDSL;
        if (nextBoard && Array.isArray(nextBoard.objects)) {
          setBoard(nextBoard);
          setCurrentBoardId(nextBoard.id);
          setBoards([{ id: nextBoard.id, name: nextBoard.name || "主画布", description: nextBoard.description, revision: nextBoard.revision, pageCount: nextBoard.objects.filter((object) => object.type === "page").length, objectCount: nextBoard.objects.length, createdAt: nextBoard.createdAt, updatedAt: nextBoard.updatedAt, isDefault: true }]);
          boardCacheRef.current = new Map([[nextBoard.id, nextBoard]]);
        }
      } catch {
        const nextBoard = defaultBoardFromPages(loadedPages);
        setBoard(nextBoard);
        setBoards([{ id: nextBoard.id, name: nextBoard.name, revision: nextBoard.revision, pageCount: loadedPages.length, objectCount: nextBoard.objects.length, createdAt: nextBoard.createdAt, updatedAt: nextBoard.updatedAt, isDefault: true }]);
      }
    } else {
      setBoard(defaultBoardFromPages(loadedPages));
    }
    setCurrentPageId(loadedPages[0]?.page.id ?? null);
    setSelectedId("");
    setHistory([]);
    setRedoStack([]);
    setPreviewReady(false);
    setViewMode("canvas");
    setActiveWorkspace("boards");
    await startProjectWatcher();
    void startLocalMcp().then((status) => setMcpState(status.state)).catch(() => setMcpState("unavailable"));
  }, [toast]);

  const openLocalProject = useCallback(async () => {
    setShowProjectMenu(false);
    if (!isDesktopRuntime()) {
      toast("info", "桌面模式功能", "浏览器预览使用仓库内 examples/case-management；桌面 App 可选择任意本地目录。 ");
      return;
    }
    try {
      const snapshot = await selectProjectFolder();
      if (snapshot) await loadDesktopSnapshot(snapshot);
    } catch (error) {
      toast("danger", "无法打开项目", error instanceof Error ? error.message : "所选目录不是有效项目");
    }
  }, [loadDesktopSnapshot, toast]);

  const createLocalProject = useCallback(async () => {
    setShowProjectMenu(false);
    if (!isDesktopRuntime()) {
      toast("info", "请在桌面 App 中创建", "Web 模式不会请求任意文件系统权限。 ");
      return;
    }
    askText({
      title: "创建新项目",
      label: "项目名称",
      defaultValue: "新原型项目",
      confirmText: "下一步",
      onConfirm: async (name) => {
        if (!name.trim()) {
          toast("warning", "请输入项目名称");
          return;
        }
        try {
          const snapshot = await createDesktopProject(name.trim(), "由 Prototype Studio 创建");
          if (!snapshot) return;
          await loadDesktopSnapshot(snapshot);
          const homePage = createMinimalPage("home", "首页", "list");
          await createDesktopPage(homePage.page.id, stringifyYaml(homePage, { lineWidth: 0 }));
          setPages([homePage]);
          setCurrentPageId(homePage.page.id);
          const homeBoard: BoardDSL = {
            dslVersion: DSL_VERSION,
            id: "main",
            projectId: snapshot.manifest.id,
            name: "主画布",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            revision: 1,
            objects: [{ id: "obj-home", type: "page", pageId: "home", x: 120, y: 80, width: 960, height: 640, source: "default" }],
            links: []
          };
          setBoard(homeBoard);
          setBoards([{ id: "main", name: "主画布", revision: 1, pageCount: 1, objectCount: 1, createdAt: homeBoard.createdAt, updatedAt: homeBoard.updatedAt, isDefault: true }]);
          setCurrentBoardId("main");
          boardCacheRef.current = new Map([["main", homeBoard]]);
          await writeDesktopBoard(stringifyYaml(homeBoard, { lineWidth: 0 }));
          setProjectRoot(snapshot.root);
          toast("success", "项目已创建", "已写入标准目录结构和示例页面");
        } catch (error) {
          toast("danger", "无法创建项目", error instanceof Error ? error.message : "请选择其他保存目录");
        }
      }
    });
  }, [askText, loadDesktopSnapshot, toast]);

  const launchMcp = useCallback(async () => {
    setShowProjectMenu(false);
    if (!isDesktopRuntime() || !projectRoot) {
      toast("warning", "需要已打开的桌面项目", "Local MCP 只在桌面 App 中由当前 Project Root 启动。 ");
      return;
    }
    try {
      const status = await startLocalMcp();
      setMcpState(status.state);
      void refreshMcpConnection();
      toast(status.state === "running" ? "success" : "warning", status.state === "running" ? "Local MCP 已启动" : "Local MCP 暂不可用", status.detail);
    } catch (error) {
      setMcpState("unavailable");
      toast("danger", "Local MCP 启动失败", error instanceof Error ? error.message : "请检查 sidecar 资源");
    }
  }, [projectRoot, refreshMcpConnection, toast]);

  const selectPage = useCallback((pageId: string) => {
    setActiveWorkspace("pages");
    setViewMode("page");
    if (pageId === currentPageId) return;
    setCurrentPageId(pageId);
    setSelectedId("");
    setHistory([]);
    setRedoStack([]);
    setShowVersions(false);
    setShowDsl(false);
    setOpenPageMenuId(undefined);
    setPreviewReady(false);
  }, [currentPageId]);

  const refreshBoards = useCallback(async () => {
    if (!webProjectId) return;
    const [active, trashed] = await Promise.all([webSpace.boards(webProjectId), webSpace.trashedBoards(webProjectId)]);
    setBoards(active.boards);
    setTrashedBoards(trashed.boards);
  }, [webProjectId]);

  const selectBoard = useCallback(async (boardId: string) => {
    currentBoardIdRef.current = boardId;
    setActiveWorkspace("boards");
    setViewMode("canvas");
    setOpenBoardMenuId(undefined);
    setBoardSelectedId(undefined);
    setBoardSelectedIds([]);
    setBoardSelectedLinkId(undefined);
    setBoardUndoStack([]);
    setBoardRedoStack([]);
    try {
      const cached = boardCacheRef.current.get(boardId);
      const next = cached ?? (webProjectId ? (await webSpace.board(webProjectId, boardId)).board : board);
      boardCacheRef.current.set(boardId, next);
      setCurrentBoardId(boardId);
      setBoard(next);
    } catch (error) {
      toast("danger", "无法打开画布", error instanceof Error ? error.message : "未知错误");
    }
  }, [board, toast, webProjectId]);

  const createNewBoard = useCallback(async () => {
    const name = newBoardName.trim();
    if (!name) {
      toast("warning", "请输入画布名称");
      return;
    }
    if (!webProjectId) {
      toast("warning", "桌面端多画布尚未连接", "请先使用当前网页端项目创建画布。");
      return;
    }
    try {
      const result = await webSpace.createBoard(webProjectId, { name, pageIds: newBoardPageIds });
      boardCacheRef.current.set(result.board.id, result.board);
      setShowBoardCreator(false);
      setNewBoardName("");
      setNewBoardPageIds([]);
      await refreshBoards();
      await selectBoard(result.board.id);
      toast("success", "画布已创建", `${name} · ${newBoardPageIds.length} 个页面`);
    } catch (error) {
      toast("danger", "无法创建画布", error instanceof Error ? error.message : "未知错误");
    }
  }, [newBoardName, newBoardPageIds, refreshBoards, selectBoard, toast, webProjectId]);

  const renameBoard = useCallback((summary: BoardSummary) => {
    setOpenBoardMenuId(undefined);
    askText({
      title: "重命名画布",
      label: "画布名称",
      defaultValue: summary.name,
      confirmText: "保存",
      onConfirm: async (name) => {
        if (!webProjectId || !name.trim()) return;
        try {
          const result = await webSpace.updateBoard(webProjectId, summary.id, { name: name.trim() });
          boardCacheRef.current.set(summary.id, result.board);
          if (summary.id === currentBoardId) setBoard(result.board);
          await refreshBoards();
        } catch (error) { toast("danger", "重命名失败", error instanceof Error ? error.message : "未知错误"); }
      }
    });
  }, [askText, currentBoardId, refreshBoards, toast, webProjectId]);

  const editBoardDescription = useCallback((summary: BoardSummary) => {
    setOpenBoardMenuId(undefined);
    askText({
      title: "修改画布说明",
      label: "画布说明",
      defaultValue: summary.description ?? "",
      confirmText: "保存",
      onConfirm: async (description) => {
        if (!webProjectId) return;
        try {
          const result = await webSpace.updateBoard(webProjectId, summary.id, { description });
          boardCacheRef.current.set(summary.id, result.board);
          if (summary.id === currentBoardId) setBoard(result.board);
          await refreshBoards();
        } catch (error) { toast("danger", "修改说明失败", error instanceof Error ? error.message : "未知错误"); }
      }
    });
  }, [askText, currentBoardId, refreshBoards, toast, webProjectId]);

  const makeDefaultBoard = useCallback(async (summary: BoardSummary) => {
    if (!webProjectId || summary.isDefault) return;
    try {
      await webSpace.updateBoard(webProjectId, summary.id, { isDefault: true });
      await refreshBoards();
      toast("success", "已设为默认画布", summary.name);
    } catch (error) { toast("danger", "设置失败", error instanceof Error ? error.message : "未知错误"); }
  }, [refreshBoards, toast, webProjectId]);

  const trashBoard = useCallback((summary: BoardSummary) => {
    setOpenBoardMenuId(undefined);
    askConfirm({
      title: "移入画布回收站",
      message: `确定移除“${summary.name}”吗？共享页面不会被删除。`,
      confirmText: "移入回收站",
      danger: true,
      onConfirm: async () => {
        if (!webProjectId) return;
        try {
          const result = await webSpace.deleteBoard(webProjectId, summary.id);
          boardCacheRef.current.delete(summary.id);
          await refreshBoards();
          if (summary.id === currentBoardId) await selectBoard(result.defaultBoardId);
          toast("success", "画布已移入回收站", summary.name);
        } catch (error) { toast("danger", "无法删除画布", error instanceof Error ? error.message : "未知错误"); }
      }
    });
  }, [askConfirm, currentBoardId, refreshBoards, selectBoard, toast, webProjectId]);

  const restoreTrashedBoard = useCallback(async (summary: TrashedBoardSummary) => {
    if (!webProjectId) return;
    try {
      const result = await webSpace.restoreBoard(webProjectId, summary.trashId);
      boardCacheRef.current.set(result.board.id, result.board);
      await refreshBoards();
      toast("success", "画布已恢复", result.board.name);
    } catch (error) {
      toast("danger", "恢复失败", error instanceof Error ? error.message : "未知错误");
    }
  }, [refreshBoards, toast, webProjectId]);

  const addPage = useCallback(async () => {
    const title = newPageTitle.trim();
    if (!title) {
      toast("warning", "请输入页面名称");
      return;
    }
    const page = createMinimalPage(pageSlug(title, pages.map((item) => item.page.id)), title, newPageType);
    const validation = validateDSL(page);
    if (!validation.valid) {
      toast("danger", "新页面未通过校验", validation.errors[0]?.message);
      return;
    }
    try {
      if (webMode && webProjectId) {
        await webSpace.createPage(webProjectId, page);
      } else if (projectRoot && isDesktopRuntime()) {
        await createDesktopPage(page.page.id, stringifyYaml(page, { lineWidth: 0 }));
      }
      setPages((items) => [...items, page]);
      setCurrentPageId(page.page.id);
      setSelectedId("");
      setHistory([]);
      setRedoStack([]);
      setNewPageTitle("");
      setShowPageCreator(false);
      setPreviewReady(false);
      toast("success", "页面已创建", `${title} · ${newPageType.toUpperCase()}`);
    } catch (error) {
      toast("danger", "无法创建页面", error instanceof Error ? error.message : "本地页面写入失败");
    }
  }, [newPageTitle, newPageType, pages, projectRoot, toast, webProjectId]);

  const renamePage = useCallback((pageId: string) => {
    const page = pages.find((item) => item.page.id === pageId);
    if (!page) return;
    setOpenPageMenuId(undefined);
    askText({
      title: "重命名页面",
      label: "页面名称",
      defaultValue: page.page.title,
      confirmText: "保存",
      onConfirm: async (title) => {
        const trimmed = title.trim();
        if (!trimmed || trimmed === page.page.title) return;
        const renamed: PageDSL = { ...page, revision: page.revision + 1, page: { ...page.page, title: trimmed } };
        try {
          if (webMode && webProjectId) {
            await webSpace.putPage(webProjectId, pageId, renamed, page.revision, "manual", "jojo");
          } else if (projectRoot && isDesktopRuntime()) {
            await renameDesktopPage(pageId, trimmed);
          }
          setPages((items) => items.map((item) => item.page.id === pageId ? renamed : item));
          toast("success", "页面已重命名", `${page.page.title} → ${trimmed}`);
        } catch (error) {
          toast("danger", "无法重命名页面", error instanceof Error ? error.message : "本地文件更新失败");
        }
      }
    });
  }, [askText, pages, projectRoot, toast, webProjectId]);

  const deletePage = useCallback((pageId: string) => {
    const index = pages.findIndex((item) => item.page.id === pageId);
    const page = pages[index];
    if (!page) return;
    setOpenPageMenuId(undefined);
    askConfirm({
      title: "删除页面",
      message: `删除页面「${page.page.title}」？桌面项目会将文件移入 .prototype/trash，不会永久删除。`,
      confirmText: "确认删除",
      danger: true,
      onConfirm: async () => {
        try {
          if (webMode && webProjectId) {
            await webSpace.deletePage(webProjectId, pageId);
          } else if (projectRoot && isDesktopRuntime()) {
            await trashDesktopPage(pageId);
          }
          const remaining = pages.filter((item) => item.page.id !== pageId);
          setPages(remaining);
          if (currentPageId === pageId) {
            setCurrentPageId(remaining[Math.min(index, remaining.length - 1)]?.page.id ?? null);
            setSelectedId("");
            setHistory([]);
            setRedoStack([]);
            setPreviewReady(false);
          }
          toast("success", "页面已删除", projectRoot ? "页面文件已移入可恢复的项目回收站" : "已从当前示例项目移除");
        } catch (error) {
          toast("danger", "无法删除页面", error instanceof Error ? error.message : "移入回收站失败");
        }
      }
    });
  }, [askConfirm, currentPageId, pages, projectRoot, toast, webProjectId]);

  const movePage = useCallback(async (pageId: string, targetIndex: number) => {
    const fromIndex = pages.findIndex((item) => item.page.id === pageId);
    const boundedIndex = Math.max(0, Math.min(targetIndex, pages.length - 1));
    if (fromIndex < 0 || fromIndex === boundedIndex) return;
    const reordered = [...pages];
    const [moved] = reordered.splice(fromIndex, 1);
    if (!moved) return;
    reordered.splice(boundedIndex, 0, moved);
    try {
      if (projectRoot && isDesktopRuntime()) await reorderDesktopPages(reordered.map((item) => item.page.id));
      setPages(reordered);
      setOpenPageMenuId(undefined);
      toast("info", "页面顺序已更新", `${moved.page.title} · 第 ${boundedIndex + 1} 位`);
    } catch (error) {
      toast("danger", "无法更新页面顺序", error instanceof Error ? error.message : "项目顺序写入失败");
    }
  }, [pages, projectRoot, toast]);

  useEffect(() => {
    if (previewReady) sendPreview({ type: "prototype:dsl", dsl });
  }, [dsl, previewReady, sendPreview]);

  useEffect(() => {
    if (previewReady) sendPreview({ type: "prototype:selected", componentId: selectedId });
  }, [selectedId, previewReady, sendPreview]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const fromPreview = event.source === null || event.source === iframeRef.current?.contentWindow;
      if (!fromPreview) return;
      if (event.data?.type === "preview:ready") setPreviewReady(true);
      if (event.data?.type === "component:selected") setSelectedId(event.data.componentId);
      if (event.data?.type === "components:selected") {
        setPageAiSelectedIds(event.data.componentIds ?? []);
        setPageAiBarPos(event.data.point ?? null);
      }
      if (event.data?.type === "runtime:event" && event.data.payload?.type !== "select") {
        if (event.data.payload?.type === "validation-error") toast("warning", "原型校验已触发", "请在 Preview 中补齐必填字段");
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [toast]);

  useEffect(() => {
    if (!projectRoot || !isDesktopRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenForProjectFiles(async (event) => {
      if (disposed || !event.relativePath.startsWith("pages/") || !event.relativePath.endsWith(".ui.yaml")) return;
      const pageId = event.relativePath.slice("pages/".length, -".ui.yaml".length);
      if (event.kind === "unlink") {
        setPages((items) => items.filter((item) => item.page.id !== pageId));
        if (pageId === currentPageId) {
          setCurrentPageId((activeId) => activeId === pageId ? null : activeId);
          setSelectedId("");
        }
        return;
      }
      try {
        const document = await readDesktopPage(pageId);
        const externalDsl = parseYaml(document.content) as PageDSL;
        const validation = validateDSL(externalDsl);
        if (!validation.valid) {
          toast("warning", "外部 DSL 未生效", validation.errors[0]?.message ?? "已保留最后一个有效 Preview");
          return;
        }
        setPages((items) => items.some((item) => item.page.id === pageId)
          ? items.map((item) => item.page.id === pageId ? externalDsl : item)
          : [...items, externalDsl]);
        toast("info", "检测到外部文件变化", `${event.relativePath} 已重新校验并刷新`);
      } catch (error) {
        toast("warning", "外部文件读取失败", error instanceof Error ? error.message : "已保留最后一个有效 Preview");
      }
    }).then((dispose) => { if (disposed) dispose(); else unlisten = dispose; });
    return () => {
      disposed = true;
      unlisten?.();
      void stopProjectWatcher();
    };
  }, [currentPageId, projectRoot, toast]);

  useEffect(() => {
    if (isDesktopRuntime() || webMode || boardSeedDone.current) return;
    boardSeedDone.current = true;
    if (pages.length) setBoard(defaultBoardFromPages(pages));
  }, [pages]);

  useEffect(() => {
    const link = board.links.find((item) => item.id === boardSelectedLinkId);
    if (link) {
      setBoardDraft({
        label: link.label ?? "",
        labelSize: link.labelSize ?? 10,
        labelColor: link.labelColor ?? "#1f2937",
        lineType: link.lineType ?? "curve",
        strokeWidth: link.strokeWidth ?? 2.5,
        color: link.color ?? "#2563eb"
      });
      return;
    }
    const object = board.objects.find((item) => item.id === boardSelectedId);
    if (!object) { setBoardDraft({}); return; }
    if (object.type === "note" || object.type === "marker") setBoardDraft({ text: object.text });
    else setBoardDraft({ x: object.x, y: object.y, width: object.width, height: object.height });
  }, [board.links, board.objects, boardSelectedId, boardSelectedLinkId]);

  const runCommands = useCallback((commands: Command[], source: RevisionRecord["source"] = "manual"): Promise<boolean> => {
    const pageId = currentPageIdRef.current;
    if (!pageId) {
      toast("danger", "修改未执行", "当前没有可编辑页面");
      return Promise.resolve(false);
    }

    // 同一页面的修改必须串行提交。否则连续编辑会同时读取同一个旧 revision：
    // 第一个请求成功后，后续请求会被服务器判定为 revision 冲突。
    const previous = pageCommandQueuesRef.current.get(pageId) ?? Promise.resolve(true);
    const task = previous.catch(() => false).then(async (): Promise<boolean> => {
      try {
        const latest = pagesRef.current.find((page) => page.page.id === pageId);
        if (!latest) throw new Error(`找不到页面“${pageId}”。`);
        const operator = source === "ai" ? "Codex" : "jojo";
        const result = executeCommands({ dsl: latest, baseRevision: latest.revision, commands, source, operator });
        if (webMode && webProjectId) {
          await webSpace.commands(webProjectId, pageId, latest.revision, commands, source, operator);
        } else {
          await persistDesktopPage(result.dsl, result.revision);
        }

        const replacePage = (items: PageDSL[]) => items.map((page) => page.page.id === pageId ? result.dsl : page);
        pagesRef.current = replacePage(pagesRef.current);
        setPages(replacePage);
        if (currentPageIdRef.current === pageId) {
          setHistory((items) => [...items, result.revision].slice(-20));
          setRedoStack([]);
        }
        // 常规保存属于高频后台反馈，仅失败时提示，避免连续编辑产生通知堆叠。
        return true;
      } catch (error) {
        let detail = error instanceof Error ? error.message : "未知错误";
        if (webMode && webProjectId && (error as Error & { status?: number }).status === 409) {
          try {
            const fresh = (await webSpace.getPage(webProjectId, pageId)).dsl;
            const replacePage = (items: PageDSL[]) => items.map((page) => page.page.id === pageId ? fresh : page);
            pagesRef.current = replacePage(pagesRef.current);
            setPages(replacePage);
            if (currentPageIdRef.current === pageId) {
              setHistory([]);
              setRedoStack([]);
            }
            detail = `${detail} 已自动重新读取最新页面，请重试刚才的操作。`;
          } catch {
            detail = `${detail} 自动刷新页面失败，请手动重新打开项目。`;
          }
        }
        toast("danger", "修改未执行", detail);
        return false;
      }
    });
    pageCommandQueuesRef.current.set(pageId, task);
    void task.finally(() => {
      if (pageCommandQueuesRef.current.get(pageId) === task) pageCommandQueuesRef.current.delete(pageId);
    });
    return task;
  }, [persistDesktopPage, toast, webProjectId]);

  useEffect(() => {
    currentBoardIdRef.current = currentBoardId;
    boardCacheRef.current.set(currentBoardId, board);
  }, [board, currentBoardId]);

  useEffect(() => {
    if (!boardMoreOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target as HTMLElement).closest(".board-more")) setBoardMoreOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [boardMoreOpen]);

  useEffect(() => {
    localStorage.setItem("ps_panel_left", leftCollapsed ? "1" : "0");
  }, [leftCollapsed]);

  useEffect(() => {
    localStorage.setItem("ps_panel_right", rightCollapsed ? "1" : "0");
  }, [rightCollapsed]);


  const runBoardCommands = useCallback(async (commands: BoardCommand[], recordHistory = true): Promise<boolean> => {
    const targetBoardId = currentBoardIdRef.current;
    const currentBoard = boardCacheRef.current.get(targetBoardId);
    if (!currentBoard) {
      toast("danger", "画布修改未执行", "当前画布尚未加载完成。");
      return false;
    }
    const beforeSnapshot = structuredClone(currentBoard);
    let applied: ApplyBoardCommandsResult;
    try {
      const result = applyBoardCommands({
        board: currentBoard,
        baseRevision: currentBoard.revision,
        commands,
        source: "manual",
        operator: "jojo"
      });
      applied = result;
      boardCacheRef.current.set(targetBoardId, result.board);
      if (currentBoardIdRef.current === targetBoardId) setBoard(result.board);
      setBoards((items) => items.map((item) => item.id === targetBoardId ? {
        ...item,
        revision: result.board.revision,
        objectCount: result.board.objects.length,
        pageCount: result.board.objects.filter((object) => object.type === "page").length,
        updatedAt: result.board.updatedAt
      } : item));
    } catch (error) {
      toast("danger", "画布修改未执行", error instanceof Error ? error.message : "未知错误");
      return false;
    }
    // 2) 服务端提交串行化：一次只发一个命令，base revision 沿队列递增，
    //    彻底避免并发命令互相踩踏导致的 revision 冲突。
    const previousTask = boardQueueRefs.current.get(targetBoardId) ?? Promise.resolve(true);
    const task = previousTask.then(async (): Promise<boolean> => {
      try {
        const base = boardQueueBaseRefs.current.get(targetBoardId) ?? applied.board.revision - 1;
        if (webMode && webProjectId) {
          await webSpace.boardCommands(webProjectId, targetBoardId, base, commands, "manual", "jojo");
        } else if (projectRoot && isDesktopRuntime()) {
          await persistDesktopBoardRevision(stringifyYaml(applied.board, { lineWidth: 0 }), applied.revision);
        }
        boardQueueBaseRefs.current.set(targetBoardId, base + 1);
        if (recordHistory) {
          setBoardUndoStack((items) => [...items, beforeSnapshot].slice(-20));
          setBoardRedoStack([]);
        }
        return true;
      } catch (error) {
        // 画布可能已被其他会话（另一个标签页 / Codex）修改：重新读取最新画布，
        // 重置版本链，避免本地乐观状态与服务端继续偏离。
        boardQueueBaseRefs.current.delete(targetBoardId);
        if (webMode && webProjectId) {
          try {
            const fresh = await webSpace.board(webProjectId, targetBoardId);
            boardCacheRef.current.set(targetBoardId, fresh.board);
            if (currentBoardIdRef.current === targetBoardId) setBoard(fresh.board);
          } catch { /* 忽略重新读取失败，保留当前状态 */ }
        }
        const detail = error instanceof Error ? error.message : "未知错误";
        toast("danger", "画布修改未执行", `${detail} 已自动重新读取画布，请重试刚才的操作。`);
        return false;
      }
    });
    boardQueueRefs.current.set(targetBoardId, task);
    void task.finally(() => {
      if (boardQueueRefs.current.get(targetBoardId) === task) boardQueueRefs.current.delete(targetBoardId);
    });
    return task;
  }, [projectRoot, toast, webProjectId]);

  const openDiagramEditor = useCallback((objectId: string) => {
    const current = boardCacheRef.current.get(currentBoardIdRef.current);
    const object = current?.objects.find((item) => item.id === objectId);
    if (!current || (object?.type !== "flowchart" && object?.type !== "er")) return;
    setDiagramEditor({ boardId: current.id, objectId, baseRevision: current.revision });
  }, []);

  const saveDiagramObject = useCallback(async (next: Extract<BoardObject, { type: "flowchart" | "er" }>, baseRevision: number): Promise<boolean> => {
    const current = boardCacheRef.current.get(currentBoardIdRef.current);
    if (!current || current.revision !== baseRevision) {
      toast("danger", "图形未保存", "画布在编辑期间已被修改。当前草稿仍保留，请取消后重新打开。");
      return false;
    }
    return runBoardCommands([{ type: "UPDATE_BOARD_OBJECT", target: next.id, changes: next }]);
  }, [runBoardCommands, toast]);

  // 拖拽移动按帧合并：一帧内只发一次 MOVE 命令（取最新位置），避免拖动时命令洪泛。
  const pendingMovesRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const pendingFlushRef = useRef<number>(0);

  const scheduleBoardMoveFlush = useCallback(() => {
    if (pendingFlushRef.current) return;
    pendingFlushRef.current = requestAnimationFrame(() => {
      pendingFlushRef.current = 0;
      const moves = pendingMovesRef.current;
      pendingMovesRef.current = new Map();
      if (!moves.size) return;
      const commands: BoardCommand[] = [...moves.entries()].map(([target, position]) => ({
        type: "MOVE_BOARD_OBJECT",
        target,
        x: position.x,
        y: position.y
      }));
      void runBoardCommands(commands);
    });
  }, [runBoardCommands]);

  const boardPageMap = useMemo(() => {
    const map: Record<string, PageDSL> = {};
    pages.forEach((page) => { map[page.page.id] = page; });
    return map;
  }, [pages]);

  const boardPageObjects = useMemo(() => board.objects.filter((object): object is Extract<BoardObject, { type: "page" }> => object.type === "page"), [board.objects]);

  const boardSelectedObject = useMemo(() => board.objects.find((object) => object.id === boardSelectedId), [board.objects, boardSelectedId]);
  const boardSelectedLink = useMemo(() => board.links.find((link) => link.id === boardSelectedLinkId), [board.links, boardSelectedLinkId]);
  const diagramEditorObject = useMemo(() => {
    if (!diagramEditor || diagramEditor.boardId !== board.id) return undefined;
    const object = board.objects.find((item) => item.id === diagramEditor.objectId);
    return object?.type === "flowchart" || object?.type === "er" ? object : undefined;
  }, [board, diagramEditor]);

  const nextMarkerNumber = () => Math.max(0, ...board.objects
    .filter((object) => object.type === "marker")
    .map((object) => (object as BoardMarkerObject).number)
    .filter((number): number is number => typeof number === "number")) + 1;

  const addBoardPageObject = async (pageId: string) => {
    const object: Extract<BoardObject, { type: "page" }> = {
      id: `obj-${pageId}`,
      type: "page",
      pageId,
      x: 120,
      y: 80 + boardPageObjects.length * 720,
      width: 960,
      height: 640,
      source: "default"
    };
    if (await runBoardCommands([{ type: "ADD_BOARD_OBJECT", object }])) {
      setBoardSelectedId(object.id);
      setBoardTool("none");
    }
  };

  const addBoardNote = async () => {
    const object: BoardNoteObject = {
      id: `note-${Date.now()}`,
      type: "note",
      x: 1180,
      y: 100 + board.objects.length * 20,
      width: 280,
      height: 90,
      text: "在这里输入说明…",
      source: "explicit"
    };
    if (await runBoardCommands([{ type: "ADD_BOARD_OBJECT", object }])) {
      setBoardSelectedId(object.id);
      setBoardDraft({ text: object.text });
    }
  };

  const addBoardMarker = async (pageObjectId: string, componentId: string, number: number | string, text: string, tone: MarkerTone, offsetX?: number, offsetY?: number) => {
    const object: BoardMarkerObject = {
      id: `marker-${Date.now()}`,
      type: "marker",
      number,
      tone,
      text: text.trim() || `标注 ${number}`,
      source: "explicit",
      anchor: { pageObjectId, componentId, ...(offsetX !== undefined ? { offsetX } : {}), ...(offsetY !== undefined ? { offsetY } : {}) }
    };
    if (await runBoardCommands([{ type: "ADD_BOARD_OBJECT", object }])) {
      setBoardSelectedId(object.id);
      setBoardTool("none");
      setMarkerPicking(false);
    }
  };

  const addBoardFlowchart = async () => {
    const object: Extract<BoardObject, { type: "flowchart" }> = {
      id: `flow-${Date.now()}`,
      type: "flowchart",
      x: 120,
      y: 900,
      width: 640,
      height: 360,
      source: "explicit",
      flowchart: {
        nodes: [
          { id: "node-1", label: "开始", kind: "start", position: { x: 236, y: 50 }, size: { width: 168, height: 64 } },
          { id: "node-2", label: "结束", kind: "end", position: { x: 236, y: 220 }, size: { width: 168, height: 64 } }
        ],
        edges: [{ id: "edge-1", from: "node-1", to: "node-2", label: "", lineType: "orthogonal", color: "#64748b", strokeWidth: 2 }]
      }
    };
    if (await runBoardCommands([{ type: "ADD_BOARD_OBJECT", object }])) {
      setBoardSelectedId(object.id);
      window.setTimeout(() => openDiagramEditor(object.id), 0);
    }
  };

  const addBoardEr = async () => {
    const object: Extract<BoardObject, { type: "er" }> = {
      id: `er-${Date.now()}`,
      type: "er",
      x: 900,
      y: 900,
      width: 640,
      height: 360,
      source: "explicit",
      er: {
        entities: [{ id: "entity-1", name: "实体A", position: { x: 80, y: 70 }, width: 220, fields: [{ id: "entity-1-id", name: "id", type: "string", key: true, nullable: false }] }],
        relations: []
      }
    };
    if (await runBoardCommands([{ type: "ADD_BOARD_OBJECT", object }])) {
      setBoardSelectedId(object.id);
      window.setTimeout(() => openDiagramEditor(object.id), 0);
    }
  };

  const addBoardLink = async (from: string, to: string, label: string, fromComponentId?: string, toComponentId?: string) => {
    await runBoardCommands([
      {
        type: "ADD_BOARD_LINK",
        link: {
          id: `link-${Date.now()}`,
          from,
          to,
          ...(label.trim() ? { label: label.trim() } : {}),
          ...(fromComponentId ? { fromComponentId } : {}),
          ...(toComponentId ? { toComponentId } : {}),
          lineType: "curve",
          strokeWidth: 2.5,
          color: "#2563eb"
        }
      }
    ]);
  };

  const updateBoardLink = (changes: Partial<BoardLink>) => {
    if (!boardSelectedLink) return;
    void runBoardCommands([{ type: "UPDATE_BOARD_LINK", target: boardSelectedLink.id, changes }]);
  };

  const commitBoardPosition = () => {
    if (!boardSelectedObject || boardSelectedObject.type === "marker") return;
    void runBoardCommands([{
      type: "UPDATE_BOARD_OBJECT",
      target: boardSelectedObject.id,
      changes: {
        x: Number(boardDraft.x ?? boardSelectedObject.x),
        y: Number(boardDraft.y ?? boardSelectedObject.y),
        width: Math.max(40, Number(boardDraft.width ?? boardSelectedObject.width)),
        height: Math.max(40, Number(boardDraft.height ?? boardSelectedObject.height))
      }
    }]);
  };

  const commitBoardText = () => {
    if (!boardSelectedObject || (boardSelectedObject.type !== "note" && boardSelectedObject.type !== "marker")) return;
    void runBoardCommands([{
      type: "UPDATE_BOARD_OBJECT",
      target: boardSelectedObject.id,
      changes: { text: String(boardDraft.text ?? "") }
    }]);
  };

  const commitBoardNumber = () => {
    if (!boardSelectedObject || boardSelectedObject.type !== "marker") return;
    const value = String(boardDraft.number ?? boardSelectedObject.number).trim();
    if (!value) {
      toast("warning", "标注序号不能为空", "请填写标注序号后再离开输入框。");
      return;
    }
    void runBoardCommands([{
      type: "UPDATE_BOARD_OBJECT",
      target: boardSelectedObject.id,
      changes: { number: /^\d+$/.test(value) ? Number(value) : value }
    }]);
  };

  const deleteBoardObject = async (id: string) => {
    if (await runBoardCommands([{ type: "DELETE_BOARD_OBJECT", target: id }])) {
      setBoardSelectedId(undefined);
    }
  };

  const selectBoardObject = (id: string) => {
    setBoardSelectedLinkId(undefined);
    setBoardSelectedId(id);
    setBoardSelectedIds((previous) => (previous.includes(id) ? previous : [id]));
    if (aiSelectMode && id) setBoardAiBarIds([id]);
  };

  const selectBoardMany = (ids: string[]) => {
    setBoardSelectedLinkId(undefined);
    setBoardSelectedIds(ids);
    setBoardSelectedId(ids.length ? ids[ids.length - 1] : undefined);
  };

  const handleBoardSelectComplete = useCallback((ids: string[], point: { x: number; y: number }) => {
    if (!aiSelectMode) return;
    if (ids.length) {
      setBoardAiBarIds(ids);
      setBoardAiBarPos(point);
    } else {
      setBoardAiBarIds([]);
      setBoardAiBarPos(null);
    }
  }, [aiSelectMode]);

  const selectBoardLink = (id: string) => {
    setBoardSelectedLinkId(id);
    setBoardSelectedId(undefined);
    setBoardSelectedIds([]);
  };

  const relinkBoardLink = (linkId: string, endpoint: "from" | "to", objectId: string, componentId?: string) => {
    const link = board.links.find((item) => item.id === linkId);
    if (!link) return;
    const oppositeObjectId = endpoint === "from" ? link.to : link.from;
    if (objectId === oppositeObjectId) {
      toast("warning", "无法吸附", "连线的起点和终点不能位于同一个画布对象");
      return;
    }
    const changes: Partial<BoardLink> = endpoint === "from"
      ? { from: objectId, fromComponentId: componentId }
      : { to: objectId, toComponentId: componentId };
    void runBoardCommands([{ type: "UPDATE_BOARD_LINK", target: linkId, changes }]);
  };

  const moveBoardLinkWaypoint = (linkId: string, x: number, y: number) => {
    void runBoardCommands([{
      type: "UPDATE_BOARD_LINK",
      target: linkId,
      changes: { waypoint: { x, y } }
    }]);
  };

  const deleteBoardObjects = async (ids: string[]) => {
    if (!ids.length) return;
    if (await runBoardCommands(ids.map((id) => ({ type: "DELETE_BOARD_OBJECT", target: id })))) {
      setBoardSelectedId(undefined);
      setBoardSelectedIds([]);
    }
  };

  const duplicateBoardObject = async (id: string) => {
    const object = board.objects.find((item) => item.id === id);
    if (!object || object.type === "marker") return;
    const copy = {
      ...structuredClone(object),
      id: `${object.id}-copy-${Date.now().toString(36)}`,
      x: object.x + 24,
      y: object.y + 24
    } as Extract<BoardObject, { type: "page" | "note" | "flowchart" | "er" }>;
    if (await runBoardCommands([{ type: "ADD_BOARD_OBJECT", object: copy }])) {
      setBoardSelectedId(copy.id);
      setBoardSelectedIds([copy.id]);
    }
  };

  const zOrderBoardObjects = async (ids: string[], position: "top" | "bottom") => {
    if (!ids.length) return;
    const maxZ = Math.max(0, ...board.objects.map((object) => object.z ?? 0));
    const minZ = Math.min(0, ...board.objects.map((object) => object.z ?? 0));
    const commands = ids.map((id) => ({
      type: "UPDATE_BOARD_OBJECT" as const,
      target: id,
      changes: { z: position === "top" ? maxZ + 1 : minZ - 1 }
    }));
    await runBoardCommands(commands);
  };

  const moveBoardObject = (id: string, x: number, y: number) => {
    pendingMovesRef.current.set(id, { x, y });
    scheduleBoardMoveFlush();
  };

  const resizeBoardObject = (id: string, x: number, y: number, width: number, height: number) => {
    void runBoardCommands([{
      type: "UPDATE_BOARD_OBJECT",
      target: id,
      changes: { x, y, width, height }
    }]);
  };

  const moveBoardObjects = (ids: string[], dx: number, dy: number) => {
    board.objects.forEach((object) => {
      if (!ids.includes(object.id) || object.type === "marker") return;
      pendingMovesRef.current.set(object.id, {
        x: boardSnap ? snapValue(object.x + dx) : object.x + dx,
        y: boardSnap ? snapValue(object.y + dy) : object.y + dy
      });
    });
    scheduleBoardMoveFlush();
  };

  const moveBoardMarker = (id: string, offsetX: number, offsetY: number) => {
    const object = board.objects.find((item) => item.id === id);
    if (!object || object.type !== "marker") return;
    void runBoardCommands([{
      type: "UPDATE_BOARD_OBJECT",
      target: id,
      changes: { anchor: { ...object.anchor, offsetX, offsetY } }
    }]);
  };

  const moveBoardMarkerNote = (id: string, x: number, y: number) => {
    void runBoardCommands([{
      type: "UPDATE_BOARD_OBJECT",
      target: id,
      changes: { noteX: x, noteY: y }
    }]);
  };

  const addMarkerToCurrentComponent = async () => {
    if (!selected || !currentPageId) {
      toast("warning", "请先在 Preview 中选择组件");
      return;
    }
    let pageObject = board.objects.find((object): object is Extract<BoardObject, { type: "page" }> =>
      object.type === "page" && object.pageId === currentPageId
    );
    if (!pageObject) {
      pageObject = {
        id: `obj-${currentPageId}`,
        type: "page",
        pageId: currentPageId,
        x: 120,
        y: 80 + boardPageObjects.length * 720,
        width: 960,
        height: 640,
        source: "default"
      };
      await runBoardCommands([{ type: "ADD_BOARD_OBJECT", object: pageObject }]);
    }
    await addBoardMarker(pageObject.id, selected.id, nextMarkerNumber(), "", "orange");
  };

  const openPageFromBoard = (pageId: string) => {
    setActiveWorkspace("pages");
    setCurrentPageId(pageId);
    setViewMode("page");
    setSelectedId("");
    setPreviewReady(false);
    setShowVersions(false);
    setShowDsl(false);
  };

  useEffect(() => {
    if (!webMode || !webProjectId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("project", webProjectId);
    if (viewMode === "canvas") {
      url.searchParams.set("board", currentBoardId);
      url.searchParams.delete("page");
    } else if (currentPageId) {
      url.searchParams.set("page", currentPageId);
      url.searchParams.delete("board");
    }
    window.history.replaceState(null, "", url);
  }, [currentBoardId, currentPageId, viewMode, webProjectId]);

  const exportBoardHtml = (mode: "content" | "with-annotations" = "content", scope: "current" | "all" = "current") => {
    const bounds = boardContentBounds(board, {});
    const showPanel = mode === "with-annotations" && board.objects.some((object) => object.type === "marker");
    const panelReserve = showPanel ? ANNOTATION_PANEL_WIDTH + ANNOTATION_PANEL_GAP : 0;
    const canvasWidth = bounds.maxX - bounds.minX + CONTENT_PADDING * 2 + panelReserve;
    const canvasHeight = bounds.maxY - bounds.minY + CONTENT_PADDING * 2;
    const body = renderToStaticMarkup(
      <BoardRenderer
        board={board}
        pages={boardPageMap}
        interactive={false}
        showAnnotationPanel={mode === "with-annotations"}
      />
    );
    const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${projectName} · 画布</title>
<style>${rendererExportCss}\n${boardExportCss}\nhtml,body{margin:0;background:#e6eaed;font-family:system-ui,-apple-system,'PingFang SC',sans-serif;}body{padding:24px;}</style>
</head>
<body>
<div class="export-canvas" style="position:relative;width:${canvasWidth}px;height:${canvasHeight}px;">${body}</div>
<script>
${boardExportRuntimeScript}
</script>
</body>
</html>`;
    if (webMode && webProjectId) {
      void webSpace.exportHtml(webProjectId, mode, scope, currentBoardId)
        .then((result) => {
          const blob = new Blob([result.html], { type: "text/html" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = scope === "all" ? "prototype-all-boards.html" : `prototype-${currentBoardId}.html`;
          link.click();
          URL.revokeObjectURL(url);
          toast("success", "画布已导出", scope === "all" ? "已下载全部画布 HTML" : `已下载 ${board.name}`);
        })
        .catch((error) => toast("danger", "导出失败", error instanceof Error ? error.message : "未知错误"));
    } else if (projectRoot && isDesktopRuntime()) {
      void exportDesktopBoardHtml(html)
        .then((path) => toast("success", "画布已导出", path))
        .catch((error) => toast("danger", "导出失败", error instanceof Error ? error.message : "请检查项目目录权限"));
    } else {
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "prototype-board.html";
      link.click();
      URL.revokeObjectURL(url);
      toast("success", "画布已导出", "已下载 prototype-board.html");
    }
  };

  const refreshPublishLinks = useCallback(async () => {
    if (!webProjectId) return;
    try {
      const result = await webSpace.shareList(webProjectId);
      setPublishLinks(result.links);
    } catch { /* 忽略查询失败 */ }
  }, [webProjectId]);

  const openPublishDrawer = useCallback(() => {
    setPublishOpen(true);
    void refreshPublishLinks();
  }, [refreshPublishLinks]);

  const publishWebProject = async () => {
    if (!webProjectId || publishBusy) return;
    setPublishBusy(true);
    try {
      const expiresInSeconds = publishExpiry === "forever" ? undefined : Number(publishExpiry) * 86400;
      await webSpace.shareCreate(webProjectId, expiresInSeconds);
      await refreshPublishLinks();
    } catch (error) {
      toast("danger", "发布失败", error instanceof Error ? error.message : "未知错误");
    } finally {
      setPublishBusy(false);
    }
  };

  const closePublishWebProject = async (token: string) => {
    if (!webProjectId || publishBusy) return;
    setPublishBusy(true);
    try {
      await webSpace.shareRevoke(webProjectId, token);
      await refreshPublishLinks();
    } catch (error) {
      toast("danger", "关闭发布失败", error instanceof Error ? error.message : "未知错误");
    } finally {
      setPublishBusy(false);
    }
  };

  const downloadWebZip = async () => {
    if (!webProjectId) return;
    try {
      const result = await webSpace.exportZip(webProjectId);
      const binary = atob(result.zip);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "prototype-project.zip";
      link.click();
      URL.revokeObjectURL(url);
      toast("success", "整包已下载", "prototype-project.zip");
    } catch (error) {
      toast("danger", "下载失败", error instanceof Error ? error.message : "未知错误");
    }
  };

  useEffect(() => {
    if (!webMode) return;
    void webAuth.me()
      .then(async (result) => {
        if (result.user) {
          setWebSession(result.user);
          const project = new URLSearchParams(window.location.search).get("project");
          if (project) { void loadWebProject(project); return; }
          await openLatestOrCreate().catch(() => setWebOpenFailed(true));
        }
      })
      .catch(() => undefined)
      .finally(() => setWebBoot(true));
  }, [loadWebProject, openLatestOrCreate]);

  const updateSelected = (changes: Partial<UIComponent>) => {
    if (!selected) return;
    const type = ["modal", "drawer", "popover"].includes(selected.type) ? "UPDATE_OVERLAY" : "UPDATE_COMPONENT";
    void runCommands([{ type, target: selected.id, changes } as Command]);
  };

  const isModulePage = dsl.page.title.includes("模块说明");

  const updatePageSections = async (sections: UIComponent[]): Promise<boolean> => {
    if (!currentPageId) return false;
    const next: PageDSL = { ...dsl, revision: dsl.revision + 1, sections };
    try {
      if (webMode && webProjectId) {
        await webSpace.putPage(webProjectId, next.page.id, next, dsl.revision, "manual", "jojo");
      } else {
        toast("warning", "文档编辑仅网页端可用");
        return false;
      }
      setDsl(next);
      setPages((items) => items.map((item) => item.page.id === next.page.id ? next : item));
      return true;
    } catch (error) {
      toast("danger", "保存文档失败", error instanceof Error ? error.message : "未知错误");
      return false;
    }
  };

  const addDocCard = async () => {
    const id = `doc-card-${Date.now()}`;
    await updatePageSections([...(dsl.sections ?? []), { id, type: "card", title: "说明卡", description: "在这里填写说明内容…", source: "explicit", children: [], actions: [] }]);
  };

  const addDocTable = () => {
    askText({
      title: "新增表格",
      label: "行数与列数（如 3,4）",
      defaultValue: "3,4",
      confirmText: "添加",
      onConfirm: async (value) => {
        const parts = value.split(/[,，xX]/).map((part) => Math.min(20, Math.max(1, parseInt(part.trim(), 10) || 1)));
        const rowCount = parts[0] ?? 3;
        const colCount = parts[1] ?? 4;
        const id = `doc-table-${Date.now()}`;
        const columns: TableColumn[] = Array.from({ length: colCount }, (_, c) => ({
          id: `${id}.col-${c + 1}`,
          type: "table-column",
          title: `列${c + 1}`,
          dataIndex: `c${c + 1}`
        }));
        const rows: Record<string, unknown>[] = Array.from({ length: rowCount }, (_, r) => {
          const row: Record<string, unknown> = { id: r + 1 };
          columns.forEach((column) => { row[column.dataIndex] = ""; });
          return row;
        });
        await updatePageSections([...(dsl.sections ?? []), { id, type: "table", columns, rows, rowKey: "id", source: "default" }]);
      }
    });
  };

  const addDocFlowchart = async () => {
    const id = `doc-flow-${Date.now()}`;
    await updatePageSections([...(dsl.sections ?? []), {
      id,
      type: "flowchart",
      title: "流程图",
      flowchart: {
        nodes: [{ id: "n1", label: "开始" }, { id: "n2", label: "处理" }, { id: "n3", label: "结束" }],
        edges: [{ id: "e1", from: "n1", to: "n2" }, { id: "e2", from: "n2", to: "n3" }]
      },
      source: "explicit"
    }]);
  };

  const addDocEr = async () => {
    const id = `doc-er-${Date.now()}`;
    await updatePageSections([...(dsl.sections ?? []), {
      id,
      type: "er",
      title: "ER 图",
      er: {
        entities: [{ id: "e1", name: "实体A", fields: [{ name: "id", type: "string", key: true }] }],
        relations: []
      },
      source: "explicit"
    }]);
  };

  const updateSelectedColumn = (index: number, changes: Partial<TableColumn>) => {
    const columns = [...(selected?.columns ?? [])];
    if (!columns[index]) return;
    columns[index] = { ...columns[index], ...changes };
    updateSelected({ columns });
  };

  const addTableColumn = () => {
    if (!selected) return;
    const columns = [...(selected.columns ?? [])];
    const dataIndex = `c${columns.length + 1}`;
    columns.push({ id: `${selected.id}.col-${columns.length + 1}`, type: "table-column", title: `列${columns.length + 1}`, dataIndex });
    const rows = (selected.rows ?? []).map((row) => ({ ...row, [dataIndex]: "" }));
    updateSelected({ columns, rows });
  };

  const deleteTableColumn = (index: number) => {
    if (!selected) return;
    const columns = [...(selected.columns ?? [])];
    const removed = columns.splice(index, 1);
    const rows = (selected.rows ?? []).map((row) => {
      const next = { ...row };
      if (removed[0]) delete next[removed[0].dataIndex];
      return next;
    });
    updateSelected({ columns, rows });
  };

  const addTableRow = () => {
    if (!selected) return;
    const row: Record<string, unknown> = { id: (selected.rows?.length ?? 0) + 1 };
    (selected.columns ?? []).forEach((column) => { row[column.dataIndex] = ""; });
    updateSelected({ rows: [...(selected.rows ?? []), row] });
  };

  const deleteTableRow = (index: number) => {
    if (!selected) return;
    const rows = [...(selected.rows ?? [])];
    rows.splice(index, 1);
    updateSelected({ rows });
  };

  const updateTableCell = (rowIndex: number, dataIndex: string, value: string) => {
    if (!selected) return;
    const rows = [...(selected.rows ?? [])];
    rows[rowIndex] = { ...rows[rowIndex], [dataIndex]: value };
    updateSelected({ rows });
  };

  const undo = async () => {
    const target = history.at(-1);
    if (!target) return;
    try {
      const result = createRevertRevision(dsl, target, "jojo");
      if (webMode && webProjectId) {
        await webSpace.putPage(webProjectId, result.dsl.page.id, result.dsl, dsl.revision, "undo", "jojo");
      } else {
        await persistDesktopPage(result.dsl, result.revision);
      }
      setDsl(result.dsl);
      setHistory((items) => [...items.slice(0, -1), result.revision].slice(-20));
      setRedoStack((items) => [...items, target].slice(-20));
    } catch (error) {
      toast("danger", "无法撤销", error instanceof Error ? error.message : "未知错误");
    }
  };

  const redo = async () => {
    const target = redoStack.at(-1);
    if (!target) return;
    const changes = target.commands;
    if (!changes.length) return;
    if (await runCommands(changes, "redo")) {
      setRedoStack((items) => items.slice(0, -1));
    }
  };

  const undoBoard = useCallback(async () => {
    const targetBoardId = currentBoardIdRef.current;
    const target = boardUndoStack.at(-1);
    if (!target) return;
    const current = boardCacheRef.current.get(targetBoardId);
    if (!current) return;
    const commands = createBoardRestoreCommands(target, current);
    if (!commands.length) return;
    const ok = await runBoardCommands(commands, false);
    if (ok) {
      setBoardUndoStack((items) => items.slice(0, -1));
      setBoardRedoStack((items) => [...items, structuredClone(current)].slice(-20));
    }
  }, [boardUndoStack, runBoardCommands]);

  const redoBoard = useCallback(async () => {
    const targetBoardId = currentBoardIdRef.current;
    const target = boardRedoStack.at(-1);
    if (!target) return;
    const current = boardCacheRef.current.get(targetBoardId);
    if (!current) return;
    const commands = createBoardRestoreCommands(target, current);
    if (!commands.length) return;
    const ok = await runBoardCommands(commands, false);
    if (ok) {
      setBoardRedoStack((items) => items.slice(0, -1));
      setBoardUndoStack((items) => [...items, structuredClone(current)].slice(-20));
    }
  }, [boardRedoStack, runBoardCommands]);

  const undoActive = useCallback(() => {
    if (viewMode === "canvas") void undoBoard();
    else void undo();
  }, [undo, undoBoard, viewMode]);

  const redoActive = useCallback(() => {
    if (viewMode === "canvas") void redoBoard();
    else void redo();
  }, [redo, redoBoard, viewMode]);

  const undoRedoRef = useRef({ undo: undoActive, redo: redoActive });
  undoRedoRef.current = { undo: undoActive, redo: redoActive };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (diagramEditor) return;
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        void undoRedoRef.current.undo();
      } else if (key === "z" && event.shiftKey) {
        event.preventDefault();
        void undoRedoRef.current.redo();
      } else if (key === "y") {
        event.preventDefault();
        void undoRedoRef.current.redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [diagramEditor]);

  const moveOutline = (dragged: string, target: string) => {
    const fields = dsl.search?.fields ?? [];
    const index = fields.findIndex((field) => field.id === target);
    if (index >= 0 && fields.some((field) => field.id === dragged)) {
      void runCommands([{ type: "MOVE_COMPONENT", target: dragged, container: "search.fields", index }], "manual");
    } else toast("warning", "当前仅支持同容器排序", "MVP 可拖动查询区字段调整顺序");
  };

  const outlineComponents: UIComponent[] = [
    ...(dsl.search?.fields ?? []),
    ...(dsl.toolbar?.actions ?? []),
    ...(dsl.table ? [dsl.table] : []),
    ...(dsl.form ? [dsl.form] : []),
    ...(dsl.detail ? [dsl.detail] : []),
    ...(dsl.sections ?? []),
    ...dsl.overlays
  ].filter(() => Boolean(currentPage));

  if (webMode && !webBoot) return <div className="web-screen"><div className="web-card"><div className="web-empty">正在打开…</div></div></div>;
  if (webMode && !webSession) return <AuthScreen onAuthenticated={(user) => void handleAuthenticated(user)} />;
  if (webMode && webSession && !webProjectId) {
    return <div className="web-screen"><div className="web-card"><div className="web-empty">{webOpenFailed ? "项目打开失败" : "正在打开项目…"}</div>{webOpenFailed ? <button className="web-ghost web-retry" onClick={() => { setWebOpenFailed(false); void openLatestOrCreate().catch(() => setWebOpenFailed(true)); }}>重新尝试</button> : null}</div></div>;
  }

  const webApiToken = getApiToken();
  const codexConnectPrompt = webApiToken
    ? "请帮我配置 Prototype Studio 的 MCP 连接。把下面这段配置写入 ~/.codex/config.toml 的 MCP 服务部分（若已存在 prototype-studio 配置则整体替换，没有则追加），配置完成后提示我重启 Codex 即可，不要修改其他内容：\n\n" +
      ["[mcp_servers.prototype-studio]", `type = "http"`, `url = "${window.location.origin}/mcp"`, `bearer_token = "${webApiToken}"`].join("\n")
    : "";
  const workbuddyConnectPrompt = webApiToken
    ? "请帮我连接 Prototype Studio 的 MCP 服务（按你支持的方式注册 HTTP / Streamable HTTP MCP Server）：\n" +
      ["- 服务名：prototype-studio", "- 类型：HTTP / Streamable HTTP", `- URL：${window.location.origin}/mcp`, "- 认证方式：Bearer Token", `- Token：${webApiToken}`].join("\n") +
      "\n\n注册并连接成功后告诉我状态即可。"
    : "";

  return <div className={`studio-shell ${leftCollapsed ? "left-collapsed" : ""} ${rightCollapsed ? "right-collapsed" : ""}`}>
    <header className="studio-titlebar">
      <div className="studio-brand"><span className="studio-mark"><i /><b /></span><div><strong>PROTOTYPE</strong><em>STUDIO</em></div></div>
      <div className="project-switcher-wrap">
        <button className="studio-project-switcher" onClick={() => { const next = !showProjectMenu; setShowProjectMenu(next); if (next) void refreshProjectMenu(); }}><FolderOpen size={14} /><span>{projectName}{projectRoot ? (webMode ? " · 云端项目" : " · 本地项目") : isDesktopRuntime() ? "" : " · 示例项目"}</span><ChevronDown size={13} /></button>
        {showProjectMenu ? <div className="project-menu">
          <div className="project-menu-head"><span>PROJECT ROOT</span><code>{projectRoot ?? "examples/case-management"}</code></div>
          {!webMode ? <>
            <button onClick={openLocalProject}><FolderOpen size={14} /><span><strong>打开本地项目</strong><small>选择包含 project.yaml 的目录</small></span></button>
            <button onClick={createLocalProject}><Plus size={14} /><span><strong>创建新项目</strong><small>生成标准目录与 project.yaml</small></span></button>
            <i />
            <button onClick={launchMcp}><Zap size={14} /><span><strong>启动 Local MCP</strong><small>当前状态：{mcpState}</small></span><StatusDot tone={mcpState === "running" ? "success" : mcpState === "unavailable" ? "danger" : "neutral"}>{mcpState}</StatusDot></button>
          </> : <>
            <button onClick={createProjectFromMenu}><Plus size={14} /><span><strong>新建项目</strong><small>创建空白项目并打开</small></span></button>
            <input ref={projectImportRef} type="file" accept=".zip" style={{ display: "none" }} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importProjectFromMenu(file); event.currentTarget.value = ""; }} />
            <button onClick={() => projectImportRef.current?.click()}><Upload size={14} /><span><strong>导入整包</strong><small>从 prototype-project.zip 恢复项目</small></span></button>
            <i />
            {projectMenuProjects.map((project) => (
              <button key={project.id} className={project.id === webProjectId ? "is-active" : ""} onClick={() => { setShowProjectMenu(false); void loadWebProject(project.id); }}>
                <FolderOpen size={14} /><span><strong>{project.name}</strong><small>{new Date(project.updatedAt).toLocaleString("zh-CN", { hour12: false })}</small></span>
              </button>
            ))}
          </>}
        </div> : null}
      </div>
      <div className="studio-title-actions">
        <StatusDot tone={currentPage && previewReady ? "success" : currentPage ? "warning" : "neutral"}>{currentPage ? (previewReady ? "Preview 已连接" : "Preview 连接中") : "暂无页面"}</StatusDot>
        <span className="title-divider" />
        <ToolButton active={!leftCollapsed} onClick={() => setLeftCollapsed((value) => !value)} title="显示 / 隐藏左侧面板"><PanelLeft size={14} /><span className="title-action-label">左栏</span></ToolButton>
        <ToolButton active={!rightCollapsed} onClick={() => setRightCollapsed((value) => !value)} title="显示 / 隐藏右侧面板"><PanelRight size={14} /><span className="title-action-label">右栏</span></ToolButton>
        <span className="title-divider" />
        <ToolButton compact title="撤销" disabled={viewMode === "canvas" ? !boardUndoStack.length : !currentPage || !history.length} onClick={() => void undoActive()}><Undo2 size={15} /></ToolButton>
        <ToolButton compact title="重做" disabled={viewMode === "canvas" ? !boardRedoStack.length : !currentPage || !redoStack.length} onClick={() => void redoActive()}><Redo2 size={15} /></ToolButton>
        <ToolButton disabled={!webMode || !webProjectId} onClick={() => { setShowVersions(!showVersions); if (!showVersions) void refreshVersions(); }} active={showVersions}><History size={14} />版本 <span className="revision-badge">{projectVersions.length}</span></ToolButton>
        <ToolButton disabled={!webMode || !webProjectId} onClick={openPublishDrawer}><Share2 size={14} />发布</ToolButton>
        <ToolButton compact title="设置" onClick={() => { setSettingsSection("account"); setShowSettings(true); void refreshMcpConnection(); }}><Settings2 size={15} /></ToolButton>
      </div>
    </header>

    <aside className="studio-left">
      <div className="left-tabs">
        <button className={activeWorkspace === "pages" ? "is-active" : ""} onClick={() => {
          setActiveWorkspace("pages");
          setViewMode("page");
          if (!currentPageId && pages[0]) selectPage(pages[0].page.id);
        }}><Layers3 size={14} />页面</button>
        <button className={activeWorkspace === "boards" ? "is-active" : ""} onClick={() => {
          setActiveWorkspace("boards");
          setViewMode("canvas");
          if (!currentBoardId && boards[0]) void selectBoard(boards[0].id);
        }}><LayoutGrid size={14} />画布</button>
      </div>
      {activeWorkspace === "pages" ? <>
        <div className="left-project-label"><span>页面结构 · {pages.length}</span><ToolButton compact title="新建页面" active={showPageCreator} onClick={() => setShowPageCreator(!showPageCreator)}><Plus size={13} /></ToolButton></div>
        {showPageCreator ? <div className="page-creator">
          <input autoFocus value={newPageTitle} onChange={(event) => setNewPageTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void addPage(); if (event.key === "Escape") setShowPageCreator(false); }} placeholder="页面名称" aria-label="页面名称" />
          <div className="page-type-picker">{(["list", "form", "detail"] as CreatablePageType[]).map((type) => <button key={type} className={newPageType === type ? "is-active" : ""} onClick={() => setNewPageType(type)}>{type}</button>)}</div>
          <div className="page-creator-actions"><button onClick={() => setShowPageCreator(false)}>取消</button><button className="is-primary" onClick={() => void addPage()}>创建页面</button></div>
        </div> : null}
        <div className="page-tree" aria-label="页面树">{pages.map((page, index) => <div
          key={page.page.id}
          className={`page-row ${page.page.id === currentPageId ? "is-active" : ""}`}
          draggable
          onDragStart={(event) => event.dataTransfer.setData("text/page-id", page.page.id)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => { event.preventDefault(); const pageId = event.dataTransfer.getData("text/page-id"); if (pageId) void movePage(pageId, index); }}
        >
          <button className="page-row-main" onClick={() => selectPage(page.page.id)} aria-label={`打开页面 ${page.page.title}`}><GripVertical className="page-drag-handle" size={11} /><div className="page-icon"><Monitor size={14} /></div><div><strong>{page.page.title}</strong><span>{page.page.id} · {page.page.type.toUpperCase()}</span></div></button>
          <button className="page-more" title={`管理页面 ${page.page.title}`} aria-label={`管理页面 ${page.page.title}`} onClick={() => setOpenPageMenuId(openPageMenuId === page.page.id ? undefined : page.page.id)}><MoreHorizontal size={14} /></button>
          {openPageMenuId === page.page.id ? <div className={`page-row-menu ${index >= 4 ? "is-up" : ""}`}>
            <button onClick={() => void renamePage(page.page.id)}><Pencil size={12} />重命名</button>
            <button disabled={index === 0} onClick={() => void movePage(page.page.id, index - 1)}><ArrowUp size={12} />上移</button>
            <button disabled={index === pages.length - 1} onClick={() => void movePage(page.page.id, index + 1)}><ArrowDown size={12} />下移</button>
            <i />
            <button className="is-danger" onClick={() => void deletePage(page.page.id)}><Trash2 size={12} />删除…</button>
          </div> : null}
        </div>)}</div>
        {!pages.length ? <EmptyState icon={<Layers3 size={17} />} title="还没有页面" description="新建列表、表单或详情页，开始搭建原型。" /> : <><SectionTitle action={<button className="icon-plain"><Search size={12} /></button>}>组件大纲</SectionTitle><div className="outline-list">{outlineComponents.map((component) => <OutlineNode key={component.id} component={component} selectedId={selectedId} onSelect={setSelectedId} onMove={moveOutline} />)}</div></>}
        <div className="left-footer"><FileCheck2 size={13} /><span>{currentPage ? `pages/${currentPage.page.id}.ui.yaml` : "pages/"}</span><StatusDot tone={currentPage ? "success" : "neutral"}>{currentPage ? "有效" : "空"}</StatusDot></div>
      </> : <>
        <div className="left-project-label"><span>画布 · {boards.length}</span><ToolButton compact title="新建画布" active={showBoardCreator} onClick={() => setShowBoardCreator((value) => !value)}><Plus size={13} /></ToolButton></div>
        {showBoardCreator ? <div className="board-creator">
          <input autoFocus value={newBoardName} onChange={(event) => setNewBoardName(event.target.value)} placeholder="画布名称" aria-label="画布名称" />
          <span className="board-creator-label">选择需要放入画布的页面（可留空）</span>
          <div className="board-page-picker">{pages.map((page) => <label key={page.page.id}><input type="checkbox" checked={newBoardPageIds.includes(page.page.id)} onChange={(event) => setNewBoardPageIds((items) => event.target.checked ? [...items, page.page.id] : items.filter((id) => id !== page.page.id))} /><span>{page.page.title}</span></label>)}</div>
          <div className="page-creator-actions"><button onClick={() => setShowBoardCreator(false)}>取消</button><button className="is-primary" onClick={() => void createNewBoard()}>创建画布</button></div>
        </div> : null}
        <div className="board-list">{boards.map((summary, index) => <div key={summary.id} className={`board-list-row ${summary.id === currentBoardId && viewMode === "canvas" ? "is-active" : ""}`}>
          <button className="board-list-main" onClick={() => void selectBoard(summary.id)}><div className="page-icon"><LayoutGrid size={14} /></div><span><strong>{summary.name}{summary.isDefault ? <em>默认</em> : null}</strong><small>{summary.pageCount} 页面 · {summary.objectCount} 对象 · R{summary.revision}</small></span></button>
          <button className="page-more" title={`管理画布 ${summary.name}`} onClick={() => setOpenBoardMenuId(openBoardMenuId === summary.id ? undefined : summary.id)}><MoreHorizontal size={14} /></button>
          {openBoardMenuId === summary.id ? <div className={`page-row-menu ${index >= 4 ? "is-up" : ""}`}>
            <button onClick={() => renameBoard(summary)}><Pencil size={12} />重命名</button>
            <button onClick={() => editBoardDescription(summary)}><FileCheck2 size={12} />修改说明</button>
            <button disabled={summary.isDefault} onClick={() => void makeDefaultBoard(summary)}><MapPin size={12} />设为默认</button>
            <i />
            <button className="is-danger" disabled={boards.length <= 1} onClick={() => trashBoard(summary)}><Trash2 size={12} />移入回收站</button>
          </div> : null}
        </div>)}</div>
        {trashedBoards.length ? <div className="board-trash">
          <div className="board-trash-title"><Trash2 size={12} /><span>回收站 · {trashedBoards.length}</span></div>
          {trashedBoards.map((summary) => <div className="board-trash-row" key={summary.trashId}><span><strong>{summary.name}</strong><small>{summary.boardId}</small></span><button title={`恢复画布 ${summary.name}`} onClick={() => void restoreTrashedBoard(summary)}><RotateCcw size={12} />恢复</button></div>)}
        </div> : null}
        {!boards.length ? <EmptyState icon={<LayoutGrid size={17} />} title="还没有画布" description="创建空白画布，或选择已有页面自动平铺。" /> : null}
        <div className="left-footer"><LayoutGrid size={13} /><span>{currentBoardId ? `boards/${currentBoardId}.board.yaml` : "boards/"}</span><StatusDot tone={currentBoardId ? "success" : "neutral"}>{currentBoardId ? "独立版本" : "空"}</StatusDot></div>
      </>}
    </aside>

    <main className="studio-canvas">
      <div className="canvas-toolbar">
        {viewMode === "page" ? <>
            <div className="canvas-toolbar-left">
              <div className="viewport-switcher"><button className="is-active"><Monitor size={14} />桌面</button><button><PanelRight size={14} />平板</button></div>
              <div className="canvas-meta"><span>1280 × 820</span></div>
            </div>
            <div className="canvas-toolbar-actions">
              {isModulePage ? <div className="doc-tools">
                <button onClick={() => void addDocCard()}><Plus size={12} />说明卡</button>
                <button onClick={() => void addDocTable()}><Table2 size={12} />表格</button>
                <button onClick={() => void addDocFlowchart()}><GitBranch size={12} />流程图</button>
                <button onClick={() => void addDocEr()}><Database size={12} />ER 图</button>
              </div> : null}
              <button className={aiSelectMode ? "is-active" : ""} onClick={() => toggleAiSelect(!aiSelectMode)} title="框选页面组件生成修改指令"><MousePointer2 size={13} />框选修改</button>
              <div className="zoom-control"><button onClick={() => setPreviewScale(Math.max(55, previewScale - 5))}>−</button><span>{previewScale}%</span><button onClick={() => setPreviewScale(Math.min(100, previewScale + 5))}>+</button><button><Maximize2 size={13} /></button></div>
            </div>
        </> : <>
            <div className="canvas-toolbar-left">
              <div className="canvas-meta"><strong>{board.name}</strong><i /><span>{board.objects.length} 个对象 · Revision {board.revision}</span></div>
            </div>
            <div className="canvas-toolbar-actions">
              <div className="board-tools">
                <button onClick={() => setBoardTool(boardTool === "page" ? "none" : "page")}><Plus size={13} />页面</button>
                <button onClick={() => void addBoardNote()}><StickyNote size={13} />说明</button>
                <button onClick={() => { const next = boardTool === "marker" ? "none" : "marker"; setBoardTool(next); if (next === "none") setMarkerPicking(false); }}><MapPin size={13} />标注</button>
                <button onClick={() => void addBoardFlowchart()}><GitBranch size={13} />流程</button>
                <button onClick={() => void addBoardEr()}><Database size={13} />ER</button>
                <i className="board-tools-divider" />
                <button className={aiSelectMode ? "is-active" : ""} onClick={() => toggleAiSelect(!aiSelectMode)} title="框选画布对象生成修改指令"><MousePointer2 size={13} />框选修改</button>
                <div className="board-more">
                  <button className={boardMoreOpen ? "is-active" : ""} onClick={() => setBoardMoreOpen((value) => !value)} title="更多操作"><MoreHorizontal size={13} />更多</button>
                  {boardMoreOpen ? <div className="board-more-menu">
                    <button className={boardSnap ? "is-active" : ""} onClick={() => setBoardSnap((value) => !value)}><Magnet size={12} />网格吸附（10px）</button>
                    <i />
                    <button onClick={() => { setBoardMoreOpen(false); setBoardExportOpen(true); }}><Download size={12} />导出 HTML</button>
                    {webMode && webProjectId ? <>
                      <button onClick={() => { setBoardMoreOpen(false); openPublishDrawer(); }}><Share2 size={12} />发布</button>
                      <button onClick={() => { setBoardMoreOpen(false); void downloadWebZip(); }}><Save size={12} />整包</button>
                    </> : null}
                  </div> : null}
                </div>
              </div>
              <div className="zoom-control"><button onClick={() => boardViewRef.current?.zoomOut()}>−</button><span>{Math.round(boardZoom * 100)}%</span><button onClick={() => boardViewRef.current?.zoomIn()}>+</button><button onClick={() => boardViewRef.current?.fitToContent()} title="适配全部内容"><Maximize2 size={13} /></button></div>
            </div>
        </>}
      </div>
      {viewMode === "canvas" ? <div className={`canvas-stage board-stage ${aiSelectMode ? "is-ai-select" : ""}`}>
        <BoardRenderer
          ref={boardViewRef}
          board={board}
          pages={boardPageMap}
          selectedId={boardSelectedId}
          selectedIds={boardSelectedIds}
          selectedLinkId={boardSelectedLinkId}
          onSelectObject={selectBoardObject}
          onSelectMany={selectBoardMany}
          onSelectLink={selectBoardLink}
          onRelink={relinkBoardLink}
          onMoveLinkWaypoint={moveBoardLinkWaypoint}
          onAddLink={(from, to, fromComponentId, toComponentId) => void addBoardLink(from, to, "", fromComponentId, toComponentId)}
          onOpenPage={openPageFromBoard}
          onOpenDiagram={openDiagramEditor}
          onMoveObject={moveBoardObject}
          onMoveObjects={moveBoardObjects}
          onResizeObject={resizeBoardObject}
          onMoveMarker={moveBoardMarker}
          onMoveMarkerNote={moveBoardMarkerNote}
          picking={markerPicking}
          aiSelectMode={aiSelectMode}
          onSelectComplete={handleBoardSelectComplete}
          onPickComponent={(pageObjectId, componentId, offsetX, offsetY) => {
            setMarkerDraft((previous) => ({ ...previous, pageObjectId, componentId, offsetX, offsetY }));
            setMarkerPicking(false);
            toast("success", "已选中元素", componentId);
          }}
          onViewChange={(view: BoardView) => setBoardZoom(view.zoom)}
          onDuplicateObject={(id) => void duplicateBoardObject(id)}
          onDeleteObjects={(ids) => void deleteBoardObjects(ids)}
          onZOrder={(ids, position) => void zOrderBoardObjects(ids, position)}
          snapToGrid={boardSnap}
        />
        {aiSelectMode && boardAiBarIds.length > 0 ? <div className="board-ai-bar" style={aiBarStyle(boardAiBarPos)}>
          <div className="board-ai-bar-head">
            <span className="board-ai-bar-label"><Zap size={13} />已框选 {boardAiBarIds.length} 个对象</span>
            <button className="board-ai-close" onClick={() => toggleAiSelect(false)} aria-label="关闭指令输入框并退出框选"><X size={13} /></button>
          </div>
          <pre className="board-ai-preview">{buildAiInstruction("board", boardAiBarIds, boardAiText)}</pre>
          <textarea
            className="board-ai-textarea"
            value={boardAiText}
            onChange={(event) => setBoardAiText(event.target.value)}
            placeholder="在这里输入想怎么改这些对象，例如：整体右移并加连线"
            aria-label="框选修改指令"
            rows={3}
          />
          <button className="board-ai-action" onClick={() => { void copyText(buildAiInstruction("board", boardAiBarIds, boardAiText)); setBoardAiText(""); }}><Copy size={13} />复制指令</button>
        </div> : null}
        {boardTool === "page" ? <div className="board-tool-panel">
          <div className="board-tool-head"><span>ADD PAGE</span><strong>添加页面到画布</strong><button onClick={() => setBoardTool("none")}><X size={13} /></button></div>
          {pages.filter((page) => !board.objects.some((object) => object.type === "page" && object.pageId === page.page.id)).map((page) => (
            <button key={page.page.id} className="board-tool-row" onClick={() => void addBoardPageObject(page.page.id)}><Layers3 size={13} /><span>{page.page.title}<small>{page.page.id}</small></span></button>
          ))}
          {pages.every((page) => board.objects.some((object) => object.type === "page" && object.pageId === page.page.id)) ? <div className="board-tool-empty">所有页面都已在画布上</div> : null}
        </div> : null}
        {boardTool === "marker" ? <MarkerPicker
          boardPageObjects={boardPageObjects}
          pages={boardPageMap}
          draft={markerDraft}
          picking={markerPicking}
          onChange={setMarkerDraft}
          onStartPick={() => { setMarkerPicking(true); setMarkerDraft((previous) => ({ ...previous, pageObjectId: boardPageObjects[0]?.id ?? "", componentId: "" })); }}
          onCancel={() => { setBoardTool("none"); setMarkerPicking(false); }}
          onAdd={async (pageObjectId, componentId, number, text, tone) => {
            const offsets = markerDraft.pageObjectId === pageObjectId && markerDraft.componentId === componentId
              ? { offsetX: markerDraft.offsetX, offsetY: markerDraft.offsetY }
              : {};
            await addBoardMarker(pageObjectId, componentId, number, text, tone, offsets.offsetX, offsets.offsetY);
          }}
        /> : null}
      </div> : currentPage ? <>
        <div className={`canvas-stage ${aiSelectMode ? "ai-select-stage" : ""}`}>
          <div className="preview-device" style={{ width: `${100 / (previewScale / 100)}%`, height: `${100 / (previewScale / 100)}%`, transform: `scale(${previewScale / 100})` }}>
            <div className="preview-browser-bar"><div><i /><i /><i /></div><span>prototype://local/{dsl.page.id}</span><button><RotateCcw size={12} /></button></div>
            <iframe key={currentPageId} ref={iframeRef} title={`${currentPage.page.title} Preview`} src={`/preview-runtime/${currentPageId}`} onLoad={() => { sendPreview({ type: "prototype:dsl", dsl }); if (aiSelectMode) sendPreview({ type: "prototype:ai-select", enabled: true }); }} sandbox="allow-scripts allow-same-origin allow-forms" />
          </div>
          {aiSelectMode && pageAiSelectedIds.length > 0 ? <div className="page-ai-bar" style={aiBarStyle(pageAiBarPos)}>
            <div className="board-ai-bar-head">
              <span className="board-ai-bar-label"><Zap size={13} />已框选 {pageAiSelectedIds.length} 个组件</span>
              <button className="board-ai-close" onClick={() => toggleAiSelect(false)} aria-label="关闭指令输入框并退出框选"><X size={13} /></button>
            </div>
            <pre className="board-ai-preview">{buildAiInstruction("page", pageAiSelectedIds, pageAiText)}</pre>
            <textarea
              className="board-ai-textarea"
              value={pageAiText}
              onChange={(event) => setPageAiText(event.target.value)}
              placeholder="在这里输入想怎么改这些组件，例如：把标题改成“还款流水”"
              aria-label="页面框选修改指令"
              rows={3}
            />
            <button className="board-ai-action" onClick={() => { void copyText(buildAiInstruction("page", pageAiSelectedIds, pageAiText)); setPageAiText(""); }}><Copy size={13} />复制指令</button>
          </div> : null}
        </div>
      </> : <div className="canvas-empty"><EmptyState icon={<Layers3 size={22} />} title={isDesktopRuntime() && !projectRoot ? "打开或创建本地项目" : "选择或新建一个页面"} description={isDesktopRuntime() && !projectRoot ? "点击左上角项目名，选择「打开本地项目」或「创建新项目」。只有打开真实项目目录后，才能读写文件并连接 Codex。" : "页面树为空。新建页面后，Preview、组件大纲和属性面板会在这里同步刷新。"} /></div>}
    </main>

    <aside className="studio-right">
      <div className="studio-right-content">
      {showVersions ? <>
        <PanelHeader eyebrow="PROJECT VERSIONS" title="版本管理" action={<ToolButton compact onClick={() => setShowVersions(false)}><X size={14} /></ToolButton>} />
        <div className="version-panel">
          <div className="version-current">
            <div className="version-current-head"><StatusDot tone="success">当前版本</StatusDot></div>
            <p>当前编辑内容始终作为“当前版本”，保存后形成历史版本；切换到历史版本后再编辑，会自动生成新的当前版本。</p>
          </div>
          <div className="version-save">
            <input value={newVersionLabel} onChange={(event) => setNewVersionLabel(event.target.value)} placeholder="输入版本编号，如 v1.2 / 评审版" onKeyDown={(event) => { if (event.key === "Enter") void saveNewVersion(); }} />
            <button className="is-primary" disabled={versionBusy || !newVersionLabel.trim()} onClick={() => void saveNewVersion()}>保存新版本</button>
          </div>
          <SectionTitle>版本记录</SectionTitle>
          {projectVersions.length ? projectVersions.map((version) => (
            <div className="version-row" key={version.id}>
              <div><strong>{version.label}</strong><small>{new Date(version.createdAt).toLocaleString("zh-CN", { hour12: false })}</small></div>
              <button disabled={versionBusy} onClick={() => void restoreVersion(version.id, version.label)}>切换</button>
            </div>
          )) : <div className="inspector-empty">还没有保存的版本。输入版本编号后点击“保存新版本”，即可把当前内容存为一个历史版本。</div>}
        </div>
      </> : viewMode === "canvas" ? <>
        <PanelHeader eyebrow={boardSelectedLink ? "BOARD LINK" : "BOARD OBJECT"} title={boardSelectedLink ? "连接线" : boardSelectedObject ? (boardSelectedObject.type === "page" ? "页面对象" : boardSelectedObject.type === "marker" ? "标注" : boardSelectedObject.type === "note" ? "说明" : "画布对象") : board.name} />
        {boardSelectedLink ? <div className="board-inspector board-link-inspector">
          <div className="selected-path"><span>{board.id}</span><ChevronRight size={10} /><b>{boardSelectedLink.id}</b></div>
          <div className="inspector-body">
            <SectionTitle>连接说明</SectionTitle>
            <label className="inspector-field"><span>内容</span><input value={String(boardDraft.label ?? "")} onChange={(event) => setBoardDraft({ ...boardDraft, label: event.target.value })} onBlur={() => updateBoardLink({ label: String(boardDraft.label ?? "") || undefined })} placeholder="例如：提交后进入" /></label>
            <div className="board-link-style-grid">
              <label><span>字号</span><select value={String(boardDraft.labelSize ?? 10)} onChange={(event) => { const labelSize = Number(event.target.value); setBoardDraft({ ...boardDraft, labelSize }); updateBoardLink({ labelSize }); }}><option value="8">小 · 8px</option><option value="10">标准 · 10px</option><option value="12">中 · 12px</option><option value="14">大 · 14px</option><option value="18">特大 · 18px</option></select></label>
              <label className="board-color-field"><span>字色</span><div><input type="color" value={String(boardDraft.labelColor ?? boardSelectedLink.labelColor ?? "#1f2937")} onChange={(event) => { const labelColor = event.target.value; setBoardDraft({ ...boardDraft, labelColor }); updateBoardLink({ labelColor }); }} /><code>{String(boardDraft.labelColor ?? boardSelectedLink.labelColor ?? "#1f2937")}</code></div></label>
            </div>
            <SectionTitle>线条样式</SectionTitle>
            <div className="board-link-style-grid">
              <label><span>路径类型</span><select value={String(boardDraft.lineType ?? "curve")} onChange={(event) => { const lineType = event.target.value as NonNullable<BoardLink["lineType"]>; setBoardDraft({ ...boardDraft, lineType }); updateBoardLink({ lineType }); }}><option value="curve">曲线</option><option value="straight">直线</option><option value="orthogonal">折线</option></select></label>
              <label><span>粗细</span><select value={String(boardDraft.strokeWidth ?? 2.5)} onChange={(event) => { const strokeWidth = Number(event.target.value); setBoardDraft({ ...boardDraft, strokeWidth }); updateBoardLink({ strokeWidth }); }}><option value="1">细 · 1px</option><option value="2.5">标准 · 2.5px</option><option value="4">粗 · 4px</option><option value="6">强调 · 6px</option></select></label>
            </div>
            <label className="inspector-field board-color-field"><span>颜色</span><div><input type="color" value={String(boardDraft.color ?? "#2563eb")} onChange={(event) => { const color = event.target.value; setBoardDraft({ ...boardDraft, color }); updateBoardLink({ color }); }} /><code>{String(boardDraft.color ?? "#2563eb")}</code></div></label>
          </div>
          <div className="inspector-footer"><button className="is-danger" onClick={() => { void runBoardCommands([{ type: "DELETE_BOARD_LINK", target: boardSelectedLink.id }]); setBoardSelectedLinkId(undefined); }}><Trash2 size={13} />删除连线</button><span>{boardSelectedLink.lineType ?? "curve"}</span></div>
        </div> : !boardSelectedObject ? <EmptyState icon={<LayoutGrid size={18} />} title="选择画布对象或连线" description="点击画布上的页面、说明、标注或连线，在这里编辑它们的属性。" /> : <div className="board-inspector">
          <div className="selected-path"><span>{board.id}</span><ChevronRight size={10} /><b>{boardSelectedObject.id}</b></div>
          <div className="inspector-body">
            {boardSelectedObject.type !== "marker" ? <>
              <SectionTitle>位置与尺寸</SectionTitle>
              <div className="board-fields">
                <label><span>X</span><input type="number" step={1} value={String(boardDraft.x ?? boardSelectedObject.x)} onChange={(event) => setBoardDraft({ ...boardDraft, x: event.target.value })} onBlur={commitBoardPosition} /></label>
                <label><span>Y</span><input type="number" step={1} value={String(boardDraft.y ?? boardSelectedObject.y)} onChange={(event) => setBoardDraft({ ...boardDraft, y: event.target.value })} onBlur={commitBoardPosition} /></label>
                <label><span>宽</span><input type="number" step={5} min={40} value={String(boardDraft.width ?? boardSelectedObject.width)} onChange={(event) => setBoardDraft({ ...boardDraft, width: event.target.value })} onBlur={commitBoardPosition} /></label>
                <label><span>高</span><input type="number" step={5} min={40} value={String(boardDraft.height ?? boardSelectedObject.height)} onChange={(event) => setBoardDraft({ ...boardDraft, height: event.target.value })} onBlur={commitBoardPosition} /></label>
              </div>
            </> : null}
            {boardSelectedObject.type === "note" ? <>
              <SectionTitle>说明内容</SectionTitle>
              <textarea value={String(boardDraft.text ?? "")} onChange={(event) => setBoardDraft({ ...boardDraft, text: event.target.value })} onBlur={commitBoardText} rows={4} />
            </> : null}
            {boardSelectedObject.type === "marker" ? <>
              <SectionTitle>标注</SectionTitle>
              <label className="inspector-field"><span>标注序号</span><input value={String(boardDraft.number ?? boardSelectedObject.number)} onChange={(event) => setBoardDraft({ ...boardDraft, number: event.target.value })} onBlur={commitBoardNumber} placeholder="可自定义，如 A1 / 5 / B-2" /></label>
              <div className="readonly-value"><code>{boardSelectedObject.tone}</code><i>挂靠组件</i></div>
              <textarea value={String(boardDraft.text ?? boardSelectedObject.text)} onChange={(event) => setBoardDraft({ ...boardDraft, text: event.target.value })} onBlur={commitBoardText} rows={3} />
              <div className="board-tones">{markerTones.map((tone) => <button key={tone} className={`board-tone board-tone--${tone} ${boardSelectedObject.tone === tone ? "is-active" : ""}`} title={tone} onClick={() => void runBoardCommands([{ type: "UPDATE_BOARD_OBJECT", target: boardSelectedObject.id, changes: { tone } }])} />)}</div>
              <div className="board-anchor-info">挂靠：{boardSelectedObject.anchor.pageObjectId} / {boardSelectedObject.anchor.componentId}</div>
            </> : null}
            {boardSelectedObject.type === "page" ? <>
              <SectionTitle>页面</SectionTitle>
              <div className="readonly-value"><code>{boardSelectedObject.pageId}</code><i>引用页面</i></div>
              <button className="inspector-action" onClick={() => openPageFromBoard(boardSelectedObject.pageId)}><Monitor size={13} />打开页面编辑</button>
            </> : null}
            {boardSelectedObject.type === "flowchart" ? <>
              <SectionTitle>流程图</SectionTitle>
              <div className="diagram-launch-card"><GitBranch size={20} /><div><strong>{boardSelectedObject.flowchart.nodes.length} 个节点</strong><span>双击图块，或打开独立编辑器拖动节点与连线。</span></div></div>
              <button className="inspector-action is-primary" onClick={() => openDiagramEditor(boardSelectedObject.id)}><Maximize2 size={13} />打开流程图编辑器</button>
            </> : null}
            {boardSelectedObject.type === "er" ? <>
              <SectionTitle>ER 图</SectionTitle>
              <div className="diagram-launch-card"><Database size={20} /><div><strong>{boardSelectedObject.er.entities.length} 个实体</strong><span>在独立编辑器中管理字段、关系和实体位置。</span></div></div>
              <button className="inspector-action is-primary" onClick={() => openDiagramEditor(boardSelectedObject.id)}><Maximize2 size={13} />打开 ER 图编辑器</button>
            </> : null}
          </div>
          <div className="inspector-footer"><button className="is-danger" onClick={() => void deleteBoardObject(boardSelectedObject.id)}><Trash2 size={13} />删除对象</button><span>{boardSelectedObject.type}</span></div>
        </div>}
      </> : !currentPage ? <EmptyState icon={<Layers3 size={18} />} title="暂无页面" description="从左侧新建页面后，可在此查看组件属性和 Revision。" /> : showDsl ? <>
        <PanelHeader eyebrow="READ ONLY" title="当前页面 DSL" action={<ToolButton compact onClick={() => setShowDsl(false)}><X size={14} /></ToolButton>} />
        <pre className="dsl-view">{JSON.stringify(dsl, null, 2)}</pre>
      </> : selected ? <>
        <PanelHeader eyebrow={selected.type.toUpperCase()} title={selected.label ?? selected.title ?? selected.text ?? "组件属性"} action={<ToolButton compact><MoreHorizontal size={14} /></ToolButton>} />
        <div className="selected-path"><span>{dsl.page.id}</span><ChevronRight size={10} /><b>{selected.id}</b></div>
        <div className="inspector-body">
          <SectionTitle>基础属性</SectionTitle>
          <label className="inspector-field"><span>组件 ID</span><div className="readonly-value"><code>{selected.id}</code><i>稳定</i></div></label>
          <label className="inspector-field"><span>{selected.type === "button" ? "按钮文字" : selected.title ? "标题" : "名称"}</span><input value={String(selected.text ?? selected.title ?? selected.label ?? "")} onChange={(event) => updateSelected(selected.type === "button" ? { text: event.target.value } : selected.title ? { title: event.target.value } : { label: event.target.value })} /></label>
          <label className="inspector-field"><span>组件类型</span><select value={selected.type} onChange={(event) => updateSelected({ type: event.target.value as UIComponent["type"] })}>{[selected.type, ...(selected.type === "modal" ? ["drawer"] : selected.type === "drawer" ? ["modal"] : [])].filter((value, index, array) => array.indexOf(value) === index).map((type) => <option key={type}>{type}</option>)}</select></label>
          {!["button", "table", "modal", "drawer", "popover"].includes(selected.type) ? <label className="inspector-field"><span>Placeholder</span><input value={String(selected.placeholder ?? "")} placeholder="未设置" onChange={(event) => updateSelected({ placeholder: event.target.value })} /></label> : null}
          {["select", "tree-select", "radio"].includes(selected.type) ? <><SectionTitle>选择项配置</SectionTitle><OptionsEditor component={selected} onChange={(options) => updateSelected({ options })} /></> : null}
          <SectionTitle>行为与状态</SectionTitle>
          <div className="inspector-toggle-list">
            <Toggle checked={selected.visible !== false} onChange={(value) => updateSelected({ visible: value })} label="显示组件" />
            <Toggle checked={Boolean(selected.validation?.required)} onChange={(value) => updateSelected({ validation: { ...selected.validation, required: value } })} label="必填" />
            <Toggle checked={Boolean(selected.disabled)} onChange={(value) => updateSelected({ disabled: value })} label="禁用" />
          </div>
          <SectionTitle>尺寸</SectionTitle>
          <div className="segmented-control">{["small", "medium", "large", "full"].map((size) => <button key={size} className={(selected.size ?? "medium") === size ? "is-active" : ""} onClick={() => updateSelected({ size: size as UIComponent["size"] })}>{size[0]!.toUpperCase()}</button>)}</div>
          <SectionTitle>来源</SectionTitle>
          <div className="source-card"><div className={`source-badge source-badge--${selected.source ?? "default"}`}>{selected.source ?? "Default"}</div><div><strong>{selected.source === "explicit" ? "需求明确说明" : selected.source === "inferred" ? "AI 推断" : "系统默认"}</strong><span>来源信息不会随属性编辑丢失</span></div></div>
          {selected.type === "table" && isModulePage ? <>
            <SectionTitle>文档表格</SectionTitle>
            <div className="doc-table-editor">
              <div className="doc-table-editor-cols">
                {(selected.columns ?? []).map((column, columnIndex) => (
                  <div className="doc-table-editor-col" key={column.id}>
                    <input value={column.title ?? ""} placeholder={`列${columnIndex + 1}`} onChange={(event) => updateSelectedColumn(columnIndex, { title: event.target.value })} />
                    <button title="删除列" onClick={() => deleteTableColumn(columnIndex)}><X size={11} /></button>
                  </div>
                ))}
                <button className="doc-table-editor-add" onClick={addTableColumn}><Plus size={11} />加列</button>
              </div>
              <div className="doc-table-editor-rows">
                {(selected.rows ?? []).map((row, rowIndex) => (
                  <div className="doc-table-editor-row" key={String(row[selected.rowKey ?? "id"] ?? rowIndex)}>
                    <span className="doc-table-editor-index">{rowIndex + 1}</span>
                    {(selected.columns ?? []).map((column) => (
                      <input key={column.id} value={String(row[column.dataIndex] ?? "")} onChange={(event) => updateTableCell(rowIndex, column.dataIndex, event.target.value)} />
                    ))}
                    <button title="删除行" onClick={() => deleteTableRow(rowIndex)}><X size={11} /></button>
                  </div>
                ))}
                <button className="doc-table-editor-add" onClick={addTableRow}><Plus size={11} />加行</button>
              </div>
            </div>
          </> : null}
          <SectionTitle>画布</SectionTitle>
          <button className="inspector-action" onClick={() => void addMarkerToCurrentComponent()}><MapPin size={13} />添加标注（挂靠此组件）</button>
        </div>
        <div className="inspector-footer"><button onClick={() => setShowDsl(true)}><Braces size={13} />查看 DSL 节点</button><span>{selectedLocation?.path}</span></div>
      </> : <EmptyState icon={<CircleHelp size={18} />} title="选择一个组件" description="点击 Preview 或左侧组件大纲，在这里查看并修改属性。" />}
      </div>
    </aside>

    {appModal ? <div className="settings-overlay" onClick={() => setAppModal(undefined)}>
      <section className="app-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <div><span>{appModal.kind === "confirm" ? "CONFIRM" : "INPUT"}</span><h2>{appModal.title}</h2></div>
          <button onClick={() => setAppModal(undefined)} aria-label="关闭对话框"><X size={14} /></button>
        </header>
        <div className="app-modal-body">
          {appModal.kind === "confirm" ? <p>{appModal.message}</p>
            : <label><span>{appModal.label}</span><input autoFocus value={modalValue} onChange={(event) => setModalValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") confirmModal(); if (event.key === "Escape") setAppModal(undefined); }} aria-label={appModal.label} /></label>}
        </div>
        <footer>
          <button onClick={() => setAppModal(undefined)}>取消</button>
          <button className={appModal.kind === "confirm" && appModal.danger ? "is-danger" : "is-primary"} onClick={confirmModal}>{appModal.confirmText}</button>
        </footer>
      </section>
    </div> : null}

    {boardExportOpen ? <div className="settings-overlay" onClick={() => setBoardExportOpen(false)}>
      <section className="settings-card board-export-card" onClick={(event) => event.stopPropagation()}>
        <header>
          <div><span>EXPORT</span><h2>导出画布 HTML</h2></div>
          <button onClick={() => setBoardExportOpen(false)} aria-label="关闭导出"><X size={14} /></button>
        </header>
        <div className="board-export-options">
          <button onClick={() => { setBoardExportOpen(false); exportBoardHtml("content", "current"); }}>
            <strong>当前画布</strong>
            <small>导出“{board.name}”为单文件 HTML，不含标注汇总栏。</small>
          </button>
          <button onClick={() => { setBoardExportOpen(false); exportBoardHtml("with-annotations", "current"); }}>
            <strong>当前画布 + 标注</strong>
            <small>当前画布内容加右侧标注汇总面板，适合评审。</small>
          </button>
          {webMode ? <button onClick={() => { setBoardExportOpen(false); exportBoardHtml("content", "all"); }}>
            <strong>全部画布</strong>
            <small>生成带画布导航的自包含 HTML，一次只显示选中的画布。</small>
          </button> : null}
        </div>
      </section>
    </div> : null}

    {showSettings ? <div className="settings-overlay" onClick={() => setShowSettings(false)}>
      <section className="settings-card" onClick={(event) => event.stopPropagation()}>
        <header>
          <div><span>SETTINGS</span><h2>设置</h2></div>
          <button onClick={() => setShowSettings(false)} aria-label="关闭设置"><X size={14} /></button>
        </header>
        <div className="settings-layout">
          <nav className="settings-nav">
            <button className={settingsSection === "account" ? "is-active" : ""} onClick={() => setSettingsSection("account")}><UserRound size={13} />账户信息</button>
            {webMode ? <button className={settingsSection === "connection" ? "is-active" : ""} onClick={() => setSettingsSection("connection")}><KeyRound size={13} />连接 Codex</button> : null}
            {isDesktopRuntime() ? <button className={settingsSection === "local" ? "is-active" : ""} onClick={() => setSettingsSection("local")}><FolderOpen size={13} />本地项目</button> : null}
          </nav>
          <div className="settings-content">
            {settingsSection === "account" ? <>
              <div className="settings-block">
                <div className="settings-profile">
                  <div className="settings-avatar">{(webSession?.name ?? isDesktopRuntime() ? "本" : "未").slice(0, 1).toUpperCase()}</div>
                  <div><strong>{webSession?.name ?? (isDesktopRuntime() ? "桌面端" : "未登录")}</strong><small>{webSession?.email ?? (isDesktopRuntime() ? "本地项目 · Local" : "请登录后使用云端功能")}</small></div>
                </div>
              </div>
              {webMode ? <div className="settings-block settings-account-actions">
                <button className="settings-logout" onClick={() => void handleLogout()}><LogOut size={13} />退出登录</button>
              </div> : null}
            </> : null}
            {settingsSection === "connection" && webMode ? <>
              <div className="settings-block">
                <div className="settings-block-head"><div><span>API TOKEN</span><strong>Codex / WorkBuddy 连接令牌</strong><small>复制后用于 MCP 认证</small></div></div>
                <div className="settings-token-row">
                  <code className="settings-token">{webApiToken ? `${webApiToken.slice(0, 12)}…${webApiToken.slice(-4)}` : "获取中…"}</code>
                  <button onClick={() => void copyText(webApiToken)} disabled={!webApiToken}><Copy size={13} />复制</button>
                </div>
              </div>
              <div className="settings-block">
                <div className="settings-block-head"><div><span>CODEX</span><strong>连接 Codex</strong><small>复制提示词后粘贴到 Codex 对话，它会自动写入配置并连接，无需其他操作</small></div></div>
                <button className="settings-prompt-btn" onClick={() => void copyText(codexConnectPrompt)} disabled={!codexConnectPrompt}><Copy size={13} />复制 Codex 连接提示词</button>
                <pre className="settings-code">{"[mcp_servers.prototype-studio]\ntype = \"http\"\nurl = \"" + window.location.origin + "/mcp\"\nbearer_token = \"••••••••\""}</pre>
              </div>
              <div className="settings-block">
                <div className="settings-block-head"><div><span>WORKBUDDY</span><strong>连接 WorkBuddy</strong><small>复制提示词后粘贴到 WorkBuddy 对话，它会按自身方式注册 MCP 服务并连接</small></div></div>
                <button className="settings-prompt-btn" onClick={() => void copyText(workbuddyConnectPrompt)} disabled={!workbuddyConnectPrompt}><Copy size={13} />复制 WorkBuddy 连接提示词</button>
              </div>
            </> : null}
            {settingsSection === "local" && isDesktopRuntime() ? (mcpConnection ? <>
              <div className="settings-block">
                <div className="settings-block-head"><div><span>LOCAL MCP</span><strong>本地项目连接</strong></div></div>
                <div className="settings-row"><span>项目目录</span><code>{mcpConnection.projectRoot ?? "未打开项目"}</code></div>
                <div className="settings-row">
                  <span>Local MCP</span>
                  <StatusDot tone={mcpConnection.state === "running" ? "success" : mcpConnection.state === "unavailable" ? "danger" : "neutral"}>{mcpConnection.state}</StatusDot>
                  {mcpConnection.state !== "running" ? <button className="settings-restart" onClick={() => void launchMcp()}>启动</button> : <button className="settings-restart" onClick={() => void launchMcp()}>重启</button>}
                </div>
                {mcpConnection.detail ? <div className="settings-note">{mcpConnection.detail}</div> : null}
                <div className="settings-block-head">
                  <div><span>STEP 1</span><strong>复制 MCP 配置</strong><small>粘贴到 ~/.codex/config.toml 后重启</small></div>
                  <button onClick={() => void copyText(mcpConnection.configToml ?? "")} disabled={!mcpConnection.configToml}><Copy size={13} />复制</button>
                </div>
                <pre>{mcpConnection.configToml ?? "需要先打开本地项目"}</pre>
                <div className="settings-block-head">
                  <div><span>STEP 2</span><strong>复制协作提示词</strong><small>粘贴到 Codex 对话</small></div>
                  <button onClick={() => void copyText(mcpConnection.connectPrompt ?? "")} disabled={!mcpConnection.connectPrompt}><Copy size={13} />复制</button>
                </div>
                <pre>{mcpConnection.connectPrompt ?? "需要先打开本地项目"}</pre>
              </div>
            </> : <div className="settings-note">正在读取连接信息…</div>) : null}
          </div>
        </div>
      </section>
    </div> : null}

    {publishOpen ? <div className="settings-overlay" onClick={() => setPublishOpen(false)}>
      <section className="publish-drawer" onClick={(event) => event.stopPropagation()}>
        <header>
          <div><span>PUBLISH</span><h2>发布项目</h2></div>
          <button onClick={() => setPublishOpen(false)} aria-label="关闭发布"><X size={14} /></button>
        </header>
        <div className="publish-body">
          {publishLinks.length ? publishLinks.map((link) => {
            const expires = link.expiresAt ? new Date(link.expiresAt) : null;
            return (
              <div className="publish-live" key={link.token}>
                <div className="publish-live-head"><StatusDot tone="success">已发布</StatusDot><small>任何人可访问</small></div>
                <div className="publish-link-row">
                  <code>{link.url}</code>
                  <button onClick={() => void copyText(link.url)} disabled={publishBusy}><Copy size={13} />复制</button>
                </div>
                <div className="publish-meta">
                  <span>有效期</span>
                  <strong>{expires ? `${expires.toLocaleDateString("zh-CN")} ${expires.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 过期` : "永久有效"}</strong>
                </div>
                <div className="publish-meta">
                  <span>创建时间</span>
                  <strong>{new Date(link.createdAt).toLocaleString("zh-CN")}</strong>
                </div>
                <button className="publish-close" onClick={() => void closePublishWebProject(link.token)} disabled={publishBusy}><X size={13} />关闭发布</button>
              </div>
            );
          }) : <>
            <div className="publish-intro">
              <strong>发布为公共链接</strong>
              <p>发布后，任何人可以通过链接查看当前项目画布，无需登录。发布内容随项目修改实时更新。</p>
            </div>
            <label className="publish-expiry-field"><span>有效期</span>
              <select value={publishExpiry} onChange={(event) => setPublishExpiry(event.target.value)}>
                <option value="7">7 天</option>
                <option value="30">30 天</option>
                <option value="90">90 天</option>
                <option value="365">365 天</option>
                <option value="forever">永久有效</option>
              </select>
            </label>
            <button className="publish-action" onClick={() => void publishWebProject()} disabled={publishBusy}><Share2 size={14} />{publishBusy ? "发布中…" : "发布"}</button>
          </>}
        </div>
      </section>
    </div> : null}

    {diagramEditor && diagramEditorObject ? <Suspense fallback={<div className="diagram-editor-loading"><GitBranch size={22} /><strong>正在打开图形编辑器…</strong></div>}>
      <DiagramEditor object={diagramEditorObject} boardRevision={diagramEditor.baseRevision} onSave={saveDiagramObject} onClose={() => setDiagramEditor(undefined)} />
    </Suspense> : null}

    <div className="toast-stack">{toasts.map((item) => <div key={item.id} className={`studio-toast studio-toast--${item.tone}`}><span><i /></span><div><strong>{item.title}</strong>{item.detail ? <p>{item.detail}</p> : null}</div><button onClick={() => setToasts((items) => items.filter((toast) => toast.id !== item.id))}><X size={13} /></button></div>)}</div>
  </div>;
}
