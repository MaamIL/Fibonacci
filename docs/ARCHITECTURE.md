# Architecture

Fibonacci Fun is a small local web app. A FastAPI server serves three static pages and two image-analysis endpoints. All drawing and editing happens in the browser on a `<canvas>`, and the server only does the heavy image analysis.

## System architecture

```mermaid
flowchart LR
  subgraph Browser["Browser (http://127.0.0.1:8000)"]
    GR["Golden Ratio page<br/>index.html"]
    GC["Golden Crop page<br/>crop.html"]
    SQ["Sequence page<br/>sequence.html"]
  end
  subgraph Server["FastAPI server (app/main.py, uvicorn)"]
    Static["Static files<br/>/static/*"]
    Pages["Page routes<br/>/ · /crop · /sequence"]
    API1["POST /api/find-spiral"]
    API2["POST /api/golden-crop"]
    API3["GET /api/sequence"]
  end
  subgraph Core["Python analysis modules"]
    SF["vision/spiral_fit.py<br/>spiral detection"]
    CR["vision/crop.py<br/>saliency + golden crop"]
    FS["fib/sequence.py<br/>Fibonacci numbers"]
  end
  GR -- "photo + mode" --> API1
  GC -- "photo + rule + shape + subject" --> API2
  SQ -- "n" --> API3
  Browser -- "HTML / JS / CSS" --> Pages
  Browser --> Static
  API1 --> SF
  API2 --> CR
  CR -- "reuses golden_eye, encode_png" --> SF
  API3 --> FS
```

- The photo never leaves the machine. The browser uploads it to the local server for each analysis, and the server keeps nothing between requests.
- Pages are plain ES modules with no build step; `python -m app` (`app/__main__.py`) starts uvicorn and opens the browser.

## Components

```mermaid
flowchart TB
  subgraph Frontend["app/static"]
    direction TB
    IDX["index.html"] --> OA["js/overlay-app.js<br/>state, canvas, drag / resize,<br/>selection, API calls, export"]
    OA --> SP["js/spiral.js<br/>golden arcs, log spiral,<br/>localMatrix, drawGrids, drawSpiral"]
    CRH["crop.html"] --> CA["js/crop-app.js<br/>crop state, before / after,<br/>subject clicks, pan, export"]
    CA --> SP
    SEQH["sequence.html"] --> SJ["js/sequence.js"]
    IDX --> TT["js/tooltip.js<br/>shared ⓘ tooltips"]
    CRH --> TT
    CSS["css/style.css"]
  end
  subgraph Backend["app"]
    direction TB
    MAIN["main.py<br/>routes, upload decoding<br/>(EXIF orientation)"]
    MAIN --> SFB["vision/spiral_fit.py"]
    MAIN --> CRB["vision/crop.py"]
    MAIN --> FIB["fib/sequence.py"]
    CRB --> SFB
  end
  OA -. "fetch /api/find-spiral" .-> MAIN
  CA -. "fetch /api/golden-crop" .-> MAIN
  SJ -. "fetch /api/sequence" .-> MAIN
```

| Component                  | Responsibility                                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/main.py`              | FastAPI app, page routes, API routes, image decoding with `ImageOps.exif_transpose` so server coordinates match what the browser draws.                                |
| `app/vision/spiral_fit.py` | Edge-orientation field, golden and log spiral templates, coarse search, refinement, fit %, one-spiral-per-object selection.                                            |
| `app/vision/crop.py`       | Spectral-residual saliency, subject detection, rule target points, crop search and scoring.                                                                            |
| `app/fib/sequence.py`      | Pure Fibonacci sequence function.                                                                                                                                      |
| `static/js/spiral.js`      | Shared geometry and drawing. It mirrors the Python templates (`goldenSteps` ↔ `golden_arcs`, `logSpiral` ↔ `log_spiral`) so server matches line up with what is drawn. |
| `static/js/overlay-app.js` | Golden Ratio page: composition layer, list of detected spirals and the selected one, hit testing, drag / resize / rotate / flip, padding, PNG export.                  |
| `static/js/crop-app.js`    | Golden Crop page: requests, before / after views, guides, subject clicks, panning the crop, cropped PNG export.                                                        |
| `static/js/tooltip.js`     | One floating tooltip for every `[data-tip]` element (hover, focus, tap).                                                                                               |

### Spiral model (shared by server and browser)

A spiral is `{ cx, cy, w, h, angle, flip, growth }`: an unrotated `w × h` box around its center, turned by `angle` degrees and optionally mirrored. `growth` is `null` for the golden arc spiral, or the growth per quarter turn for a log spiral. Both sides draw the curve in the same unit frame (`aspect × 1`, starting where the golden arcs start), so a match from the server lands exactly on the drawn overlay.

## Flow: Find spirals

```mermaid
sequenceDiagram
  actor U as User
  participant P as overlay-app.js
  participant S as FastAPI /api/find-spiral
  participant F as spiral_fit.find_spirals
  U->>P: Choose image, pick Spiral type, click Find
  P->>S: POST file + mode (golden | any)
  S->>S: decode, EXIF-rotate, convert to grayscale
  S->>F: find_spirals(gray, mode)
  F-->>S: matches [cx, cy, w, h, angle, flip, growth, fit] + edge map
  S-->>P: JSON
  P->>P: store detections, select best, draw all
  U->>P: click / drag / resize / rotate / flip / ◀ ▶
  P->>P: update selected spiral, redraw
  U->>P: Download PNG
  P->>P: redraw at full resolution, save file
```

## Algorithm: spiral detection

```mermaid
flowchart TD
  A["Grayscale photo"] --> B["Resize: 240 px (coarse) and 480 px (fine)"]
  B --> C["Orientation field at 2 scales<br/>structure tensor → how strongly edges run<br/>in each direction at each pixel"]
  C --> D{"Mode"}
  D -- "golden" --> E1["Golden arc template<br/>(8 quarter arcs)"]
  D -- "any" --> E2["Log spiral templates<br/>growth 1.3, φ, 2.0"]
  E1 --> F["Coarse search on 240 px<br/>30×30 positions × 8 sizes × 24 angles × 2 mirrors"]
  E2 --> F
  F --> G["Keep 40 best, spread out<br/>(overlap suppression)"]
  G --> H["Refine on 480 px<br/>position, size, angle (halving steps)"]
  H --> H2{"any mode?"}
  H2 -- "yes" --> I["Line search on growth rate,<br/>then refine again"]
  H2 -- "no" --> J
  I --> J["Fit % = share of the curve on a<br/>matching, correctly oriented edge"]
  J --> K["Pick one spiral per object:<br/>best always; others ≥ 55%, within 10 points of best,<br/>above chance, not overlapping a better one"]
  K --> L["Matches sorted best first + edge map PNG"]
```

- **Score** (used for searching): the average of √(edge strength along the curve's direction), weighted toward the long outer arcs. Only the part of the curve that lies inside the photo counts, and at least 60% must be inside.
- **Fit %** (shown to the user): the weighted share of the curve that has a supporting edge. On the sample photos, random placements score a median of about 6–23%.

## Flow: Golden crop

```mermaid
sequenceDiagram
  actor U as User
  participant P as crop-app.js
  participant S as FastAPI /api/golden-crop
  participant C as crop.golden_crop
  U->>P: Choose image
  P->>S: POST file + rule + aspect (+ subject_x, subject_y)
  S->>C: golden_crop(rgb, rule, aspect, subject)
  C-->>S: crop box, rule used, target, subject, scores, saliency PNG
  S-->>P: JSON
  P->>P: show After view with guides
  U->>P: change Definition / Shape, or click a new subject
  P->>S: POST again (recompute)
  U->>P: drag in After view
  P->>P: pan crop locally (no request)
  U->>P: Download cropped PNG
  P->>P: cut crop from the original at full resolution
```

## Algorithm: golden crop

```mermaid
flowchart TD
  A["RGB photo"] --> B["Spectral-residual saliency on a 64 px copy<br/>(Lab channels) + mild center bias → 480 px map"]
  B --> C{"Subject given?"}
  C -- "no" --> D["Top 8% salient pixels → largest blob<br/>→ weighted centroid + box"]
  C -- "yes (click)" --> E["Clicked point + small box"]
  D --> F
  E --> F["Target points for the rule<br/>phi: 0.382 / 0.618 · thirds: 1/3 / 2/3 · spiral: golden eye ≈ 0.724 / 0.276"]
  F --> G["For each shape (golden tries landscape + portrait)<br/>and 12 crop sizes (100% → 50%)<br/>and each target: place subject exactly on target,<br/>slide back inside the photo"]
  G --> H["Score = placement + saliency kept + size<br/>− saliency cut at the border − subject outside"]
  H --> I{"Rule = auto?"}
  I -- "yes" --> J["Best of phi, thirds, spiral"]
  I -- "no" --> K["Best crop for that rule"]
  J --> L["Crop box, rule used, target, subject, saliency PNG"]
  K --> L
```

## Page state: detected spirals (Golden Ratio page)

```mermaid
stateDiagram-v2
  [*] --> NoImage
  NoImage --> ImageLoaded: choose or drop photo
  ImageLoaded --> Searching: Find spirals
  Searching --> Detections: matches returned
  Searching --> ImageLoaded: no spiral found / error
  ImageLoaded --> Detections: Place manually
  Detections --> Detections: select (click, ◀ ▶, [ ])<br/>move, resize, rotate, flip
  Detections --> Detections: Place manually (adds one)
  Detections --> ImageLoaded: Remove last spiral
  Detections --> Searching: Find again (manual spirals kept)
  ImageLoaded --> ImageLoaded: new photo resets everything
  Detections --> ImageLoaded: new photo
```

## Design choices

- **No build step, no frameworks.** Vanilla ES modules and one stylesheet keep the app small and easy to run.
- **Analysis on the server, drawing in the browser.** NumPy and OpenCV do the heavy search, and the canvas handles smooth interaction and exports at any resolution.
- **Shared geometry.** The spiral templates are defined identically in Python and JavaScript, which lets the server return compact parameters instead of drawings.
- **Honest scores.** Fit % is an absolute measure checked against random placements, so a "strong" match is meaningfully better than chance.
- **No extra dependencies.** Saliency is implemented in NumPy because `cv2.saliency` is not part of `opencv-python-headless`.
