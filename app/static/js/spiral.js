export const PHI = (1 + Math.sqrt(5)) / 2;
export const THIRDS_COLOR = "#7fdbff";
// Carves squares off a PHI x 1 rectangle, cycling left, top, right, bottom; each square holds one quarter arc of the spiral.
export function goldenSteps(count) {
  let r = { x: 0, y: 0, w: PHI, h: 1 };
  const steps = [];
  for (let i = 0; i < count; i++) {
    const s = Math.min(r.w, r.h);
    const side = i % 4;
    if (side === 0) {
      steps.push({ square: { x: r.x, y: r.y, s }, arc: { cx: r.x + s, cy: r.y + s, a0: Math.PI, a1: 1.5 * Math.PI, s } });
      r = { x: r.x + s, y: r.y, w: r.w - s, h: r.h };
    } else if (side === 1) {
      steps.push({ square: { x: r.x, y: r.y, s }, arc: { cx: r.x, cy: r.y + s, a0: 1.5 * Math.PI, a1: 2 * Math.PI, s } });
      r = { x: r.x, y: r.y + s, w: r.w, h: r.h - s };
    } else if (side === 2) {
      steps.push({ square: { x: r.x + r.w - s, y: r.y, s }, arc: { cx: r.x + r.w - s, cy: r.y, a0: 0, a1: 0.5 * Math.PI, s } });
      r = { x: r.x, y: r.y, w: r.w - s, h: r.h };
    } else {
      steps.push({ square: { x: r.x, y: r.y + r.h - s, s }, arc: { cx: r.x + s, cy: r.y + r.h - s, a0: 0.5 * Math.PI, a1: Math.PI, s } });
      r = { x: r.x, y: r.y, w: r.w, h: r.h - s };
    }
  }
  return { steps, eye: { x: r.x + r.w / 2, y: r.y + r.h / 2 } };
}
const DRAW = goldenSteps(14);
const EYE = goldenSteps(60).eye;
// Maps the local PHI x 1 rectangle onto the box, honoring 90° rotation steps and mirroring.
export function localMatrix(box, rotation, flip) {
  const odd = rotation % 2 === 1;
  const lw = odd ? box.h : box.w;
  const lh = odd ? box.w : box.h;
  const m = new DOMMatrix();
  m.translateSelf(box.x + box.w / 2, box.y + box.h / 2);
  m.rotateSelf(rotation * 90);
  m.scaleSelf((flip ? -1 : 1) * (lw / PHI), lh);
  m.translateSelf(-PHI / 2, -0.5);
  return m;
}
export function eyePoint(spiral) {
  const p = localMatrix(spiral.box, spiral.rotation, spiral.flip).transformPoint(new DOMPoint(EYE.x, EYE.y));
  return { x: p.x, y: p.y };
}
// Builds the path under `matrix` but strokes in device space, so line width stays uniform even when the frame is stretched.
function strokePath(ctx, matrix, build, color, width, dash = []) {
  ctx.save();
  ctx.setTransform(matrix);
  ctx.beginPath();
  build(ctx);
  ctx.restore();
  ctx.setLineDash(dash.map((d) => d * width));
  ctx.lineWidth = width + 2;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
  ctx.stroke();
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.setLineDash([]);
}
function gridLines(ctx, box, fractions) {
  for (const f of fractions) {
    ctx.moveTo(box.x + box.w * f, box.y);
    ctx.lineTo(box.x + box.w * f, box.y + box.h);
    ctx.moveTo(box.x, box.y + box.h * f);
    ctx.lineTo(box.x + box.w, box.y + box.h * f);
  }
}
function prepare(ctx, opacity) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = opacity;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}
// `view` maps image pixels to canvas pixels; `px` is canvas pixels per screen pixel, so strokes look the same on screen and in exports.
export function drawGrids(ctx, view, box, style) {
  const width = style.lineWidth * style.px;
  prepare(ctx, style.opacity);
  if (style.thirds) strokePath(ctx, view, (c) => gridLines(c, box, [1 / 3, 2 / 3]), THIRDS_COLOR, width * 0.75, [3, 3]);
  if (style.phi) strokePath(ctx, view, (c) => gridLines(c, box, [1 / PHI ** 2, 1 / PHI]), style.color, width * 0.75, [6, 4]);
  ctx.restore();
}
// `spiral` is { box, rotation, flip }; style flags choose which parts are drawn.
export function drawSpiral(ctx, view, spiral, style) {
  const { box } = spiral;
  const width = style.lineWidth * style.px;
  const local = view.multiply(localMatrix(box, spiral.rotation, spiral.flip));
  prepare(ctx, style.opacity);
  if (style.squares) {
    ctx.globalAlpha = style.opacity * 0.55;
    strokePath(ctx, local, (c) => DRAW.steps.forEach(({ square: q }) => c.rect(q.x, q.y, q.s, q.s)), style.color, width * 0.6);
    ctx.globalAlpha = style.opacity;
  }
  if (style.arcs !== false) strokePath(ctx, local, (c) => DRAW.steps.forEach(({ arc: a }) => c.arc(a.cx, a.cy, a.s, a.a0, a.a1)), style.color, width * 1.25);
  if (style.frame) strokePath(ctx, view, (c) => c.rect(box.x, box.y, box.w, box.h), style.color, width * 0.6);
  if (style.eye) {
    const e = view.transformPoint(eyePoint(spiral));
    ctx.beginPath();
    ctx.arc(e.x, e.y, width * 4, 0, 2 * Math.PI);
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.fill();
    ctx.lineWidth = width;
    ctx.strokeStyle = style.color;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(e.x, e.y, width * 1.2, 0, 2 * Math.PI);
    ctx.fillStyle = style.color;
    ctx.fill();
  }
  if (style.handle) {
    const h = view.transformPoint(new DOMPoint(box.x + box.w, box.y + box.h));
    const size = 7 * style.px;
    ctx.globalAlpha = 1;
    ctx.fillStyle = style.color;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.lineWidth = 1.5;
    ctx.fillRect(h.x - size, h.y - size, size * 2, size * 2);
    ctx.strokeRect(h.x - size, h.y - size, size * 2, size * 2);
  }
  ctx.restore();
}
