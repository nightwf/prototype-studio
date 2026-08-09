import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { LoadedRequirement, RequirementInput } from "./types";

export class RequirementInputError extends Error {
  readonly code: "EMPTY_REQUIREMENT" | "UNSUPPORTED_REQUIREMENT_FILE" | "REQUIREMENT_FILE_READ_FAILED";

  constructor(code: RequirementInputError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RequirementInputError";
    this.code = code;
  }
}

const supportedExtensions = new Set([".md", ".markdown", ".txt"]);

function assertNotEmpty(value: string): string {
  const normalized = value.replace(/^\uFEFF/, "").trim();
  if (!normalized) {
    throw new RequirementInputError("EMPTY_REQUIREMENT", "需求内容为空，请粘贴 Codex 整理后的文本，或选择 Markdown/TXT 文件。");
  }
  return normalized;
}

export async function loadRequirementInput(input: RequirementInput): Promise<LoadedRequirement> {
  if (input.kind === "text") {
    return { text: assertNotEmpty(input.text), title: input.title };
  }

  const extension = extname(input.path).toLowerCase();
  if (!supportedExtensions.has(extension)) {
    throw new RequirementInputError(
      "UNSUPPORTED_REQUIREMENT_FILE",
      `暂不支持“${extension || "无扩展名"}”需求文件；文档提取由 Codex 负责，Studio 当前只读取 Markdown（.md/.markdown）和 TXT（.txt）。`
    );
  }

  try {
    const text = await readFile(input.path, "utf8");
    return { text: assertNotEmpty(text), title: input.title, sourceFile: input.path };
  } catch (error) {
    if (error instanceof RequirementInputError) throw error;
    throw new RequirementInputError("REQUIREMENT_FILE_READ_FAILED", `无法读取需求文件“${input.path}”。`, {
      cause: error
    });
  }
}
