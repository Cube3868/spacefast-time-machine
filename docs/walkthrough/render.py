"""Spacefast Time Machine walkthrough: renders the edited MP4 from the real read-only recording.

Usage: python -I render.py [out.mp4]
Footage is shown 1:1 in time (no speed changes, no faked UI). Only the crop window moves, with eased
pans between chapters. A navy caption panel on the left replaces the app's own static sidebar.
"""
import os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.environ.get("TM_WALKTHROUGH_SOURCE", os.path.join(HERE, "source-recording.webm"))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "spacefast-time-machine-walkthrough.mp4")

W, H, FPS = 1920, 1080, 30
SW, SH, SFPS = 1600, 1000, 25
PANEL = 420                      # caption panel width
FW = W - PANEL                   # footage area 1500x1080
NAVY = (18, 28, 35)              # #121c23
SAGE = (200, 238, 165)           # #c8eea5
WHITE = (244, 247, 243)
MUTED = (168, 184, 180)
DIM = (74, 92, 100)

# Edit timeline (output seconds)
INTRO = 2.5                      # title card, last 0.4 s crossfades into footage
SRC_IN, SRC_OUT = 0.656, 32.36   # comparison fully loaded -> last frame of recording
FOOT_END = INTRO + (SRC_OUT - SRC_IN)
HOLD = 0.95                      # hold final real frame
XF = 0.4                         # crossfade length
CAP_XF = 0.5                     # caption change: 0.25 s out, 0.25 s in
OUTRO_START = FOOT_END + HOLD
TOTAL = OUTRO_START + XF + 3.9

FONT = "C:/Windows/Fonts/"
def font(name, size): return ImageFont.truetype(FONT + name, size)
F_BOLD, F_REG, F_LIGHT, F_SEMI = "segoeuib.ttf", "segoeui.ttf", "segoeuil.ttf", "segoeuisl.ttf"

# Crop windows in source pixels (x, y, w, h), all at the 1500:1080 footage aspect
ASPECT = FW / H
def box(x, y, w): return (x, y, w, w / ASPECT)
FULL = box(252, 15, 1348)        # whole app minus static sidebar (x1.11)
RESIZE = box(380, 136, 1200)     # comparison panes (x1.25)
FILES = box(400, 20, 1200)       # files tab, diff (x1.25)
SHARE = box(252, 86, 1150)       # share modal (x1.30, URL kept near native size)
# (src time, crop): eased move from previous key to this one ends at the given time
CROP_KEYS = [(0.0, FULL), (9.0, FULL), (9.7, RESIZE), (14.6, RESIZE), (15.3, FILES),
             (23.8, FILES), (24.5, SHARE), (28.3, SHARE), (29.0, FULL)]

# Captions keyed on source time. (start, chapter, title, body, tag)
CAPS = [
    (0.0,   1, "Compare any two versions", "Two real deployments of the same site, side by side: v2 meets v1.", None),
    (6.0,   1, "Pick a version from history", "Selecting v1 flips the view: v1 meets v2, with live v2 alongside.", None),
    (9.5,   2, "Check any screen size", "v1's viewport narrows 700px in seven keyboard steps, then resets.", None),
    (15.15, 3, "See what changed", "A real unified diff of the served files, v2 to v1.", None),
    (20.55, 3, "Before / after", "The same file change, side by side.", None),
    (23.6,  4, "Share the exact comparison", "The link reopens these exact versions in this same view.", None),
    (28.15, 5, "Restore, with safeguards",
     "Connected accounts: typed confirmation, provider approval when required, then live verification.",
     "Public demo \u2013 restore disabled"),
]
CHAPTERS = 5


def ease(u):
    u = min(max(u, 0.0), 1.0)
    return u * u * (3 - 2 * u)


def crop_at(s):
    prev_t, prev_b = CROP_KEYS[0]
    for t, b in CROP_KEYS[1:]:
        if s <= t:
            u = ease((s - prev_t) / (t - prev_t)) if t > prev_t else 1.0
            return tuple(p + (q - p) * u for p, q in zip(prev_b, b))
        prev_t, prev_b = t, b
    return prev_b


def wrap(draw, text, f, width):
    lines, cur = [], ""
    for word in text.split():
        trial = (cur + " " + word).strip()
        if draw.textlength(trial, font=f) <= width or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    return lines + [cur] if cur else lines


def wordmark(d, x, y, scale=1.0):
    r = int(44 * scale)
    d.rounded_rectangle((x, y, x + r, y + r), radius=int(12 * scale), fill=SAGE)
    cx, cy, cr = x + r / 2, y + r / 2, r * 0.27
    d.ellipse((cx - cr, cy - cr, cx + cr, cy + cr), outline=NAVY, width=max(2, int(3 * scale)))
    d.line((cx, cy, cx, cy - cr * 0.62), fill=NAVY, width=max(2, int(3 * scale)))
    d.line((cx, cy, cx + cr * 0.5, cy), fill=NAVY, width=max(2, int(3 * scale)))
    d.text((x + r + 14 * scale, y - 4 * scale), "spacefast", font=font(F_BOLD, int(30 * scale)), fill=WHITE)
    d.text((x + r + 16 * scale, y + 32 * scale), "T I M E   M A C H I N E", font=font(F_SEMI, int(12 * scale)), fill=SAGE)


def make_panel(cap, chrome_only=False):
    _, ch, title, body, tag = cap
    img = Image.new("RGB", (PANEL, H), NAVY)
    d = ImageDraw.Draw(img)
    wordmark(d, 48, 56)
    x, tw = 48, PANEL - 96
    draw_footer(d, x, tw, ch)
    if chrome_only:
        return np.asarray(img).copy()
    y = 300
    d.text((x, y), f"{ch:02d}", font=font(F_BOLD, 60), fill=SAGE)
    d.text((x + d.textlength(f"{ch:02d}", font=font(F_BOLD, 60)) + 12, y + 26), f"/ {CHAPTERS:02d}",
           font=font(F_REG, 26), fill=MUTED)
    y += 104
    ft = font(F_BOLD, 46)
    for line in wrap(d, title, ft, tw):
        d.text((x, y), line, font=ft, fill=WHITE)
        y += 56
    y += 22
    if tag:
        fg = font(F_BOLD, 24)
        tl = wrap(d, tag.upper(), fg, tw - 40)
        bh = 22 + 34 * len(tl)
        d.rounded_rectangle((x, y, x + tw, y + bh), radius=14, outline=SAGE, width=2, fill=(30, 44, 44))
        for i, line in enumerate(tl):
            d.text((x + 20, y + 10 + 34 * i), line, font=fg, fill=SAGE)
        y += bh + 26
    fb = font(F_REG, 30)
    for line in wrap(d, body, fb, tw):
        d.text((x, y), line, font=fb, fill=MUTED if not tag else WHITE)
        y += 42
    return np.asarray(img).copy()


def draw_footer(d, x, tw, ch):
    """Chapter progress bar and provenance note."""
    seg_w, gap, by = (tw - gap_total()) / CHAPTERS, 10, H - 92
    for i in range(CHAPTERS):
        sx = x + i * (seg_w + gap)
        d.rounded_rectangle((sx, by, sx + seg_w, by + 6), radius=3, fill=SAGE if i < ch else DIM)
    d.text((x, by + 22), "Real recording \u00b7 public read-only demo", font=font(F_REG, 20), fill=MUTED)


def gap_total(): return 10 * (CHAPTERS - 1)


def make_intro():
    img = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(img)
    ft, fs = font(F_BOLD, 92), font(F_LIGHT, 50)
    t1, t2 = "Spacefast Time Machine", "Every version. Within reach."
    d.text(((W - d.textlength(t1, font=ft)) / 2, 420), t1, font=ft, fill=WHITE)
    d.text(((W - d.textlength(t2, font=fs)) / 2, 548), t2, font=fs, fill=SAGE)
    d.rounded_rectangle((W / 2 - 40, 382, W / 2 + 40, 388), radius=3, fill=SAGE)
    return np.asarray(img).astype(np.float32)


def make_outro():
    img = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(img)
    wordmark(d, W / 2 - 150, 200, 1.4)
    rows = [("TRY THE LIVE DEMO", "space-xx8uckgsp.space.fast/?demo=1", 400),
            ("OPEN SOURCE ON GITHUB", "github.com/Cube3868/spacefast-time-machine", 610)]
    fl, fu = font(F_BOLD, 26), font(F_SEMI, 62)
    for label, url, y in rows:
        d.text(((W - d.textlength(label, font=fl)) / 2, y), label, font=fl, fill=SAGE)
        d.text(((W - d.textlength(url, font=fu)) / 2, y + 48), url, font=fu, fill=WHITE)
    note = "Recorded read-only on the public demo, where restore is disabled."
    fn = font(F_REG, 28)
    d.text(((W - d.textlength(note, font=fn)) / 2, 880), note, font=fn, fill=MUTED)
    return np.asarray(img).astype(np.float32)


def caption_index(s):
    i = 0
    for k, c in enumerate(CAPS):
        if s >= c[0]:
            i = k
    return i


class Source:
    """Sequential decoder; frames are only ever requested in non-decreasing order."""
    def __init__(self):
        self.p = subprocess.Popen(["ffmpeg", "-v", "error", "-threads", "2", "-i", SRC,
                                   "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
        self.n, self.frame = -1, None

    def get(self, idx):
        while self.n < idx:
            buf = self.p.stdout.read(SW * SH * 3)
            if len(buf) < SW * SH * 3:
                break
            self.frame = Image.frombuffer("RGB", (SW, SH), buf, "raw", "RGB", 0, 1)
            self.n += 1
        return self.frame


def pick_encoder():
    test = subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.1",
                           "-c:v", "h264_nvenc", "-f", "null", "-"], capture_output=True)
    if test.returncode == 0:
        return ["-c:v", "h264_nvenc", "-preset", "p6", "-tune", "hq", "-rc", "vbr", "-cq", "21", "-b:v", "0",
                "-maxrate", "6M", "-bufsize", "12M", "-profile:v", "high"]
    return ["-c:v", "libx264", "-preset", "slow", "-crf", "20", "-threads", "4", "-profile:v", "high"]


def main():
    panels = [make_panel(c) for c in CAPS]
    chrome = [make_panel(c, chrome_only=True) for c in CAPS]
    intro, outro = make_intro(), make_outro()
    enc = pick_encoder()
    print("encoder:", enc[1], "| duration %.2fs" % TOTAL)
    ff = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
                           "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                           "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p", *enc,
                           "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
                           "-bsf:v", "h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1",
                           "-r", str(FPS), "-movflags", "+faststart", OUT], stdin=subprocess.PIPE)
    src = Source()
    frame = np.empty((H, W, 3), np.uint8)
    nframes = int(round(TOTAL * FPS))
    for k in range(nframes):
        t = k / FPS
        if t >= OUTRO_START + XF:
            out = outro.astype(np.uint8)
        else:
            s = SRC_IN + min(max(t - INTRO, 0.0), SRC_OUT - SRC_IN)
            im = src.get(int(s * SFPS + 1e-6))
            x, y, w, h = crop_at(s)
            frame[:, PANEL:] = np.asarray(im.resize((FW, H), Image.LANCZOS, box=(x, y, x + w, y + h)))
            ci = caption_index(s)
            since = s - CAPS[ci][0]
            if ci > 0 and since < CAP_XF:
                # dip the caption text through the bare panel so old and new text never overlap
                u = since / CAP_XF
                a, b = (panels[ci - 1], chrome[ci]) if u < 0.5 else (chrome[ci], panels[ci])
                v = ease(u * 2 if u < 0.5 else u * 2 - 1)
                frame[:, :PANEL] = (a * (1 - v) + b * v).astype(np.uint8)
            else:
                frame[:, :PANEL] = panels[ci]
            frame[:, PANEL:PANEL + 1] = (40, 56, 62)
            out = frame
            if t < INTRO:
                u = ease((t - (INTRO - XF)) / XF)
                out = (intro * (1 - u) + frame * u).astype(np.uint8)
            elif t >= OUTRO_START:
                u = ease((t - OUTRO_START) / XF)
                out = (frame * (1 - u) + outro * u).astype(np.uint8)
        ff.stdin.write(np.ascontiguousarray(out).tobytes())
        if k % 150 == 0:
            print(f"  {t:5.1f}s / {TOTAL:.1f}s", flush=True)
    ff.stdin.close()
    ff.wait()
    src.p.kill()
    print("done", OUT, "rc", ff.returncode)


if __name__ == "__main__":
    main()
