import {
  Component,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode
} from "react";
import { Check, ChevronDown, ChevronsUpDown, Info, Search, X } from "lucide-react";
import type {
  Condition,
  PageDSL,
  PrototypeEvent,
  TableColumn,
  UIComponent
} from "@prototype-studio/dsl-schema";
import "@prototype-studio/design-system/styles.css";
import "./styles.css";

export interface RuntimeEventPayload {
  type: PrototypeEvent["type"] | "select" | "validation-error";
  componentId?: string;
  target?: string;
  value?: unknown;
}

export interface PrototypeRendererProps {
  dsl: PageDSL;
  selectedId?: string;
  interactive?: boolean;
  onSelect?: (componentId: string) => void;
  onRuntimeEvent?: (event: RuntimeEventPayload) => void;
}

export interface RuntimeComponentState {
  visible?: boolean;
  disabled?: boolean;
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/** Evaluate DSL conditions without reading ambient state or mutating their inputs. */
export function evaluateCondition(condition: Condition, values: Readonly<Record<string, unknown>>): boolean {
  const current = values[condition.field];
  const expected = condition.value;
  switch (condition.operator) {
    case "equals":
      return Object.is(current, expected);
    case "notEquals":
      return !Object.is(current, expected);
    case "contains":
      if (Array.isArray(current)) return current.some((item) => Object.is(item, expected));
      return typeof current === "string" && current.includes(String(expected ?? ""));
    case "in":
      return Array.isArray(expected) && expected.some((item) => Object.is(item, current));
    case "notIn":
      return !Array.isArray(expected) || !expected.some((item) => Object.is(item, current));
    case "greaterThan":
      return typeof current === "number" && typeof expected === "number" && current > expected;
    case "lessThan":
      return typeof current === "number" && typeof expected === "number" && current < expected;
    case "isEmpty":
      return isEmpty(current);
    case "isNotEmpty":
      return !isEmpty(current);
    default:
      return false;
  }
}

function formatValue(value: unknown, column?: TableColumn): string {
  if (value === undefined || value === null || value === "") return "—";
  if (column?.format === "currency" && typeof value === "number") {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency: "CNY",
      maximumFractionDigits: 0
    }).format(value);
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[无法显示]";
    }
  }
  return String(value);
}

function Selectable({ component, selectedId, onSelect, className = "", children, style }: {
  component: UIComponent;
  selectedId?: string;
  onSelect?: (id: string) => void;
  className?: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const selected = component.id === selectedId;
  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    onSelect?.(component.id);
  };
  return (
    <div
      className={`proto-selectable ${selected ? "is-selected" : ""} ${className}`}
      data-component-id={component.id}
      data-component-type={component.type}
      onClick={handleClick}
      style={style}
    >
      {selected ? <span className="proto-selection-tag">{component.id}</span> : null}
      {children}
    </div>
  );
}

export { BoardRenderer } from "./BoardRenderer";
export type { BoardRendererProps } from "./BoardRenderer";

function Field({ component, value, error, onValue, selectedId, onSelect }: {
  component: UIComponent;
  value: unknown;
  error?: string;
  onValue: (value: unknown) => void;
  selectedId?: string;
  onSelect?: (id: string) => void;
}) {
  const required = component.validation?.required;
  const label = component.label ?? component.title ?? component.id;
  const scalarValue = typeof value === "string" || typeof value === "number" ? value : "";
  const changeValue = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    if (component.type === "number" && event.target.value !== "") onValue(Number(event.target.value));
    else onValue(event.target.value);
  };
  let control: ReactNode;
  switch (component.type) {
    case "select":
    case "tree-select":
      control = (
        <div className="proto-control-wrap">
          <select
            disabled={component.disabled}
            value={component.multiple && Array.isArray(value) ? value.map(String) : scalarValue}
            multiple={component.multiple}
            onChange={(event) => {
              const optionValue = (raw: string) => component.options?.find((option) => String(option.value) === raw)?.value ?? raw;
              if (component.multiple) onValue(Array.from(event.target.selectedOptions, (option) => optionValue(option.value)));
              else onValue(optionValue(event.target.value));
            }}
          >
            {!component.multiple ? <option value="">{component.placeholder ?? "请选择"}</option> : null}
            {component.options?.map((option) => (
              <option key={String(option.value)} value={option.value} disabled={option.disabled}>{option.label}</option>
            ))}
          </select>
          {component.type === "tree-select" ? <ChevronsUpDown size={14} /> : <ChevronDown size={14} />}
        </div>
      );
      break;
    case "textarea":
      control = <textarea disabled={component.disabled} value={scalarValue} placeholder={component.placeholder} onChange={changeValue} rows={3} />;
      break;
    case "checkbox":
      control = (
        <label className="proto-check">
          <input type="checkbox" disabled={component.disabled} checked={Boolean(value)} onChange={(event) => onValue(event.target.checked)} />
          <span><Check size={12} /></span>{component.text}
        </label>
      );
      break;
    case "switch":
      control = <button className={`proto-switch ${value ? "is-on" : ""}`} disabled={component.disabled} type="button" onClick={() => onValue(!value)}><i /></button>;
      break;
    case "radio":
      control = (
        <div className="proto-radio-group">
          {component.options?.map((option) => (
            <label key={String(option.value)}>
              <input type="radio" disabled={component.disabled || option.disabled} checked={Object.is(value, option.value)} onChange={() => onValue(option.value)} />
              {option.label}
            </label>
          ))}
        </div>
      );
      break;
    default:
      control = (
        <input
          disabled={component.disabled}
          value={scalarValue}
          placeholder={component.placeholder}
          onChange={changeValue}
          type={component.type === "number" ? "number" : component.type === "date" ? "date" : component.type === "datetime" ? "datetime-local" : "text"}
        />
      );
  }
  return (
    <Selectable component={component} selectedId={selectedId} onSelect={onSelect} className={`proto-field proto-field--${component.size ?? "medium"}`}>
      <label>{label}{required ? <em>*</em> : null}</label>
      {control}
      {error ? <span className="proto-field-error" role="alert">{error}</span> : null}
    </Selectable>
  );
}

function ActionButton({ component, selectedId, onSelect, onAction }: {
  component: UIComponent;
  selectedId?: string;
  onSelect?: (id: string) => void;
  onAction: (event?: PrototypeEvent, componentId?: string) => void;
}) {
  return (
    <Selectable component={component} selectedId={selectedId} onSelect={onSelect} className="proto-action-wrap">
      <button
        type="button"
        disabled={component.disabled}
        className={`proto-button proto-button--${component.variant ?? "default"}`}
        onClick={(event) => {
          event.stopPropagation();
          onSelect?.(component.id);
          onAction(component.event, component.id);
        }}
      >
        {component.id === "search.submit" ? <Search size={14} /> : null}
        {component.text ?? component.label ?? "操作"}
      </button>
    </Selectable>
  );
}

interface ComponentErrorBoundaryProps {
  componentId: string;
  children: ReactNode;
}

class ComponentErrorBoundary extends Component<ComponentErrorBoundaryProps, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(previous: ComponentErrorBoundaryProps) {
    if (previous.componentId !== this.props.componentId && this.state.error) this.setState({ error: undefined });
  }

  render() {
    if (this.state.error) return <ComponentFailure componentId={this.props.componentId} message={this.state.error.message} />;
    return this.props.children;
  }
}

function ComponentFailure({ componentId, message }: { componentId: string; message: string }) {
  return (
    <div className="proto-component-error" data-component-error={componentId} role="alert">
      <strong>组件无法渲染</strong>
      <span>{componentId}</span>
      <small>{message}</small>
    </div>
  );
}

interface ComponentRenderProps {
  component: UIComponent;
  values: Readonly<Record<string, unknown>>;
  errors: Readonly<Record<string, string>>;
  runtimeState: Readonly<Record<string, RuntimeComponentState>>;
  selectedId?: string;
  onSelect: (id: string) => void;
  onValue: (id: string, value: unknown) => void;
  onAction: (event?: PrototypeEvent, componentId?: string) => void;
  selectedRows: ReadonlySet<string>;
  onSelectedRows: (rows: Set<string>) => void;
}

const fieldTypes = new Set<UIComponent["type"]>([
  "input", "select", "tree-select", "number", "date", "datetime", "radio", "checkbox", "switch", "textarea"
]);

function effectiveComponent(component: UIComponent, runtimeState: Readonly<Record<string, RuntimeComponentState>>): UIComponent {
  const runtime = runtimeState[component.id];
  if (!runtime) return component;
  return {
    ...component,
    ...(runtime.visible === undefined ? {} : { visible: runtime.visible }),
    ...(runtime.disabled === undefined ? {} : { disabled: runtime.disabled })
  };
}

function componentIsVisible(component: UIComponent, values: Readonly<Record<string, unknown>>, runtimeState: Readonly<Record<string, RuntimeComponentState>>): boolean {
  const runtimeVisible = runtimeState[component.id]?.visible;
  if (runtimeVisible !== undefined) return runtimeVisible;
  if (component.visible === false) return false;
  return !component.visibleWhen || evaluateCondition(component.visibleWhen, values);
}

function SafeComponent(props: ComponentRenderProps) {
  const candidate = props.component as unknown;
  if (!candidate || typeof candidate !== "object") return <ComponentFailure componentId="unknown" message="组件必须是对象" />;
  const raw = candidate as Partial<UIComponent>;
  if (typeof raw.id !== "string" || typeof raw.type !== "string") {
    return <ComponentFailure componentId={typeof raw.id === "string" ? raw.id : "unknown"} message="缺少有效的 id 或 type" />;
  }
  if (!componentIsVisible(props.component, props.values, props.runtimeState)) return null;
  const component = effectiveComponent(props.component, props.runtimeState);
  return (
    <ComponentErrorBoundary componentId={component.id}>
      <ComponentView {...props} component={component} />
    </ComponentErrorBoundary>
  );
}

function ComponentChildren(props: ComponentRenderProps, components: UIComponent[] | undefined, className: string) {
  if (!components?.length) return null;
  return <div className={className}>{components.map((component, index) => <SafeComponent {...props} component={component} key={component?.id ?? `invalid-${index}`} />)}</div>;
}

function FormBlock(props: ComponentRenderProps) {
  const { component } = props;
  return (
    <Selectable component={component} selectedId={props.selectedId} onSelect={props.onSelect} className="proto-panel proto-form-panel">
      {(component.title || component.description) ? <header className="proto-block-heading"><div><span>FORM</span><h2>{component.title ?? "填写信息"}</h2>{component.description ? <p>{component.description}</p> : null}</div></header> : null}
      {ComponentChildren(props, component.fields, "proto-form-grid")}
      {component.children?.length ? ComponentChildren(props, component.children, "proto-component-stack") : null}
      {component.actions?.length ? ComponentChildren(props, component.actions, "proto-form-actions") : null}
    </Selectable>
  );
}

function DescriptionBlock(props: ComponentRenderProps) {
  const { component } = props;
  return (
    <Selectable component={component} selectedId={props.selectedId} onSelect={props.onSelect} className="proto-panel proto-description-panel">
      <header className="proto-block-heading"><div><span>DETAIL</span><h2>{component.title ?? component.label ?? "详情"}</h2>{component.description ? <p>{component.description}</p> : null}</div></header>
      {component.fields?.length ? (
        <dl className="proto-description-grid">
          {component.fields.map((field, index) => {
            if (!field || typeof field.id !== "string" || typeof field.type !== "string") {
              return <div key={`invalid-${index}`}><ComponentFailure componentId="unknown" message="详情字段结构无效" /></div>;
            }
            if (!componentIsVisible(field, props.values, props.runtimeState)) return null;
            const shown = effectiveComponent(field, props.runtimeState);
            return (
              <Selectable component={shown} selectedId={props.selectedId} onSelect={props.onSelect} className="proto-description-item" key={shown.id}>
                <dt>{shown.label ?? shown.title ?? shown.id}</dt>
                <dd>{formatValue(props.values[shown.id] ?? shown.value ?? shown.defaultValue)}</dd>
                {shown.description ? <small>{shown.description}</small> : null}
              </Selectable>
            );
          })}
        </dl>
      ) : null}
      {component.children?.length ? ComponentChildren(props, component.children, "proto-component-stack") : null}
      {component.actions?.length ? ComponentChildren(props, component.actions, "proto-form-actions") : null}
    </Selectable>
  );
}

function CardBlock(props: ComponentRenderProps) {
  const { component } = props;
  return (
    <Selectable component={component} selectedId={props.selectedId} onSelect={props.onSelect} className="proto-panel proto-card">
      {(component.title || component.description) ? <header className="proto-card-heading"><div><h2>{component.title ?? component.label}</h2>{component.description ? <p>{component.description}</p> : null}</div></header> : null}
      {component.fields?.length ? ComponentChildren(props, component.fields, "proto-form-grid") : null}
      {component.children?.length ? ComponentChildren(props, component.children, "proto-component-stack") : null}
      {component.actions?.length ? ComponentChildren(props, component.actions, "proto-form-actions") : null}
    </Selectable>
  );
}

function TabsBlock(props: ComponentRenderProps) {
  const { component } = props;
  const tabs = component.tabs ?? [];
  const [requestedTab, setRequestedTab] = useState(tabs[0]?.id);
  const activeTab = tabs.find((tab) => tab.id === requestedTab) ?? tabs[0];
  return (
    <Selectable component={component} selectedId={props.selectedId} onSelect={props.onSelect} className="proto-panel proto-tabs">
      {(component.title || component.description) ? <header className="proto-card-heading"><div><h2>{component.title}</h2>{component.description ? <p>{component.description}</p> : null}</div></header> : null}
      <div className="proto-tab-list" role="tablist" aria-label={component.title ?? component.label ?? "标签页"}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === activeTab?.id}
            className={tab.id === activeTab?.id ? "is-active" : ""}
            onClick={(event) => { event.stopPropagation(); setRequestedTab(tab.id); }}
          >{tab.label}</button>
        ))}
      </div>
      <div className="proto-tab-content" role="tabpanel" data-tab-id={activeTab?.id}>
        {activeTab ? ComponentChildren(props, activeTab.children, "proto-component-stack") : <div className="proto-empty">暂无标签内容</div>}
      </div>
    </Selectable>
  );
}

function TableBlock(props: ComponentRenderProps) {
  const { component: table, selectedId, onSelect, selectedRows, onSelectedRows } = props;
  const rows = table.rows ?? [];
  const columns = table.columns ?? [];
  return (
    <Selectable component={table} selectedId={selectedId} onSelect={onSelect} className="proto-table-selectable">
      <div className="proto-table-scroller">
        <table className="proto-table">
          <thead><tr>
            {table.selectable ? (
              <th className="proto-cell-check"><input type="checkbox" checked={rows.length > 0 && selectedRows.size === rows.length} onChange={(event) => onSelectedRows(event.target.checked ? new Set(rows.map((row) => String(row[table.rowKey ?? "id"]))) : new Set())} /></th>
            ) : null}
            {columns.map((column) => (
              <th key={column.id} className={selectedId === column.id ? "is-component-selected" : ""} data-component-id={column.id} onClick={(event) => { event.stopPropagation(); onSelect(column.id); }}>
                {column.title}{selectedId === column.id ? <span className="proto-column-tag">{column.id}</span> : null}
              </th>
            ))}
          </tr></thead>
          <tbody>{rows.map((row, rowIndex) => {
            const key = String(row[table.rowKey ?? "id"] ?? rowIndex);
            return (
              <tr key={key} className={selectedRows.has(key) ? "is-selected" : ""}>
                {table.selectable ? (
                  <td className="proto-cell-check"><input type="checkbox" checked={selectedRows.has(key)} onChange={(event) => { const next = new Set(selectedRows); if (event.target.checked) next.add(key); else next.delete(key); onSelectedRows(next); }} /></td>
                ) : null}
                {columns.map((column) => (
                  <td key={column.id}>{column.format === "status" ? (
                    <span className={`proto-status proto-status--${String(row[column.dataIndex]).includes("完成") ? "done" : String(row[column.dataIndex]).includes("跟进") ? "active" : "pending"}`}>
                      {formatValue(row[column.dataIndex], column)}
                    </span>
                  ) : formatValue(row[column.dataIndex], column)}</td>
                ))}
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </Selectable>
  );
}

function ComponentView(props: ComponentRenderProps) {
  const { component } = props;
  if (fieldTypes.has(component.type)) {
    return <Field component={component} value={props.values[component.id]} error={props.errors[component.id]} onValue={(value) => props.onValue(component.id, value)} selectedId={props.selectedId} onSelect={props.onSelect} />;
  }
  switch (component.type) {
    case "button":
      return <ActionButton component={component} selectedId={props.selectedId} onSelect={props.onSelect} onAction={props.onAction} />;
    case "form":
      return <FormBlock {...props} />;
    case "description":
      return <DescriptionBlock {...props} />;
    case "card":
      return <CardBlock {...props} />;
    case "tabs":
      return <TabsBlock {...props} />;
    case "table":
      return <TableBlock {...props} />;
    case "modal":
    case "drawer":
    case "popover":
      return <CardBlock {...props} />;
    default:
      return <ComponentFailure componentId={component.id} message={`不支持的组件类型：${String(component.type)}`} />;
  }
}

function walkComponents(components: readonly UIComponent[], visit: (component: UIComponent) => boolean | void): UIComponent | undefined {
  for (const component of components) {
    if (!component || typeof component !== "object") continue;
    if (visit(component)) return component;
    const nested = [component.fields ?? [], component.children ?? [], component.actions ?? []];
    for (const children of nested) {
      const found = walkComponents(children, visit);
      if (found) return found;
    }
    for (const tab of component.tabs ?? []) {
      const found = walkComponents(tab.children ?? [], visit);
      if (found) return found;
    }
  }
  return undefined;
}

function componentRoots(dsl: PageDSL): UIComponent[] {
  return [
    ...(dsl.search?.fields ?? []),
    ...(dsl.search?.actions ?? []),
    ...(dsl.toolbar?.actions ?? []),
    ...(dsl.table ? [dsl.table] : []),
    ...(dsl.form ? [dsl.form] : []),
    ...(dsl.detail ? [dsl.detail] : []),
    ...(dsl.sections ?? []),
    ...dsl.overlays
  ];
}

function validationErrors(component: UIComponent | undefined, values: Readonly<Record<string, unknown>>, runtimeState: Readonly<Record<string, RuntimeComponentState>>): Record<string, string> {
  const next: Record<string, string> = {};
  if (!component) return next;
  walkComponents([component], (field) => {
    if (!field.validation || !componentIsVisible(field, values, runtimeState) || effectiveComponent(field, runtimeState).disabled) return;
    const value = values[field.id];
    const rule = field.validation;
    let invalid = false;
    if (rule.required && isEmpty(value)) invalid = true;
    else if (typeof value === "string" && rule.minLength !== undefined && value.length < rule.minLength) invalid = true;
    else if (typeof value === "string" && rule.maxLength !== undefined && value.length > rule.maxLength) invalid = true;
    else if (typeof value === "number" && rule.min !== undefined && value < rule.min) invalid = true;
    else if (typeof value === "number" && rule.max !== undefined && value > rule.max) invalid = true;
    else if (typeof value === "string" && rule.pattern) {
      try { invalid = !new RegExp(rule.pattern).test(value); } catch { invalid = true; }
    }
    if (invalid) next[field.id] = rule.message ?? `${field.label ?? "该字段"}校验未通过`;
  });
  return next;
}

export function PrototypeRenderer({ dsl, selectedId, interactive = true, onSelect, onRuntimeEvent }: PrototypeRendererProps) {
  const roots = useMemo(() => componentRoots(dsl), [dsl]);
  const initialValues = useMemo(() => {
    const entries: [string, unknown][] = [];
    walkComponents(roots, (component) => { entries.push([component.id, component.defaultValue ?? component.value ?? ""]); });
    return Object.fromEntries(entries);
  }, [roots]);
  const [values, setValues] = useState<Record<string, unknown>>(initialValues);
  const [runtimeState, setRuntimeState] = useState<Record<string, RuntimeComponentState>>({});
  const [openOverlay, setOpenOverlay] = useState<string>();
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    setValues(initialValues);
    setRuntimeState({});
    setOpenOverlay(undefined);
    setSelectedRows(new Set());
    setErrors({});
    setNotice(undefined);
  }, [initialValues]);

  const select = (id: string) => {
    if (!interactive) return;
    onSelect?.(id);
    onRuntimeEvent?.({ type: "select", componentId: id });
  };

  const trigger = (event?: PrototypeEvent, componentId?: string) => {
    if (!event) return;
    onRuntimeEvent?.({ type: event.type, componentId, target: event.target, value: event.value });
    if (event.type === "open" && event.target) setOpenOverlay(event.target);
    if (event.type === "close") setOpenOverlay(undefined);
    if (event.type === "clear") {
      setValues(initialValues);
      setErrors({});
      setNotice("查询条件已重置");
    }
    if (event.type === "refresh") setNotice(`已按当前条件刷新 · ${(dsl.table?.rows ?? []).length} 条结果`);
    if (event.type === "navigate") setNotice(`导航到 ${event.path ?? event.target ?? "目标页面"}`);
    if (event.target && ["show", "hide", "enable", "disable"].includes(event.type)) {
      setRuntimeState((current) => ({
        ...current,
        [event.target!]: {
          ...current[event.target!],
          ...((event.type === "show" || event.type === "hide") ? { visible: event.type === "show" } : { disabled: event.type === "disable" })
        }
      }));
    }
    if (event.type === "setValue" && event.target) {
      setValues((current) => ({ ...current, [event.target!]: event.value }));
      setErrors((current) => { const next = { ...current }; delete next[event.target!]; return next; });
    }
    if (event.type === "submit") {
      const targetId = event.target ?? openOverlay ?? dsl.form?.id;
      const target = targetId ? walkComponents(roots, (component) => component.id === targetId) : dsl.form;
      const nextErrors = validationErrors(target, values, runtimeState);
      setErrors(nextErrors);
      if (Object.keys(nextErrors).length === 0) {
        if (dsl.overlays.some((overlay) => overlay.id === targetId)) setOpenOverlay(undefined);
        setNotice(dsl.overlays.some((overlay) => overlay.id === targetId) ? "操作完成，页面已刷新" : "表单已提交");
      } else onRuntimeEvent?.({ type: "validation-error", target: targetId, value: nextErrors });
    }
  };

  const onValue = (id: string, value: unknown) => {
    setValues((current) => ({ ...current, [id]: value }));
    setErrors((current) => { const next = { ...current }; delete next[id]; return next; });
  };
  const renderProps: Omit<ComponentRenderProps, "component"> = {
    values,
    errors,
    runtimeState,
    selectedId,
    onSelect: select,
    onValue,
    onAction: trigger,
    selectedRows,
    onSelectedRows: setSelectedRows
  };
  const visibleOverlay = dsl.overlays.find((item) => item.id === openOverlay && componentIsVisible(item, values, runtimeState));
  const rows = dsl.table?.rows ?? [];

  return (
    <div className={`proto-root proto-density--${dsl.layout.density ?? "normal"}`} onClick={() => onSelect?.("")}>
      <div className="proto-page-heading">
        <div>
          <div className="proto-breadcrumb"><span>业务工作台</span><b>/</b><span>{dsl.page.title}</span></div>
          <h1>{dsl.page.title}</h1>
          {dsl.page.description ? <p>{dsl.page.description}</p> : null}
        </div>
        <div className="proto-page-meta"><span>PAGE</span><strong>{dsl.page.id}</strong></div>
      </div>

      {dsl.search ? (
        <section className="proto-panel proto-search-panel" data-container-id={dsl.search.id}>
          <div className="proto-search-grid">
            {dsl.search.fields.map((component, index) => <SafeComponent {...renderProps} component={component} key={component?.id ?? `invalid-${index}`} />)}
            <div className="proto-search-actions">
              {dsl.search.actions?.map((component, index) => <SafeComponent {...renderProps} component={component} key={component?.id ?? `invalid-${index}`} />)}
            </div>
          </div>
        </section>
      ) : null}

      {(dsl.toolbar || dsl.table) ? (
        <section className="proto-panel proto-data-panel">
          {dsl.toolbar ? (
            <div className="proto-toolbar">
              <div className="proto-toolbar-actions">{dsl.toolbar.actions.map((component, index) => <SafeComponent {...renderProps} component={component} key={component?.id ?? `invalid-${index}`} />)}</div>
              {dsl.table ? <div className="proto-count"><b>{selectedRows.size}</b> 已选择 <i /> 共 {rows.length} 条</div> : null}
            </div>
          ) : null}
          {dsl.table ? <SafeComponent {...renderProps} component={dsl.table} /> : null}
          {dsl.table ? <div className="proto-pagination"><span>共 {rows.length} 条</span><button className="is-active">1</button><button>2</button><button>›</button></div> : null}
        </section>
      ) : null}

      {dsl.form ? <SafeComponent {...renderProps} component={dsl.form} /> : null}
      {dsl.detail ? <SafeComponent {...renderProps} component={dsl.detail} /> : null}
      {dsl.sections?.map((component, index) => <SafeComponent {...renderProps} component={component} key={component?.id ?? `invalid-${index}`} />)}

      {notice ? <div className="proto-notice"><Check size={14} />{notice}<button onClick={() => setNotice(undefined)}><X size={13} /></button></div> : null}

      {visibleOverlay ? (
        <div className="proto-overlay-backdrop" onClick={() => setOpenOverlay(undefined)}>
          <Selectable
            component={effectiveComponent(visibleOverlay, runtimeState)}
            selectedId={selectedId}
            onSelect={select}
            className={`proto-overlay proto-overlay--${visibleOverlay.type}`}
          >
            <ComponentErrorBoundary componentId={visibleOverlay.id}>
              <div className="proto-overlay-card" onClick={(event) => event.stopPropagation()}>
                <header><div><div className="proto-overlay-kicker">OPERATION</div><h2>{visibleOverlay.title}</h2>{visibleOverlay.description ? <p>{visibleOverlay.description}</p> : null}</div><button onClick={() => setOpenOverlay(undefined)}><X size={18} /></button></header>
                <div className="proto-overlay-info"><Info size={15} /><span>请确认信息无误后再执行操作。</span></div>
                {visibleOverlay.fields?.length ? ComponentChildren({ ...renderProps, component: visibleOverlay }, visibleOverlay.fields, "proto-overlay-fields") : null}
                {visibleOverlay.children?.length ? ComponentChildren({ ...renderProps, component: visibleOverlay }, visibleOverlay.children, "proto-overlay-fields") : null}
                <footer>{visibleOverlay.actions?.map((action, index) => <SafeComponent {...renderProps} component={action} key={action?.id ?? `invalid-${index}`} />)}</footer>
              </div>
            </ComponentErrorBoundary>
          </Selectable>
        </div>
      ) : null}
    </div>
  );
}
