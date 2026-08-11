/** Repositions DOM-bound markers and link endpoints after a standalone board export loads. */
export const boardExportRuntimeScript = String.raw`
window.addEventListener('DOMContentLoaded', function () {
  var canvas = document.querySelector('.export-canvas');
  if (!canvas) return;
  var canvasRect = canvas.getBoundingClientRect();
  function objectElement(id) {
    return document.querySelector('[data-board-object="' + id + '"]');
  }
  function center(rect) {
    return { x: rect.left - canvasRect.left + rect.width / 2, y: rect.top - canvasRect.top + rect.height / 2 };
  }
  function componentPoint(object, componentId) {
    if (!componentId) return null;
    var component = object.querySelector('[data-component-id="' + componentId + '"]');
    return component ? center(component.getBoundingClientRect()) : null;
  }
  function edgePoint(rect, toward) {
    var point = center(rect);
    var dx = toward.x - point.x;
    var dy = toward.y - point.y;
    if (!dx && !dy) return point;
    var scale = Math.min(dx ? rect.width / 2 / Math.abs(dx) : Infinity, dy ? rect.height / 2 / Math.abs(dy) : Infinity);
    return { x: point.x + dx * scale, y: point.y + dy * scale };
  }
  function pathFor(from, to, type, waypoint) {
    if (waypoint) {
      if (type === 'straight') return 'M ' + from.x + ' ' + from.y + ' L ' + waypoint.x + ' ' + waypoint.y + ' L ' + to.x + ' ' + to.y;
      if (type === 'orthogonal') return 'M ' + from.x + ' ' + from.y + ' L ' + waypoint.x + ' ' + from.y + ' L ' + waypoint.x + ' ' + waypoint.y + ' L ' + to.x + ' ' + waypoint.y + ' L ' + to.x + ' ' + to.y;
      var bend1 = Math.max(80, Math.hypot(waypoint.x - from.x, waypoint.y - from.y) * 0.4) * (waypoint.x >= from.x ? 1 : -1);
      var bend2 = Math.max(80, Math.hypot(to.x - waypoint.x, to.y - waypoint.y) * 0.4) * (to.x >= waypoint.x ? 1 : -1);
      return 'M ' + from.x + ' ' + from.y + ' C ' + (from.x + bend1) + ' ' + from.y + ', ' + (waypoint.x - bend1) + ' ' + waypoint.y + ', ' + waypoint.x + ' ' + waypoint.y + ' C ' + (waypoint.x + bend2) + ' ' + waypoint.y + ', ' + (to.x - bend2) + ' ' + to.y + ', ' + to.x + ' ' + to.y;
    }
    if (type === 'straight') return 'M ' + from.x + ' ' + from.y + ' L ' + to.x + ' ' + to.y;
    if (type === 'orthogonal') {
      var middleX = Math.round((from.x + to.x) / 2);
      return 'M ' + from.x + ' ' + from.y + ' L ' + middleX + ' ' + from.y + ' L ' + middleX + ' ' + to.y + ' L ' + to.x + ' ' + to.y;
    }
    var distance = Math.abs(to.x - from.x);
    var bend = Math.max(60, distance * 0.45);
    var direction = to.x >= from.x ? 1 : -1;
    return 'M ' + from.x + ' ' + from.y + ' C ' + (from.x + bend * direction) + ' ' + from.y + ', ' + (to.x - bend * direction) + ' ' + to.y + ', ' + to.x + ' ' + to.y;
  }
  document.querySelectorAll('[data-board-marker]').forEach(function (pin) {
    var parts = (pin.getAttribute('data-marker-anchor') || '').split(':');
    if (parts.length < 4) return;
    var object = objectElement(parts[0]);
    var frame = object && object.querySelector('.board-page-body');
    var component = frame && frame.querySelector('[data-component-id="' + parts[1] + '"]');
    if (!object || !frame || !component) return;
    var objectX = parseFloat(object.style.left || '0') || 0;
    var objectY = parseFloat(object.style.top || '0') || 0;
    var objectRect = object.getBoundingClientRect();
    var componentRect = component.getBoundingClientRect();
    pin.style.left = (objectX + componentRect.left - objectRect.left + frame.scrollLeft + Number(parts[2] || 0)) + 'px';
    pin.style.top = (objectY + componentRect.top - objectRect.top + frame.scrollTop + Number(parts[3] || 0)) + 'px';
  });
  document.querySelectorAll('[data-board-marker-note]').forEach(function (note) {
    var markerId = note.getAttribute('data-board-marker-note');
    var rawX = note.getAttribute('data-marker-note-x');
    var rawY = note.getAttribute('data-marker-note-y');
    var pin = markerId && document.querySelector('[data-board-marker="' + markerId + '"]');
    if (rawX !== null && rawX !== '' && rawY !== null && rawY !== '' && Number.isFinite(Number(rawX)) && Number.isFinite(Number(rawY))) {
      var boardCanvas = note.closest('.board-canvas');
      var canvasX = boardCanvas ? parseFloat(boardCanvas.style.left || '0') || 0 : 0;
      var canvasY = boardCanvas ? parseFloat(boardCanvas.style.top || '0') || 0 : 0;
      note.style.left = (Number(rawX) - canvasX) + 'px';
      note.style.top = (Number(rawY) - canvasY) + 'px';
    } else if (pin) {
      note.style.left = (parseFloat(pin.style.left || '0') + 38) + 'px';
      note.style.top = (parseFloat(pin.style.top || '0') - 8) + 'px';
    }
  });
  document.querySelectorAll('[data-board-link]').forEach(function (group) {
    var fromObject = objectElement(group.getAttribute('data-link-from') || '');
    var toObject = objectElement(group.getAttribute('data-link-to') || '');
    if (!fromObject || !toObject) return;
    var boardCanvas = group.closest('.board-canvas');
    var canvasX = boardCanvas ? parseFloat(boardCanvas.style.left || '0') || 0 : 0;
    var canvasY = boardCanvas ? parseFloat(boardCanvas.style.top || '0') || 0 : 0;
    var fromRect = fromObject.getBoundingClientRect();
    var toRect = toObject.getBoundingClientRect();
    var fromCenter = center(fromRect);
    var toCenter = center(toRect);
    var from = componentPoint(fromObject, group.getAttribute('data-from-component') || '') || edgePoint(fromRect, toCenter);
    var to = componentPoint(toObject, group.getAttribute('data-to-component') || '') || edgePoint(toRect, fromCenter);
    // SVG 画布本身有 left/top 偏移，端点需换算为画布相对坐标，避免连线整体错位。
    from.x -= canvasX;
    from.y -= canvasY;
    to.x -= canvasX;
    to.y -= canvasY;
    var rawWx = group.getAttribute('data-waypoint-x');
    var rawWy = group.getAttribute('data-waypoint-y');
    var waypoint = null;
    if (rawWx !== null && rawWx !== '' && rawWy !== null && rawWy !== '' && Number.isFinite(Number(rawWx)) && Number.isFinite(Number(rawWy))) {
      waypoint = { x: Number(rawWx) - canvasX, y: Number(rawWy) - canvasY };
    }
    var path = pathFor(from, to, group.getAttribute('data-line-type') || 'curve', waypoint);
    group.querySelectorAll('path').forEach(function (element) { element.setAttribute('d', path); });
    var label = group.querySelector('.board-link-label');
    if (label) {
      var labelX = waypoint ? waypoint.x : (from.x + to.x) / 2;
      var labelY = waypoint ? waypoint.y : (from.y + to.y) / 2;
      label.setAttribute('x', String(labelX));
      label.setAttribute('y', String(labelY - 8));
    }
  });

  // ===== 发布页查看器：默认适配全屏，支持滚轮缩放、拖拽平移与缩放控制条 =====
  var viewerScale = 1, viewerTx = 0, viewerTy = 0, viewerDrag = null;
  var viewerToolbar = null, viewerSlider = null, viewerLabel = null;

  function activeCanvas() {
    var list = document.querySelectorAll('.export-canvas');
    for (var i = 0; i < list.length; i++) {
      var section = list[i].closest('[data-board-panel]');
      if (!section || !section.hidden) return list[i];
    }
    return list[0] || null;
  }

  function availableHeight() {
    var nav = document.querySelector('.board-export-nav');
    return window.innerHeight - (nav ? nav.offsetHeight : 0) - 24;
  }

  function viewerApply() {
    var el = activeCanvas();
    if (!el) return;
    el.style.transformOrigin = '0 0';
    el.style.transform = 'translate(' + viewerTx + 'px, ' + viewerTy + 'px) scale(' + viewerScale + ')';
    if (viewerLabel) viewerLabel.textContent = Math.round(viewerScale * 100) + '%';
    if (viewerSlider) viewerSlider.value = String(Math.round(viewerScale * 100));
  }

  function viewerFit() {
    var el = activeCanvas();
    if (!el) return;
    var w = el.offsetWidth, h = el.offsetHeight;
    if (!w || !h) return;
    var fit = Math.min((window.innerWidth - 32) / w, availableHeight() / h, 1);
    viewerScale = Math.max(0.1, fit);
    viewerTx = (window.innerWidth - w * viewerScale) / 2;
    viewerTy = (window.innerHeight - (document.querySelector('.board-export-nav') ? document.querySelector('.board-export-nav').offsetHeight : 0) - h * viewerScale) / 2;
    viewerApply();
  }

  function viewerZoom(factor, cx, cy) {
    var next = Math.min(4, Math.max(0.1, viewerScale * factor));
    var ratio = next / viewerScale;
    viewerTx = cx - (cx - viewerTx) * ratio;
    viewerTy = cy - (cy - viewerTy) * ratio;
    viewerScale = next;
    viewerApply();
  }

  function viewerReset() {
    var el = activeCanvas();
    if (!el) return;
    viewerScale = 1;
    viewerTx = (window.innerWidth - el.offsetWidth) / 2;
    viewerTy = (window.innerHeight - (document.querySelector('.board-export-nav') ? document.querySelector('.board-export-nav').offsetHeight : 0) - el.offsetHeight) / 2;
    viewerApply();
  }

  function viewerSetScale(next) {
    var ratio = next / viewerScale;
    viewerTx = window.innerWidth / 2 - (window.innerWidth / 2 - viewerTx) * ratio;
    viewerTy = window.innerHeight / 2 - (window.innerHeight / 2 - viewerTy) * ratio;
    viewerScale = next;
    viewerApply();
  }

  function buildViewerToolbar() {
    if (viewerToolbar) return;
    viewerToolbar = document.createElement('div');
    viewerToolbar.className = 'board-viewer-toolbar';
    var minus = document.createElement('button');
    minus.textContent = '−';
    minus.title = '缩小';
    minus.onclick = function () { viewerZoom(0.8, window.innerWidth / 2, window.innerHeight / 2); };
    viewerSlider = document.createElement('input');
    viewerSlider.type = 'range';
    viewerSlider.min = '10';
    viewerSlider.max = '400';
    viewerSlider.value = '100';
    viewerSlider.addEventListener('input', function () { viewerSetScale(Math.max(0.1, Number(viewerSlider.value) / 100)); });
    viewerLabel = document.createElement('span');
    viewerLabel.className = 'board-viewer-zoom-label';
    var plus = document.createElement('button');
    plus.textContent = '+';
    plus.title = '放大';
    plus.onclick = function () { viewerZoom(1.25, window.innerWidth / 2, window.innerHeight / 2); };
    var fitBtn = document.createElement('button');
    fitBtn.textContent = '适配';
    fitBtn.title = '适配全屏';
    fitBtn.onclick = viewerFit;
    var resetBtn = document.createElement('button');
    resetBtn.textContent = '100%';
    resetBtn.title = '实际大小';
    resetBtn.onclick = viewerReset;
    viewerToolbar.appendChild(minus);
    viewerToolbar.appendChild(viewerSlider);
    viewerToolbar.appendChild(viewerLabel);
    viewerToolbar.appendChild(plus);
    viewerToolbar.appendChild(fitBtn);
    viewerToolbar.appendChild(resetBtn);
    document.body.appendChild(viewerToolbar);
  }

  document.body.style.padding = '0';
  document.body.style.overflow = 'hidden';
  buildViewerToolbar();
  window.addEventListener('resize', viewerFit);
  window.addEventListener('wheel', function (event) {
    if (!event.target.closest || event.target.closest('.board-viewer-toolbar')) return;
    event.preventDefault();
    viewerZoom(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX, event.clientY);
  }, { passive: false });
  document.addEventListener('pointerdown', function (event) {
    if (event.button !== 0) return;
    if (event.target.closest && event.target.closest('.board-viewer-toolbar')) return;
    var el = activeCanvas();
    if (!el || !event.target.closest('.export-canvas')) return;
    viewerDrag = { x: event.clientX, y: event.clientY, tx: viewerTx, ty: viewerTy };
    el.setPointerCapture(event.pointerId);
    el.classList.add('is-dragging');
  });
  document.addEventListener('pointermove', function (event) {
    if (!viewerDrag) return;
    viewerTx = viewerDrag.tx + (event.clientX - viewerDrag.x);
    viewerTy = viewerDrag.ty + (event.clientY - viewerDrag.y);
    viewerApply();
  });
  document.addEventListener('pointerup', function () {
    viewerDrag = null;
    var el = activeCanvas();
    if (el) el.classList.remove('is-dragging');
  });
  document.addEventListener('pointercancel', function () {
    viewerDrag = null;
    var el = activeCanvas();
    if (el) el.classList.remove('is-dragging');
  });
  document.addEventListener('click', function (event) {
    if (event.target.closest && event.target.closest('[data-board-tab]')) setTimeout(viewerFit, 0);
  });
  viewerFit();
});`;
