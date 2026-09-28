from pathlib import Path
from fastapi import FastAPI, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from app.fib.sequence import fibonacci

STATIC_DIR = Path(__file__).parent / "static"
app = FastAPI(title="Fibonacci Fun")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/sequence")
def sequence(n: int = Query(10, ge=1, le=1000)) -> dict:
    return {"n": n, "sequence": fibonacci(n)}
