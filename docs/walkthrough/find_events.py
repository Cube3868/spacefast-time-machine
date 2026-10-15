"""Print source timestamps where the raw recording changes noticeably (frame-difference pass)."""
import subprocess, sys
import numpy as np

SRC = sys.argv[1]
W, H = 400, 250
p = subprocess.Popen(["ffmpeg", "-v", "error", "-threads", "2", "-i", SRC, "-vf", f"scale={W}:{H}",
                      "-f", "rawvideo", "-pix_fmt", "gray", "-"], stdout=subprocess.PIPE)
prev, n = None, 0
while True:
    buf = p.stdout.read(W * H)
    if len(buf) < W * H:
        break
    f = np.frombuffer(buf, np.uint8).astype(np.int16)
    if prev is not None:
        d = np.abs(f - prev)
        changed = (d > 12).mean()
        if changed > 0.002:
            print(f"{n / 25:6.2f}s  frame {n:4d}  changed {changed * 100:5.2f}%")
    prev, n = f, n + 1
print("frames", n)
