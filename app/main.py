import mimetypes
from pathlib import Path
from typing import Annotated, Literal
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError
from app.fib.sequence import fibonacci
from app.vision.crop import golden_crop
from app.vision.spiral_fit import find_spirals

# The Windows registry may map .js to text/plain, which browsers reject for ES modules.
mimetypes.add_type("text/javascript", ".js")
STATIC_DIR = Path(__file__).parent / "static"
ImageFile = Annotated[UploadFile, File()]
RuleField = Annotated[Literal["auto", "phi", "thirds", "spiral"], Form()]
AspectField = Annotated[Literal["golden", "original", "1:1", "4:5", "3:2", "16:9"], Form()]
FloatField = Annotated[float | None, Form()]
app = FastAPI(title="Fibonacci Fun")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/crop")
def crop_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "crop.html")


@app.get("/sequence")
def sequence_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "sequence.html")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/sequence")
def sequence(n: int = Query(10, ge=1, le=1000)) -> dict:
    return {"n": n, "sequence": fibonacci(n)}


@app.post("/api/find-spiral")
def find_spiral(file: Annotated[UploadFile, File()], mode: Annotated[Literal["golden", "any"], Form()] = "golden") -> dict:
    try:
        # exif_transpose matches the orientation browsers use when drawing the image, so coordinates line up.
        img = ImageOps.exif_transpose(Image.open(file.file)).convert("L")
    except (UnidentifiedImageError, OSError) as e:
        raise HTTPException(status_code=400, detail="Could not read that image.") from e
    return find_spirals(np.asarray(img), mode=mode)


@app.post("/api/golden-crop")
def golden_crop_route(file: ImageFile, rule: RuleField = "auto", aspect: AspectField = "golden", subject_x: FloatField = None, subject_y: FloatField = None) -> dict:
    try:
        img = ImageOps.exif_transpose(Image.open(file.file)).convert("RGB")
    except (UnidentifiedImageError, OSError) as e:
        raise HTTPException(status_code=400, detail="Could not read that image.") from e
    subject = (subject_x, subject_y) if subject_x is not None and subject_y is not None else None
    return golden_crop(np.asarray(img), rule=rule, aspect=aspect, subject=subject)
