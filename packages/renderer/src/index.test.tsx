import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DESIGN_SYSTEM_VERSION,
  DSL_VERSION,
  RENDERER_VERSION,
  type Condition,
  type PageDSL
} from "@prototype-studio/dsl-schema";
import { caseListExample } from "@prototype-studio/dsl-schema/example";
import { evaluateCondition, PrototypeRenderer } from "./index";

function page(overrides: Partial<PageDSL>): PageDSL {
  return {
    dslVersion: DSL_VERSION,
    rendererVersion: RENDERER_VERSION,
    designSystemVersion: DESIGN_SYSTEM_VERSION,
    revision: 1,
    page: { id: "test-page", type: "form", title: "测试页", status: "Draft" },
    layout: { type: "standard", density: "normal" },
    overlays: [],
    rules: [],
    events: [],
    ...overrides
  };
}

describe("PrototypeRenderer determinism", () => {
  it("applies the Anmi visual theme from page metadata", () => {
    const markup = renderToStaticMarkup(<PrototypeRenderer dsl={page({ meta: { visualTheme: "anmi" } })} interactive={false} />);
    expect(markup).toContain("anmi-theme");
  });

  it("renders explanation pages without the system page chrome", () => {
    const markup = renderToStaticMarkup(<PrototypeRenderer dsl={page({ meta: { viewMode: "explanation" } })} interactive={false} />);
    expect(markup).toContain("proto-explanation");
  });

  it("renders an overlay specification as an opened modal without page content", () => {
    const dsl = page({
      meta: { viewMode: "overlay-spec" },
      form: { id: "hidden-form", type: "form", title: "完整页面表单" },
      overlays: [{ id: "join-modal", type: "modal", title: "加入诉讼", fields: [{ id: "case-count", type: "number", label: "案件数" }] }]
    });
    const markup = renderToStaticMarkup(<PrototypeRenderer dsl={dsl} interactive={false} />);
    expect(markup).toContain("proto-overlay-spec");
    expect(markup).toContain("proto-overlay-backdrop");
    expect(markup).toContain("加入诉讼");
    expect(markup).not.toContain("完整页面表单");
  });

  it("renders identical markup for the same DSL and versions", () => {
    const first = renderToStaticMarkup(<PrototypeRenderer dsl={caseListExample} interactive={false} />);
    const second = renderToStaticMarkup(<PrototypeRenderer dsl={structuredClone(caseListExample)} interactive={false} />);
    expect(first).toBe(second);
    expect(first).toContain('data-component-id="search.status"');
    expect(first).toContain('data-component-id="table.amount"');
  });
});

describe("page body rendering", () => {
  it("renders a form with its fields and actions", () => {
    const dsl = page({
      form: {
        id: "customer.form",
        type: "form",
        title: "新建客户",
        description: "填写基础信息",
        fields: [
          { id: "customer.name", type: "input", label: "姓名", defaultValue: "周颖", validation: { required: true } },
          { id: "customer.level", type: "select", label: "等级", options: [{ label: "A 级", value: "a" }] }
        ],
        actions: [{ id: "customer.submit", type: "button", text: "保存客户", variant: "primary", event: { type: "submit", target: "customer.form" } }]
      }
    });
    const markup = renderToStaticMarkup(<PrototypeRenderer dsl={dsl} interactive={false} />);

    expect(markup).toContain('data-component-id="customer.form"');
    expect(markup).toContain('data-component-id="customer.name"');
    expect(markup).toContain('value="周颖"');
    expect(markup).toContain("保存客户");
    expect(markup).not.toContain("proto-data-panel");
  });

  it("renders detail descriptions, cards, and the active tab child", () => {
    const dsl = page({
      page: { id: "customer-detail", type: "detail", title: "客户详情", status: "Draft" },
      detail: {
        id: "customer.detail",
        type: "description",
        title: "基础档案",
        description: "最后更新于今日",
        fields: [
          { id: "customer.no", type: "input", label: "客户编号", value: "KH-1042" },
          { id: "customer.owner", type: "input", label: "负责人", value: "陈骁" }
        ]
      },
      sections: [
        {
          id: "customer.summary",
          type: "card",
          title: "进度摘要",
          children: [
            {
              id: "customer.tabs",
              type: "tabs",
              tabs: [
                { id: "followups", label: "跟进记录", children: [{ id: "followups.card", type: "card", title: "首次联系已完成" }] },
                { id: "contracts", label: "合同", children: [{ id: "contracts.card", type: "card", title: "合同信息" }] }
              ]
            }
          ]
        }
      ]
    });
    const markup = renderToStaticMarkup(<PrototypeRenderer dsl={dsl} interactive={false} />);

    expect(markup).toContain("基础档案");
    expect(markup).toContain("KH-1042");
    expect(markup).toContain('data-component-id="customer.summary"');
    expect(markup).toContain('data-component-id="customer.tabs"');
    expect(markup).toContain('data-tab-id="followups"');
    expect(markup).toContain("首次联系已完成");
    expect(markup).not.toContain('data-component-id="contracts.card"');
  });

  it("keeps a malformed component failure local", () => {
    const dsl = page({
      form: {
        id: "safe.form",
        type: "form",
        fields: [
          { id: "safe.name", type: "input", label: "正常字段" },
          { id: "broken" } as never
        ]
      }
    });
    const markup = renderToStaticMarkup(<PrototypeRenderer dsl={dsl} interactive={false} />);

    expect(markup).toContain('data-component-id="safe.name"');
    expect(markup).toContain('data-component-error="broken"');
    expect(markup).toContain("缺少有效的 id 或 type");
  });
});

describe("navigation shell", () => {
  it("renders a sidebar with menu labels, badges and the active state when layout.navigation exists", () => {
    const dsl = page({
      page: { id: "case-list", type: "list", title: "案件列表", status: "Draft" },
      layout: {
        type: "standard",
        density: "normal",
        navigation: {
          title: "业务工作台",
          items: [
            { key: "case-center", label: "案件管理", icon: "table", path: "case-list", active: true, badge: "4" },
            { key: "config", label: "系统配置", icon: "settings", children: [
              { key: "config.users", label: "用户管理", path: "user-list" }
            ] }
          ]
        }
      }
    });
    const markup = renderToStaticMarkup(<PrototypeRenderer dsl={dsl} interactive={false} />);

    expect(markup).toContain("proto-app");
    expect(markup).toContain("proto-sidebar");
    expect(markup).toContain("业务工作台");
    expect(markup).toContain("案件管理");
    expect(markup).toContain("系统配置");
    expect(markup).toContain("用户管理");
    expect(markup).toContain("proto-nav-badge");
    expect(markup).toContain("is-active");
    expect(markup).toContain("proto-app-body");
    expect(markup).toContain("<h1>案件列表</h1>");
  });

  it("keeps the plain page shell when layout.navigation is absent", () => {
    const markup = renderToStaticMarkup(<PrototypeRenderer dsl={page({})} interactive={false} />);
    expect(markup).not.toContain("proto-app");
    expect(markup).not.toContain("proto-sidebar");
    expect(markup).toContain("proto-root");
  });
});

describe("visibleWhen condition evaluation", () => {
  const values = {
    status: "active",
    tags: ["vip", "overdue"],
    note: "priority customer",
    amount: 120,
    emptyText: "",
    owner: "陈骁"
  };
  const check = (operator: Condition["operator"], field: string, value?: unknown) => evaluateCondition({ field, operator, value }, values);

  it("supports all DSL operators", () => {
    expect(check("equals", "status", "active")).toBe(true);
    expect(check("notEquals", "status", "closed")).toBe(true);
    expect(check("contains", "tags", "vip")).toBe(true);
    expect(check("contains", "note", "customer")).toBe(true);
    expect(check("in", "status", ["active", "pending"])).toBe(true);
    expect(check("notIn", "status", ["closed", "archived"])).toBe(true);
    expect(check("greaterThan", "amount", 100)).toBe(true);
    expect(check("lessThan", "amount", 200)).toBe(true);
    expect(check("isEmpty", "emptyText")).toBe(true);
    expect(check("isNotEmpty", "owner")).toBe(true);
  });

  it("renders only components whose visibleWhen condition passes", () => {
    const dsl = page({
      form: {
        id: "conditional.form",
        type: "form",
        fields: [
          { id: "mode", type: "select", label: "模式", defaultValue: "advanced" },
          { id: "advanced.name", type: "input", label: "高级名称", visibleWhen: { field: "mode", operator: "equals", value: "advanced" } },
          { id: "basic.name", type: "input", label: "基础名称", visibleWhen: { field: "mode", operator: "equals", value: "basic" } }
        ]
      }
    });
    const markup = renderToStaticMarkup(<PrototypeRenderer dsl={dsl} interactive={false} />);

    expect(markup).toContain('data-component-id="advanced.name"');
    expect(markup).not.toContain('data-component-id="basic.name"');
  });
});
