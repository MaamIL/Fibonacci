import { PHI, boxSpiral, drawGrids, drawSpiral, eyePoint, handlePoint, localMatrix } from "./spiral.js";
const $ = (id) => document.getElementById(id);
const stage = $("stage");
const canvas = $("canvas");
const ctx = canvas.getContext("2d");
const emptyState = $("empty-state");
const exportButton = $("export-button");
const eyeInfo = $("eye-info");
const findButton = $("find-button");
const findStatus = $("find-status");
const matchNav = $("match-nav");
const matchLabel = $("match-label");
const edgesInput = $("edges-input");
const modeSelect = $("mode-select");
const allInput = $("all-input");
const detButtons = ["remove-button", "det-rotate", "det-flip"].map($);
const HANDLE_HIT = 14;
const MIN_SIZE = 16;
const STAGE_PAD = 24;
const comp = { layers: {}, frame: "fit", padFill: "blur", rotation: 0, flip: false };
const style = { compColor: "#ffd166", detColor: "#ff5fa2", logColor: "#4cc9f0", opacity: 0.9, lineWidth: 2, eye: true, detSquares: true };
// Detected spirals (found or placed by hand); `sel` is the one the buttons, keys and handle act on.
let dets = [];
let sel = -1;
const cur = () => dets[sel] || null;
const visibleDets = () => dets.filter((d, i) => i === sel || allInput.checked);
let image = null;
let currentFile = null;
let fileName = "image";
let scale = 1;
let drag = null;
let edgesImage = null;
let findToken = 0;
const fullBox = () => ({ x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight });
// Largest golden rectangle in the given orientation, centered on the image.
function goldenFit(rotation, fraction = 1) {
  const iw = image.naturalWidth;
  const ih = image.naturalHeight;
  const a = rotation % 2 === 0 ? PHI : 1 / PHI;
  const w = Math.min(iw, ih * a) * fraction;
  const h = w / a;
  return { x: (iw - w) / 2, y: (ih - h) / 2, w, h };
}
// Smallest golden rectangle (in the composition orientation) that contains the photo, centered on it; in image coordinates, so x/y may be negative.
function paddedBox() {
  const iw = image.naturalWidth;
  const ih = image.naturalHeight;
  const a = comp.rotation % 2 === 0 ? PHI : 1 / PHI;
  const w = iw / ih > a ? iw : ih * a;
  const h = w / a;
  return { x: (iw - w) / 2, y: (ih - h) / 2, w, h };
}
// The frame is what the canvas shows and exports: the photo itself, or the photo plus golden padding.
const frameBox = () => (comp.frame === "pad" ? paddedBox() : fullBox());
const compSpiral = () => boxSpiral(comp.frame === "fit" ? goldenFit(comp.rotation) : frameBox(), comp.rotation, comp.flip);
const frameView = (s) => new DOMMatrix().scale(s).translate(-frameBox().x, -frameBox().y);
function resizeCanvas() {
  if (!image) return;
  const fb = frameBox();
  const maxW = stage.clientWidth - STAGE_PAD * 2;
  const maxH = stage.clientHeight - STAGE_PAD * 2;
  scale = Math.min(maxW / fb.w, maxH / fb.h);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${fb.w * scale}px`;
  canvas.style.height = `${fb.h * scale}px`;
  canvas.width = Math.round(fb.w * scale * dpr);
  canvas.height = Math.round(fb.h * scale * dpr);
  render();
}
function drawPadding(c) {
  const fb = frameBox();
  if (comp.padFill !== "blur") {
    c.fillStyle = comp.padFill;
    c.fillRect(fb.x, fb.y, fb.w, fb.h);
    return;
  }
  const cover = Math.max(fb.w / image.naturalWidth, fb.h / image.naturalHeight);
  const w = image.naturalWidth * cover;
  const h = image.naturalHeight * cover;
  // Filter lengths are in canvas pixels (unaffected by the transform), so size the blur from the canvas to match on screen and in exports.
  c.filter = `blur(${Math.round(Math.max(c.canvas.width, c.canvas.height) / 60)}px) brightness(0.8)`;
  c.drawImage(image, fb.x + (fb.w - w) / 2, fb.y + (fb.h - h) / 2, w, h);
  c.filter = "none";
}
function drawBase(c, view) {
  c.save();
  c.setTransform(view);
  if (comp.frame === "pad") drawPadding(c);
  c.drawImage(image, 0, 0);
  if (edgesImage && edgesInput.checked) {
    c.fillStyle = "rgba(0, 0, 0, 0.65)";
    c.fillRect(0, 0, image.naturalWidth, image.naturalHeight);
    c.globalCompositeOperation = "screen";
    c.drawImage(edgesImage, 0, 0, image.naturalWidth, image.naturalHeight);
  }
  c.restore();
}
// `px` is canvas pixels per screen pixel: devicePixelRatio on screen, image pixels per screen pixel when exporting.
function drawScene(c, view, px, interactive) {
  drawBase(c, view);
  const common = { opacity: style.opacity, lineWidth: style.lineWidth, px };
  drawGrids(c, view, frameBox(), { ...common, color: style.compColor, phi: comp.layers.phi, thirds: comp.layers.thirds });
  const compStyle = { ...common, color: style.compColor, arcs: comp.layers.spiral, squares: comp.layers.squares, eye: style.eye && comp.layers.spiral };
  if (comp.layers.spiral || comp.layers.squares) drawSpiral(c, view, compSpiral(), compStyle);
  for (const d of visibleDets()) {
    const active = d === cur();
    const look = active ? { squares: style.detSquares, frame: true, handle: interactive } : { opacity: style.opacity * 0.6, lineWidth: style.lineWidth * 0.7 };
    drawSpiral(c, view, d, { ...common, color: d.growth ? style.logColor : style.detColor, eye: style.eye, ...look });
  }
}
function render() {
  if (!image) return;
  const dpr = window.devicePixelRatio || 1;
  drawScene(ctx, frameView(scale * dpr), dpr, true);
  const det = cur();
  const spiral = det || (comp.layers.spiral ? compSpiral() : null);
  const e = spiral && eyePoint(spiral);
  const fb = frameBox();
  const pct = (v, start, size) => `${(((v - start) / size) * 100).toFixed(1)}%`;
  eyeInfo.textContent = e ? `${det ? "Detected" : "Composition"} spiral eye at ${pct(e.x, fb.x, fb.w)} × ${pct(e.y, fb.y, fb.h)} of the ${comp.frame === "pad" ? "frame" : "image"}.` : "";
}
// Refreshes everything that depends on the detections and the selection.
function update() {
  const d = cur();
  for (const b of detButtons) b.disabled = !d;
  matchNav.hidden = !d;
  for (const id of ["prev-match", "next-match"]) $(id).hidden = dets.length < 2;
  if (d) {
    const ratio = d.growth ? ` · ratio ${d.growth.toFixed(2)} (golden 1.62)` : "";
    const what = d.fit === undefined ? "manual" : `${Math.round(d.fit * 100)}% ${fitWord(d.fit)}${ratio}`;
    matchLabel.textContent = `Spiral ${sel + 1} of ${dets.length} · ${what}`;
  }
  render();
}
function select(i) {
  if (!dets.length) return;
  sel = (i + dets.length) % dets.length;
  update();
}
function setCur(next) {
  dets[sel] = next;
  update();
}
function removeCur() {
  if (!cur()) return;
  dets.splice(sel, 1);
  sel = Math.min(sel, dets.length - 1);
  update();
}
function resetMatches() {
  findToken++;
  dets = [];
  sel = -1;
  edgesImage = null;
  edgesInput.checked = false;
  edgesInput.disabled = true;
  matchNav.hidden = true;
  findStatus.textContent = "";
  findButton.disabled = !image;
  $("place-button").disabled = !image;
}
// Calibrated on the sample photos: random placements score about 10-20%, rarely above 50%.
const fitWord = (f) => (f >= 0.85 ? "strong" : f >= 0.7 ? "good" : f >= 0.55 ? "fair" : "weak");
async function findSpirals() {
  if (!currentFile) return;
  const token = ++findToken;
  const body = new FormData();
  body.append("file", currentFile);
  body.append("mode", modeSelect.value);
  findButton.disabled = true;
  findStatus.textContent = modeSelect.value === "any" ? "Searching position, size, angle and growth rate…" : "Searching position, size and angle…";
  try {
    const res = await fetch("/api/find-spiral", { method: "POST", body });
    if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
    const data = await res.json();
    if (token !== findToken) return;
    const edges = new Image();
    edges.src = data.edges;
    await edges.decode();
    if (token !== findToken) return;
    edgesImage = edges;
    edgesInput.disabled = false;
    dets = [...dets.filter((d) => d.fit === undefined), ...data.matches.map((m) => ({ cx: m.cx, cy: m.cy, w: m.w, h: m.h, angle: m.angle, flip: m.flip, growth: m.growth, fit: m.fit }))];
    const n = data.matches.length;
    findStatus.textContent = data.matches.length ? `${n} spiral${n === 1 ? "" : "s"} found. Click a spiral or use ◀ ▶ / [ ] to select, then fine-tune by hand.` : "No spiral-like edges found.";
    sel = data.matches.length ? dets.length - data.matches.length : dets.length - 1;
    update();
  } catch (err) {
    if (token === findToken) findStatus.textContent = `Search failed: ${err.message}`;
  } finally {
    if (token === findToken) findButton.disabled = false;
  }
}
function placeManually() {
  if (!image) return;
  dets.push(boxSpiral(goldenFit(0, 0.5), 0, false));
  select(dets.length - 1);
}
async function loadFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  const img = new Image();
  img.src = URL.createObjectURL(file);
  try {
    await img.decode();
  } catch {
    eyeInfo.textContent = "Could not read that image.";
    return;
  }
  if (image) URL.revokeObjectURL(image.src);
  image = img;
  currentFile = file;
  fileName = file.name.replace(/\.[^.]+$/, "");
  canvas.hidden = false;
  emptyState.hidden = true;
  exportButton.disabled = false;
  resetMatches();
  update();
  resizeCanvas();
}
function toImage(e) {
  const r = canvas.getBoundingClientRect();
  const fb = frameBox();
  return { x: (e.clientX - r.left) / scale + fb.x, y: (e.clientY - r.top) / scale + fb.y };
}
function inside(d, p) {
  const q = localMatrix(d).inverse().transformPoint(new DOMPoint(p.x, p.y));
  return q.x >= 0 && q.x <= d.w / d.h && q.y >= 0 && q.y <= 1;
}
// The resize handle wins, then the smallest spiral under the pointer, so nested ones stay reachable.
function hitTest(p) {
  const det = cur();
  if (det) {
    const hp = handlePoint(det);
    if (Math.hypot(p.x - hp.x, p.y - hp.y) <= HANDLE_HIT / scale) return { mode: "resize" };
  }
  const under = visibleDets()
    .filter((d) => inside(d, p))
    .sort((a, b) => a.w * a.h - b.w * b.h);
  if (!under.length) return null;
  return under[0] === det ? { mode: "move" } : { mode: "select", index: dets.indexOf(under[0]) };
}
function rotateDet() {
  const d = cur();
  if (d) setCur({ ...d, angle: (d.angle + 90) % 360 });
}
function flipDet() {
  const d = cur();
  if (d) setCur({ ...d, flip: !d.flip });
}
function exportPng() {
  if (!image) return;
  const out = document.createElement("canvas");
  const fb = frameBox();
  out.width = Math.round(fb.w);
  out.height = Math.round(fb.h);
  drawScene(out.getContext("2d"), frameView(1), 1 / scale, false);
  out.toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${fileName}-golden.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, "image/png");
}
canvas.addEventListener("pointerdown", (e) => {
  const p = toImage(e);
  const hit = hitTest(p);
  if (!hit) return;
  if (hit.mode === "select") select(hit.index);
  const det = cur();
  canvas.setPointerCapture(e.pointerId);
  const a = localMatrix(det).transformPoint(new DOMPoint(0, 0));
  drag = { mode: hit.mode === "resize" ? "resize" : "move", start: p, spiral: { ...det }, anchor: { x: a.x, y: a.y }, handle: handlePoint(det) };
});
canvas.addEventListener("pointermove", (e) => {
  const p = toImage(e);
  if (!drag) {
    const hit = hitTest(p);
    canvas.style.cursor = !hit ? "default" : hit.mode === "resize" ? "nwse-resize" : hit.mode === "move" ? "move" : "pointer";
    return;
  }
  const dx = p.x - drag.start.x;
  const dy = p.y - drag.start.y;
  const s = drag.spiral;
  if (drag.mode === "move") {
    dets[sel] = { ...s, cx: s.cx + dx, cy: s.cy + dy };
  } else {
    // Scale about the opposite corner by how far the pointer moved along the box diagonal.
    const { anchor: o, handle: hp } = drag;
    const diag = { x: hp.x - o.x, y: hp.y - o.y };
    const k = Math.max(MIN_SIZE / Math.min(s.w, s.h), ((p.x - o.x) * diag.x + (p.y - o.y) * diag.y) / (diag.x ** 2 + diag.y ** 2));
    dets[sel] = { ...s, w: s.w * k, h: s.h * k, cx: o.x + (s.cx - o.x) * k, cy: o.y + (s.cy - o.y) * k };
  }
  render();
});
const endDrag = () => (drag = null);
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
function onWheel(e) {
  if (hitTest(toImage(e))?.mode !== "move") return;
  e.preventDefault();
  const det = cur();
  const k = Math.max(MIN_SIZE / Math.min(det.w, det.h), e.deltaY < 0 ? 1.05 : 1 / 1.05);
  dets[sel] = { ...det, w: det.w * k, h: det.h * k };
  render();
}
canvas.addEventListener("wheel", onWheel, { passive: false });
stage.addEventListener("dragover", (e) => {
  e.preventDefault();
  stage.classList.add("dragging");
});
stage.addEventListener("dragleave", () => stage.classList.remove("dragging"));
stage.addEventListener("drop", (e) => {
  e.preventDefault();
  stage.classList.remove("dragging");
  loadFile(e.dataTransfer.files[0]);
});
$("file-input").addEventListener("change", (e) => loadFile(e.target.files[0]));
for (const input of document.querySelectorAll("[data-comp]")) {
  comp.layers[input.dataset.comp] = input.checked;
  input.addEventListener("change", () => {
    comp.layers[input.dataset.comp] = input.checked;
    render();
  });
}
$("frame-select").addEventListener("change", (e) => {
  comp.frame = e.target.value;
  $("pad-fill-field").hidden = comp.frame !== "pad";
  resizeCanvas();
});
$("pad-fill-select").addEventListener("change", (e) => {
  comp.padFill = e.target.value;
  render();
});
$("comp-rotate").addEventListener("click", () => {
  comp.rotation = (comp.rotation + 1) % 4;
  resizeCanvas();
});
$("comp-flip").addEventListener("click", () => {
  comp.flip = !comp.flip;
  render();
});
findButton.addEventListener("click", findSpirals);
$("prev-match").addEventListener("click", () => select(sel - 1));
$("next-match").addEventListener("click", () => select(sel + 1));
$("place-button").addEventListener("click", placeManually);
$("remove-button").addEventListener("click", removeCur);
allInput.addEventListener("change", render);
$("det-rotate").addEventListener("click", rotateDet);
$("det-flip").addEventListener("click", flipDet);
document.querySelector("[data-det=squares]").addEventListener("change", (e) => {
  style.detSquares = e.target.checked;
  render();
});
edgesInput.addEventListener("change", render);
exportButton.addEventListener("click", exportPng);
const styleInputs = {
  "comp-color-input": ["compColor", String],
  "det-color-input": ["detColor", String],
  "log-color-input": ["logColor", String],
  "opacity-input": ["opacity", Number],
  "width-input": ["lineWidth", Number],
};
for (const [id, [key, cast]] of Object.entries(styleInputs)) {
  $(id).addEventListener("input", (e) => {
    style[key] = cast(e.target.value);
    render();
  });
}
$("eye-input").addEventListener("change", (e) => {
  style.eye = e.target.checked;
  render();
});
document.addEventListener("keydown", (e) => {
  if (!image || e.target.matches("input[type=number], input[type=text]")) return;
  const key = e.key.toLowerCase();
  if (key === "r") rotateDet();
  else if (key === "f") flipDet();
  else if (key === "delete" || key === "backspace") removeCur();
  else if (key === "[") select(sel - 1);
  else if (key === "]") select(sel + 1);
});
new ResizeObserver(resizeCanvas).observe(stage);
