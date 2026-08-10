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
  function pathFor(from, to, type) {
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
  document.querySelectorAll('[data-board-link]').forEach(function (group) {
    var fromObject = objectElement(group.getAttribute('data-link-from') || '');
    var toObject = objectElement(group.getAttribute('data-link-to') || '');
    if (!fromObject || !toObject) return;
    var fromRect = fromObject.getBoundingClientRect();
    var toRect = toObject.getBoundingClientRect();
    var fromCenter = center(fromRect);
    var toCenter = center(toRect);
    var from = componentPoint(fromObject, group.getAttribute('data-from-component') || '') || edgePoint(fromRect, toCenter);
    var to = componentPoint(toObject, group.getAttribute('data-to-component') || '') || edgePoint(toRect, fromCenter);
    var path = pathFor(from, to, group.getAttribute('data-line-type') || 'curve');
    group.querySelectorAll('path').forEach(function (element) { element.setAttribute('d', path); });
    var label = group.querySelector('.board-link-label');
    if (label) {
      label.setAttribute('x', String((from.x + to.x) / 2));
      label.setAttribute('y', String((from.y + to.y) / 2 - 8));
    }
  });
});`;
