import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { BoardRenderer } from "@prototype-studio/renderer";
import type { BoardDSL, PageDSL } from "@prototype-studio/dsl-schema";

const rendererSourceDir = join(process.cwd(), "packages", "renderer", "src");

export async function renderBoardHtml(board: BoardDSL, pages: Record<string, PageDSL>, title: string): Promise<string> {
  const [boardCss, rendererCss] = await Promise.all([
    readFile(`${rendererSourceDir}/board.css`, "utf8"),
    readFile(`${rendererSourceDir}/styles.css`, "utf8")
  ]);
  const body = renderToStaticMarkup(<BoardRenderer board={board} pages={pages} interactive={false} />);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · 画布</title>
<style>${rendererCss}\n${boardCss}\nhtml,body{margin:0;background:#0f172a;font-family:system-ui,-apple-system,'PingFang SC',sans-serif;}body{padding:24px;}</style>
</head>
<body>
<div class="export-canvas" style="position:relative;min-height:100vh;">${body}</div>
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
    var frameRect = frame.getBoundingClientRect();
    var componentRect = component.getBoundingClientRect();
    pin.style.left = (componentRect.left - frameRect.left + frame.scrollLeft + Number(parts[2] || 0)) + 'px';
    pin.style.top = (componentRect.top - frameRect.top + frame.scrollTop + Number(parts[3] || 0)) + 'px';
  });
});
</script>
</body>
</html>`;
}
