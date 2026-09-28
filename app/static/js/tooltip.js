// One shared tooltip for every [data-tip] element; it is fixed-positioned so the scrolling side panel cannot clip it.
const tip = document.createElement("div");
tip.className = "tooltip";
tip.setAttribute("role", "tooltip");
tip.hidden = true;
document.body.append(tip);
const GAP = 8;
function show(el) {
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  const r = el.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  const left = r.right + GAP + t.width <= window.innerWidth - GAP ? r.right + GAP : Math.max(GAP, r.left - GAP - t.width);
  const top = Math.min(Math.max(GAP, r.top + r.height / 2 - t.height / 2), window.innerHeight - t.height - GAP);
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}
function hide() {
  tip.hidden = true;
}
const target = (e) => e.target.closest?.("[data-tip]");
document.addEventListener("pointerover", (e) => {
  if (target(e)) show(target(e));
});
document.addEventListener("pointerout", (e) => {
  if (target(e)) hide();
});
document.addEventListener("focusin", (e) => {
  if (target(e)) show(target(e));
});
document.addEventListener("focusout", hide);
// Icons sit inside <label>s: stop the click from toggling the control, and show the tip for touch users.
document.addEventListener("click", (e) => {
  if (!target(e)) return;
  e.preventDefault();
  show(target(e));
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hide();
});
window.addEventListener("scroll", hide, true);
