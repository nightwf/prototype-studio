import {
  type Command,
  type PageDSL,
  type PageEvent,
  type PageRule,
  type RevisionRecord,
  type RevisionSource,
  type UIComponent
} from "@prototype-studio/dsl-schema";
import { collectComponentLocations, validateDSL, type DSLValidationIssue } from "@prototype-studio/dsl-validator";

export class CommandEngineError extends Error {
  constructor(
    public readonly code: "REVISION_CONFLICT" | "TARGET_NOT_FOUND" | "CONTAINER_NOT_FOUND" | "INVALID_COMMAND" | "DSL_VALIDATION_FAILED",
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "CommandEngineError";
  }
}

export interface ExecuteCommandsInput {
  dsl: PageDSL;
  baseRevision: number;
  commands: Command[];
  source: RevisionSource;
  operator: string;
  now?: string;
  revisionId?: string;
}

export interface ExecuteCommandsResult {
  dsl: PageDSL;
  revision: RevisionRecord;
  warnings: DSLValidationIssue[];
}

interface ComponentArrayLocation {
  array: UIComponent[];
  index: number;
}

function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `rev_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function nestedArrays(component: UIComponent): UIComponent[][] {
  const arrays: UIComponent[][] = [];
  if (component.fields) arrays.push(component.fields);
  if (component.children) arrays.push(component.children);
  if (component.actions) arrays.push(component.actions);
  if (component.columns) arrays.push(component.columns as unknown as UIComponent[]);
  component.tabs?.forEach((tab) => arrays.push(tab.children));
  return arrays;
}

function topLevelArrays(dsl: PageDSL): UIComponent[][] {
  return [
    dsl.search?.fields,
    dsl.search?.actions,
    dsl.toolbar?.actions,
    dsl.table ? [dsl.table] : undefined,
    dsl.form ? [dsl.form] : undefined,
    dsl.detail ? [dsl.detail] : undefined,
    dsl.sections,
    dsl.overlays
  ].filter((value): value is UIComponent[] => Boolean(value));
}

function findInArrays(arrays: UIComponent[][], target: string): ComponentArrayLocation | undefined {
  for (const array of arrays) {
    const index = array.findIndex((component) => component.id === target);
    if (index >= 0) return { array, index };
    for (const component of array) {
      const nested = findInArrays(nestedArrays(component), target);
      if (nested) return nested;
    }
  }
  return undefined;
}

function findComponentArray(dsl: PageDSL, target: string): ComponentArrayLocation {
  const found = findInArrays(topLevelArrays(dsl), target);
  if (!found) {
    throw new CommandEngineError("TARGET_NOT_FOUND", `找不到组件“${target}”。`, {
      target,
      suggestion: "请先通过 get_component 获取当前 componentId。"
    });
  }
  return found;
}

function findComponent(dsl: PageDSL, target: string): UIComponent {
  const { array, index } = findComponentArray(dsl, target);
  return array[index]!;
}

function resolveContainer(dsl: PageDSL, container: string): UIComponent[] {
  switch (container) {
    case "search.fields":
      if (dsl.search) return dsl.search.fields;
      break;
    case "search.actions":
      if (dsl.search) return (dsl.search.actions ??= []);
      break;
    case "toolbar.actions":
      if (dsl.toolbar) return dsl.toolbar.actions;
      break;
    case "sections":
      return (dsl.sections ??= []);
    case "overlays":
      return dsl.overlays;
  }

  const suffix = [".fields", ".children", ".actions"].find((candidate) => container.endsWith(candidate));
  const componentId = suffix ? container.slice(0, -suffix.length) : container;
  try {
    const component = findComponent(dsl, componentId);
    if (suffix === ".fields") return (component.fields ??= []);
    if (suffix === ".actions") return (component.actions ??= []);
    return (component.children ??= []);
  } catch {
    throw new CommandEngineError("CONTAINER_NOT_FOUND", `找不到容器“${container}”。`, {
      container,
      suggestion: "使用 search.fields、search.actions、toolbar.actions、sections、overlays 或组件 ID。"
    });
  }
}

function insertAt<T>(array: T[], value: T, index?: number): void {
  if (index === undefined || index >= array.length) array.push(value);
  else array.splice(Math.max(0, index), 0, value);
}

function updateObject<T extends object>(target: T, changes: Partial<T>): void {
  Object.entries(changes).forEach(([key, value]) => {
    if (key === "id" && value !== undefined && value !== (target as Record<string, unknown>).id) {
      throw new CommandEngineError(
        "INVALID_COMMAND",
        "稳定 componentId 不能通过普通更新修改。请删除后重新创建组件。"
      );
    }
    if (value === undefined) delete (target as Record<string, unknown>)[key];
    else (target as Record<string, unknown>)[key] = value;
  });
}

function applyCommand(dsl: PageDSL, command: Command, changed: Set<string>): void {
  switch (command.type) {
    case "ADD_COMPONENT": {
      insertAt(resolveContainer(dsl, command.container), clone(command.component), command.index);
      changed.add(command.component.id);
      return;
    }
    case "UPDATE_COMPONENT": {
      const component = findComponent(dsl, command.target);
      updateObject(component, command.changes);
      changed.add(command.target);
      return;
    }
    case "MOVE_COMPONENT": {
      const source = findComponentArray(dsl, command.target);
      const [component] = source.array.splice(source.index, 1);
      if (!component) throw new CommandEngineError("TARGET_NOT_FOUND", `找不到组件“${command.target}”。`);
      insertAt(resolveContainer(dsl, command.container), component, command.index);
      changed.add(command.target);
      return;
    }
    case "DELETE_COMPONENT": {
      const source = findComponentArray(dsl, command.target);
      source.array.splice(source.index, 1);
      changed.add(command.target);
      return;
    }
    case "CREATE_OVERLAY":
      insertAt(dsl.overlays, clone(command.overlay), command.index);
      changed.add(command.overlay.id);
      return;
    case "UPDATE_OVERLAY": {
      const overlay = dsl.overlays.find((item) => item.id === command.target);
      if (!overlay) throw new CommandEngineError("TARGET_NOT_FOUND", `找不到 Overlay“${command.target}”。`);
      updateObject(overlay, command.changes);
      changed.add(command.target);
      return;
    }
    case "DELETE_OVERLAY": {
      const index = dsl.overlays.findIndex((item) => item.id === command.target);
      if (index < 0) throw new CommandEngineError("TARGET_NOT_FOUND", `找不到 Overlay“${command.target}”。`);
      dsl.overlays.splice(index, 1);
      changed.add(command.target);
      return;
    }
    case "ADD_RULE":
      dsl.rules.push(clone(command.rule));
      return;
    case "UPDATE_RULE": {
      const rule = dsl.rules.find((item) => item.id === command.target);
      if (!rule) throw new CommandEngineError("TARGET_NOT_FOUND", `找不到规则“${command.target}”。`);
      updateObject<PageRule>(rule, command.changes);
      return;
    }
    case "DELETE_RULE": {
      const index = dsl.rules.findIndex((item) => item.id === command.target);
      if (index < 0) throw new CommandEngineError("TARGET_NOT_FOUND", `找不到规则“${command.target}”。`);
      dsl.rules.splice(index, 1);
      return;
    }
    case "ADD_EVENT":
      dsl.events.push(clone(command.event));
      return;
    case "UPDATE_EVENT": {
      const event = dsl.events.find((item) => item.id === command.target);
      if (!event) throw new CommandEngineError("TARGET_NOT_FOUND", `找不到页面事件“${command.target}”。`);
      updateObject<PageEvent>(event, command.changes);
      return;
    }
    case "CREATE_PAGE":
    case "DELETE_PAGE":
      throw new CommandEngineError("INVALID_COMMAND", `${command.type} 必须由 Project Store 执行。`);
  }
}

export function executeCommands(input: ExecuteCommandsInput): ExecuteCommandsResult {
  if (input.baseRevision !== input.dsl.revision) {
    throw new CommandEngineError(
      "REVISION_CONFLICT",
      `页面当前 revision 为 ${input.dsl.revision}，但命令基于 ${input.baseRevision}。请重新读取页面后再提交。`,
      { currentRevision: input.dsl.revision, baseRevision: input.baseRevision }
    );
  }
  if (input.commands.length === 0) {
    throw new CommandEngineError("INVALID_COMMAND", "commands 不能为空。");
  }

  const before = clone(input.dsl);
  const after = clone(input.dsl);
  const changed = new Set<string>();
  input.commands.forEach((command) => applyCommand(after, command, changed));
  after.revision = before.revision + 1;
  const validation = validateDSL(after);
  if (!validation.valid) {
    throw new CommandEngineError(
      "DSL_VALIDATION_FAILED",
      "命令执行结果未通过 DSL 校验，未写入任何修改。",
      validation.errors
    );
  }

  const now = input.now ?? new Date().toISOString();
  const revision: RevisionRecord = {
    id: input.revisionId ?? randomId(),
    pageId: after.page.id,
    revision: after.revision,
    source: input.source,
    operator: input.operator,
    baseRevision: before.revision,
    commands: clone(input.commands),
    before,
    after: clone(after),
    changedComponentIds: [...changed],
    createdAt: now
  };
  return { dsl: after, revision, warnings: validation.warnings };
}

export interface DslDiffEntry {
  path: string;
  before: unknown;
  after: unknown;
  kind: "add" | "remove" | "change";
}

export function diffDsl(before: unknown, after: unknown, path = "$"): DslDiffEntry[] {
  if (Object.is(before, after)) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    return Array.from({ length }, (_, index) => diffDsl(before[index], after[index], `${path}[${index}]`)).flat();
  }
  if (
    before !== null && after !== null &&
    typeof before === "object" && typeof after === "object" &&
    !Array.isArray(before) && !Array.isArray(after)
  ) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].flatMap((key) =>
      diffDsl((before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key], `${path}.${key}`)
    );
  }
  return [{
    path,
    before,
    after,
    kind: before === undefined ? "add" : after === undefined ? "remove" : "change"
  }];
}

export function createRevertRevision(
  current: PageDSL,
  target: RevisionRecord,
  operator: string,
  now = new Date().toISOString()
): { dsl: PageDSL; revision: RevisionRecord } {
  const before = clone(current);
  const after = clone(target.before);
  after.revision = current.revision + 1;
  const validation = validateDSL(after);
  if (!validation.valid) {
    throw new CommandEngineError("DSL_VALIDATION_FAILED", "目标历史版本已无法通过当前 DSL 校验。", validation.errors);
  }
  const changedComponentIds = new Set([
    ...collectComponentLocations(before).map(({ component }) => component.id),
    ...collectComponentLocations(after).map(({ component }) => component.id)
  ]);
  const revision: RevisionRecord = {
    id: randomId(),
    pageId: current.page.id,
    revision: after.revision,
    source: "undo",
    operator,
    baseRevision: current.revision,
    commands: [],
    before,
    after: clone(after),
    changedComponentIds: [...changedComponentIds],
    createdAt: now,
    revertsRevision: target.revision
  };
  return { dsl: after, revision };
}

export function createReapplyRevision(
  current: PageDSL,
  target: RevisionRecord,
  operator: string,
  now = new Date().toISOString()
): { dsl: PageDSL; revision: RevisionRecord } {
  const before = clone(current);
  const after = clone(target.after);
  after.revision = current.revision + 1;
  const validation = validateDSL(after);
  if (!validation.valid) {
    throw new CommandEngineError("DSL_VALIDATION_FAILED", "目标历史版本已无法通过当前 DSL 校验。", validation.errors);
  }
  const changedComponentIds = target.changedComponentIds.length
    ? [...target.changedComponentIds]
    : [...new Set([
        ...collectComponentLocations(before).map(({ component }) => component.id),
        ...collectComponentLocations(after).map(({ component }) => component.id)
      ])];
  const revision: RevisionRecord = {
    id: randomId(),
    pageId: current.page.id,
    revision: after.revision,
    source: "redo",
    operator,
    baseRevision: current.revision,
    commands: clone(target.commands),
    before,
    after: clone(after),
    changedComponentIds,
    createdAt: now,
    reappliesRevision: target.revision
  };
  return { dsl: after, revision };
}

export { applyBoardCommands, BoardEngineError } from "./board";
export type { ApplyBoardCommandsInput, ApplyBoardCommandsResult } from "./board";
