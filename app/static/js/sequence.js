const form = document.getElementById("seq-form");
const nInput = document.getElementById("n-input");
const sequenceEl = document.getElementById("sequence");
const ratioEl = document.getElementById("ratio");
async function loadSequence(n) {
  const res = await fetch(`/api/sequence?n=${n}`);
  if (!res.ok) {
    sequenceEl.textContent = "Please enter a number between 1 and 1000.";
    ratioEl.textContent = "";
    return;
  }
  const data = await res.json();
  const seq = data.sequence;
  sequenceEl.textContent = seq.join(", ");
  ratioEl.textContent = seq.length > 2 ? `F(${seq.length - 1}) / F(${seq.length - 2}) = ${(seq.at(-1) / seq.at(-2)).toFixed(10)} (φ ≈ 1.6180339887)` : "";
}
form.addEventListener("submit", (e) => {
  e.preventDefault();
  loadSequence(nInput.value);
});
loadSequence(nInput.value);
