import { PHI, drawGrids, drawSpiral, eyePoint } from "./spiral.js";
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
const detButtons = ["remove-button", "det-rotate", "det-flip"].map($);
const HANDLE_HIT = 14;
const MIN_SIZE = 16;
const STAGE_PAD = 24;
const comp = { layers: {}, frame: "fit", padFill: "blur", rotation: 0, flip: false };
const style = { compColor: "#ffd166", detColor: "#ff5fa2", opacity: 0.9, lineWidth: 2, eye: true, detSquares: true };
let det = null;
let image = null;
let currentFile = null;
let fileName = "image";
let scale = 1;
let drag = null;
let matches = [];
let matchIndex = 0;
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
const compSpiral = () => ({ box: comp.frame === "fit" ? goldenFit(comp.rotation) : frameBox(), rotation: comp.rotation, flip: comp.flip });
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
  if (det) drawSpiral(c, view, det, { ...common, color: style.detColor, squares: style.detSquares, eye: style.eye, frame: true, handle: interactive });
}
function render() {
  if (!image) return;
  const dpr = window.devicePixelRatio || 1;
  drawScene(ctx, frameView(scale * dpr), dpr, true);
  const spiral = det || (comp.layers.spiral ? compSpiral() : null);
  const e = spiral && eyePoint(spiral);
  const fb = frameBox();
  const pct = (v, start, size) => `${(((v - start) / size) * 100).toFixed(1)}%`;
  eyeInfo.textContent = e ? `${det ? "Detected" : "Composition"} spiral eye at ${pct(e.x, fb.x, fb.w)} × ${pct(e.y, fb.y, fb.h)} of the ${comp.frame === "pad" ? "frame" : "image"}.` : "";
}
function setDet(next) {
  det = next;
  for (const b of detButtons) b.disabled = !det;
  render();
}
function resetMatches() {
  findToken++;
  matches = [];
  edgesImage = null;
  edgesInput.checked = false;
  edgesInput.disabled = true;
  matchNav.hidden = true;
  findStatus.textContent = "";
  findButton.disabled = !image;
  $("place-button").disabled = !image;
}
const fitWord = (f) => (f >= 0.75 ? "strong" : f >= 0.5 ? "good" : f >= 0.25 ? "fair" : "weak");
function applyMatch(i) {
  if (!matches.length) return;
  matchIndex = (i + matches.length) % matches.length;
  const m = matches[matchIndex];
  matchLabel.textContent = `Match ${matchIndex + 1} of ${matches.length} · ${Math.round(m.fit * 100)}% ${fitWord(m.fit)}`;
  setDet({ box: { x: m.x, y: m.y, w: m.w, h: m.h }, rotation: m.rotation, flip: m.flip });
}
async function findSpirals() {
  if (!currentFile) return;
  const token = ++findToken;
  const body = new FormData();
  body.append("file", currentFile);
  findButton.disabled = true;
  findStatus.textContent = "Searching position, size and orientation…";
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
    matches = data.matches;
    matchNav.hidden = matches.length < 2;
    findStatus.textContent = matches.length ? "Use ◀ ▶ or [ ] to browse matches, then fine-tune by hand." : "No spiral-like edges found.";
    applyMatch(0);
  } catch (err) {
    if (token === findToken) findStatus.textContent = `Search failed: ${err.message}`;
  } finally {
    if (token === findToken) findButton.disabled = false;
  }
}
function placeManually() {
  if (!image) return;
  if (matches.length) matchLabel.textContent = "Manual placement";
  setDet({ box: goldenFit(0, 0.5), rotation: 0, flip: false });
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
  det = null;
  for (const b of detButtons) b.disabled = true;
  resizeCanvas();
}
function toImage(e) {
  const r = canvas.getBoundingClientRect();
  const fb = frameBox();
  return { x: (e.clientX - r.left) / scale + fb.x, y: (e.clientY - r.top) / scale + fb.y };
}
function hitTest(p) {
  if (!det) return null;
  const { x, y, w, h } = det.box;
  const tol = HANDLE_HIT / scale;
  if (Math.abs(p.x - (x + w)) <= tol && Math.abs(p.y - (y + h)) <= tol) return "resize";
  if (p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h) return "move";
  return null;
}
function rotateDet() {
  if (!det) return;
  const { x, y, w, h } = det.box;
  setDet({ ...det, rotation: (det.rotation + 1) % 4, box: { x: x + (w - h) / 2, y: y + (h - w) / 2, w: h, h: w } });
}
function flipDet() {
  if (det) setDet({ ...det, flip: !det.flip });
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
  const mode = hitTest(p);
  if (!mode) return;
  canvas.setPointerCapture(e.pointerId);
  drag = { mode, start: p, box: { ...det.box } };
});
canvas.addEventListener("pointermove", (e) => {
  const p = toImage(e);
  if (!drag) {
    const mode = hitTest(p);
    canvas.style.cursor = mode === "resize" ? "nwse-resize" : mode === "move" ? "move" : "default";
    return;
  }
  const dx = p.x - drag.start.x;
  const dy = p.y - drag.start.y;
  const b = drag.box;
  if (drag.mode === "move") {
    det.box = { ...b, x: b.x + dx, y: b.y + dy };
  } else {
    const w = Math.max(MIN_SIZE, b.w + dx);
    det.box = { ...b, w, h: w * (b.h / b.w) };
  }
  render();
});
const endDrag = () => (drag = null);
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
function onWheel(e) {
  if (hitTest(toImage(e)) !== "move") return;
  e.preventDefault();
  const { x, y, w, h } = det.box;
  const nw = Math.max(MIN_SIZE, w * (e.deltaY < 0 ? 1.05 : 1 / 1.05));
  const nh = nw * (h / w);
  det.box = { x: x + (w - nw) / 2, y: y + (h - nh) / 2, w: nw, h: nh };
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
$("prev-match").addEventListener("click", () => applyMatch(matchIndex - 1));
$("next-match").addEventListener("click", () => applyMatch(matchIndex + 1));
$("place-button").addEventListener("click", placeManually);
$("remove-button").addEventListener("click", () => setDet(null));
$("det-rotate").addEventListener("click", rotateDet);
$("det-flip").addEventListener("click", flipDet);
document.querySelector("[data-det=squares]").addEventListener("change", (e) => {
  style.detSquares = e.target.checked;
  render();
});
edgesInput.addEventListener("change", render);
exportButton.addEventListener("click", exportPng);
const styleInputs = { "comp-color-input": ["compColor", String], "det-color-input": ["detColor", String], "opacity-input": ["opacity", Number], "width-input": ["lineWidth", Number] };
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
  else if (key === "delete" || key === "backspace") setDet(null);
  else if (key === "[") applyMatch(matchIndex - 1);
  else if (key === "]") applyMatch(matchIndex + 1);
});
new ResizeObserver(resizeCanvas).observe(stage);
