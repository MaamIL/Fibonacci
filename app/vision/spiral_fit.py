import base64
from dataclasses import asdict, dataclass
import cv2
import numpy as np

PHI = (1 + 5**0.5) / 2
ANALYSIS_SIZE = 480
COARSE_SIZE = 240
ARC_COUNT = 8
SAMPLES_PER_QUARTER = 24
COARSE_SAMPLES_PER_QUARTER = 12
SCALE_STEPS = 8
MIN_SCALE_FRACTION = 0.3
GRID_DIVISIONS = 30
ANGLE_STEPS = 24
GROWTHS = (1.3, PHI, 2.0)
GROWTH_RANGE = (1.15, 2.6)
# Spirals may hang off the frame as long as MIN_COVERAGE of the (weighted) curve stays visible.
MAX_SCALE = 1.2
MIN_COVERAGE = 0.6
# A curve sample counts as "on an edge" for the fit % when its aligned edge strength is at least this.
SUPPORT = 0.12
REFINE_KEEP = 40
REFINE_ROUNDS = 12
COARSE_MAX_OVERLAP = 0.7
BASELINE_PERCENTILE = 99
# Returned spirals are one per object: fit at least MIN_FIT, not far below the best, and apart from every better one (centers apart, little overlap).
MIN_FIT = 0.55
DISTINCT_DROP = 0.1
DISTINCT_OVERLAP = 0.1
DISTINCT_SPACING = 1.0
MAX_SPIRALS = 6


@dataclass
class Match:
    cx: float
    cy: float
    w: float
    h: float
    angle: float
    flip: bool
    growth: float | None
    score: float
    fit: float


@dataclass
class Shape:
    points: np.ndarray
    normals: np.ndarray
    weights: np.ndarray
    aspect: float


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


def golden_eye() -> tuple[float, float]:
    x, y, w, h = 0.0, 0.0, PHI, 1.0
    for i in range(60):
        s = min(w, h)
        side = i % 4
        if side == 0:
            x, w = x + s, w - s
        elif side == 1:
            y, h = y + s, h - s
        elif side == 2:
            w = w - s
        else:
            h = h - s
    return x + w / 2, y + h / 2


def log_spiral(growth: float, samples_per_quarter: int, quarters: int = ARC_COUNT) -> tuple[np.ndarray, np.ndarray, float]:
    # Mirrors logSpiral() in static/js/spiral.js: starts where the golden arcs start, winds the same way, normalized to a box of height 1 (set by the outer turn).
    ex, ey = golden_eye()
    theta0 = np.arctan2(1 - ey, -ex)
    t = np.linspace(0, quarters * np.pi / 2, quarters * samples_per_quarter + 1)
    r = growth ** (-t / (np.pi / 2))
    p = np.stack([r * np.cos(theta0 + t), r * np.sin(theta0 + t)], axis=1)
    lo, hi = p.min(axis=0), p.max(axis=0)
    height = hi[1] - lo[1]
    return (p - lo) / height, r / height, (hi[0] - lo[0]) / height


def golden_shape(samples: int = SAMPLES_PER_QUARTER) -> Shape:
    points, normals, weights = [], [], []
    for cx, cy, r, a0, a1 in golden_arcs(ARC_COUNT):
        a = np.linspace(a0, a1, samples, endpoint=False) + (a1 - a0) / (2 * samples)
        points.append(np.stack([cx + r * np.cos(a), cy + r * np.sin(a)], axis=1))
        normals.append(np.stack([np.cos(a), np.sin(a)], axis=1))
        # sqrt(r) keeps the long outer arcs dominant without letting the inner arcs vanish.
        weights.append(np.full(samples, np.sqrt(r)))
    w = np.concatenate(weights)
    return Shape(np.concatenate(points) - np.array([PHI / 2, 0.5]), np.concatenate(normals), w / w.sum(), PHI)


def log_shape(growth: float, samples: int = SAMPLES_PER_QUARTER) -> Shape:
    # Every growth rate is scored over the same number of quarter turns, so loose spirals do not win just by having less curve to match.
    p, r, aspect = log_spiral(growth, samples)
    tangent = np.gradient(p, axis=0)
    tangent /= np.linalg.norm(tangent, axis=1, keepdims=True)
    w = np.sqrt(r)
    return Shape(p - np.array([aspect / 2, 0.5]), np.stack([-tangent[:, 1], tangent[:, 0]], axis=1), w / w.sum(), aspect)


def orientation_field(gray: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    g = gray.astype(np.float32)
    a = np.zeros(g.shape, np.float32)
    b = np.zeros(g.shape, np.float32)
    # Two scales so both thin outlines and broad shading bands register.
    for sigma, window in ((1.2, 3), (2.5, 5)):
        s = cv2.GaussianBlur(g, (0, 0), sigma)
        gx = cv2.Sobel(s, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(s, cv2.CV_32F, 0, 1, ksize=3)
        # n·J·n − t·J·t = cos2θ·(Jxx−Jyy) + sin2θ·2Jxy: positive only where edges run along the curve, zero for isotropic texture.
        sa = cv2.GaussianBlur(gx * gx - gy * gy, (0, 0), window)
        sb = cv2.GaussianBlur(2 * gx * gy, (0, 0), window)
        norm = float(np.percentile(np.sqrt(sa * sa + sb * sb), 95)) + 1e-6
        a += sa / norm
        b += sb / norm
    mag = np.sqrt(a * a + b * b)
    norm = float(np.percentile(mag, 95)) + 1e-6
    return a / norm, b / norm, np.clip(mag / norm, 0, 1)


class SpiralScorer:
    def __init__(self, gray: np.ndarray):
        self.a, self.b, self.edges = orientation_field(gray)
        self.h, self.w = self.a.shape

    def along(self, shape: Shape, flip: bool, cx: np.ndarray, cy: np.ndarray, s: np.ndarray, angle: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        fx = -1.0 if flip else 1.0
        ox, oy = shape.points[:, 0] * fx, shape.points[:, 1]
        c, sn = np.cos(angle)[:, None], np.sin(angle)[:, None]
        px = cx[:, None] + s[:, None] * (ox[None, :] * c - oy[None, :] * sn)
        py = cy[:, None] + s[:, None] * (ox[None, :] * sn + oy[None, :] * c)
        inside = (px >= 0) & (px <= self.w - 1) & (py >= 0) & (py <= self.h - 1)
        ix = np.clip(np.rint(px).astype(np.int32), 0, self.w - 1)
        iy = np.clip(np.rint(py).astype(np.int32), 0, self.h - 1)
        nx, ny = shape.normals[:, 0] * fx, shape.normals[:, 1]
        cos2, sin2 = nx * nx - ny * ny, 2 * nx * ny
        c2, s2 = np.cos(2 * angle)[:, None], np.sin(2 * angle)[:, None]
        along = (cos2[None, :] * c2 - sin2[None, :] * s2) * self.a[iy, ix] + (sin2[None, :] * c2 + cos2[None, :] * s2) * self.b[iy, ix]
        return np.clip(along, 0, 1), inside

    def score(self, shape: Shape, flip: bool, cx, cy, s, angle) -> np.ndarray:
        along, inside = self.along(shape, flip, cx, cy, s, angle)
        coverage = inside @ shape.weights
        return ((np.sqrt(along) * inside) @ shape.weights) / np.maximum(coverage, MIN_COVERAGE)

    def fit(self, shape: Shape, flip: bool, cx: float, cy: float, s: float, angle: float) -> float:
        along, inside = self.along(shape, flip, np.array([cx]), np.array([cy]), np.array([s]), np.array([angle]))
        coverage = inside @ shape.weights
        return float((((along >= SUPPORT) & inside) @ shape.weights / np.maximum(coverage, MIN_COVERAGE))[0])


def radius(shape: Shape, s: float) -> float:
    return 0.5 * s * np.hypot(shape.aspect, 1)


def overlap(m1: tuple, m2: tuple, shapes: dict) -> float:
    # Compares the circles around each candidate: cheap, rotation-proof, good enough for suppression.
    r1, r2 = radius(shapes[m1[1]], m1[5]), radius(shapes[m2[1]], m2[5])
    d = np.hypot(m1[3] - m2[3], m1[4] - m2[4])
    if d >= r1 + r2:
        return 0.0
    if d <= abs(r1 - r2):
        return min(r1, r2) ** 2 / max(r1, r2) ** 2
    a1 = r1 * r1 * np.arccos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1))
    a2 = r2 * r2 * np.arccos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2))
    inter = a1 + a2 - 0.5 * np.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2))
    return inter / (np.pi * (r1 * r1 + r2 * r2) - inter)


def suppress(candidates: list[tuple], shapes: dict, keep: int, max_overlap: float, rank=lambda c: c[0]) -> list[tuple]:
    kept = []
    for c in sorted(candidates, key=lambda c: -rank(c)):
        if not any(overlap(k, c, shapes) > max_overlap for k in kept):
            kept.append(c)
        if len(kept) >= keep:
            break
    return kept


# Candidates are (score, growth, flip, cx, cy, s, angle) in analysis-size pixels; growth None means the golden arc template.
def coarse_search(scorer: SpiralScorer, shapes: dict, k: float) -> tuple[list[tuple], float]:
    step = max(scorer.w, scorer.h) / GRID_DIVISIONS
    angles = np.arange(ANGLE_STEPS) * 2 * np.pi / ANGLE_STEPS
    candidates, all_scores = [], []
    for growth, shape in shapes.items():
        s_max = min(scorer.w, scorer.h) / (np.hypot(shape.aspect, 1) * 0.5 + 0.5) * MAX_SCALE
        for s in np.geomspace(MIN_SCALE_FRACTION * s_max, s_max, SCALE_STEPS):
            margin = max(0.0, 0.5 * s - step)
            xs = np.arange(min(margin, scorer.w / 2), max(scorer.w - margin, scorer.w / 2) + 1e-6, step)
            ys = np.arange(min(margin, scorer.h / 2), max(scorer.h - margin, scorer.h / 2) + 1e-6, step)
            gx, gy, ga = np.meshgrid(xs, ys, angles)
            cx, cy, ang = gx.ravel(), gy.ravel(), ga.ravel()
            for flip in (False, True):
                scores = scorer.score(shape, flip, cx, cy, np.full(cx.shape, s), ang)
                all_scores.append(scores)
                best = np.argsort(-scores)[:REFINE_KEEP]
                candidates.extend((float(scores[i]), growth, flip, float(cx[i]) * k, float(cy[i]) * k, float(s) * k, float(ang[i])) for i in best)
    kept = suppress(candidates, shapes, REFINE_KEEP, COARSE_MAX_OVERLAP)
    return kept, float(np.percentile(np.concatenate(all_scores), BASELINE_PERCENTILE))


def refine(scorer: SpiralScorer, shapes: dict, c: tuple, step: float, dangle: float) -> tuple:
    _, growth, flip, cx, cy, s, angle = c
    shape = shapes[growth]
    score = float(scorer.score(shape, flip, np.array([cx]), np.array([cy]), np.array([s]), np.array([angle]))[0])
    ds = 1.06
    d = np.array([-1.0, 0.0, 1.0])
    ox, oy, os_, oa = (v.ravel() for v in np.meshgrid(d, d, d, d))
    for _ in range(REFINE_ROUNDS):
        xs, ys, ss, angs = cx + ox * step, cy + oy * step, s * ds**os_, angle + oa * dangle
        scores = scorer.score(shape, flip, xs, ys, ss, angs)
        i = int(np.argmax(scores))
        if scores[i] > score:
            score, cx, cy, s, angle = float(scores[i]), float(xs[i]), float(ys[i]), float(ss[i]), float(angs[i])
        else:
            step, ds, dangle = step / 2, ds**0.5, dangle / 2
    return score, growth, flip, cx, cy, s, angle


def refine_growth(scorer: SpiralScorer, shapes: dict, c: tuple) -> tuple:
    # Line search on the growth rate in log space, keeping position, size and angle.
    best, ratio = c, 1.12
    for _ in range(6):
        for g in (best[1] * ratio, best[1] / ratio):
            g = float(np.clip(g, *GROWTH_RANGE))
            shapes.setdefault(g, log_shape(g))
            score = float(scorer.score(shapes[g], c[2], np.array([c[3]]), np.array([c[4]]), np.array([c[5]]), np.array([c[6]]))[0])
            if score > best[0]:
                best = (score, g, *c[2:])
                break
        else:
            ratio = ratio**0.5
    return best


def encode_png(img: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", img)
    return "data:image/png;base64," + base64.b64encode(buf.tobytes()).decode("ascii")


def resize(gray: np.ndarray, size: int) -> np.ndarray:
    h0, w0 = gray.shape
    f = min(1.0, size / max(h0, w0))
    return cv2.resize(gray, (max(1, round(w0 * f)), max(1, round(h0 * f))), interpolation=cv2.INTER_AREA)


def find_spirals(gray: np.ndarray, mode: str = "golden") -> dict:
    h0, w0 = gray.shape
    fine = SpiralScorer(resize(gray, ANALYSIS_SIZE))
    coarse = SpiralScorer(resize(gray, COARSE_SIZE))
    k = fine.w / coarse.w
    growths = [None] if mode == "golden" else list(GROWTHS)
    shapes = {g: golden_shape() if g is None else log_shape(g) for g in growths}
    candidates, baseline = coarse_search(coarse, {g: golden_shape(COARSE_SAMPLES_PER_QUARTER) if g is None else log_shape(g, COARSE_SAMPLES_PER_QUARTER) for g in growths}, k)
    step = max(fine.w, fine.h) / GRID_DIVISIONS
    refined = [refine(fine, shapes, c, step / 2, np.pi / ANGLE_STEPS) for c in candidates]
    if mode != "golden":
        refined = [refine(fine, shapes, refine_growth(fine, shapes, c), step / 4, np.pi / ANGLE_STEPS / 2) for c in refined]
    fits = {id(c): fine.fit(shapes[c[1]], c[2], c[3], c[4], c[5], c[6]) for c in refined}
    best_fit = max(fits.values())
    # Greedy one-per-object pick, best fit first; the best is always kept, and nothing no better than the top 1% of chance placements is added.
    spirals = []
    for c in sorted(refined, key=lambda c: -fits[id(c)]):
        if spirals and (fits[id(c)] < max(MIN_FIT, best_fit - DISTINCT_DROP) or c[0] <= baseline):
            continue
        r = radius(shapes[c[1]], c[5])
        if all(overlap(c, d, shapes) <= DISTINCT_OVERLAP and np.hypot(c[3] - d[3], c[4] - d[4]) >= DISTINCT_SPACING * max(r, radius(shapes[d[1]], d[5])) for d in spirals):
            spirals.append(c)
        if len(spirals) >= MAX_SPIRALS:
            break
    f = fine.w / w0
    matches = []
    for c in spirals:
        score, growth, flip, cx, cy, s, angle = c
        degrees = round(float(np.degrees(angle)) % 360, 2)
        g = None if growth is None else round(growth, 4)
        m = Match(cx / f, cy / f, shapes[growth].aspect * s / f, s / f, degrees, flip, g, round(score, 4), round(fits[id(c)], 4))
        matches.append(asdict(m))
    return {"width": w0, "height": h0, "matches": matches, "edges": encode_png((fine.edges * 255).astype(np.uint8))}
