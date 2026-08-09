export function stableHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

const knownSlugs: Array<[RegExp, string]> = [
  [/案件/, "case"],
  [/用户|客户/, "user"],
  [/订单/, "order"],
  [/商品|产品/, "product"],
  [/角色/, "role"],
  [/权限/, "permission"],
  [/列表|清单/, "list"],
  [/详情/, "detail"],
  [/表单|新增|创建/, "form"],
  [/编辑|修改/, "edit"],
  [/管理/, "management"],
  [/仪表盘|看板/, "dashboard"],
  [/向导|步骤/, "wizard"]
];

export function stableId(value: string, prefix: string): string {
  const ascii = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const known = knownSlugs
    .filter(([pattern]) => pattern.test(value))
    .map(([, slug]) => slug)
    .join("-");
  const body = ascii || known || stableHash(value);
  return `${prefix}-${body}`.replace(/-+/g, "-");
}

export function uniqueId(candidate: string, used: Set<string>): string {
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  let suffix = 2;
  while (used.has(`${candidate}-${suffix}`)) suffix += 1;
  const result = `${candidate}-${suffix}`;
  used.add(result);
  return result;
}

export function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
