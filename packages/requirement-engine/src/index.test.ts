import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RequirementModel } from "@prototype-studio/dsl-schema";
import { validateBoard, validateDSL } from "@prototype-studio/dsl-validator";
import {
  PagePlanNotConfirmedError,
  confirmPagePlan,
  createPagePlan,
  createPagePlanFromTemplates,
  createBoardFromTemplates,
  generateConfirmedPageDSLs,
  generatePageDSL,
  loadRequirementInput,
  parseRequirement,
  parseRequirementTemplates,
  requirementModelFromTemplates,
  updatePagePlanDecisions,
  type RequirementParserAdapter
} from "./index";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryFile(name: string, content: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "prototype-requirement-"));
  temporaryDirectories.push(directory);
  const path = join(directory, name);
  await writeFile(path, content, "utf8");
  return path;
}

const chineseRequirement = `# 案件批量分配

## 页面
- 案件列表页
- 案件详情页

## 功能
- 支持批量选择并分配案件

## 业务规则
- 最多选择500条
- 已锁定案件不可分配

## 权限
- 仅主管允许批量分配

## 校验
- 催收员必填

## 交互
1. 选择案件
2. 点击批量分配
3. 打开分配弹窗
4. 提交后刷新列表

## 未明确项
- 超过500条时是否允许拆分操作
`;

describe("requirement input", () => {
  it("loads pasted text and local Markdown/TXT files", async () => {
    const markdownPath = await temporaryFile("requirement.md", chineseRequirement);
    const textPath = await temporaryFile("requirement.txt", "用户列表页面\n支持按姓名查询");

    await expect(loadRequirementInput({ kind: "text", text: "  新建用户页面  " })).resolves.toEqual({
      text: "新建用户页面",
      title: undefined
    });
    await expect(loadRequirementInput({ kind: "file", path: markdownPath })).resolves.toMatchObject({
      text: chineseRequirement.trim(),
      sourceFile: markdownPath
    });
    await expect(loadRequirementInput({ kind: "file", path: textPath })).resolves.toMatchObject({
      text: "用户列表页面\n支持按姓名查询"
    });
  });

  it("rejects unsupported or empty input with stable error codes", async () => {
    const pdfPath = await temporaryFile("scan.pdf", "not really a pdf");
    await expect(loadRequirementInput({ kind: "text", text: "   " })).rejects.toMatchObject({
      code: "EMPTY_REQUIREMENT"
    });
    await expect(loadRequirementInput({ kind: "file", path: pdfPath })).rejects.toMatchObject({
      code: "UNSUPPORTED_REQUIREMENT_FILE"
    });
  });
});

describe("deterministic parser", () => {
  it("parses Chinese requirement sections and preserves evidence source", async () => {
    const result = await parseRequirement({ kind: "text", text: chineseRequirement }, { requirementId: "req-case" });

    expect(result.parser).toBe("fallback");
    expect(result.model).toMatchObject({
      id: "req-case",
      title: "案件批量分配"
    });
    expect(result.model.pages.map((item) => item.value)).toEqual(["案件列表页", "案件详情页"]);
    expect(result.model.businessRules.map((item) => item.value)).toEqual(["最多选择500条", "已锁定案件不可分配"]);
    expect(result.model.permissions[0]).toMatchObject({ value: "仅主管允许批量分配", source: "explicit" });
    expect(result.model.validations[0]).toMatchObject({ value: "催收员必填", source: "explicit" });
    expect(result.model.interactions).toHaveLength(4);
    expect(result.model.unresolved[0]?.source).toBe("explicit");
  });

  it("adds visibly labeled inferred/default items when the input omits structure", async () => {
    const result = await parseRequirement({ kind: "text", text: "# 库存盘点需求\n支持批量盘点商品" });

    expect(result.model.pages[0]).toMatchObject({ value: "库存盘点页面", source: "default" });
    expect(result.model.unresolved).toContainEqual(expect.objectContaining({ source: "inferred" }));
    expect(result.model.interactions).toContainEqual(expect.objectContaining({ source: "inferred" }));
  });
});

describe("replaceable parser adapter", () => {
  it("uses an injected adapter without coupling the engine to a provider", async () => {
    const model: RequirementModel = {
      id: "req-ai",
      title: "AI 解析结果",
      pages: [{ value: "订单列表", source: "explicit" }],
      features: [],
      businessRules: [],
      permissions: [],
      validations: [],
      interactions: [],
      unresolved: []
    };
    const parse = vi.fn(async () => model);
    const adapter: RequirementParserAdapter = { id: "test-adapter", parse };

    const result = await parseRequirement({ kind: "text", text: "任意需求" }, { adapter });
    expect(result).toMatchObject({ parser: "adapter", adapterId: "test-adapter", model });
    expect(parse).toHaveBeenCalledOnce();
  });

  it("falls back deterministically and reports a warning when an adapter fails", async () => {
    const adapter: RequirementParserAdapter = {
      id: "offline-model",
      parse: async () => {
        throw new Error("connection refused");
      }
    };

    const result = await parseRequirement({ kind: "text", text: "用户列表页面\n支持按姓名查询" }, { adapter });
    expect(result.parser).toBe("fallback");
    expect(result.adapterId).toBe("offline-model");
    expect(result.warnings[0]).toContain("connection refused");
    expect(result.model.pages).not.toHaveLength(0);
  });
});

describe("page plan and DSL generation", () => {
  it("requires an explicit plan confirmation before generating a valid minimal DSL", async () => {
    const { model } = await parseRequirement(
      { kind: "text", text: chineseRequirement },
      { requirementId: "req-case" }
    );
    const draft = createPagePlan(model);

    expect(draft.status).toBe("draft");
    expect(draft.pages.map((page) => page.type)).toEqual(["list", "detail"]);
    expect(() => generatePageDSL(draft, draft.pages[0]!.id)).toThrowError(PagePlanNotConfirmedError);

    const confirmed = confirmPagePlan(draft);
    expect(confirmed.status).toBe("confirmed");
    const generated = generateConfirmedPageDSLs(confirmed);
    expect(generated).toHaveLength(2);
    for (const { dsl } of generated) {
      expect(validateDSL(dsl)).toMatchObject({ valid: true, errors: [] });
      expect(dsl.meta).toMatchObject({ requirementId: "req-case", pagePlanId: "req-case-page-plan" });
    }
    expect(generated[0]?.dsl.table?.type).toBe("table");
    expect(generated[1]?.dsl.detail?.type).toBe("description");
  });

  it("supports partial confirmation and rejection without generating rejected pages", async () => {
    const { model } = await parseRequirement({ kind: "text", text: chineseRequirement });
    const draft = createPagePlan(model);
    const reviewed = updatePagePlanDecisions(draft, [
      { pageId: draft.pages[0]!.id, decision: "confirmed" },
      { pageId: draft.pages[1]!.id, decision: "rejected" }
    ]);

    expect(reviewed.status).toBe("confirmed");
    expect(generateConfirmedPageDSLs(reviewed)).toHaveLength(1);
  });

  it("generates a valid form body for a confirmed form page", async () => {
    const { model } = await parseRequirement({
      kind: "text",
      text: "# 新建客户需求\n## 页面\n- 新建客户表单页\n## 校验\n- 客户名称必填"
    });
    const plan = confirmPagePlan(createPagePlan(model));
    const dsl = generatePageDSL(plan, plan.pages[0]!.id);

    expect(dsl.page.type).toBe("form");
    expect(dsl.form?.type).toBe("form");
    expect(validateDSL(dsl).valid).toBe(true);
  });
});

describe("structured page templates (ADR-008)", () => {
  const templateYaml = `
title: 案件批量分配
id: REQ-TPL-001
pages:
  - title: 案件管理列表页
    type: list
    features:
      - 支持勾选案件并批量分配
    businessRules:
      - 单次最多选择 500 条
    search:
      fields:
        - id: caseNo
          type: input
          label: 案件编号
        - id: status
          type: select
          label: 案件状态
          options:
            - label: 待分配
              value: pending
            - label: 跟进中
              value: following
    table:
      columns:
        - id: caseNo
          title: 案件编号
          dataIndex: caseNo
        - id: amount
          title: 待还金额
          dataIndex: amount
          format: currency
        - id: status
          title: 状态
          dataIndex: status
          format: status
    overlays:
      - id: assign
        title: 批量分配
        type: modal
        fields:
          - id: collector
            type: select
            label: 催收员
            required: true
            options:
              - label: 陈骁
                value: chenxiao
  - title: 案件工作台
    type: form
    form:
      fields:
        - id: owner
          type: input
          label: 负责人
          required: true
`;

  it("parses YAML templates and keeps the explicitly declared page type", () => {
    const templates = parseRequirementTemplates(templateYaml);
    expect(templates).not.toBeNull();
    expect(templates?.title).toBe("案件批量分配");
    expect(templates?.id).toBe("REQ-TPL-001");
    expect(templates?.pages[1]?.type).toBe("form");

    const plan = createPagePlanFromTemplates(templates!);
    expect(plan.pages[1]?.type).toBe("form");
    expect(plan.pages[1]?.structure?.form?.fields[0]).toMatchObject({ id: "owner", required: true });
  });

  it("treats plain Markdown as non-structured and rejects malformed templates", () => {
    expect(parseRequirementTemplates("# 案件批量分配\n## 页面\n- 案件列表页")).toBeNull();
    expect(() => parseRequirementTemplates("title: 需求\npages:\n  - title: 缺类型\n")).toThrow(/type/);
    expect(() => parseRequirementTemplates("title: 需求\npages:\n  - title: 页面\n    type: unknown\n")).toThrow(/type/);
    expect(() => parseRequirementTemplates("title: 需求\npages:\n  - title: 列表页\n    type: list\n    table:\n      columns: 不是数组\n")).toThrow(/table\.columns/);
  });

  it("generates a field-level DSL from templates without keyword guessing", () => {
    const templates = parseRequirementTemplates(templateYaml)!;
    const plan = createPagePlanFromTemplates(templates);
    const confirmed = confirmPagePlan(plan);
    const generated = generateConfirmedPageDSLs(confirmed);

    const list = generated[0]!.dsl;
    expect(list.page.type).toBe("list");
    expect(list.search?.fields.map((field) => field.id)).toEqual([
      `${list.page.id}.search.caseNo`,
      `${list.page.id}.search.status`
    ]);
    expect(list.search?.fields[1]).toMatchObject({
      type: "select",
      options: [
        { label: "待分配", value: "pending" },
        { label: "跟进中", value: "following" }
      ]
    });
    expect((list.table?.columns ?? []).map((column) => column.dataIndex)).toEqual(["caseNo", "amount", "status"]);
    expect(list.table?.columns?.[1]).toMatchObject({ format: "currency" });
    expect(list.overlays[0]).toMatchObject({ type: "modal", title: "批量分配" });
    expect(list.overlays[0]?.fields?.[0]).toMatchObject({
      type: "select",
      validation: { required: true, message: "请填写催收员" }
    });
    expect(list.meta).toMatchObject({
      businessRules: [{ value: "单次最多选择 500 条", source: "explicit" }]
    });
    expect(validateDSL(list)).toMatchObject({ valid: true, errors: [] });

    const form = generated[1]!.dsl;
    expect(form.page.type).toBe("form");
    expect(form.form?.fields?.[0]).toMatchObject({ id: `${form.page.id}.form.owner`, validation: { required: true } });
    expect(validateDSL(form)).toMatchObject({ valid: true, errors: [] });
  });

  it("supports JSON deliverables and builds the inspector model", () => {
    const json = JSON.stringify({
      id: "REQ-TPL-002",
      title: "库存盘点",
      pages: [{ title: "盘点列表", type: "list", businessRules: ["盘点期间禁止出入库"] }]
    });
    const templates = parseRequirementTemplates(json)!;
    expect(templates.pages[0]?.type).toBe("list");

    const model = requirementModelFromTemplates(templates);
    expect(model.pages.map((page) => page.value)).toEqual(["盘点列表"]);
    expect(model.businessRules[0]).toMatchObject({ value: "盘点期间禁止出入库", source: "explicit" });
  });

  it("delivers canvas objects through structured templates", () => {
    const yaml = `
title: 案件批量分配
id: REQ-TPL-BOARD
pages:
  - id: case-list
    title: 案件列表页
    type: list
board:
  objects:
    - id: obj-case-list
      type: page
      pageId: case-list
      x: 120
      y: 80
      width: 960
      height: 640
    - id: note-1
      type: note
      x: 1180
      y: 100
      width: 280
      height: 90
      text: 最多选择 500 条
    - id: marker-1
      type: marker
      number: 1
      tone: orange
      text: 待确认
      anchor:
        pageObjectId: obj-case-list
        componentId: case-list.search.status
    - id: flow-1
      type: flowchart
      x: 120
      y: 800
      width: 480
      height: 300
      flowchart:
        nodes:
          - id: a
            label: 勾选
          - id: b
            label: 分配
        edges:
          - id: e1
            from: a
            to: b
  links:
    - id: link-1
      from: obj-case-list
      to: note-1
      label: 约束
`;
    const templates = parseRequirementTemplates(yaml)!;
    const board = createBoardFromTemplates(templates)!;
    expect(board.objects).toHaveLength(4);
    expect(board.links).toEqual([{ id: "link-1", from: "obj-case-list", to: "note-1", label: "约束" }]);
    expect(validateBoard(board).valid).toBe(true);

    const generated = generateConfirmedPageDSLs(confirmPagePlan(createPagePlanFromTemplates(templates)));
    expect(generated[0]?.dsl.page.id).toBe("case-list");
  });
});
