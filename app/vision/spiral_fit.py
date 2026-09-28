import base64
from dataclasses import asdict, dataclass
import cv2
import numpy as np

PHI = (1 + 5**0.5) / 2
ANALYSIS_SIZE = 480
ARC_COUNT = 8
SAMPLES_PER_ARC = 48
SCALE_STEPS = 9
MIN_SCALE_FRACTION = 0.35
GRID_DIVISIONS = 45
# Spirals may hang off the frame by this fraction of their box, as long as MIN_COVERAGE of the (weighted) curve stays visible.
OVERHANG = 0.2
MIN_COVERAGE = 0.6
REFINE_KEEP = 30
REFINE_ROUNDS = 10
COARSE_MAX_OVERLAP = 0.8
FINAL_MAX_OVERLAP = 0.6
BASELINE_PERCENTILE = 99
# A golden spiral contains smaller copies of itself; this nudges ties toward the outermost one (about 5% per 1/PHI step).
SIZE_PREFERENCE = 0.1


@dataclass
class Match:
    rotation: int
    flip: bool
    x: float
    y: float
    w: float
    h: float
    score: float
    fit: float


def golden_arcs(count: int) -> list[tuple[float, float, float, float, float]]:
    # Mirrors goldenSteps() in static/js/spiral.js so server matches line up with the drawn overlay.
    x, y, w, h = 0.0, 0.0, PHI, 1.0
    arcs = []
    for i in range(count):
        s = min(w, h)
        side = i % 4
        if side == 0:
            arcs.append((x + s, y + s, s, np.pi, 1.5 * np.pi))
            x, w = x + s, w - s
        elif side == 1:
            arcs.append((x, y + s, s, 1.5 * np.pi, 2 * np.pi))
            y, h = y + s, h - s
        elif side == 2:
            arcs.append((x + w - s, y, s, 0.0, 0.5 * np.pi))
            w = w - s
        else:
            arcs.append((x + s, y + h - s, s, 0.5 * np.pi, np.pi))
            h = h - s
    return arcs


def spiral_template() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    points, normals, weights = [], [], []
    for cx, cy, r, a0, a1 in golden_arcs(ARC_COUNT):
        a = np.linspace(a0, a1, SAMPLES_PER_ARC, endpoint=False) + (a1 - a0) / (2 * SAMPLES_PER_ARC)
        points.append(np.stack([cx + r * np.cos(a), cy + r * np.sin(a)], axis=1))
        normals.append(np.stack([np.cos(a), np.sin(a)], axis=1))
        # sqrt(r) keeps the long outer arcs dominant without letting the inner arcs vanish.
        weights.append(np.full(SAMPLES_PER_ARC, np.sqrt(r)))
    p = np.concatenate(points) - np.array([PHI / 2, 0.5])
    w = np.concatenate(weights)
    return p, np.concatenate(normals), w / w.sum()


TEMPLATE = spiral_template()


def orient(v: np.ndarray, rotation: int, flip: bool) -> np.ndarray:
    v = v * np.array([-1.0 if flip else 1.0, 1.0])
    c, s = np.cos(rotation * np.pi / 2), np.sin(rotation * np.pi / 2)
    return np.stack([v[:, 0] * c - v[:, 1] * s, v[:, 0] * s + v[:, 1] * c], axis=1)


def orientation_field(gray: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    g = cv2.GaussianBlur(gray.astype(np.float32), (0, 0), 1.2)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    jxx = cv2.GaussianBlur(gx * gx, (0, 0), 3)
    jxy = cv2.GaussianBlur(gx * gy, (0, 0), 3)
    jyy = cv2.GaussianBlur(gy * gy, (0, 0), 3)
    # n·J·n − t·J·t = cos2θ·(Jxx−Jyy) + sin2θ·2Jxy: positive only where edges run along the curve, zero for isotropic texture.
    a = jxx - jyy
    b = 2 * jxy
    mag = np.sqrt(a * a + b * b)
    norm = float(np.percentile(mag, 95)) + 1e-6
    return a / norm, b / norm, np.clip(mag / norm, 0, 1)


class SpiralScorer:
    def __init__(self, a: np.ndarray, b: np.ndarray):
        self.a = a
        self.b = b
        self.h, self.w = a.shape
        self.oriented = {}
        for rotation in range(4):
            for flip in (False, True):
                n = orient(TEMPLATE[1], rotation, flip)
                self.oriented[rotation, flip] = (orient(TEMPLATE[0], rotation, flip), n[:, 0] ** 2 - n[:, 1] ** 2, 2 * n[:, 0] * n[:, 1])

    def score(self, rotation: int, flip: bool, cx: np.ndarray, cy: np.ndarray, s: np.ndarray) -> np.ndarray:
        offsets, cos2, sin2 = self.oriented[rotation, flip]
        px = cx[:, None] + s[:, None] * offsets[None, :, 0]
        py = cy[:, None] + s[:, None] * offsets[None, :, 1]
        inside = (px >= 0) & (px <= self.w - 1) & (py >= 0) & (py <= self.h - 1)
        ix = np.clip(np.rint(px).astype(np.int32), 0, self.w - 1)
        iy = np.clip(np.rint(py).astype(np.int32), 0, self.h - 1)
        along = cos2[None, :] * self.a[iy, ix] + sin2[None, :] * self.b[iy, ix]
        coverage = inside @ TEMPLATE[2]
        return ((np.sqrt(np.clip(along, 0, 1)) * inside) @ TEMPLATE[2]) / np.maximum(coverage, MIN_COVERAGE)


def box_size(rotation: int, s: float) -> tuple[float, float]:
    return (PHI * s, s) if rotation % 2 == 0 else (s, PHI * s)


def overlap(m1: tuple, m2: tuple) -> float:
    w1, h1 = box_size(m1[1], m1[5])
    w2, h2 = box_size(m2[1], m2[5])
    ix = max(0.0, min(m1[3] + w1 / 2, m2[3] + w2 / 2) - max(m1[3] - w1 / 2, m2[3] - w2 / 2))
    iy = max(0.0, min(m1[4] + h1 / 2, m2[4] + h2 / 2) - max(m1[4] - h1 / 2, m2[4] - h2 / 2))
    inter = ix * iy
    return inter / (w1 * h1 + w2 * h2 - inter)


def suppress(candidates: list[tuple], keep: int, max_overlap: float, per_orientation: bool, rank=lambda c: c[0]) -> list[tuple]:
    kept = []
    for c in sorted(candidates, key=lambda c: -rank(c)):
        if not any((not per_orientation or k[1:3] == c[1:3]) and overlap(k, c) > max_overlap for k in kept):
            kept.append(c)
        if len(kept) >= keep:
            break
    return kept


def coarse_search(scorer: SpiralScorer) -> tuple[list[tuple], float]:
    step = max(scorer.w, scorer.h) / GRID_DIVISIONS
    candidates = []
    all_scores = []
    for rotation, flip in scorer.oriented:
        uw, uh = box_size(rotation, 1.0)
        s_max = min(scorer.w / uw, scorer.h / uh)
        for s in np.geomspace(MIN_SCALE_FRACTION * s_max, (1 + OVERHANG) * s_max, SCALE_STEPS):
            bw, bh = uw * s, uh * s
            xs = np.arange(bw * (0.5 - OVERHANG), scorer.w - bw * (0.5 - OVERHANG) + 1e-6, step)
            ys = np.arange(bh * (0.5 - OVERHANG), scorer.h - bh * (0.5 - OVERHANG) + 1e-6, step)
            xs = xs if xs.size else np.array([scorer.w / 2])
            ys = ys if ys.size else np.array([scorer.h / 2])
            gx, gy = np.meshgrid(xs, ys)
            cx, cy = gx.ravel(), gy.ravel()
            scores = scorer.score(rotation, flip, cx, cy, np.full(cx.shape, s))
            all_scores.append(scores)
            best = np.argsort(-scores)[:REFINE_KEEP]
            candidates.extend((float(scores[i]), rotation, flip, float(cx[i]), float(cy[i]), float(s)) for i in best)
    return suppress(candidates, REFINE_KEEP, COARSE_MAX_OVERLAP, per_orientation=True), float(np.percentile(np.concatenate(all_scores), BASELINE_PERCENTILE))


def refine(scorer: SpiralScorer, c: tuple, step: float) -> tuple:
    score, rotation, flip, cx, cy, s = c
    ds = 1.06
    d = np.array([-1.0, 0.0, 1.0])
    ox, oy, os_ = (v.ravel() for v in np.meshgrid(d, d, d))
    for _ in range(REFINE_ROUNDS):
        xs, ys, ss = cx + ox * step, cy + oy * step, s * ds**os_
        scores = scorer.score(rotation, flip, xs, ys, ss)
        i = int(np.argmax(scores))
        if scores[i] > score:
            score, cx, cy, s = float(scores[i]), float(xs[i]), float(ys[i]), float(ss[i])
        else:
            step, ds = step / 2, ds**0.5
    return score, rotation, flip, cx, cy, s


def encode_png(img: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", img)
    return "data:image/png;base64," + base64.b64encode(buf.tobytes()).decode("ascii")


def find_spirals(gray: np.ndarray, top: int = 5) -> dict:
    h0, w0 = gray.shape
    f = min(1.0, ANALYSIS_SIZE / max(h0, w0))
    small = cv2.resize(gray, (max(1, round(w0 * f)), max(1, round(h0 * f))), interpolation=cv2.INTER_AREA)
    f_x, f_y = small.shape[1] / w0, small.shape[0] / h0
    a, b, edges = orientation_field(small)
    scorer = SpiralScorer(a, b)
    step = max(scorer.w, scorer.h) / GRID_DIVISIONS
    coarse, baseline = coarse_search(scorer)
    refined = [refine(scorer, c, step / 2) for c in coarse]
    matches = []
    for score, rotation, flip, cx, cy, s in suppress(refined, top, FINAL_MAX_OVERLAP, per_orientation=False, rank=lambda c: c[0] * c[5] ** SIZE_PREFERENCE):
        bw, bh = box_size(rotation, s)
        # Fit is measured against the top 1% of chance placements in this same image, so busy textures do not look like perfect matches.
        fit = max(0.0, (score - baseline) / (1 - baseline + 1e-6))
        matches.append(asdict(Match(rotation, flip, (cx - bw / 2) / f_x, (cy - bh / 2) / f_y, bw / f_x, bh / f_y, round(score, 4), round(fit, 4))))
    return {"width": w0, "height": h0, "matches": matches, "edges": encode_png((edges * 255).astype(np.uint8))}
