import { boxSpiral, drawGrids, drawSpiral, eyePoint } from "./spiral.js";
const $ = (id) => document.getElementById(id);
const stage = $("stage");
const canvas = $("canvas");
const ctx = canvas.getContext("2d");
const ruleSelect = $("rule-select");
const aspectSelect = $("aspect-select");
const cropInfo = $("crop-info");
const subjectInfo = $("subject-info");
const saliencyInput = $("saliency-input");
const guidesInput = $("guides-input");
const STAGE_PAD = 24;
const GUIDE_COLOR = "#ffd166";
const SUBJECT_COLOR = "#ff5fa2";
const DRAG_THRESHOLD = 4;
const RULE_NAMES = { phi: "Dramatic · phi grid", thirds: "Interesting · rule of thirds", spiral: "Flowing · golden spiral" };
let image = null;
let currentFile = null;
let fileName = "image";
let result = null;
let crop = null;
let subject = null;
let saliencyImage = null;
let after = false;
let scale = 1;
let drag = null;
let requestToken = 0;
const viewBox = () => (after ? crop : { x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight });
const viewMatrix = (s) => new DOMMatrix().scale(s).translate(-viewBox().x, -viewBox().y);
function resizeCanvas() {
  if (!image || !crop) return;
  const vb = viewBox();
  scale = Math.min((stage.clientWidth - STAGE_PAD * 2) / vb.w, (stage.clientHeight - STAGE_PAD * 2) / vb.h);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${vb.w * scale}px`;
  canvas.style.height = `${vb.h * scale}px`;
  canvas.width = Math.round(vb.w * scale * dpr);
  canvas.height = Math.round(vb.h * scale * dpr);
  render();
}
// The golden spiral orientation whose eye lands closest to the target point, matching the crop's landscape or portrait shape.
function targetSpiral() {
  const rotations = crop.w >= crop.h ? [0, 2] : [1, 3];
  const target = { x: crop.x + (result.target.x - result.crop.x), y: crop.y + (result.target.y - result.crop.y) };
  const options = rotations.flatMap((r) => [false, true].map((flip) => boxSpiral(crop, r, flip)));
  return options.reduce((best, s) => {
    const e = eyePoint(s);
    const b = eyePoint(best);
    return Math.hypot(e.x - target.x, e.y - target.y) < Math.hypot(b.x - target.x, b.y - target.y) ? s : best;
  });
}
function marker(c, view, p, radius, color) {
  const q = view.transformPoint(new DOMPoint(p.x, p.y));
  c.beginPath();
  c.arc(q.x, q.y, radius, 0, 2 * Math.PI);
  c.lineWidth = 2;
  c.strokeStyle = "rgba(0, 0, 0, 0.6)";
  c.stroke();
  c.beginPath();
  c.arc(q.x, q.y, radius - 1.5, 0, 2 * Math.PI);
  c.strokeStyle = color;
  c.stroke();
}
function render() {
  if (!image || !crop) return;
  const dpr = window.devicePixelRatio || 1;
  const view = viewMatrix(scale * dpr);
  ctx.save();
  ctx.setTransform(view);
  ctx.drawImage(image, 0, 0);
  if (saliencyImage && saliencyInput.checked) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(0, 0, image.naturalWidth, image.naturalHeight);
    ctx.globalCompositeOperation = "screen";
    ctx.drawImage(saliencyImage, 0, 0, image.naturalWidth, image.naturalHeight);
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.restore();
  // Before is the untouched photo (plus the subject marker); After is the crop with the rule's guides.
  const style = { opacity: 0.9, lineWidth: 1.5, px: dpr, color: GUIDE_COLOR };
  if (after && guidesInput.checked) {
    if (result.rule === "spiral") drawSpiral(ctx, view, targetSpiral(), { ...style, squares: true, eye: true });
    else drawGrids(ctx, view, crop, { ...style, phi: result.rule === "phi", thirds: result.rule === "thirds" });
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  marker(ctx, view, subject || result.subject, 9 * dpr, SUBJECT_COLOR);
  ctx.restore();
}
function updateInfo() {
  const chosen = RULE_NAMES[result.rule];
  const share = Math.round(((crop.w * crop.h) / (image.naturalWidth * image.naturalHeight)) * 100);
  const orient = Math.abs(crop.w - crop.h) < 2 ? "square" : crop.w > crop.h ? "landscape" : "portrait";
  cropInfo.textContent = `${ruleSelect.value === "auto" ? `Auto chose: ${chosen}` : chosen}. The crop is ${orient} and keeps ${share}% of the photo.`;
  subjectInfo.textContent = subject ? "Subject: where you clicked. Click again to move it." : "Subject: found automatically (pink circle). Click the photo to set it yourself.";
  $("reset-subject").disabled = !subject;
}
async function recompute() {
  if (!currentFile) return;
  const token = ++requestToken;
  const body = new FormData();
  body.append("file", currentFile);
  body.append("rule", ruleSelect.value);
  body.append("aspect", aspectSelect.value);
  if (subject) {
    body.append("subject_x", subject.x);
    body.append("subject_y", subject.y);
  }
  cropInfo.textContent = "Finding the best crop…";
  try {
    const res = await fetch("/api/golden-crop", { method: "POST", body });
    if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
    const data = await res.json();
    if (token !== requestToken) return;
    const sal = new Image();
    sal.src = data.saliency;
    await sal.decode();
    if (token !== requestToken) return;
    result = data;
    saliencyImage = sal;
    crop = { ...data.crop };
    for (const id of ["before-button", "after-button", "export-button"]) $(id).disabled = false;
    saliencyInput.disabled = false;
    updateInfo();
    resizeCanvas();
  } catch (err) {
    if (token === requestToken) cropInfo.textContent = `Crop failed: ${err.message}`;
  }
}
async function loadFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  const img = new Image();
  img.src = URL.createObjectURL(file);
  try {
    await img.decode();
  } catch {
    cropInfo.textContent = "Could not read that image.";
    return;
  }
  if (image) URL.revokeObjectURL(image.src);
  image = img;
  currentFile = file;
  fileName = file.name.replace(/\.[^.]+$/, "");
  subject = null;
  after = false;
  canvas.hidden = false;
  $("empty-state").hidden = true;
  await recompute();
  setView(true);
}
function toImage(e) {
  const r = canvas.getBoundingClientRect();
  const vb = viewBox();
  return { x: (e.clientX - r.left) / scale + vb.x, y: (e.clientY - r.top) / scale + vb.y };
}
function setView(isAfter) {
  after = isAfter;
  $("before-button").classList.toggle("primary", !after);
  $("after-button").classList.toggle("primary", after);
  resizeCanvas();
}
function exportPng() {
  if (!image || !crop) return;
  const out = document.createElement("canvas");
  out.width = Math.round(crop.w);
  out.height = Math.round(crop.h);
  out.getContext("2d").drawImage(image, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height);
  out.toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${fileName}-golden-crop.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, "image/png");
}
// A press without movement sets the subject; in After view a drag pans the photo inside the crop.
canvas.addEventListener("pointerdown", (e) => {
  if (!crop) return;
  canvas.setPointerCapture(e.pointerId);
  drag = { screen: { x: e.clientX, y: e.clientY }, crop: { ...crop }, moved: false };
});
canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.screen.x;
  const dy = e.clientY - drag.screen.y;
  if (Math.hypot(dx, dy) > DRAG_THRESHOLD) drag.moved = true;
  if (!drag.moved || !after) return;
  const c = drag.crop;
  crop = { ...c, x: Math.min(Math.max(0, c.x - dx / scale), image.naturalWidth - c.w), y: Math.min(Math.max(0, c.y - dy / scale), image.naturalHeight - c.h) };
  render();
});
canvas.addEventListener("pointerup", (e) => {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.moved) {
    updateInfo();
    return;
  }
  const p = toImage(e);
  subject = { x: p.x, y: p.y };
  recompute();
});
canvas.addEventListener("pointercancel", () => (drag = null));
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
ruleSelect.addEventListener("change", recompute);
aspectSelect.addEventListener("change", recompute);
$("reset-subject").addEventListener("click", () => {
  subject = null;
  recompute();
});
saliencyInput.addEventListener("change", render);
guidesInput.addEventListener("change", render);
$("before-button").addEventListener("click", () => setView(false));
$("after-button").addEventListener("click", () => setView(true));
$("export-button").addEventListener("click", exportPng);
new ResizeObserver(resizeCanvas).observe(stage);
