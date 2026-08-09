import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type WheelEvent as ReactWheelEvent } from "react";
import {
  Box,
  Braces,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Command as CommandIcon,
  Copy,
  Database,
  Download,
  FileCheck2,
  FileText,
  FolderOpen,
  GripVertical,
  GitBranch,
  History,
  Layers3,
  LayoutPanelLeft,
  LayoutGrid,
  Link2,
  Maximize2,
  MapPin,
  Monitor,
  MoreHorizontal,
  Pencil,
  PanelRight,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Share2,
  Sparkles,
  StickyNote,
  Trash2,
  Undo2,
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
  type BoardMarkerObject,
  type BoardNoteObject,
  type BoardObject,
  type BoardFlowchartObject,
  type BoardErObject,
  type Command,
  type MarkerTone,
  type PageDSL,
  type RevisionRecord,
  type UIComponent
} from "@prototype-studio/dsl-schema";
import { applyBoardCommands, createRevertRevision, diffDsl, executeCommands, type DslDiffEntry } from "@prototype-studio/command-engine";
import { collectComponentLocations, getComponentLocation, validateDSL } from "@prototype-studio/dsl-validator";
import { BoardRenderer } from "@prototype-studio/renderer";
import { EmptyState, Keycap, PanelHeader, StatusDot, ToolButton } from "@prototype-studio/design-system";
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
import {
  confirmPagePlan,
  createBoardFromTemplates,
  createPagePlan,
  createPagePlanFromTemplates,
  deterministicRequirementParser,
  generateConfirmedPageDSLs,
  parseRequirementTemplates,
  requirementModelFromTemplates,
  type PagePlan,
  type RequirementTemplates
} from "@prototype-studio/requirement-engine/browser";
import type { RequirementModel } from "@prototype-studio/dsl-schema";
import { webAuth, webMode, webProjects, webSpace, type WebUser } from "./webBridge";
import { AuthScreen, ProjectsScreen } from "./WebScreens";

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

function defaultBoardFromPages(pages: PageDSL[], id = "web-board"): BoardDSL {
  return {
    dslVersion: DSL_VERSION,
    id,
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

function MarkerPicker({ boardPageObjects, pages, onCancel, onAdd }: {
  boardPageObjects: Array<Extract<BoardObject, { type: "page" }>>;
  pages: Record<string, PageDSL>;
  onCancel: () => void;
  onAdd: (pageObjectId: string, componentId: string, text: string, tone: MarkerTone) => void;
}) {
  const [pageObjectId, setPageObjectId] = useState(boardPageObjects[0]?.id ?? "");
  const [componentId, setComponentId] = useState("");
  const [text, setText] = useState("");
  const [tone, setTone] = useState<MarkerTone>("orange");
  const pageDsl = pageObjectId ? pages[boardPageObjects.find((object) => object.id === pageObjectId)?.pageId ?? ""] : undefined;
  const components = pageDsl ? collectComponentLocations(pageDsl).map(({ component }) => component.id) : [];
  return (
    <div className="board-tool-panel">
      <div className="board-tool-head"><span>ADD MARKER</span><strong>添加标注</strong><button onClick={onCancel} aria-label="关闭标注面板"><X size={13} /></button></div>
      <label><span>挂靠页面</span>
        <select value={pageObjectId} onChange={(event) => { setPageObjectId(event.target.value); setComponentId(""); }}>
          {boardPageObjects.map((object) => <option key={object.id} value={object.id}>{pages[object.pageId]?.page.title ?? object.pageId}</option>)}
        </select>
      </label>
      <label><span>挂靠组件</span>
        <select value={componentId} onChange={(event) => setComponentId(event.target.value)} disabled={!pageDsl}>
          <option value="">选择组件</option>
          {components.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      </label>
      <label><span>颜色</span>
        <select value={tone} onChange={(event) => setTone(event.target.value as MarkerTone)}>
          {markerTones.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
      <label><span>说明文字</span><input value={text} onChange={(event) => setText(event.target.value)} placeholder="标注内容…" /></label>
      <div className="board-tool-actions">
        <button onClick={onCancel}>取消</button>
        <button className="is-primary" disabled={!pageObjectId || !componentId} onClick={() => onAdd(pageObjectId, componentId, text, tone)}>添加</button>
      </div>
    </div>
  );
}

function FlowchartEditor({ object, onChange }: {
  object: Extract<BoardObject, { type: "flowchart" }>;
  onChange: (flowchart: BoardFlowchartObject["flowchart"]) => void;
}) {
  const [draft, setDraft] = useState(object.flowchart);
  useEffect(() => setDraft(object.flowchart), [object]);
  return (
    <div className="board-editor">
      <div className="board-editor-sub"><strong>节点</strong><button onClick={() => setDraft((value) => ({ ...value, nodes: [...value.nodes, { id: `node-${value.nodes.length + 1}`, label: "新节点" }] }))}>+ 节点</button></div>
      {draft.nodes.map((node, index) => (
        <div className="board-editor-row" key={node.id}>
          <code>{node.id}</code>
          <input value={node.label} onChange={(event) => setDraft((value) => ({ ...value, nodes: value.nodes.map((item, i) => i === index ? { ...item, label: event.target.value } : item) }))} />
          <button title="删除节点" onClick={() => setDraft((value) => ({ ...value, nodes: value.nodes.filter((_, i) => i !== index), edges: value.edges.filter((edge) => edge.from !== node.id && edge.to !== node.id) }))}><X size={11} /></button>
        </div>
      ))}
      <div className="board-editor-sub"><strong>连线</strong><button onClick={() => setDraft((value) => ({ ...value, edges: [...value.edges, { id: `edge-${value.edges.length + 1}`, from: value.nodes[0]?.id ?? "", to: value.nodes[1]?.id ?? value.nodes[0]?.id ?? "" }] }))}>+ 连线</button></div>
      {draft.edges.map((edge, index) => (
        <div className="board-editor-row" key={edge.id}>
          <select value={edge.from} onChange={(event) => setDraft((value) => ({ ...value, edges: value.edges.map((item, i) => i === index ? { ...item, from: event.target.value } : item) }))}>{draft.nodes.map((node) => <option key={node.id} value={node.id}>{node.label || node.id}</option>)}</select>
          <select value={edge.to} onChange={(event) => setDraft((value) => ({ ...value, edges: value.edges.map((item, i) => i === index ? { ...item, to: event.target.value } : item) }))}>{draft.nodes.map((node) => <option key={node.id} value={node.id}>{node.label || node.id}</option>)}</select>
          <input value={edge.label ?? ""} placeholder="说明" onChange={(event) => setDraft((value) => ({ ...value, edges: value.edges.map((item, i) => i === index ? { ...item, label: event.target.value } : item) }))} />
          <button title="删除连线" onClick={() => setDraft((value) => ({ ...value, edges: value.edges.filter((_, i) => i !== index) }))}><X size={11} /></button>
        </div>
      ))}
      <button className="board-editor-save" onClick={() => onChange(draft)}>保存流程图</button>
    </div>
  );
}

function ErEditor({ object, onChange }: {
  object: Extract<BoardObject, { type: "er" }>;
  onChange: (er: BoardErObject["er"]) => void;
}) {
  const [draft, setDraft] = useState(object.er);
  useEffect(() => setDraft(object.er), [object]);
  return (
    <div className="board-editor">
      <div className="board-editor-sub"><strong>实体</strong><button onClick={() => setDraft((value) => ({ ...value, entities: [...value.entities, { id: `entity-${value.entities.length + 1}`, name: "新实体", fields: [{ name: "id", type: "string", key: true }] }] }))}>+ 实体</button></div>
      {draft.entities.map((entity, entityIndex) => (
        <div className="board-editor-entity" key={entity.id}>
          <div className="board-editor-row">
            <code>{entity.id}</code>
            <input value={entity.name} onChange={(event) => setDraft((value) => ({ ...value, entities: value.entities.map((item, i) => i === entityIndex ? { ...item, name: event.target.value } : item) }))} />
            <button title="删除实体" onClick={() => setDraft((value) => ({ ...value, entities: value.entities.filter((_, i) => i !== entityIndex), relations: value.relations.filter((relation) => relation.from !== entity.id && relation.to !== entity.id) }))}><X size={11} /></button>
          </div>
          {entity.fields.map((field, fieldIndex) => (
            <div className="board-editor-row board-editor-field" key={`${entity.id}-${field.name}`}>
              <input value={field.name} placeholder="字段名" onChange={(event) => setDraft((value) => ({ ...value, entities: value.entities.map((item, i) => i === entityIndex ? { ...item, fields: item.fields.map((f, fi) => fi === fieldIndex ? { ...f, name: event.target.value } : f) } : item) }))} />
              <input value={field.type} placeholder="类型" onChange={(event) => setDraft((value) => ({ ...value, entities: value.entities.map((item, i) => i === entityIndex ? { ...item, fields: item.fields.map((f, fi) => fi === fieldIndex ? { ...f, type: event.target.value } : f) } : item) }))} />
              <label className="board-key-toggle"><input type="checkbox" checked={Boolean(field.key)} onChange={(event) => setDraft((value) => ({ ...value, entities: value.entities.map((item, i) => i === entityIndex ? { ...item, fields: item.fields.map((f, fi) => fi === fieldIndex ? { ...f, key: event.target.checked } : f) } : item) }))} />主键</label>
              <button title="删除字段" onClick={() => setDraft((value) => ({ ...value, entities: value.entities.map((item, i) => i === entityIndex ? { ...item, fields: item.fields.filter((_, fi) => fi !== fieldIndex) } : item) }))}><X size={11} /></button>
            </div>
          ))}
          <button className="board-editor-mini" onClick={() => setDraft((value) => ({ ...value, entities: value.entities.map((item, i) => i === entityIndex ? { ...item, fields: [...item.fields, { name: "field", type: "string" }] } : item) }))}>+ 字段</button>
        </div>
      ))}
      <div className="board-editor-sub"><strong>关系</strong><button onClick={() => setDraft((value) => ({ ...value, relations: [...value.relations, { id: `relation-${value.relations.length + 1}`, from: value.entities[0]?.id ?? "", fromField: value.entities[0]?.fields[0]?.name ?? "", to: value.entities[1]?.id ?? value.entities[0]?.id ?? "", toField: value.entities[0]?.fields[0]?.name ?? "", cardinality: "many-to-one" }] }))}>+ 关系</button></div>
      {draft.relations.map((relation, index) => (
        <div className="board-editor-row" key={relation.id}>
          <select value={relation.from} onChange={(event) => setDraft((value) => ({ ...value, relations: value.relations.map((item, i) => i === index ? { ...item, from: event.target.value } : item) }))}>{draft.entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select>
          <input value={relation.fromField} placeholder="字段" onChange={(event) => setDraft((value) => ({ ...value, relations: value.relations.map((item, i) => i === index ? { ...item, fromField: event.target.value } : item) }))} />
          <span>→</span>
          <select value={relation.to} onChange={(event) => setDraft((value) => ({ ...value, relations: value.relations.map((item, i) => i === index ? { ...item, to: event.target.value } : item) }))}>{draft.entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select>
          <input value={relation.toField} placeholder="字段" onChange={(event) => setDraft((value) => ({ ...value, relations: value.relations.map((item, i) => i === index ? { ...item, toField: event.target.value } : item) }))} />
          <button title="删除关系" onClick={() => setDraft((value) => ({ ...value, relations: value.relations.filter((_, i) => i !== index) }))}><X size={11} /></button>
        </div>
      ))}
      <button className="board-editor-save" onClick={() => onChange(draft)}>保存 ER 图</button>
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

function DiffView({ entries }: { entries: DslDiffEntry[] }) {
  if (!entries.length) return <div className="history-empty">本次没有可显示的字段变化</div>;
  return <div className="diff-list">{entries.slice(0, 20).map((entry) => <div key={entry.path} className={`diff-entry diff-entry--${entry.kind}`}>
    <code>{entry.path}</code>
    <div><span>{entry.before === undefined ? "∅" : JSON.stringify(entry.before)}</span><b>→</b><span>{entry.after === undefined ? "∅" : JSON.stringify(entry.after)}</span></div>
  </div>)}</div>;
}

function parseLocalCommand(prompt: string, selected?: UIComponent): Command[] | undefined {
  if (!selected) return undefined;
  const normalized = prompt.trim().toLowerCase();
  if (normalized.includes("不必填") || normalized.includes("取消必填")) {
    return [{ type: "UPDATE_COMPONENT", target: selected.id, changes: { validation: { ...selected.validation, required: false } } }];
  }
  if (normalized.includes("必填")) {
    return [{ type: "UPDATE_COMPONENT", target: selected.id, changes: { validation: { ...selected.validation, required: true } } }];
  }
  if (normalized.includes("drawer") || normalized.includes("抽屉")) {
    return [{ type: selected.type === "modal" || selected.type === "drawer" ? "UPDATE_OVERLAY" : "UPDATE_COMPONENT", target: selected.id, changes: { type: "drawer" } } as Command];
  }
  if (normalized.includes("modal") || normalized.includes("弹窗")) {
    return [{ type: selected.type === "modal" || selected.type === "drawer" ? "UPDATE_OVERLAY" : "UPDATE_COMPONENT", target: selected.id, changes: { type: "modal" } } as Command];
  }
  const label = prompt.match(/(?:名称|标题|label)\s*(?:改成|设为|为)\s*[“"']?([^”"']+)[”"']?/i)?.[1]?.trim();
  if (label) return [{ type: "UPDATE_COMPONENT", target: selected.id, changes: selected.type === "button" ? { text: label } : { label } }];
  return undefined;
}

export function App() {
  const initialPages = useMemo(() => (isDesktopRuntime() ? [] : [structuredClone(caseListExample)]), []);
  const [pages, setPages] = useState<PageDSL[]>(initialPages);
  const [currentPageId, setCurrentPageId] = useState<string | null>(initialPages[0]?.page.id ?? null);
  const [selectedId, setSelectedId] = useState<string>(initialPages[0] ? "search.status" : "");
  const [history, setHistory] = useState<RevisionRecord[]>([]);
  const [redoStack, setRedoStack] = useState<RevisionRecord[]>([]);
  const [command, setCommand] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showDsl, setShowDsl] = useState(false);
  const [previewScale, setPreviewScale] = useState(82);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [previewReady, setPreviewReady] = useState(false);
  const [activeWorkspace, setActiveWorkspace] = useState<"pages" | "requirements">("pages");
  const [requirementText, setRequirementText] = useState(`# 案件批量分配

## 页面
- 案件管理列表页

## 功能
- 支持勾选案件并批量分配
- 点击批量分配后打开弹窗

## 业务规则
- 单次最多选择 500 条
- 已锁定案件不可分配

## 权限
- 只有主管和管理员可以批量分配

## 校验
- 催收员必填
- 备注最多 200 字

## 交互
- 提交成功后关闭弹窗并刷新列表`);
  const [requirementModel, setRequirementModel] = useState<RequirementModel>();
  const [pagePlan, setPagePlan] = useState<PagePlan>();
  const [structuredTemplates, setStructuredTemplates] = useState<RequirementTemplates>();
  const [projectName, setProjectName] = useState(() => (isDesktopRuntime() ? "未打开项目" : "案件中台"));
  const [projectRoot, setProjectRoot] = useState<string>();
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [showPageCreator, setShowPageCreator] = useState(false);
  const [newPageTitle, setNewPageTitle] = useState("");
  const [newPageType, setNewPageType] = useState<CreatablePageType>("list");
  const [openPageMenuId, setOpenPageMenuId] = useState<string>();
  const [mcpState, setMcpState] = useState<"stopped" | "running" | "unavailable">("stopped");
  const [showSettings, setShowSettings] = useState(false);
  const [mcpConnection, setMcpConnection] = useState<DesktopMcpConnectionInfo>();
  const [appModal, setAppModal] = useState<AppModal>();
  const [modalValue, setModalValue] = useState("");
  const [board, setBoard] = useState<BoardDSL>(() => defaultBoardFromPages([]));
  const [viewMode, setViewMode] = useState<"canvas" | "page">("page");
  const [boardSelectedId, setBoardSelectedId] = useState<string>();
  const [boardZoom, setBoardZoom] = useState(0.82);
  const [boardPan, setBoardPan] = useState({ x: 0, y: 0 });
  const [boardTool, setBoardTool] = useState<"none" | "page" | "marker">("none");
  const [boardDraft, setBoardDraft] = useState<Record<string, unknown>>({});
  const boardSeedDone = useRef(false);
  const boardPanRef = useRef<{ x: number; y: number; startX: number; startY: number } | undefined>(undefined);
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

  const selectedLocation = useMemo(() => selectedId ? getComponentLocation(dsl, selectedId) : undefined, [dsl, selectedId]);
  const selected = selectedLocation?.component;
  const lastRevision = history.at(-1);
  const lastDiff = useMemo(() => lastRevision ? diffDsl(lastRevision.before, lastRevision.after).filter((entry) => entry.path !== "$.revision") : [], [lastRevision]);

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
      setPages(loadedPages);
      setBoard(tree.board);
      setProjectName(tree.manifest.name);
      setProjectRoot(`web://${projectId}`);
      setCurrentPageId(loadedPages[0]?.page.id ?? null);
      setSelectedId("");
      setHistory([]);
      setRedoStack([]);
      setViewMode("canvas");
      setWebProjectId(projectId);
      toast("success", "项目已打开", tree.manifest.name);
    } catch (error) {
      toast("danger", "无法打开项目", error instanceof Error ? error.message : "未知错误");
    }
  }, [toast]);

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
        if (nextBoard && Array.isArray(nextBoard.objects)) setBoard(nextBoard);
      } catch {
        setBoard(defaultBoardFromPages(loadedPages));
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
    await startProjectWatcher();
    void startLocalMcp().then((status) => setMcpState(status.state)).catch(() => setMcpState("unavailable"));
    toast("success", "本地项目已打开", `${snapshot.manifest.name} · ${snapshot.pageIds.length} 个页面`);
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
            id: `${snapshot.manifest.id}-board`,
            revision: 1,
            objects: [{ id: "obj-home", type: "page", pageId: "home", x: 120, y: 80, width: 960, height: 640, source: "default" }],
            links: []
          };
          setBoard(homeBoard);
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
    if (pageId === currentPageId) return;
    setViewMode("page");
    setCurrentPageId(pageId);
    setSelectedId("");
    setHistory([]);
    setRedoStack([]);
    setShowHistory(false);
    setShowDsl(false);
    setOpenPageMenuId(undefined);
    setPreviewReady(false);
  }, [currentPageId]);

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
    const object = board.objects.find((item) => item.id === boardSelectedId);
    if (!object) { setBoardDraft({}); return; }
    if (object.type === "note" || object.type === "marker") setBoardDraft({ text: object.text });
    else setBoardDraft({ x: object.x, y: object.y, width: object.width, height: object.height });
  }, [board.objects, boardSelectedId]);

  const runCommands = useCallback(async (commands: Command[], source: RevisionRecord["source"] = "manual", message = "修改已保存"): Promise<boolean> => {
    try {
      const result = executeCommands({ dsl, baseRevision: dsl.revision, commands, source, operator: source === "ai" ? "Codex" : "jojo" });
      if (webMode && webProjectId) {
        await webSpace.commands(webProjectId, result.dsl.page.id, dsl.revision, commands, source, source === "ai" ? "Codex" : "jojo");
      } else {
        await persistDesktopPage(result.dsl, result.revision);
      }
      setDsl(result.dsl);
      setHistory((items) => [...items, result.revision]);
      setRedoStack([]);
      toast("success", message, `Revision ${result.dsl.revision} · 影响 ${result.revision.changedComponentIds.length} 个组件`);
      return true;
    } catch (error) {
      toast("danger", "修改未执行", error instanceof Error ? error.message : "未知错误");
      return false;
    }
  }, [dsl, persistDesktopPage, toast, webProjectId]);

  const runBoardCommands = useCallback(async (commands: BoardCommand[], message = "画布已更新"): Promise<boolean> => {
    try {
      const result = applyBoardCommands({
        board,
        baseRevision: board.revision,
        commands,
        source: "manual",
        operator: "jojo"
      });
      setBoard(result.board);
      if (webMode && webProjectId) {
        await webSpace.boardCommands(webProjectId, board.revision, commands, "manual", "jojo");
        const fresh = await webSpace.board(webProjectId);
        setBoard(fresh.board);
      } else if (projectRoot && isDesktopRuntime()) {
        await persistDesktopBoardRevision(stringifyYaml(result.board, { lineWidth: 0 }), result.revision);
      }
      toast("success", message, `画布 Revision ${result.board.revision}`);
      return true;
    } catch (error) {
      toast("danger", "画布修改未执行", error instanceof Error ? error.message : "未知错误");
      return false;
    }
  }, [board, projectRoot, toast, webProjectId]);

  const boardPageMap = useMemo(() => {
    const map: Record<string, PageDSL> = {};
    pages.forEach((page) => { map[page.page.id] = page; });
    return map;
  }, [pages]);

  const boardPageObjects = useMemo(() => board.objects.filter((object): object is Extract<BoardObject, { type: "page" }> => object.type === "page"), [board.objects]);

  const boardSelectedObject = useMemo(() => board.objects.find((object) => object.id === boardSelectedId), [board.objects, boardSelectedId]);

  const nextMarkerNumber = () => Math.max(0, ...board.objects.filter((object) => object.type === "marker").map((object) => (object as BoardMarkerObject).number)) + 1;

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
    if (await runBoardCommands([{ type: "ADD_BOARD_OBJECT", object }], "页面已添加到画布")) {
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
    if (await runBoardCommands([{ type: "ADD_BOARD_OBJECT", object }], "说明已添加到画布")) {
      setBoardSelectedId(object.id);
      setBoardDraft({ text: object.text });
    }
  };

  const addBoardMarker = async (pageObjectId: string, componentId: string, text: string, tone: MarkerTone) => {
    const object: BoardMarkerObject = {
      id: `marker-${Date.now()}`,
      type: "marker",
      number: nextMarkerNumber(),
      tone,
      text: text.trim() || `标注 ${nextMarkerNumber()}`,
      source: "explicit",
      anchor: { pageObjectId, componentId }
    };
    if (await runBoardCommands([{ type: "ADD_BOARD_OBJECT", object }], "标注已添加")) {
      setBoardSelectedId(object.id);
      setBoardTool("none");
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
      flowchart: { nodes: [{ id: "node-1", label: "开始" }, { id: "node-2", label: "结束" }], edges: [{ id: "edge-1", from: "node-1", to: "node-2", label: "" }] }
    };
    if (await runBoardCommands([{ type: "ADD_BOARD_OBJECT", object }], "流程图已添加")) {
      setBoardSelectedId(object.id);
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
        entities: [{ id: "entity-1", name: "实体A", fields: [{ name: "id", type: "string", key: true }] }],
        relations: []
      }
    };
    if (await runBoardCommands([{ type: "ADD_BOARD_OBJECT", object }], "ER 图已添加")) {
      setBoardSelectedId(object.id);
    }
  };

  const addBoardLink = async (from: string, to: string, label: string) => {
    await runBoardCommands([
      { type: "ADD_BOARD_LINK", link: { id: `link-${Date.now()}`, from, to, ...(label.trim() ? { label: label.trim() } : {}) } }
    ], "连线已添加");
  };

  const commitBoardPosition = () => {
    if (!boardSelectedObject || boardSelectedObject.type === "marker") return;
    void runBoardCommands([{
      type: "UPDATE_BOARD_OBJECT",
      target: boardSelectedObject.id,
      changes: {
        x: Number(boardDraft.x ?? boardSelectedObject.x),
        y: Number(boardDraft.y ?? boardSelectedObject.y),
        width: Number(boardDraft.width ?? boardSelectedObject.width),
        height: Number(boardDraft.height ?? boardSelectedObject.height)
      }
    }], "对象属性已更新");
  };

  const commitBoardText = () => {
    if (!boardSelectedObject || (boardSelectedObject.type !== "note" && boardSelectedObject.type !== "marker")) return;
    void runBoardCommands([{
      type: "UPDATE_BOARD_OBJECT",
      target: boardSelectedObject.id,
      changes: { text: String(boardDraft.text ?? "") }
    }], "标注已更新");
  };

  const deleteBoardObject = async (id: string) => {
    if (await runBoardCommands([{ type: "DELETE_BOARD_OBJECT", target: id }], "画布对象已删除")) {
      setBoardSelectedId(undefined);
    }
  };

  const moveBoardObject = (id: string, x: number, y: number) => {
    void runBoardCommands([{ type: "MOVE_BOARD_OBJECT", target: id, x, y }]);
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
      await runBoardCommands([{ type: "ADD_BOARD_OBJECT", object: pageObject }], "页面已添加到画布");
    }
    await addBoardMarker(pageObject.id, selected.id, "", "orange");
    toast("success", "标注已添加", `已挂靠 ${selected.id}，可在画布中查看和编辑`);
  };

  const openPageFromBoard = (pageId: string) => {
    setCurrentPageId(pageId);
    setViewMode("page");
    setSelectedId("");
    setPreviewReady(false);
    setShowHistory(false);
    setShowDsl(false);
  };

  const exportBoardHtml = () => {
    const body = renderToStaticMarkup(
      <BoardRenderer board={board} pages={boardPageMap} interactive={false} />
    );
    const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${projectName} · 画布</title>
<style>${rendererExportCss}\n${boardExportCss}\nhtml,body{margin:0;background:#0f172a;font-family:system-ui,-apple-system,'PingFang SC',sans-serif;}body{padding:24px;}</style>
</head>
<body>
<div class="export-canvas" style="position:relative;min-height:100vh;">${body}</div>
<script>
window.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('[data-board-marker]').forEach(function (pin) {
    var anchor = pin.getAttribute('data-marker-anchor') || '';
    var parts = anchor.split(':');
    if (parts.length < 4) return;
    var pageObjectId = parts[0];
    var componentId = parts[1];
    var offsetX = Number(parts[2] || 0);
    var offsetY = Number(parts[3] || 0);
    var frame = document.querySelector('[data-board-object="' + pageObjectId + '"] .board-page-body');
    if (!frame) return;
    var component = frame.querySelector('[data-component-id="' + componentId + '"]');
    if (!component) return;
    var frameRect = frame.getBoundingClientRect();
    var componentRect = component.getBoundingClientRect();
    pin.style.left = (componentRect.left - frameRect.left + frame.scrollLeft + offsetX) + 'px';
    pin.style.top = (componentRect.top - frameRect.top + frame.scrollTop + offsetY) + 'px';
  });
});
</script>
</body>
</html>`;
    if (webMode && webProjectId) {
      void webSpace.exportHtml(webProjectId)
        .then((result) => {
          const blob = new Blob([result.html], { type: "text/html" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = "prototype-board.html";
          link.click();
          URL.revokeObjectURL(url);
          toast("success", "画布已导出", "已下载 prototype-board.html");
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

  const shareWebProject = async () => {
    if (!webProjectId) return;
    try {
      const share = await webSpace.shareCreate(webProjectId);
      await copyText(share.url);
      toast("success", "分享链接已复制", share.url);
    } catch (error) {
      toast("danger", "创建分享链接失败", error instanceof Error ? error.message : "未知错误");
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
          const listed = await webProjects.list();
          const latest = [...listed.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
          if (latest) void loadWebProject(latest.id);
        }
      })
      .catch(() => undefined)
      .finally(() => setWebBoot(true));
  }, [loadWebProject]);

  const updateSelected = (changes: Partial<UIComponent>) => {
    if (!selected) return;
    const type = ["modal", "drawer", "popover"].includes(selected.type) ? "UPDATE_OVERLAY" : "UPDATE_COMPONENT";
    void runCommands([{ type, target: selected.id, changes } as Command]);
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
      setHistory((items) => [...items.slice(0, -1), result.revision]);
      setRedoStack((items) => [...items, target]);
      toast("info", "已撤销修改", `保留为 Revision ${result.dsl.revision}`);
    } catch (error) {
      toast("danger", "无法撤销", error instanceof Error ? error.message : "未知错误");
    }
  };

  const redo = async () => {
    const target = redoStack.at(-1);
    if (!target) return;
    const changes = target.commands;
    if (!changes.length) return;
    if (await runCommands(changes, "redo", "已重做修改")) {
      setRedoStack((items) => items.slice(0, -1));
    }
  };

  const moveOutline = (dragged: string, target: string) => {
    const fields = dsl.search?.fields ?? [];
    const index = fields.findIndex((field) => field.id === target);
    if (index >= 0 && fields.some((field) => field.id === dragged)) {
      void runCommands([{ type: "MOVE_COMPONENT", target: dragged, container: "search.fields", index }], "manual", "字段顺序已更新");
    } else toast("warning", "当前仅支持同容器排序", "MVP 可拖动查询区字段调整顺序");
  };

  const submitCommand = () => {
    if (!command.trim()) return;
    const commands = parseLocalCommand(command, selected);
    if (commands) {
      void runCommands(commands, "ai", "AI Command 已执行");
      setCommand("");
    } else {
      toast("warning", "需要外部 Codex", "该复杂语义将在 MCP 接入后生成 Change Plan");
    }
  };

  const buildRequirementPlan = () => {
    const structured = parseRequirementTemplates(requirementText);
    if (structured) {
      const model = requirementModelFromTemplates(structured);
      const plan = createPagePlanFromTemplates(structured);
      setStructuredTemplates(structured);
      setRequirementModel(model);
      setPagePlan(plan);
      toast("success", "结构化页面模板已接收", `按声明生成 ${plan.pages.length} 个页面 · 无关键词猜测`);
      return;
    }
    const model = deterministicRequirementParser({
      text: requirementText,
      title: "案件批量分配",
      requirementId: "REQ-001"
    });
    const plan = createPagePlan(model);
    setRequirementModel(model);
    setPagePlan(plan);
    toast("success", "Codex 需求已接收", `形成 ${plan.pages.length} 个页面计划 · ${model.businessRules.length} 条业务规则`);
  };

  const confirmRequirementPlan = () => {
    if (!pagePlan) return;
    const confirmed = confirmPagePlan(pagePlan);
    const generated = generateConfirmedPageDSLs(confirmed);
    setPagePlan(confirmed);
    if (generated[0]) {
      setPages((items) => {
        const generatedIds = new Set(generated.map((item) => item.dsl.page.id));
        return [...items.filter((item) => !generatedIds.has(item.page.id)), ...generated.map((item) => item.dsl)];
      });
      setCurrentPageId(generated[0].dsl.page.id);
      generated.forEach((item) => void persistDesktopPage(item.dsl));
      setSelectedId("");
      setHistory([]);
      setRedoStack([]);
      setPreviewReady(false);
      toast("success", "Page Plan 已确认", `已生成 ${generated.length} 个合法 UI DSL 页面`);
    }
    const board = structuredTemplates ? createBoardFromTemplates(structuredTemplates) : null;
    if (board) {
      setBoard(board);
      if (projectRoot && isDesktopRuntime()) {
        void writeDesktopBoard(stringifyYaml(board, { lineWidth: 0 }));
      }
      toast("success", "画布已生成", `来自 Codex 模板：${board.objects.length} 个对象 · ${board.links.length} 条连线`);
    }
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
  if (webMode && !webSession) return <AuthScreen onAuthenticated={setWebSession} />;
  if (webMode && webSession && !webProjectId) {
    return <ProjectsScreen
      user={webSession}
      onOpenProject={(id) => void loadWebProject(id)}
      onLogout={() => { void webAuth.logout(); setWebSession(undefined); }}
    />;
  }

  return <div className="studio-shell">
    <header className="studio-titlebar">
      <div className="studio-brand"><span className="studio-mark"><i /><b /></span><div><strong>PROTOTYPE</strong><em>STUDIO</em></div></div>
      <div className="project-switcher-wrap">
        <button className="studio-project-switcher" onClick={() => setShowProjectMenu(!showProjectMenu)}><FolderOpen size={14} /><span>{projectName}{projectRoot ? (webMode ? " · 云端项目" : " · 本地项目") : isDesktopRuntime() ? "" : " · 示例项目"}</span><ChevronDown size={13} /></button>
        {showProjectMenu ? <div className="project-menu">
          <div className="project-menu-head"><span>PROJECT ROOT</span><code>{projectRoot ?? "examples/case-management"}</code></div>
          {!webMode ? <>
            <button onClick={openLocalProject}><FolderOpen size={14} /><span><strong>打开本地项目</strong><small>选择包含 project.yaml 的目录</small></span></button>
            <button onClick={createLocalProject}><Plus size={14} /><span><strong>创建新项目</strong><small>生成标准目录与 project.yaml</small></span></button>
            <i />
            <button onClick={launchMcp}><Zap size={14} /><span><strong>启动 Local MCP</strong><small>当前状态：{mcpState}</small></span><StatusDot tone={mcpState === "running" ? "success" : mcpState === "unavailable" ? "danger" : "neutral"}>{mcpState}</StatusDot></button>
          </> : <button onClick={() => { setShowProjectMenu(false); setWebProjectId(undefined); setPages([]); setBoard(defaultBoardFromPages([])); }}><FolderOpen size={14} /><span><strong>返回项目列表</strong><small>切换到其他云端项目</small></span></button>}
        </div> : null}
      </div>
      <div className="studio-title-actions">
        <StatusDot tone={currentPage && previewReady ? "success" : currentPage ? "warning" : "neutral"}>{currentPage ? (previewReady ? "Preview 已连接" : "Preview 连接中") : "暂无页面"}</StatusDot>
        <span className="title-divider" />
        <ToolButton compact title="撤销" disabled={!currentPage || !history.length} onClick={undo}><Undo2 size={15} /></ToolButton>
        <ToolButton compact title="重做" disabled={!currentPage || !redoStack.length} onClick={redo}><Redo2 size={15} /></ToolButton>
        <ToolButton disabled={!currentPage} onClick={() => setShowHistory(!showHistory)} active={showHistory}><History size={14} />版本 <span className="revision-badge">{currentPage?.revision ?? 0}</span></ToolButton>
        {webMode ? <ToolButton compact title="返回项目列表" onClick={() => { setWebProjectId(undefined); setPages([]); setBoard(defaultBoardFromPages([])); }}><FolderOpen size={15} /></ToolButton> : null}
        <ToolButton><Share2 size={14} />分享</ToolButton>
        <ToolButton compact title="设置" onClick={() => { setShowSettings(true); void refreshMcpConnection(); }}><Settings2 size={15} /></ToolButton>
      </div>
    </header>

    <aside className="studio-left">
      <div className="left-tabs"><button className={activeWorkspace === "pages" ? "is-active" : ""} onClick={() => setActiveWorkspace("pages")}><Layers3 size={14} />页面</button><button className={activeWorkspace === "requirements" ? "is-active" : ""} onClick={() => setActiveWorkspace("requirements")}><FileText size={14} />需求</button></div>
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
        <div className="left-project-label"><span>需求资产</span><ToolButton compact title="从 Codex 同步需求"><Plus size={13} /></ToolButton></div>
        <div className="requirement-file-row is-active"><div><FileText size={14} /></div><span><strong>案件批量分配</strong><small>REQ-001.md · MARKDOWN</small></span><StatusDot tone={requirementModel ? "success" : "warning"}>{requirementModel ? "已解析" : "待解析"}</StatusDot></div>
        <SectionTitle>解析概览</SectionTitle>
        {requirementModel ? <div className="requirement-mini-stats">
          <div><b>{requirementModel.pages.length}</b><span>页面</span></div>
          <div><b>{requirementModel.features.length}</b><span>功能</span></div>
          <div><b>{requirementModel.businessRules.length}</b><span>规则</span></div>
          <div><b>{requirementModel.unresolved.length}</b><span>待确认</span></div>
        </div> : <EmptyState icon={<FileText size={17} />} title="等待 Codex 结果" description="Codex 同步结构化页面模板或规范化需求后，Studio 再按声明生成页面计划。" />}
        <div className="left-footer"><FileCheck2 size={13} /><span>requirements/REQ-001.md</span><StatusDot tone="success">本地</StatusDot></div>
      </>}
    </aside>

    <main className="studio-canvas">
      <div className="canvas-toolbar">
        {activeWorkspace === "pages" ? <>
          <div className="view-switcher">
            <button className={viewMode === "page" ? "is-active" : ""} onClick={() => setViewMode("page")}><Monitor size={14} />页面</button>
            <button className={viewMode === "canvas" ? "is-active" : ""} onClick={() => { setViewMode("canvas"); setBoardSelectedId(undefined); }}><LayoutGrid size={14} />画布</button>
          </div>
          {viewMode === "page" ? <>
            <div className="viewport-switcher"><button className="is-active"><Monitor size={14} />桌面</button><button><PanelRight size={14} />平板</button></div>
            <div className="canvas-meta"><span>1280 × 820</span><i /><StatusDot tone="info">可点选模式</StatusDot></div>
            <div className="zoom-control"><button onClick={() => setPreviewScale(Math.max(55, previewScale - 5))}>−</button><span>{previewScale}%</span><button onClick={() => setPreviewScale(Math.min(100, previewScale + 5))}>+</button><button><Maximize2 size={13} /></button></div>
          </> : <>
            <div className="canvas-meta"><span>画布 · {board.objects.length} 个对象</span><i /><StatusDot tone="info">拖拽移动 · 双击页面进入编辑</StatusDot></div>
            <div className="board-tools">
              <button onClick={() => setBoardTool(boardTool === "page" ? "none" : "page")}><Plus size={13} />页面</button>
              <button onClick={() => void addBoardNote()}><StickyNote size={13} />说明</button>
              <button onClick={() => setBoardTool(boardTool === "marker" ? "none" : "marker")}><MapPin size={13} />标注</button>
              <button onClick={() => void addBoardFlowchart()}><GitBranch size={13} />流程</button>
              <button onClick={() => void addBoardEr()}><Database size={13} />ER</button>
              <button onClick={exportBoardHtml}><Download size={13} />导出 HTML</button>
              {webMode && webProjectId ? <>
                <button onClick={() => void shareWebProject()}><Share2 size={13} />分享</button>
                <button onClick={() => void downloadWebZip()}><Save size={13} />整包</button>
              </> : null}
            </div>
            <div className="zoom-control"><button onClick={() => setBoardZoom(Math.max(0.4, Math.round((boardZoom - 0.1) * 100) / 100))}>−</button><span>{Math.round(boardZoom * 100)}%</span><button onClick={() => setBoardZoom(Math.min(2, Math.round((boardZoom + 0.1) * 100) / 100))}>+</button><button onClick={() => { setBoardZoom(1); setBoardPan({ x: 0, y: 0 }); }}><Maximize2 size={13} /></button></div>
          </>}
        </> : <>
          <div className="requirement-toolbar-title"><FileText size={14} /><span>Requirement Model</span></div>
          <StatusDot tone={pagePlan?.status === "confirmed" ? "success" : requirementModel ? "info" : "warning"}>{pagePlan?.status === "confirmed" ? "页面计划已确认" : requirementModel ? "等待确认 Page Plan" : "等待解析"}</StatusDot>
          <div className="requirement-format">Explicit / Inferred / Default</div>
        </>}
      </div>
      {activeWorkspace === "pages" ? viewMode === "canvas" ? <div className="canvas-stage board-stage">
        <div
          className="board-viewport"
          onWheel={(event: ReactWheelEvent) => { event.preventDefault(); const factor = event.deltaY < 0 ? 1.1 : 0.9; setBoardZoom((zoom) => Math.min(2, Math.max(0.4, Math.round(zoom * factor * 100) / 100))); }}
          onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
            if ((event.target as HTMLElement).closest(".board-object, .board-tool-panel")) return;
            boardPanRef.current = { x: boardPan.x, y: boardPan.y, startX: event.clientX, startY: event.clientY };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) => {
            const pan = boardPanRef.current;
            if (!pan) return;
            setBoardPan({ x: pan.x + (event.clientX - pan.startX), y: pan.y + (event.clientY - pan.startY) });
          }}
          onPointerUp={() => { boardPanRef.current = undefined; }}
          onPointerCancel={() => { boardPanRef.current = undefined; }}
        >
          <div className="board-viewport-inner" style={{ transform: `translate(${boardPan.x}px, ${boardPan.y}px) scale(${boardZoom})`, transformOrigin: "0 0" }}>
            <BoardRenderer
              board={board}
              pages={boardPageMap}
              selectedId={boardSelectedId}
              scale={boardZoom}
              onSelectObject={setBoardSelectedId}
              onOpenPage={openPageFromBoard}
              onMoveObject={moveBoardObject}
              onMoveMarker={moveBoardMarker}
            />
          </div>
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
            onCancel={() => setBoardTool("none")}
            onAdd={async (pageObjectId, componentId, text, tone) => { await addBoardMarker(pageObjectId, componentId, text, tone); }}
          /> : null}
        </div>
      </div> : currentPage ? <>
        <div className="canvas-stage">
          <div className="preview-device" style={{ width: `${100 / (previewScale / 100)}%`, height: `${100 / (previewScale / 100)}%`, transform: `scale(${previewScale / 100})` }}>
            <div className="preview-browser-bar"><div><i /><i /><i /></div><span>prototype://local/{dsl.page.id}</span><button><RotateCcw size={12} /></button></div>
            <iframe key={currentPageId} ref={iframeRef} title={`${currentPage.page.title} Preview`} src={`/preview-runtime/${currentPageId}`} onLoad={() => sendPreview({ type: "prototype:dsl", dsl })} sandbox="allow-scripts allow-same-origin allow-forms" />
          </div>
        </div>
        <div className="command-dock">
          <div className="command-context"><Sparkles size={14} /><span>AI COMMAND</span><i /><b>{selected ? selected.id : "未选择组件"}</b><span className="scope-pill">Scope · {selected ? "1 node" : "page"}</span></div>
          <div className="command-input-row">
            <CommandIcon size={18} />
            <input value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submitCommand(); }} placeholder={selected ? `描述如何修改「${selected.label ?? selected.title ?? selected.text ?? selected.id}」…` : "先在原型中选择一个组件"} />
            <span className="command-hint"><Keycap>⌘</Keycap><Keycap>↵</Keycap></span>
            <button className="command-run" onClick={submitCommand} disabled={!command.trim()}><Play size={13} fill="currentColor" />执行</button>
          </div>
        </div>
      </> : <div className="canvas-empty"><EmptyState icon={<Layers3 size={22} />} title={isDesktopRuntime() && !projectRoot ? "打开或创建本地项目" : "选择或新建一个页面"} description={isDesktopRuntime() && !projectRoot ? "点击左上角项目名，选择「打开本地项目」或「创建新项目」。只有打开真实项目目录后，才能读写文件并连接 Codex。" : "页面树为空。新建页面后，Preview、组件大纲和属性面板会在这里同步刷新。"} /></div> : <div className="requirement-stage">
        <section className="requirement-editor-card">
          <header><div><span>01 · CODEX INPUT</span><h2>规范化需求</h2></div><div className="local-asset"><StatusDot tone="success">仅保存在本地项目</StatusDot></div></header>
          <textarea value={requirementText} onChange={(event) => setRequirementText(event.target.value)} spellCheck={false} />
          <footer><span>{requirementText.length} 字 · Markdown / 结构化模板</span><button onClick={buildRequirementPlan}><Sparkles size={13} />生成 Page Plan</button></footer>
        </section>
        <section className="requirement-plan-card">
          <header><div><span>02 · PAGE PLAN</span><h2>页面规划</h2></div>{pagePlan ? <div className={`plan-status plan-status--${pagePlan.status}`}>{pagePlan.status}</div> : null}</header>
          {!pagePlan ? <EmptyState icon={<LayoutPanelLeft size={18} />} title="先解析业务需求" description="系统会先展示页面、功能、规则和未明确项；确认后才生成 UI DSL。" /> : <div className="page-plan-list">
            {pagePlan.pages.map((page) => <article key={page.id} className={page.decision === "confirmed" ? "is-confirmed" : ""}>
              <div className="plan-page-index">{String(pagePlan.pages.indexOf(page) + 1).padStart(2, "0")}</div>
              <div><div className="plan-page-title"><strong>{page.title}</strong><code>{page.type}</code><span className={`source-chip source-chip--${page.source}`}>{page.source}</span></div><p>{page.features.slice(0, 2).map((item) => item.value).join(" · ") || "根据需求生成基础页面结构"}</p><small>{page.businessRules.length} 条规则 · {page.validations.length} 条校验 · {page.interactions.length} 个交互</small></div>
            </article>)}
          </div>}
          {pagePlan ? <footer><span>{pagePlan.unresolved.length ? `${pagePlan.unresolved.length} 个未明确项会保留到 Product Package` : "未发现阻塞性未明确项"}</span><button onClick={confirmRequirementPlan} disabled={pagePlan.status === "confirmed"}><FileCheck2 size={13} />{pagePlan.status === "confirmed" ? "已生成 DSL" : "确认并生成"}</button></footer> : null}
        </section>
      </div>}
    </main>

    <aside className="studio-right">
      {activeWorkspace === "requirements" ? <>
        <PanelHeader eyebrow="TRACEABLE MODEL" title="需求解析结果" action={<ToolButton compact><MoreHorizontal size={14} /></ToolButton>} />
        {!requirementModel ? <EmptyState icon={<Sparkles size={18} />} title="等待 Requirement Model" description="解析后可在这里检查每一项来自原文、AI 推断还是系统默认。" /> : <div className="requirement-inspector">
          <div className="requirement-result-banner"><div><Sparkles size={16} /></div><span><strong>结构化 Requirement Model</strong><small>原始文档由 Codex 处理 · Studio 不解析附件</small></span><StatusDot tone="success">完成</StatusDot></div>
          {([
            ["页面", requirementModel.pages],
            ["功能", requirementModel.features],
            ["业务规则", requirementModel.businessRules],
            ["权限", requirementModel.permissions],
            ["校验", requirementModel.validations],
            ["交互", requirementModel.interactions]
          ] as const).map(([label, items]) => <div className="requirement-result-group" key={label}><SectionTitle>{label} · {items.length}</SectionTitle>{items.length ? items.map((item, index) => <div className="requirement-result-item" key={`${label}-${index}`}><i className={`source-dot source-dot--${item.source}`} /><span>{item.value}</span><code>{item.source}</code></div>) : <div className="requirement-result-empty">未识别</div>}</div>)}
          <div className="requirement-unresolved"><SectionTitle>未明确项 · {requirementModel.unresolved.length}</SectionTitle>{requirementModel.unresolved.map((item, index) => <div key={index}><CircleHelp size={12} /><span>{item.value}</span></div>)}</div>
        </div>}
      </> : viewMode === "canvas" ? <>
        <PanelHeader eyebrow="BOARD OBJECT" title={boardSelectedObject ? (boardSelectedObject.type === "page" ? "页面对象" : boardSelectedObject.type === "marker" ? "标注" : boardSelectedObject.type === "note" ? "说明" : "画布对象") : "画布对象"} action={<ToolButton compact onClick={() => setViewMode("page")}><Monitor size={13} /></ToolButton>} />
        {!boardSelectedObject ? <EmptyState icon={<LayoutGrid size={18} />} title="选择一个画布对象" description="点击画布上的页面、说明或标注，在这里编辑位置、内容与连线。" /> : <div className="board-inspector">
          <div className="selected-path"><span>{board.id}</span><ChevronRight size={10} /><b>{boardSelectedObject.id}</b></div>
          <div className="inspector-body">
            {boardSelectedObject.type !== "marker" ? <>
              <SectionTitle>位置与尺寸</SectionTitle>
              <div className="board-fields">
                <label><span>X</span><input value={String(boardDraft.x ?? boardSelectedObject.x)} onChange={(event) => setBoardDraft({ ...boardDraft, x: event.target.value })} onBlur={commitBoardPosition} /></label>
                <label><span>Y</span><input value={String(boardDraft.y ?? boardSelectedObject.y)} onChange={(event) => setBoardDraft({ ...boardDraft, y: event.target.value })} onBlur={commitBoardPosition} /></label>
                <label><span>宽</span><input value={String(boardDraft.width ?? boardSelectedObject.width)} onChange={(event) => setBoardDraft({ ...boardDraft, width: event.target.value })} onBlur={commitBoardPosition} /></label>
                <label><span>高</span><input value={String(boardDraft.height ?? boardSelectedObject.height)} onChange={(event) => setBoardDraft({ ...boardDraft, height: event.target.value })} onBlur={commitBoardPosition} /></label>
              </div>
            </> : null}
            {boardSelectedObject.type === "note" ? <>
              <SectionTitle>说明内容</SectionTitle>
              <textarea value={String(boardDraft.text ?? "")} onChange={(event) => setBoardDraft({ ...boardDraft, text: event.target.value })} onBlur={commitBoardText} rows={4} />
            </> : null}
            {boardSelectedObject.type === "marker" ? <>
              <SectionTitle>标注</SectionTitle>
              <div className="readonly-value"><code>#{boardSelectedObject.number} · {boardSelectedObject.tone}</code><i>挂靠组件</i></div>
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
              <FlowchartEditor object={boardSelectedObject} onChange={(flowchart) => void runBoardCommands([{ type: "UPDATE_BOARD_OBJECT", target: boardSelectedObject.id, changes: { flowchart } }])} />
            </> : null}
            {boardSelectedObject.type === "er" ? <>
              <SectionTitle>ER 图</SectionTitle>
              <ErEditor object={boardSelectedObject} onChange={(er) => void runBoardCommands([{ type: "UPDATE_BOARD_OBJECT", target: boardSelectedObject.id, changes: { er } }])} />
            </> : null}
            <SectionTitle>连线</SectionTitle>
            {board.links.filter((link) => link.from === boardSelectedObject.id || link.to === boardSelectedObject.id).length ? board.links.filter((link) => link.from === boardSelectedObject.id || link.to === boardSelectedObject.id).map((link) => (
              <div className="board-link-row" key={link.id}><span>{link.label || `${link.from} → ${link.to}`}</span><button title="删除连线" onClick={() => void runBoardCommands([{ type: "DELETE_BOARD_LINK", target: link.id }])}><X size={12} /></button></div>
            )) : <div className="requirement-result-empty">当前对象没有连线</div>}
            <div className="board-link-add">
              <select value={String(boardDraft.linkTarget ?? "")} onChange={(event) => setBoardDraft({ ...boardDraft, linkTarget: event.target.value })}>
                <option value="">选择连线目标</option>
                {board.objects.filter((object) => object.id !== boardSelectedObject.id).map((object) => <option key={object.id} value={object.id}>{object.id}</option>)}
              </select>
              <input value={String(boardDraft.linkLabel ?? "")} onChange={(event) => setBoardDraft({ ...boardDraft, linkLabel: event.target.value })} placeholder="连线说明（可选）" />
              <button disabled={!boardDraft.linkTarget} onClick={() => { void addBoardLink(boardSelectedObject.id, String(boardDraft.linkTarget), String(boardDraft.linkLabel ?? "")); setBoardDraft({ ...boardDraft, linkTarget: "", linkLabel: "" }); }}><Link2 size={12} />连线</button>
            </div>
          </div>
          <div className="inspector-footer"><button className="is-danger" onClick={() => void deleteBoardObject(boardSelectedObject.id)}><Trash2 size={13} />删除对象</button><span>{boardSelectedObject.type}</span></div>
        </div>}
      </> : !currentPage ? <EmptyState icon={<Layers3 size={18} />} title="暂无页面" description="从左侧新建页面后，可在此查看组件属性和 Revision。" /> : showHistory ? <>
        <PanelHeader eyebrow="APPEND-ONLY" title="版本与变更" action={<ToolButton compact onClick={() => setShowHistory(false)}><X size={14} /></ToolButton>} />
        <div className="history-summary"><div><Clock3 size={16} /><span>当前 Revision</span><strong>{dsl.revision}</strong></div><div><Save size={16} /><span>本次会话修改</span><strong>{history.length}</strong></div></div>
        {lastRevision ? <div className="history-current"><div className="revision-card-head"><span>R{lastRevision.revision}</span><div><strong>{lastRevision.source === "ai" ? "AI Command" : lastRevision.source === "undo" ? "撤销操作" : "属性修改"}</strong><small>{lastRevision.changedComponentIds.join("、") || "页面状态"}</small></div><StatusDot tone="success">已保存</StatusDot></div><DiffView entries={lastDiff} /></div> : <EmptyState icon={<History size={18} />} title="尚无修改记录" description="属性编辑、拖动和 AI Command 都会形成不可覆盖的 Revision。" />}
        <div className="history-actions"><button disabled={!history.length} onClick={undo}><Undo2 size={13} />撤销最近修改</button></div>
      </> : showDsl ? <>
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
          <SectionTitle>画布</SectionTitle>
          <button className="inspector-action" onClick={() => void addMarkerToCurrentComponent()}><MapPin size={13} />添加标注（挂靠此组件）</button>
        </div>
        <div className="inspector-footer"><button onClick={() => setShowDsl(true)}><Braces size={13} />查看 DSL 节点</button><span>{selectedLocation?.path}</span></div>
      </> : <EmptyState icon={<CircleHelp size={18} />} title="选择一个组件" description="点击 Preview 或左侧组件大纲，在这里查看并修改属性。" />}
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

    {showSettings ? <div className="settings-overlay" onClick={() => setShowSettings(false)}>
      <section className="settings-card" onClick={(event) => event.stopPropagation()}>
        <header>
          <div><span>SETTINGS</span><h2>设置 · 连接 Codex</h2></div>
          <button onClick={() => setShowSettings(false)} aria-label="关闭设置"><X size={14} /></button>
        </header>
        <div className="settings-body">
          {!isDesktopRuntime() ? <div className="settings-note">{webMode ? `网页端连接 Codex：回到“我的项目”页复制 API Token，再在 ~/.codex/config.toml 配置 url = ${window.location.origin}/mcp 与 bearer_token_env_var = PROTOTYPE_STUDIO_TOKEN。` : "当前是浏览器体验模式，不能读写本地项目。请在桌面 App 中打开或创建项目后连接 Codex。"}</div>
            : !mcpConnection ? <div className="settings-note">正在读取连接信息…</div>
            : <>
                <div className="settings-row"><span>项目目录</span><code>{mcpConnection.projectRoot ?? "未打开项目"}</code></div>
                <div className="settings-row">
                  <span>Local MCP</span>
                  <StatusDot tone={mcpConnection.state === "running" ? "success" : mcpConnection.state === "unavailable" ? "danger" : "neutral"}>{mcpConnection.state}</StatusDot>
                  {mcpConnection.state !== "running" ? <button className="settings-restart" onClick={() => void launchMcp()}>启动</button> : <button className="settings-restart" onClick={() => void launchMcp()}>重启</button>}
                </div>
                {mcpConnection.detail ? <div className="settings-note">{mcpConnection.detail}</div> : null}
                <div className="settings-block">
                  <div className="settings-block-head">
                    <div><span>STEP 1</span><strong>复制 MCP 配置</strong><small>粘贴到 ~/.codex/config.toml，或在 Codex 设置 → MCP servers → Add server（STDIO）后重启</small></div>
                    <button onClick={() => void copyText(mcpConnection.configToml ?? "")} disabled={!mcpConnection.configToml}><Copy size={13} />复制</button>
                  </div>
                  <pre>{mcpConnection.configToml ?? "需要先打开本地项目"}</pre>
                </div>
                <div className="settings-block">
                  <div className="settings-block-head">
                    <div><span>STEP 2</span><strong>复制协作提示词</strong><small>粘贴到 Codex 对话，告诉它如何使用这个本地项目</small></div>
                    <button onClick={() => void copyText(mcpConnection.connectPrompt ?? "")} disabled={!mcpConnection.connectPrompt}><Copy size={13} />复制</button>
                  </div>
                  <pre>{mcpConnection.connectPrompt ?? "需要先打开本地项目"}</pre>
                </div>
              </>}
        </div>
      </section>
    </div> : null}

    <div className="toast-stack">{toasts.map((item) => <div key={item.id} className={`studio-toast studio-toast--${item.tone}`}><span><i /></span><div><strong>{item.title}</strong>{item.detail ? <p>{item.detail}</p> : null}</div><button onClick={() => setToasts((items) => items.filter((toast) => toast.id !== item.id))}><X size={13} /></button></div>)}</div>
  </div>;
}
