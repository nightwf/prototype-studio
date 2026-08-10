import path from "node:path";
import type { BoardCommand, Command, PageDSL, UIComponent } from "@prototype-studio/dsl-schema";
import { getComponentLocation, validateDSL } from "@prototype-studio/dsl-validator";
import {
  ProjectStoreError,
  executeBoardCommands,
  createBoard,
  createBoards,
  deleteBoard,
  createPage,
  deletePage,
  executeProjectCommands,
  getPage,
  listPages,
  listBoards,
  openProject,
  readBoard,
  updateBoard
} from "@prototype-studio/project-store";
import type {
  ApplyBoardCommandsInput,
  BoardInput,
  ApplyCommandsInput,
  ComponentInput,
  CreateBoardInput,
  CreateBoardsInput,
  CreateOverlayInput,
  CreatePageInput,
  DeletePageInput,
  DeleteComponentInput,
  DeleteBoardInput,
  ListPagesInput,
  MoveComponentInput,
  PageInput,
  ListBoardsInput,
  UpdateBoardInput,
  UpdateComponentInput,
  UpdateOverlayInput,
  ValidateDslInput
} from "./schemas.js";

export interface ToolSuccess<T> {
  ok: true;
  data: T;
}

export interface ToolFailure {
  ok: false;
  error: {
    code: string;
    message: string;
    suggestion: string;
    details?: unknown;
  };
}

export type ToolOutcome<T> = ToolSuccess<T> | ToolFailure;

export interface PrototypeServiceOptions {
  projectRoot: string;
  previewBaseUrl?: string;
}

function success<T>(data: T): ToolSuccess<T> {
  return { ok: true, data };
}

function failure(code: string, message: string, suggestion: string, details?: unknown): ToolFailure {
  return { ok: false, error: { code, message, suggestion, ...(details === undefined ? {} : { details }) } };
}

function isCodedError(error: unknown): error is Error & { code: string; details?: unknown } {
  return error instanceof Error && "code" in error && typeof (error as { code?: unknown }).code === "string";
}

function safeFailure(error: unknown): ToolFailure {
  if (error instanceof ProjectStoreError || isCodedError(error)) {
    const suggestions: Record<string, string> = {
      PROJECT_NOT_FOUND: "检查 PROTOTYPE_STUDIO_PROJECT_ROOT 是否指向包含 project.yaml 的项目目录。",
      INVALID_PROJECT: "修复 project.yaml 或页面 ID 后重试。",
      PAGE_NOT_FOUND: "先调用 prototype_list_pages 取得有效 page_id。",
      PAGE_EXISTS: "改用新 page_id，或读取现有页面后通过 Command 修改。",
      BOARD_NOT_FOUND: "先调用 prototype_list_boards 取得有效 board_id。",
      BOARD_EXISTS: "使用项目内唯一的画布名称和 board_id。",
      LAST_BOARD: "项目至少要保留一个画布；请先创建其他画布。",
      PATH_OUTSIDE_PROJECT: "只能访问当前 Project Root 中的文件。",
      INVALID_DSL_FILE: "调用 prototype_validate_dsl 定位错误，修正后再写入。",
      REVISION_NOT_FOUND: "重新读取页面与当前 Revision 后重试。",
      REVISION_CONFLICT: "重新调用 prototype_get_dsl 获取最新 revision，再重新生成命令。",
      TARGET_NOT_FOUND: "先调用 prototype_get_dsl 或 prototype_get_component 确认稳定 componentId。",
      CONTAINER_NOT_FOUND: "使用 search.fields、search.actions、toolbar.actions、sections、overlays 或存在的容器组件 ID。",
      INVALID_COMMAND: "检查命令类型、必填参数与稳定 ID；页面创建请用 prototype_create_page。",
      DSL_VALIDATION_FAILED: "按 details 中的 path 和 suggestion 修正命令后重试。"
    };
    const safeDetails = ["INVALID_DSL_FILE", "DSL_VALIDATION_FAILED", "REVISION_CONFLICT"].includes(error.code)
      ? error.details
      : undefined;
    return failure(
      error.code,
      error.message,
      suggestions[error.code] ?? "根据错误提示检查输入，重新读取最新项目状态后重试。",
      safeDetails
    );
  }
  return failure(
    "INTERNAL_ERROR",
    "Prototype Studio 本地操作失败，未写入任何变更。",
    "检查 Project Root 是否可读写，然后重新读取项目状态并重试。"
  );
}

function asPageDsl(value: Record<string, unknown>): PageDSL {
  return value as unknown as PageDSL;
}

function asComponent(value: Record<string, unknown>): UIComponent {
  return value as unknown as UIComponent;
}

async function run<T>(operation: () => Promise<T>): Promise<ToolOutcome<T>> {
  try {
    return success(await operation());
  } catch (error) {
    return safeFailure(error);
  }
}

export function resolveProjectRoot(value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error("PROTOTYPE_STUDIO_PROJECT_ROOT 未设置。请将它设为包含 project.yaml 的本地项目目录。");
  }
  if (value.includes("\0")) throw new Error("PROTOTYPE_STUDIO_PROJECT_ROOT 包含无效字符。");
  return path.resolve(value);
}

export class PrototypeService {
  readonly projectRoot: string;
  readonly previewBaseUrl: string;

  constructor(options: PrototypeServiceOptions) {
    this.projectRoot = resolveProjectRoot(options.projectRoot);
    this.previewBaseUrl = options.previewBaseUrl ?? "http://127.0.0.1:4173";
  }

  getProject(): Promise<ToolOutcome<unknown>> {
    return run(async () => {
      const project = await openProject(this.projectRoot);
      return {
        manifest: project.manifest,
        page_count: project.pages.length,
        scope: "configured-project-root"
      };
    });
  }

  listPages(input: ListPagesInput): Promise<ToolOutcome<unknown>> {
    return run(async () => {
      await openProject(this.projectRoot);
      const allPages = await listPages(this.projectRoot);
      const pages = allPages.slice(input.offset, input.offset + input.limit);
      const nextOffset = input.offset + pages.length;
      return {
        total_count: allPages.length,
        count: pages.length,
        offset: input.offset,
        limit: input.limit,
        pages,
        has_more: nextOffset < allPages.length,
        ...(nextOffset < allPages.length ? { next_offset: nextOffset } : {})
      };
    });
  }

  getPage(input: PageInput): Promise<ToolOutcome<unknown>> {
    return run(async () => {
      const dsl = await getPage(this.projectRoot, input.page_id);
      const locations = getAllComponents(dsl);
      return {
        page: dsl.page,
        revision: dsl.revision,
        dsl_version: dsl.dslVersion,
        renderer_version: dsl.rendererVersion,
        design_system_version: dsl.designSystemVersion,
        layout: dsl.layout,
        component_count: locations.length,
        overlay_count: dsl.overlays.length,
        rule_count: dsl.rules.length,
        event_count: dsl.events.length,
        data_source: dsl.dataSource
      };
    });
  }

  getComponent(input: ComponentInput): Promise<ToolOutcome<unknown>> {
    return run(async () => {
      const dsl = await getPage(this.projectRoot, input.page_id);
      const location = getComponentLocation(dsl, input.component_id);
      if (!location) {
        const error = new Error(`找不到组件“${input.component_id}”。`) as Error & { code: string };
        error.code = "TARGET_NOT_FOUND";
        throw error;
      }
      return {
        page_id: input.page_id,
        revision: dsl.revision,
        component: location.component,
        dsl_path: location.path,
        parent_id: location.parentId
      };
    });
  }

  getDsl(input: PageInput): Promise<ToolOutcome<unknown>> {
    return run(async () => ({ dsl: await getPage(this.projectRoot, input.page_id) }));
  }

  listBoards(input: ListBoardsInput): Promise<ToolOutcome<unknown>> {
    return run(async () => {
      const allBoards = await listBoards(this.projectRoot);
      const boards = allBoards.slice(input.offset, input.offset + input.limit);
      const nextOffset = input.offset + boards.length;
      return {
        total_count: allBoards.length,
        count: boards.length,
        offset: input.offset,
        limit: input.limit,
        boards,
        has_more: nextOffset < allBoards.length,
        ...(nextOffset < allBoards.length ? { next_offset: nextOffset } : {})
      };
    });
  }

  getBoard(input: BoardInput): Promise<ToolOutcome<unknown>> {
    return run(async () => {
      const board = await readBoard(this.projectRoot, input.board_id);
      return {
        board,
        object_count: board.objects.length,
        link_count: board.links.length,
        revision: board.revision
      };
    });
  }

  applyBoardCommands(input: ApplyBoardCommandsInput): Promise<ToolOutcome<unknown>> {
    return run(async () => {
      const result = await executeBoardCommands(this.projectRoot, input.board_id, {
        baseRevision: input.base_revision,
        commands: input.commands as BoardCommand[],
        source: "mcp",
        operator: input.operator
      });
      return {
        board_id: input.board_id,
        revision: result.revision.revision,
        changed_object_ids: result.revision.changedObjectIds,
        object_count: result.board.objects.length,
        link_count: result.board.links.length
      };
    });
  }

  createBoard(input: CreateBoardInput): Promise<ToolOutcome<unknown>> {
    return run(async () => ({ board: await createBoard(this.projectRoot, {
      name: input.name,
      description: input.description,
      pageIds: input.page_ids,
      boardId: input.board_id
    }) }));
  }

  createBoards(input: CreateBoardsInput): Promise<ToolOutcome<unknown>> {
    return run(async () => ({ boards: await createBoards(this.projectRoot, input.boards.map((board) => ({
      name: board.name,
      description: board.description,
      pageIds: board.page_ids,
      boardId: board.board_id
    }))) }));
  }

  updateBoard(input: UpdateBoardInput): Promise<ToolOutcome<unknown>> {
    return run(async () => ({ board: await updateBoard(this.projectRoot, input.board_id, {
      name: input.name,
      description: input.description,
      isDefault: input.is_default
    }) }));
  }

  deleteBoard(input: DeleteBoardInput): Promise<ToolOutcome<unknown>> {
    return run(async () => ({ ...(await deleteBoard(this.projectRoot, input.board_id)), recoverable: true }));
  }

  createPage(input: CreatePageInput): Promise<ToolOutcome<unknown>> {
    return run(async () => ({ page: await createPage(this.projectRoot, asPageDsl(input.dsl)) }));
  }

  deletePage(input: DeletePageInput): Promise<ToolOutcome<unknown>> {
    return run(async () => {
      const current = await getPage(this.projectRoot, input.page_id);
      if (current.revision !== input.base_revision) {
        const error = new Error(`页面当前 revision 为 ${current.revision}，但删除命令基于 ${input.base_revision}。`) as Error & { code: string; details: unknown };
        error.code = "REVISION_CONFLICT";
        error.details = { currentRevision: current.revision, baseRevision: input.base_revision };
        throw error;
      }
      await deletePage(this.projectRoot, input.page_id);
      return { page_id: input.page_id, deleted: true, recoverable: true, trash: ".prototype/trash", operator: input.operator };
    });
  }

  updateComponent(input: UpdateComponentInput): Promise<ToolOutcome<unknown>> {
    return this.execute(input.page_id, input.base_revision, [{
      type: "UPDATE_COMPONENT",
      target: input.component_id,
      changes: input.changes as Partial<UIComponent>
    }], input.operator);
  }

  moveComponent(input: MoveComponentInput): Promise<ToolOutcome<unknown>> {
    return this.execute(input.page_id, input.base_revision, [{
      type: "MOVE_COMPONENT",
      target: input.component_id,
      container: input.container,
      index: input.index
    }], input.operator);
  }

  deleteComponent(input: DeleteComponentInput): Promise<ToolOutcome<unknown>> {
    return this.execute(input.page_id, input.base_revision, [{
      type: "DELETE_COMPONENT",
      target: input.component_id
    }], input.operator);
  }

  createOverlay(input: CreateOverlayInput): Promise<ToolOutcome<unknown>> {
    return this.execute(input.page_id, input.base_revision, [{
      type: "CREATE_OVERLAY",
      overlay: asComponent(input.overlay),
      ...(input.index === undefined ? {} : { index: input.index })
    }], input.operator);
  }

  updateOverlay(input: UpdateOverlayInput): Promise<ToolOutcome<unknown>> {
    return this.execute(input.page_id, input.base_revision, [{
      type: "UPDATE_OVERLAY",
      target: input.component_id,
      changes: input.changes as Partial<UIComponent>
    }], input.operator);
  }

  applyCommands(input: ApplyCommandsInput): Promise<ToolOutcome<unknown>> {
    return this.execute(
      input.page_id,
      input.base_revision,
      input.commands as unknown as Command[],
      input.operator
    );
  }

  validateDsl(input: ValidateDslInput): Promise<ToolOutcome<unknown>> {
    if ((input.page_id === undefined) === (input.dsl === undefined)) {
      return Promise.resolve(failure(
        "INVALID_INPUT",
        "page_id 和 dsl 必须且只能提供一个。",
        "校验已存在页面时仅传 page_id；校验候选 DSL 时仅传 dsl。"
      ));
    }
    return run(async () => {
      const dsl = input.page_id === undefined
        ? asPageDsl(input.dsl!)
        : await getPage(this.projectRoot, input.page_id);
      return { page_id: dsl.page?.id, revision: dsl.revision, validation: validateDSL(dsl) };
    });
  }

  getPreviewUrl(input: PageInput): Promise<ToolOutcome<unknown>> {
    return run(async () => {
      const dsl = await getPage(this.projectRoot, input.page_id);
      const base = new URL(this.previewBaseUrl);
      base.pathname = `${base.pathname.replace(/\/$/, "")}/preview-runtime/${encodeURIComponent(input.page_id)}`;
      base.searchParams.set("revision", String(dsl.revision));
      return {
        page_id: input.page_id,
        revision: dsl.revision,
        url: base.toString(),
        availability: "local",
        note: "该 URL 仅在 Prototype Studio 本地 Preview 服务运行时可访问。"
      };
    });
  }

  renderPreview(input: PageInput): Promise<ToolOutcome<unknown>> {
    return run(async () => {
      const dsl = await getPage(this.projectRoot, input.page_id);
      const validation = validateDSL(dsl);
      if (!validation.valid) {
        const error = new Error(`页面“${input.page_id}”未通过 DSL 校验，不能渲染。`) as Error & { code: string; details: unknown };
        error.code = "DSL_VALIDATION_FAILED";
        error.details = validation.errors;
        throw error;
      }
      const base = new URL(this.previewBaseUrl);
      base.pathname = `${base.pathname.replace(/\/$/, "")}/preview-runtime/${encodeURIComponent(input.page_id)}`;
      base.searchParams.set("revision", String(dsl.revision));
      return {
        page_id: input.page_id,
        revision: dsl.revision,
        renderer_version: dsl.rendererVersion,
        design_system_version: dsl.designSystemVersion,
        validation,
        preview_url: base.toString(),
        status: "ready",
        note: "Preview Runtime 将按该页面 DSL 确定性渲染；URL 仅在本地 Studio 运行时可访问。"
      };
    });
  }

  private execute(pageId: string, baseRevisionValue: number, commands: Command[], operatorValue: string): Promise<ToolOutcome<unknown>> {
    return run(async () => {
      const result = await executeProjectCommands(this.projectRoot, pageId, {
        baseRevision: baseRevisionValue,
        commands,
        source: "mcp",
        operator: operatorValue
      });
      return {
        page_id: pageId,
        revision: result.dsl.revision,
        revision_record: result.revision,
        changed_component_ids: result.revision.changedComponentIds,
        warnings: result.warnings,
        dsl: result.dsl
      };
    });
  }
}

function getAllComponents(dsl: PageDSL): UIComponent[] {
  const seen: UIComponent[] = [];
  const visit = (components: UIComponent[]): void => {
    for (const component of components) {
      seen.push(component);
      visit(component.fields ?? []);
      visit(component.children ?? []);
      visit(component.actions ?? []);
      for (const tab of component.tabs ?? []) visit(tab.children);
    }
  };
  visit(dsl.search?.fields ?? []);
  visit(dsl.search?.actions ?? []);
  visit(dsl.toolbar?.actions ?? []);
  visit(dsl.table ? [dsl.table] : []);
  visit(dsl.form ? [dsl.form] : []);
  visit(dsl.detail ? [dsl.detail] : []);
  visit(dsl.sections ?? []);
  visit(dsl.overlays);
  return seen;
}
