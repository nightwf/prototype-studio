import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import type { PageDSL } from "@prototype-studio/dsl-schema";
import { deleteLocalPage, listLocalRevisions, readLocalPages, readLocalRevision, writeLocalPage, type LocalDirectoryHandle, type LocalFileHandle } from "./localPages";

function page(id: string, title: string): PageDSL {
  return {
    dslVersion: "1.0",
    rendererVersion: "1.0.0",
    designSystemVersion: "1.0.0",
    revision: 1,
    page: { id, type: "wireframe", title, status: "Draft" },
    layout: { type: "standard", density: "normal" },
    overlays: [],
    rules: [],
    events: [],
    wireframe: { width: 1440, height: 900, background: "#ffffff", elements: [] }
  };
}

/** 用内存文件系统模拟目录授权句柄，验证读取/写回/删除逻辑。 */
function fakeDirectory(seed: Record<string, string> = {}): LocalDirectoryHandle & { files: Map<string, string> } {
  const files = new Map(Object.entries(seed));
  const children = new Map<string, LocalDirectoryHandle & { files: Map<string, string> }>();
  const fileHandle = (name: string): LocalFileHandle => ({
    kind: "file",
    name,
    async getFile() {
      const text = files.get(name) ?? "";
      return { text: async () => text, name } as unknown as File;
    },
    async createWritable() {
      let buffer = "";
      return {
        async write(data: string) { buffer = data; },
        async close() { files.set(name, buffer); }
      };
    }
  });
  const directory: LocalDirectoryHandle = {
    kind: "directory",
    name: "local-project",
    async getDirectoryHandle(name: string) {
      // 根目录下的 pages 就是当前文件集合；其它目录（.prototype 等）各自独立。
      if (name === "pages") return directory;
      if (!children.has(name)) children.set(name, fakeDirectory());
      return children.get(name)!;
    },
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (!files.has(name) && !options?.create) throw new Error(`未找到文件 ${name}`);
      return fileHandle(name);
    },
    async removeEntry(name: string) { files.delete(name); },
    async *values() {
      for (const name of [...files.keys()]) yield fileHandle(name);
    },
    queryPermission: async () => "granted",
    requestPermission: async () => "granted"
  };
  return Object.assign(directory, { files });
}

describe("本地页面目录", () => {
  it("读取 pages/*.ui.yaml，跳过损坏文件与重复 id", async () => {
    const root = fakeDirectory({
      "repayment.ui.yaml": stringify(page("repayment", "还款管理"), { lineWidth: 0 }),
      "repayment-copy.ui.yaml": stringify(page("repayment", "重复页面"), { lineWidth: 0 }),
      "broken.ui.yaml": "page: [unclosed",
      "notes.txt": "不是页面"
    });
    const scan = await readLocalPages(root);
    expect(scan.pages.map((item) => item.page.id)).toEqual(["repayment"]);
    expect(scan.fileById.repayment).toBe("repayment.ui.yaml");
    expect(scan.skipped).toHaveLength(2);
  });

  it("写回页面 YAML 后可以再次读取，并保持 revision 与内容", async () => {
    const root = fakeDirectory();
    const next = { ...page("repayment", "还款管理"), revision: 5 };
    await writeLocalPage(root, next);
    const scan = await readLocalPages(root);
    expect(scan.pages[0]!.page.title).toBe("还款管理");
    expect(scan.pages[0]!.revision).toBe(5);
  });

  it("删除页面会移除对应文件", async () => {
    const root = fakeDirectory({ "repayment.ui.yaml": stringify(page("repayment", "还款管理")) });
    await deleteLocalPage(root, "repayment");
    expect(root.files.has("repayment.ui.yaml")).toBe(false);
    expect((await readLocalPages(root)).pages).toHaveLength(0);
  });

  it("每次写回都留版本快照，可按 revision 读取（跨会话撤销的基础）", async () => {
    const root = fakeDirectory();
    await writeLocalPage(root, { ...page("repayment", "还款管理"), revision: 1 });
    await writeLocalPage(root, { ...page("repayment", "还款管理"), revision: 2 });
    expect(await listLocalRevisions(root, "repayment")).toEqual([1, 2]);
    const first = await readLocalRevision(root, "repayment", 1);
    expect(first?.revision).toBe(1);
    expect(await readLocalRevision(root, "repayment", 99)).toBeUndefined();
  });
});
