# Fibonacci Fun

## Goal

A just-for-fun local web app: upload an image and find/trace Fibonacci and golden-ratio structure in it (golden spiral and phi-grid overlays, auto spiral fitting, phyllotaxis spiral counting, golden-ratio crop), plus Fibonacci number toys (sequence explorer, Zeckendorf, Pisano periods, phyllotaxis generator).

## Stack

- Python 3.12, pip, project virtualenv in `.venv`
- Backend: FastAPI + uvicorn, python-multipart (uploads)
- Image processing: opencv-python-headless, numpy, Pillow
- Frontend: vanilla HTML/CSS/JS + `<canvas>`, no build step, served from `app/static`
- Style tools: Ruff (Python format + lint), Prettier (HTML/CSS/JS/JSON/MD)
- Runs on Windows, locally at http://127.0.0.1:8000

## Layout

- `app/main.py` FastAPI app and routes (`/`, `/api/*`)
- `app/__main__.py` entry point: `python -m app` starts the server and opens the browser
- `app/fib/` pure Fibonacci math, no I/O
- `app/vision/` (future) OpenCV code: spiral fit, phyllotaxis, golden crop
- `app/static/` frontend: `index.html`, `css/`, `js/`

## Commands (PowerShell, from project root)

- Install: `py -3.12 -m venv .venv; .venv\Scripts\activate; pip install -r requirements-dev.txt; npm install`
- Run: `python -m app` (or `uvicorn app.main:app --reload` for auto-reload)
- Test: none yet
- Lint: `ruff check .; ruff format --check .; npm run lint`
- Format: `ruff format .; ruff check --fix .; npm run format`

## Code style (strict, applies to every file)

- No blank lines unless syntactically required or separating top-level definitions where the language/formatter requires it (Ruff/PEP 8 requires 2 blank lines between top-level Python definitions; that is the only allowed exception). Formatters cannot remove blank lines inside bodies, so never write them.
- Minimal comments, only where logic is non-obvious. All comments in English.
- Never wrap a statement across multiple lines. Long lines are fine. Line length limit is 200 (Ruff `line-length = 200`, Prettier `printWidth: 200`).
- Naming: language defaults. Python: `snake_case` functions/variables/modules, `PascalCase` classes, `UPPER_CASE` constants. JS: `camelCase` variables/functions, `PascalCase` classes. CSS: `kebab-case` classes and ids.
- Run the Format and Lint commands after editing; both must be clean.
