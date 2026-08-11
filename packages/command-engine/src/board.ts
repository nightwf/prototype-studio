import {
  type BoardCommand,
  type BoardDSL,
  type BoardLink,
  type BoardObject,
  type BoardRevisionRecord,
  type RevisionSource
} from "@prototype-studio/dsl-schema";
import { validateBoard } from "@prototype-studio/dsl-validator";

export class BoardEngineError extends Error {
  constructor(
    public readonly code: "REVISION_CONFLICT" | "TARGET_NOT_FOUND" | "INVALID_COMMAND" | "BOARD_VALIDATION_FAILED",
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "BoardEngineError";
  }
}

export interface ApplyBoardCommandsInput {
  board: BoardDSL;
  baseRevision: number;
  commands: BoardCommand[];
  source: RevisionSource;
  operator: string;
  now?: string;
  revisionId?: string;
}

export interface ApplyBoardCommandsResult {
  board: BoardDSL;
  revision: BoardRevisionRecord;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `brd_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function findObject(board: BoardDSL, target: string): BoardObject {
  const object = board.objects.find((item) => item.id === target);
  if (!object) {
    throw new BoardEngineError("TARGET_NOT_FOUND", `找不到画布对象“${target}”。`, {
      target,
      suggestion: "先读取画布确认对象 id。"
    });
  }
  return object;
}

function updateObject(target: Record<string, unknown>, changes: Record<string, unknown>): void {
  Object.entries(changes).forEach(([key, value]) => {
    if (key === "id" && value !== target.id) {
      throw new BoardEngineError("INVALID_COMMAND", "画布对象 id 不可通过普通更新修改。");
    }
    if (value === undefined) delete target[key];
    else target[key] = value;
  });
}

function applyCommand(board: BoardDSL, command: BoardCommand, changed: Set<string>): void {
  switch (command.type) {
    case "ADD_BOARD_OBJECT": {
      if (command.index === undefined || command.index >= board.objects.length) board.objects.push(clone(command.object));
      else board.objects.splice(Math.max(0, command.index), 0, clone(command.object));
      changed.add(command.object.id);
      return;
    }
    case "UPDATE_BOARD_OBJECT": {
      const object = findObject(board, command.target);
      updateObject(object as unknown as Record<string, unknown>, command.changes as unknown as Record<string, unknown>);
      changed.add(command.target);
      return;
    }
    case "MOVE_BOARD_OBJECT": {
      const object = findObject(board, command.target);
      if (object.type === "marker") {
        throw new BoardEngineError("INVALID_COMMAND", "标注对象通过组件挂靠定位，不支持画布坐标移动。");
      }
      (object as { x: number; y: number }).x = command.x;
      (object as { y: number }).y = command.y;
      if (command.z !== undefined) object.z = command.z;
      changed.add(command.target);
      return;
    }
    case "DELETE_BOARD_OBJECT": {
      const index = board.objects.findIndex((item) => item.id === command.target);
      if (index < 0) throw new BoardEngineError("TARGET_NOT_FOUND", `找不到画布对象“${command.target}”。`);
      board.objects.splice(index, 1);
      board.links = board.links.filter((link) => link.from !== command.target && link.to !== command.target);
      changed.add(command.target);
      return;
    }
    case "ADD_BOARD_LINK": {
      const link = clone(command.link) as BoardLink;
      if (!board.objects.some((item) => item.id === link.from) || !board.objects.some((item) => item.id === link.to)) {
        throw new BoardEngineError("INVALID_COMMAND", "连线两端必须是画布上的对象。");
      }
      if (command.index === undefined || command.index >= board.links.length) board.links.push(link);
      else board.links.splice(Math.max(0, command.index), 0, link);
      changed.add(link.id);
      return;
    }
    case "UPDATE_BOARD_LINK": {
      const link = board.links.find((item) => item.id === command.target);
      if (!link) throw new BoardEngineError("TARGET_NOT_FOUND", `找不到连线“${command.target}”。`);
      updateObject(link as unknown as Record<string, unknown>, command.changes as unknown as Record<string, unknown>);
      changed.add(command.target);
      return;
    }
    case "DELETE_BOARD_LINK": {
      const index = board.links.findIndex((item) => item.id === command.target);
      if (index < 0) throw new BoardEngineError("TARGET_NOT_FOUND", `找不到连线“${command.target}”。`);
      board.links.splice(index, 1);
      changed.add(command.target);
      return;
    }
  }
}

export function applyBoardCommands(input: ApplyBoardCommandsInput): ApplyBoardCommandsResult {
  if (input.baseRevision !== input.board.revision) {
    throw new BoardEngineError(
      "REVISION_CONFLICT",
      `画布当前 revision 为 ${input.board.revision}，但命令基于 ${input.baseRevision}。请重新读取画布。`,
      { currentRevision: input.board.revision, baseRevision: input.baseRevision }
    );
  }
  if (input.commands.length === 0) {
    throw new BoardEngineError("INVALID_COMMAND", "commands 不能为空。");
  }

  const before = clone(input.board);
  const after = clone(input.board);
  const changed = new Set<string>();
  input.commands.forEach((command) => applyCommand(after, command, changed));
  after.revision = before.revision + 1;

  const validation = validateBoard(after);
  if (!validation.valid) {
    throw new BoardEngineError("BOARD_VALIDATION_FAILED", "命令执行结果未通过画布校验，未写入任何修改。", validation.errors);
  }

  const now = input.now ?? new Date().toISOString();
  const revision: BoardRevisionRecord = {
    id: input.revisionId ?? randomId(),
    boardId: after.id,
    revision: after.revision,
    source: input.source,
    operator: input.operator,
    baseRevision: before.revision,
    commands: clone(input.commands),
    before,
    after: clone(after),
    changedObjectIds: [...changed],
    createdAt: now
  };
  return { board: after, revision };
}

/**
 * 生成把 current 恢复成 target 状态所需的画布命令（撤销 / 重做使用）。
 * 通过对象 / 连线的增删改还原完整状态，不含 id 变更。
 */
export function createBoardRestoreCommands(target: BoardDSL, current: BoardDSL): BoardCommand[] {
  const commands: BoardCommand[] = [];

  // 删除当前多余、目标中不存在的连线
  for (const link of current.links) {
    if (!target.links.some((item) => item.id === link.id)) {
      commands.push({ type: "DELETE_BOARD_LINK", target: link.id });
    }
  }
  // 删除当前多余、目标中不存在的对象（其关联连线由引擎一并移除）
  for (const object of current.objects) {
    if (!target.objects.some((item) => item.id === object.id)) {
      commands.push({ type: "DELETE_BOARD_OBJECT", target: object.id });
    }
  }
  // 补回目标中存在、当前缺失的对象
  for (const object of target.objects) {
    if (!current.objects.some((item) => item.id === object.id)) {
      commands.push({ type: "ADD_BOARD_OBJECT", object: clone(object) });
    }
  }
  // 恢复内容发生变化的对象
  for (const object of target.objects) {
    const live = current.objects.find((item) => item.id === object.id);
    if (live) {
      const changes = boardFieldChanges(live, object);
      if (changes) commands.push({ type: "UPDATE_BOARD_OBJECT", target: object.id, changes: changes as Partial<BoardObject> });
    }
  }
  // 补回目标中存在、当前缺失的连线
  for (const link of target.links) {
    if (!current.links.some((item) => item.id === link.id)) {
      commands.push({ type: "ADD_BOARD_LINK", link: clone(link) });
    }
  }
  // 恢复内容发生变化的连线
  for (const link of target.links) {
    const live = current.links.find((item) => item.id === link.id);
    if (live) {
      const changes = boardFieldChanges(live, link);
      if (changes) commands.push({ type: "UPDATE_BOARD_LINK", target: link.id, changes: changes as Partial<BoardLink> });
    }
  }
  return commands;
}

/** 计算 current → target 的字段差异；字段在目标中缺失时置 undefined 以便引擎删除。 */
function boardFieldChanges<T extends object>(current: T, target: T): Record<string, unknown> | null {
  const changes: Record<string, unknown> = {};
  let dirty = false;
  for (const key of new Set([...Object.keys(current), ...Object.keys(target)])) {
    if (key === "id") continue;
    const before = (current as Record<string, unknown>)[key];
    const after = (target as Record<string, unknown>)[key];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changes[key] = after;
      dirty = true;
    }
  }
  return dirty ? changes : null;
}
