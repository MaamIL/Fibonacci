import { PHI, drawOverlay, eyePoint } from "./spiral.js";
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
const HANDLE_HIT = 14;
const MIN_SIZE = 16;
const STAGE_PAD = 24;
const state = { box: { x: 0, y: 0, w: 1, h: 1 }, rotation: 0, flip: false, lock: true, layers: {}, color: "#ffd166", opacity: 0.9, lineWidth: 2 };
let image = null;
let fileName = "image";
let scale = 1;
let drag = null;
let currentFile = null;
let matches = [];
let matchIndex = 0;
let edgesImage = null;
let findToken = 0;
const aspect = () => (state.rotation % 2 === 0 ? PHI : 1 / PHI);
function fitBox() {
  const iw = image.naturalWidth;
  const ih = image.naturalHeight;
  if (!state.lock) {
    state.box = { x: 0, y: 0, w: iw, h: ih };
    return;
  }
  const a = aspect();
  const w = Math.min(iw, ih * a);
  const h = w / a;
  state.box = { x: (iw - w) / 2, y: (ih - h) / 2, w, h };
}
function resizeCanvas() {
  if (!image) return;
  const maxW = stage.clientWidth - STAGE_PAD * 2;
  const maxH = stage.clientHeight - STAGE_PAD * 2;
  scale = Math.min(maxW / image.naturalWidth, maxH / image.naturalHeight);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${image.naturalWidth * scale}px`;
  canvas.style.height = `${image.naturalHeight * scale}px`;
  canvas.width = Math.round(image.naturalWidth * scale * dpr);
  canvas.height = Math.round(image.naturalHeight * scale * dpr);
  render();
}
function render() {
  if (!image) return;
  const dpr = window.devicePixelRatio || 1;
  const view = new DOMMatrix().scale(scale * dpr);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBase(ctx, view);
  drawOverlay(ctx, view, state, dpr, true);
  const e = eyePoint(state);
  eyeInfo.textContent = `Spiral eye at ${((e.x / image.naturalWidth) * 100).toFixed(1)}% × ${((e.y / image.naturalHeight) * 100).toFixed(1)}% of the image.`;
}
function drawBase(c, view) {
  c.save();
  c.setTransform(view);
  c.drawImage(image, 0, 0);
  if (edgesImage && edgesInput.checked) {
    c.fillStyle = "rgba(0, 0, 0, 0.65)";
    c.fillRect(0, 0, image.naturalWidth, image.naturalHeight);
    c.globalCompositeOperation = "screen";
    c.drawImage(edgesImage, 0, 0, image.naturalWidth, image.naturalHeight);
  }
  c.restore();
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
}
const fitWord = (f) => (f >= 0.75 ? "strong" : f >= 0.5 ? "good" : f >= 0.25 ? "fair" : "weak");
function applyMatch(i) {
  if (!matches.length) return;
  matchIndex = (i + matches.length) % matches.length;
  const m = matches[matchIndex];
  state.box = { x: m.x, y: m.y, w: m.w, h: m.h };
  state.rotation = m.rotation;
  state.flip = m.flip;
  state.lock = true;
  $("lock-input").checked = true;
  matchLabel.textContent = `Match ${matchIndex + 1} of ${matches.length} · ${Math.round(m.fit * 100)}% ${fitWord(m.fit)}`;
  render();
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
  resetMatches();
  fileName = file.name.replace(/\.[^.]+$/, "");
  canvas.hidden = false;
  emptyState.hidden = true;
  exportButton.disabled = false;
  fitBox();
  resizeCanvas();
}
function toImage(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
}
function hitTest(p) {
  const { x, y, w, h } = state.box;
  const tol = HANDLE_HIT / scale;
  if (Math.abs(p.x - (x + w)) <= tol && Math.abs(p.y - (y + h)) <= tol) return "resize";
  if (p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h) return "move";
  return null;
}
function scaleBox(factor) {
  const { x, y, w, h } = state.box;
  const nw = Math.max(MIN_SIZE, w * factor);
  const nh = nw * (h / w);
  state.box = { x: x + (w - nw) / 2, y: y + (h - nh) / 2, w: nw, h: nh };
}
function rotate() {
  state.rotation = (state.rotation + 1) % 4;
  if (state.lock) {
    const { x, y, w, h } = state.box;
    state.box = { x: x + (w - h) / 2, y: y + (h - w) / 2, w: h, h: w };
    if (image && (h > image.naturalWidth || w > image.naturalHeight)) fitBox();
  }
  render();
}
function flip() {
  state.flip = !state.flip;
  render();
}
function fit() {
  if (!image) return;
  fitBox();
  render();
}
function exportPng() {
  if (!image) return;
  const out = document.createElement("canvas");
  out.width = image.naturalWidth;
  out.height = image.naturalHeight;
  const octx = out.getContext("2d");
  drawBase(octx, new DOMMatrix());
  drawOverlay(octx, new DOMMatrix(), state, 1 / scale, false);
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
  drag = { mode, start: p, box: { ...state.box } };
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
    state.box = { ...b, x: b.x + dx, y: b.y + dy };
  } else {
    const w = Math.max(MIN_SIZE, b.w + dx);
    const h = state.lock ? w / aspect() : Math.max(MIN_SIZE, b.h + dy);
    state.box = { ...b, w, h };
  }
  render();
});
const endDrag = () => (drag = null);
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
function onWheel(e) {
  if (!image) return;
  e.preventDefault();
  scaleBox(e.deltaY < 0 ? 1.05 : 1 / 1.05);
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
for (const input of document.querySelectorAll("[data-layer]")) {
  state.layers[input.dataset.layer] = input.checked;
  input.addEventListener("change", () => {
    state.layers[input.dataset.layer] = input.checked;
    render();
  });
}
$("lock-input").addEventListener("change", (e) => {
  state.lock = e.target.checked;
  if (state.lock) {
    const { x, y, w, h } = state.box;
    const nh = w / aspect();
    state.box = { x, y: y + (h - nh) / 2, w, h: nh };
  }
  render();
});
$("rotate-button").addEventListener("click", rotate);
$("flip-button").addEventListener("click", flip);
$("fit-button").addEventListener("click", fit);
exportButton.addEventListener("click", exportPng);
findButton.addEventListener("click", findSpirals);
$("prev-match").addEventListener("click", () => applyMatch(matchIndex - 1));
$("next-match").addEventListener("click", () => applyMatch(matchIndex + 1));
edgesInput.addEventListener("change", render);
$("color-input").addEventListener("input", (e) => {
  state.color = e.target.value;
  render();
});
$("opacity-input").addEventListener("input", (e) => {
  state.opacity = Number(e.target.value);
  render();
});
$("width-input").addEventListener("input", (e) => {
  state.lineWidth = Number(e.target.value);
  render();
});
document.addEventListener("keydown", (e) => {
  if (!image || e.target.matches("input[type=number], input[type=text]")) return;
  const key = e.key.toLowerCase();
  if (key === "r") rotate();
  else if (key === "f") flip();
  else if (key === "0") fit();
  else if (key === "[") applyMatch(matchIndex - 1);
  else if (key === "]") applyMatch(matchIndex + 1);
});
new ResizeObserver(resizeCanvas).observe(stage);
