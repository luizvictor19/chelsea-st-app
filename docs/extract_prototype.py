"""Validated Callan page extractor. Reference implementation, thresholds measured."""
import re, subprocess, tempfile
import numpy as np
from PIL import Image

TARGET_W   = 1100   # every incoming page is normalised to this width
ROW_FRAC   = 0.45   # a row belongs to a box when this share of it is shaded
MERGE_GAP  = 16     # bands closer than this are one box split by dense text
MIN_BOX_H  = 35     # below this a band is an underline artifact, not content
TABLE_H    = 250    # above this a box is a table and needs manual review
MARGIN_CFG = [(-2, "6"), (22, "6"), (14, "11")]   # (pad, psm) for margin numbers

def normalise(im):
    w, h = im.size
    return im if w == TARGET_W else im.resize((TARGET_W, round(h*TARGET_W/w)), Image.LANCZOS)

def shaded_mask(im):
    a = np.asarray(im).astype(int)
    r, g, b = a[:,:,0], a[:,:,1], a[:,:,2]
    return (b > r + 4) & (r < 250) & (r > 200)

def _tsv(im, extra=()):
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        im.save(f.name)
        out = subprocess.run(["tesseract", f.name, "stdout", "-l", "eng", *extra, "tsv"],
                             capture_output=True, text=True).stdout
    lines = out.splitlines()
    if not lines: return []
    hdr, rows = lines[0].split("\t"), []
    for ln in lines[1:]:
        p = ln.split("\t")
        if len(p) != len(hdr): continue
        d = dict(zip(hdr, p))
        if d["text"].strip():
            rows.append({"text": d["text"].strip(), "x": int(d["left"]), "y": int(d["top"]),
                         "h": int(d["height"]), "conf": float(d["conf"])})
    return rows

def boxes(mask):
    h = mask.shape[0]
    rows = mask.mean(axis=1) > ROW_FRAC
    raw, s = [], None
    for y, on in enumerate(rows):
        if on and s is None: s = y
        elif not on and s is not None: raw.append((s, y)); s = None
    if s is not None: raw.append((s, h))
    merged = []
    for b in raw:
        if merged and b[0] - merged[-1][1] <= MERGE_GAP: merged[-1] = (merged[-1][0], b[1])
        else: merged.append(list(b))
    return [tuple(b) for b in merged if b[1]-b[0] >= MIN_BOX_H]

def margin_numbers(im, box_left):
    found = {}
    for pad, psm in MARGIN_CFG:
        right = max(box_left + pad, 8)
        k = 5
        strip = im.crop((0, 0, right, im.size[1])).resize((right*k, im.size[1]*k), Image.LANCZOS)
        for t in _tsv(strip, ["--psm", psm, "-c", "tessedit_char_whitelist=0123456789"]):
            s = re.sub(r"\D", "", t["text"])
            if not s or len(s) > 4: continue
            if t["x"]//k >= box_left - 12: continue   # must start in the margin
            found.setdefault(int(s), t["y"]//k)
    return sorted(found.items(), key=lambda kv: kv[1])   # [(number, y)]

def explanation_lines(im, box_left):
    """Explanations are justified across the whole column. Q&A always has a mid gap."""
    a = np.asarray(im.convert("L")).astype(int)
    ink = (a < 160) & ~shaded_mask(im)
    rows = ink.sum(axis=1) > 2
    spans, s = [], None
    for y, on in enumerate(rows):
        if on and s is None: s = y
        elif not on and s is not None:
            if y - s >= 6: spans.append((s, y))
            s = None
    out = []
    for (y0, y1) in spans:
        col = ink[y0:y1].any(axis=0)
        xs = np.where(col)[0]
        if not len(xs): continue
        x0, x1 = int(xs.min()), int(xs.max())
        gap = run = 0
        for x in range(x0, x1+1):
            if not col[x]: run += 1; gap = max(gap, run)
            else: run = 0
        if abs(x0 - box_left) <= 15 and gap <= 25:
            out.append((y0, y1))
    return out

def read(im_raw):
    im = normalise(im_raw); W, H = im.size
    m = shaded_mask(im)
    cols = np.where(m.any(axis=0))[0]
    box_left = int(cols.min()) if len(cols) else int(W*0.10)
    bs = boxes(m)
    words = _tsv(im); toks = [w["text"] for w in words]; txt = " ".join(toks)
    slash_ratio = sum(1 for t in toks if "/" in t) / max(len(toks), 1)
    out = {"box_left": box_left, "marks": margin_numbers(im, box_left),
           "lesson": re.findall(r"LESSON\s+(\d+)", txt),
           "revision_exercise": re.findall(r"Revision\s+Exercise\s+(\d+)", txt, re.I),
           "chart": re.findall(r"See\s+Chart\s+(\d+)", txt, re.I),
           "is_dictation": slash_ratio >= 0.10, "slash_ratio": round(slash_ratio, 3),
           "boxes": [], "explanations": len(explanation_lines(im, box_left))}
    for (y0, y1) in bs:
        c = im.crop((box_left, y0, W, y1))
        c = c.resize((c.size[0]*2, c.size[1]*2), Image.LANCZOS)
        out["boxes"].append({"y": (y0, y1), "h": y1-y0, "needs_review": (y1-y0) > TABLE_H,
                             "content": " ".join(w["text"] for w in _tsv(c))})
    return out
