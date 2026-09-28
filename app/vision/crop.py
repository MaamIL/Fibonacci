import cv2
import numpy as np
from app.vision.spiral_fit import PHI, encode_png, golden_eye

ANALYSIS_SIZE = 480
SALIENCY_SIZE = 64
SUBJECT_PERCENTILE = 92
HEIGHT_STEPS = 12
MIN_HEIGHT = 0.5
# Score weights: land the subject on the rule's point, keep the eye-catching parts, prefer bigger crops, avoid slicing through salient areas.
W_PLACE = 1.0
W_KEEP = 0.8
W_SIZE = 0.4
W_CUT = 0.8
W_SUBJECT_OUT = 1.5
PLACE_TOLERANCE = 0.04
EX, EY = golden_eye()
RULES = {
    "phi": [(x, y) for x in (1 / PHI**2, 1 / PHI) for y in (1 / PHI**2, 1 / PHI)],
    "thirds": [(x, y) for x in (1 / 3, 2 / 3) for y in (1 / 3, 2 / 3)],
    "spiral": [(x, y) for x in (EX / PHI, 1 - EX / PHI) for y in (EY, 1 - EY)],
}
ASPECTS = {"golden": (PHI, 1 / PHI), "1:1": (1.0,), "4:5": (0.8,), "3:2": (1.5,), "16:9": (16 / 9,)}


def saliency_map(rgb: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    # Spectral residual saliency (Hou & Zhang 2007): what stands out is what the image's smooth log spectrum does not predict.
    h, w = rgb.shape[:2]
    f = SALIENCY_SIZE / max(h, w)
    small = cv2.resize(rgb, (max(8, round(w * f)), max(8, round(h * f))), interpolation=cv2.INTER_AREA)
    lab = cv2.cvtColor(small, cv2.COLOR_RGB2LAB).astype(np.float32)
    sal = np.zeros(small.shape[:2], np.float32)
    for c in range(3):
        spec = np.fft.fft2(lab[:, :, c])
        log_amp = np.log(np.abs(spec) + 1e-6).astype(np.float32)
        residual = log_amp - cv2.blur(log_amp, (3, 3))
        sal += (np.abs(np.fft.ifft2(np.exp(residual + 1j * np.angle(spec)))) ** 2).astype(np.float32)
    sal = cv2.GaussianBlur(sal, (0, 0), 2.5)
    # A mild center bias: photographers and viewers both favor the middle.
    yy, xx = np.mgrid[0 : sal.shape[0], 0 : sal.shape[1]]
    sal *= 0.6 + 0.4 * np.exp(-(((xx / sal.shape[1] - 0.5) / 0.35) ** 2 + ((yy / sal.shape[0] - 0.5) / 0.35) ** 2))
    sal = cv2.resize(sal, size, interpolation=cv2.INTER_CUBIC)
    sal -= sal.min()
    return sal / (sal.max() + 1e-9)


def find_subject(sal: np.ndarray) -> tuple[tuple[float, float], tuple[float, float, float, float]]:
    mask = (sal >= np.percentile(sal, SUBJECT_PERCENTILE)).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
    weights = [float(sal[labels == i].sum()) for i in range(1, n)]
    i = 1 + int(np.argmax(weights))
    ys, xs = np.nonzero(labels == i)
    wts = sal[ys, xs]
    x, y, w, h = (float(v) for v in stats[i, :4])
    return (float((xs * wts).sum() / wts.sum()), float((ys * wts).sum() / wts.sum())), (x, y, w, h)


class Scorer:
    def __init__(self, sal: np.ndarray, subject: tuple[float, float], box: tuple[float, float, float, float]):
        self.sal = sal
        self.h, self.w = sal.shape
        self.integral = cv2.integral(sal.astype(np.float64))
        self.total = float(self.integral[-1, -1]) + 1e-9
        self.subject = subject
        self.box = box

    def inside(self, x0: int, y0: int, x1: int, y1: int) -> float:
        ii = self.integral
        return float(ii[y1, x1] - ii[y0, x1] - ii[y1, x0] + ii[y0, x0])

    def score(self, x: float, y: float, cw: float, ch: float, target: tuple[float, float]) -> dict:
        x0, y0, x1, y1 = round(x), round(y), min(self.w, round(x + cw)), min(self.h, round(y + ch))
        px, py = x + target[0] * cw, y + target[1] * ch
        d = np.hypot(self.subject[0] - px, self.subject[1] - py) / np.hypot(cw, ch)
        place = float(np.exp(-((d / PLACE_TOLERANCE) ** 2)))
        keep = self.inside(x0, y0, x1, y1) / self.total
        size = (cw * ch) / (self.w * self.h)
        # Mean saliency along the crop's edges (only edges that are inside the photo cut anything).
        edges = [self.sal[y0:y1, x0], self.sal[y0:y1, x1 - 1], self.sal[y0, x0:x1], self.sal[y1 - 1, x0:x1]]
        cut = float(np.mean([e.mean() for e in edges if e.size]))
        bx, by, bw, bh = self.box
        ix = max(0.0, min(bx + bw, x + cw) - max(bx, x))
        iy = max(0.0, min(by + bh, y + ch) - max(by, y))
        out = 1 - ix * iy / max(bw * bh, 1.0)
        total = W_PLACE * place + W_KEEP * keep + W_SIZE * size - W_CUT * cut - W_SUBJECT_OUT * out
        return {"total": total, "place": place, "keep": keep, "size": size, "cut": cut, "subject_out": out}


def search(scorer: Scorer, rule: str, aspect: float) -> tuple[dict, tuple]:
    w, h = scorer.w, scorer.h
    ch_max = min(h, w / aspect)
    best = None
    for ch in np.geomspace(ch_max, MIN_HEIGHT * ch_max, HEIGHT_STEPS):
        cw = ch * aspect
        for target in RULES[rule]:
            # Put the subject exactly on the rule's point, then slide back inside the photo if needed.
            x = float(np.clip(scorer.subject[0] - target[0] * cw, 0, w - cw))
            y = float(np.clip(scorer.subject[1] - target[1] * ch, 0, h - ch))
            s = scorer.score(x, y, cw, ch, target)
            if best is None or s["total"] > best[0]["total"]:
                best = (s, (x, y, cw, ch, target))
    return best


def golden_crop(rgb: np.ndarray, rule: str = "auto", aspect: str = "golden", subject: tuple[float, float] | None = None) -> dict:
    h0, w0 = rgb.shape[:2]
    f = min(1.0, ANALYSIS_SIZE / max(h0, w0))
    w, h = max(1, round(w0 * f)), max(1, round(h0 * f))
    sal = saliency_map(rgb, (w, h))
    auto_subject, box = find_subject(sal)
    if subject is not None:
        # A clicked subject gets a small box of its own so "keep the subject whole" still means something.
        s = subject[0] * f, subject[1] * f
        box = (s[0] - 0.05 * w, s[1] - 0.05 * h, 0.1 * w, 0.1 * h)
    else:
        s = auto_subject
    scorer = Scorer(sal, s, box)
    aspects = ASPECTS.get(aspect, (w0 / h0,))
    rules = list(RULES) if rule == "auto" else [rule]
    results = {r: max((search(scorer, r, a) for a in aspects), key=lambda b: b[0]["total"]) for r in rules}
    used = max(results, key=lambda r: results[r][0]["total"])
    parts, (x, y, cw, ch, target) = results[used]
    return {
        "width": w0,
        "height": h0,
        "rule": used,
        "crop": {"x": x / f, "y": y / f, "w": cw / f, "h": ch / f},
        "target": {"x": (x + target[0] * cw) / f, "y": (y + target[1] * ch) / f},
        "subject": {"x": s[0] / f, "y": s[1] / f, "auto": subject is None},
        "subject_box": {"x": box[0] / f, "y": box[1] / f, "w": box[2] / f, "h": box[3] / f},
        "score": {k: round(float(v), 4) for k, v in parts.items()},
        "rule_scores": {r: round(float(results[r][0]["total"]), 4) for r in rules},
        "saliency": encode_png((sal * 255).astype(np.uint8)),
    }
