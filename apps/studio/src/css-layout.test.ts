import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function collectCss(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) collectCss(path, found);
    else if (entry.endsWith(".css")) found.push(path);
  }
  return found;
}

const cssFiles = ["packages", "apps"].flatMap((top) => collectCss(join(repoRoot, top)));

function declarations(source: string, property: string): string[] {
  return [...source.matchAll(new RegExp(`${property}\\s*:([^;}]*)`, "g"))].map((match) => match[1]!.trim());
}

describe("样式表布局声明", () => {
  it("扫描到项目内的样式表", () => {
    expect(cssFiles.length).toBeGreaterThanOrEqual(7);
  });

  it("grid-template-rows / grid-template-columns 不包含只属于 grid-template 的斜杠语法", () => {
    // 浏览器会静默丢弃非法声明：写成 grid-template-rows: a / b 会让三栏布局塌成一列，且没有任何报错。
    const offenders: string[] = [];
    for (const file of cssFiles) {
      const source = readFileSync(file, "utf-8");
      for (const property of ["grid-template-rows", "grid-template-columns"]) {
        declarations(source, property).forEach((value) => {
          if (value.includes("/")) offenders.push(`${relative(repoRoot, file)} → ${property}: ${value}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  it("图形编辑器外壳保留 顶栏 + 左库 + 画布 + 右检查器 的三栏布局", () => {
    const source = readFileSync(join(repoRoot, "apps/studio/src/diagramEditor.css"), "utf-8");
    const shell = /\.[a-z-]*diagram-editor-shell\s*\{([^}]*)\}/.exec(source)?.[1] ?? "";
    expect(shell).toContain("display: grid");
    const template = /grid-template\s*:([^;}]*)/.exec(shell)?.[1]?.trim() ?? "";
    expect(template).toMatch(/\d+px\s+minmax\(0,\s*1fr\)\s*\/\s*[^/]+\s+minmax\(0,\s*1fr\)\s+\d+px/);
  });
});
