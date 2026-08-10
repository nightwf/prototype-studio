import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { ANNOTATION_PANEL_GAP, ANNOTATION_PANEL_WIDTH, CONTENT_PADDING, BoardRenderer, boardContentBounds, boardExportRuntimeScript } from "@prototype-studio/renderer";
import type { BoardDSL, PageDSL } from "@prototype-studio/dsl-schema";

const rendererSourceDir = join(process.cwd(), "packages", "renderer", "src");

export interface BoardExportOptions {
  mode?: "content" | "with-annotations";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

async function rendererStyles(): Promise<string> {
  const [boardCss, rendererCss] = await Promise.all([
    readFile(`${rendererSourceDir}/board.css`, "utf8"),
    readFile(`${rendererSourceDir}/styles.css`, "utf8")
  ]);
  return `${rendererCss}\n${boardCss}`;
}

function boardMarkup(board: BoardDSL, pages: Record<string, PageDSL>, mode: "content" | "with-annotations"): { body: string; width: number; height: number } {
  const bounds = boardContentBounds(board, {});
  const showPanel = mode === "with-annotations" && board.objects.some((object) => object.type === "marker");
  const panelReserve = showPanel ? ANNOTATION_PANEL_WIDTH + ANNOTATION_PANEL_GAP : 0;
  return {
    width: bounds.maxX - bounds.minX + CONTENT_PADDING * 2 + panelReserve,
    height: bounds.maxY - bounds.minY + CONTENT_PADDING * 2,
    body: renderToStaticMarkup(
      <BoardRenderer board={board} pages={pages} interactive={false} showAnnotationPanel={mode === "with-annotations"} />
    )
  };
}

export async function renderBoardHtml(board: BoardDSL, pages: Record<string, PageDSL>, title: string, options: BoardExportOptions = {}): Promise<string> {
  const styles = await rendererStyles();
  const mode = options.mode ?? "content";
  const rendered = boardMarkup(board, pages, mode);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · ${escapeHtml(board.name)}</title>
<style>${styles}\nhtml,body{margin:0;background:#e6eaed;font-family:system-ui,-apple-system,'PingFang SC',sans-serif;}body{padding:24px;}</style>
</head>
<body>
<div class="export-canvas" style="position:relative;width:${rendered.width}px;height:${rendered.height}px;">${rendered.body}</div>
<script>
${boardExportRuntimeScript}
</script>
</body>
</html>`;
}

export async function renderBoardsHtml(
  boards: BoardDSL[],
  pages: Record<string, PageDSL>,
  title: string,
  defaultBoardId: string,
  options: BoardExportOptions = {}
): Promise<string> {
  const styles = await rendererStyles();
  const mode = options.mode ?? "content";
  const ordered = [...boards].sort((a, b) => Number(b.id === defaultBoardId) - Number(a.id === defaultBoardId) || a.createdAt.localeCompare(b.createdAt));
  const rendered = ordered.map((board) => ({ board, ...boardMarkup(board, pages, mode) }));
  const initial = rendered.find((item) => item.board.id === defaultBoardId) ?? rendered[0];
  const navigation = rendered.map(({ board }) => `<button type="button" data-board-tab="${escapeHtml(board.id)}"${board.id === initial?.board.id ? ' class="is-active"' : ""}>${escapeHtml(board.name)}</button>`).join("");
  const canvases = rendered.map(({ board, body, width, height }) => `<section data-board-panel="${escapeHtml(board.id)}"${board.id === initial?.board.id ? "" : " hidden"}><div class="export-canvas" style="position:relative;width:${width}px;height:${height}px;">${body}</div></section>`).join("");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · 全部画布</title>
<style>${styles}\nhtml,body{margin:0;background:#e6eaed;font-family:system-ui,-apple-system,'PingFang SC',sans-serif;}body{padding:0 24px 24px}.board-export-nav{position:sticky;top:0;z-index:10000;display:flex;gap:8px;padding:14px 0;background:#e6eaed}.board-export-nav button{border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:8px 14px;color:#475569;cursor:pointer}.board-export-nav button.is-active{border-color:#2563eb;background:#2563eb;color:#fff}[hidden]{display:none!important}</style>
</head><body><nav class="board-export-nav" aria-label="画布导航">${navigation}</nav>${canvases}
<script>${boardExportRuntimeScript}\nfor(const tab of document.querySelectorAll('[data-board-tab]'))tab.addEventListener('click',()=>{const id=tab.getAttribute('data-board-tab');for(const item of document.querySelectorAll('[data-board-tab]'))item.classList.toggle('is-active',item===tab);for(const panel of document.querySelectorAll('[data-board-panel]'))panel.hidden=panel.getAttribute('data-board-panel')!==id;history.replaceState(null,'','#board='+encodeURIComponent(id||''));});const requested=new URLSearchParams(location.hash.slice(1)).get('board');if(requested)document.querySelector('[data-board-tab="'+CSS.escape(requested)+'"]')?.click();</script>
</body></html>`;
}
