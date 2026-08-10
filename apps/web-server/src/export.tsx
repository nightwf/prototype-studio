import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { ANNOTATION_PANEL_GAP, ANNOTATION_PANEL_WIDTH, CONTENT_PADDING, BoardRenderer, boardContentBounds } from "@prototype-studio/renderer";
import type { BoardDSL, PageDSL } from "@prototype-studio/dsl-schema";

const rendererSourceDir = join(process.cwd(), "packages", "renderer", "src");

export interface BoardExportOptions {
  mode?: "content" | "with-annotations";
}

export async function renderBoardHtml(board: BoardDSL, pages: Record<string, PageDSL>, title: string, options: BoardExportOptions = {}): Promise<string> {
  const [boardCss, rendererCss] = await Promise.all([
    readFile(`${rendererSourceDir}/board.css`, "utf8"),
    readFile(`${rendererSourceDir}/styles.css`, "utf8")
  ]);
  const mode = options.mode ?? "content";
  const bounds = boardContentBounds(board, {});
  const showPanel = mode === "with-annotations" && board.objects.some((object) => object.type === "marker");
  const panelReserve = showPanel ? ANNOTATION_PANEL_WIDTH + ANNOTATION_PANEL_GAP : 0;
  const canvasWidth = bounds.maxX - bounds.minX + CONTENT_PADDING * 2 + panelReserve;
  const canvasHeight = bounds.maxY - bounds.minY + CONTENT_PADDING * 2;
  const body = renderToStaticMarkup(
    <BoardRenderer board={board} pages={pages} interactive={false} showAnnotationPanel={mode === "with-annotations"} />
  );
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · 画布</title>
<style>${rendererCss}\n${boardCss}\nhtml,body{margin:0;background:#e6eaed;font-family:system-ui,-apple-system,'PingFang SC',sans-serif;}body{padding:24px;}</style>
</head>
<body>
<div class="export-canvas" style="position:relative;width:${canvasWidth}px;height:${canvasHeight}px;">${body}</div>
<script>
window.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('[data-board-marker]').forEach(function (pin) {
    var anchor = pin.getAttribute('data-marker-anchor') || '';
    var parts = anchor.split(':');
    if (parts.length < 4) return;
    var frame = document.querySelector('[data-board-object="' + parts[0] + '"] .board-page-body');
    if (!frame) return;
    var component = frame.querySelector('[data-component-id="' + parts[1] + '"]');
    if (!component) return;
    var objectEl = document.querySelector('[data-board-object="' + parts[0] + '"]');
    var objectX = parseFloat(objectEl && objectEl.style ? objectEl.style.left : '0') || 0;
    var objectY = parseFloat(objectEl && objectEl.style ? objectEl.style.top : '0') || 0;
    var objectRect = objectEl.getBoundingClientRect();
    var componentRect = component.getBoundingClientRect();
    pin.style.left = (objectX + componentRect.left - objectRect.left + frame.scrollLeft + Number(parts[2] || 0)) + 'px';
    pin.style.top = (objectY + componentRect.top - objectRect.top + frame.scrollTop + Number(parts[3] || 0)) + 'px';
  });
});
</script>
</body>
</html>`;
}
