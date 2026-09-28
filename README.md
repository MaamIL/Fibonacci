# Fibonacci Fun

A just-for-fun local web app that looks for Fibonacci and golden-ratio structure in your photos: it traces golden and logarithmic spirals, overlays phi grids and the golden spiral for composition, crops photos so the subject sits on a golden point, and plays with the Fibonacci sequence.

Everything runs on your own computer. Photos are only sent to the local server at `http://127.0.0.1:8000`, never online.

![Find spirals: a nautilus shell traced as a logarithmic spiral with ratio 1.34](docs/images/golden-ratio-find.jpg)

## Features

### Golden Ratio: spiral overlays and spiral detection

- **Composition guides** over the whole photo: phi grid (0.382 / 0.618), rule of thirds, the golden spiral and its Fibonacci squares, with rotate and flip.
- **Frame modes**: fit a true golden rectangle inside the photo, stretch to the photo, or pad the photo out to exactly 1 : 1.618 (blurred, black or white borders).
- **Find spirals in image**: searches every position, size and angle for curves in the photo that follow a spiral.
  - **Golden** mode matches only the true golden spiral (it grows 1.618× every quarter turn).
  - **Any log spiral** mode also matches tighter or looser spirals and reports their growth ratio. Nautilus shells come out at about 1.3, the known value.
  - Each match shows a **fit %**: how much of the spiral runs along a matching edge in the photo. Random placements usually score under 40%.
- **Edit detections by hand**: drag, resize, rotate, flip, place your own spiral, and step through several found spirals.
- **Download PNG** of the photo with the overlays at full resolution.

![Composition spiral, Fibonacci squares and phi grid](docs/images/golden-ratio-composition.jpg)

![A golden spiral found in a golden-ratio frame, 96% fit](docs/images/golden-ratio-golden-match.jpg)

### Golden Crop: re-crop a photo by golden-ratio rules

- Finds the most eye-catching area of the photo automatically (a saliency map), or you click the subject yourself.
- Crops so the subject lands on a chosen point:
  - **Dramatic**: a phi-grid crossing.
  - **Interesting**: a rule-of-thirds crossing.
  - **Flowing**: the golden spiral's eye.
  - **Auto**: tries all three and keeps the best.
- Crop shapes: golden 1 : 1.618 (landscape or portrait), the photo's own shape, 1:1, 4:5, 3:2 and 16:9.
- Before / After views, and a full-resolution **Download cropped PNG**.

![Golden Crop: the snail placed on a phi-grid crossing](docs/images/golden-crop-after.jpg)

![Flowing crop: the spiral's eye on the fractal's center](docs/images/golden-crop-spiral.jpg)

### Sequence

Generates the first n Fibonacci numbers (up to 1000) and shows how the ratio of the last two approaches φ ≈ 1.6180339887.

![Fibonacci sequence page](docs/images/sequence.jpg)

## Quick start (Windows, PowerShell)

Requirements: Python 3.12, and Node.js (only for the Prettier formatter).

```powershell
py -3.12 -m venv .venv
.venv\Scripts\activate
pip install -r requirements-dev.txt
npm install
python -m app
```

`python -m app` starts the server and opens `http://127.0.0.1:8000` in your browser. For auto-reload while developing, use `uvicorn app.main:app --reload` instead.

## How it works (short version)

- **Spiral detection** (`app/vision/spiral_fit.py`):
  - The photo is turned into an edge-orientation field (a structure tensor at two scales).
  - A spiral template is scored by how well the edges under it run along the curve.
  - A coarse search over position, size, angle and mirror image is followed by a local refinement. In "any" mode, a line search over the growth rate also runs.
  - One spiral is kept per object.
- **Golden crop** (`app/vision/crop.py`):
  - Spectral-residual saliency finds the subject.
  - For each crop size, the subject is placed exactly on each target point of the rule.
  - Each crop is scored for placement, how much salient content it keeps, size, not slicing through salient areas at the edges, and keeping the subject whole.

More detail, with diagrams, is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Step-by-step usage is in the [User Manual](docs/USER_MANUAL.md).

## Project layout

```
app/
  main.py            FastAPI app: pages and /api routes
  __main__.py        python -m app: start server, open browser
  fib/sequence.py    pure Fibonacci math
  vision/
    spiral_fit.py    spiral detection (POST /api/find-spiral)
    crop.py          golden crop (POST /api/golden-crop)
  static/
    index.html       Golden Ratio page       js/overlay-app.js, js/spiral.js
    crop.html        Golden Crop page        js/crop-app.js
    sequence.html    Sequence page           js/sequence.js
    js/tooltip.js    shared ⓘ tooltips
    css/style.css    all styles
docs/                architecture, user manual, screenshots
IMGS/                sample photos
```

## Development

- Stack: Python 3.12, FastAPI + uvicorn, OpenCV (headless), NumPy, Pillow; vanilla HTML/CSS/JS with `<canvas>` and no build step.
- Lint: `ruff check .; ruff format --check .; npm run lint`
- Format: `ruff format .; ruff check --fix .; npm run format`
- Code style rules (no blank lines inside bodies, no wrapped statements, 200-character lines) are in [CLAUDE.md](CLAUDE.md).

## Known limitations

- **Small spirals:** Find reliably detects spirals that are large in the frame, about a quarter of the photo's height or more. At smaller sizes, ordinary texture matches the spiral as well as real spirals do, so small spirals (for example each tile of a collage) are not reported.
- **Flowers and cones:** sunflowers, pine cones and similar plants are families of many interleaved spirals, not one curve. They are not counted as spiral families.
- **Automatic crop subject:** the automatic subject guess can pick the wrong thing on busy photos. Click the real subject to fix it.

## Image credits

Screenshots use sample photos from `IMGS/`. Make sure you have the right to publish any photo you add there.
