"""Programmatic checks of the muxed sound layer: decodes the AAC from the final MP4 and reports
peaks, clipping, per-effect levels and onset timing against the planned event times."""
import os, subprocess
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MP4 = os.path.join(HERE, "spacefast-time-machine-walkthrough.mp4")
SR = 48000
OFF = 1.844

raw = subprocess.run(["ffmpeg", "-v", "error", "-i", MP4, "-map", "0:a:0", "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
                     capture_output=True, check=True).stdout
x = np.frombuffer(raw, np.float32).reshape(-1, 2).astype(np.float64)
m = np.abs(x).max(axis=1)
print(f"decoded {len(x)} samples = {len(x) / SR:.3f} s")
print(f"sample peak {20 * np.log10(m.max()):.2f} dBFS, samples >= 0.99: {(m >= 0.99).sum()}, DC L/R {x.mean(0)}")

events = [("open mark", 0.25), ("intro swish", 2.05), ("v1 select", 6.24 + OFF)]
events += [(f"resize {k + 1}", t + OFF) for k, t in enumerate([9.76, 10.00, 10.20, 10.44, 10.68, 10.92, 11.16])]
events += [("reset", 13.80 + OFF), ("Files", 15.32 + OFF), ("Before/after", 20.72 + OFF), ("Share", 23.76 + OFF),
           ("modal closed", 28.28 + OFF), ("Compare", 28.44 + OFF), ("close mark", 35.30)]
env = np.convolve(m, np.ones(48) / 48, "same")     # 1 ms peak envelope
print(f"{'event':14s} {'plan s':>7s} {'onset s':>8s} {'delta ms':>8s} {'peak dBFS':>9s}")
for name, t in events:
    i0, i1 = int((t - 0.06) * SR), int((t + 0.12) * SR)
    seg = env[i0:i1]
    floor = env[i0 - int(0.03 * SR):i0].max() if name not in ("resize 2", "resize 3") else 0
    on = i0 + int(np.argmax(seg > max(seg.max() * 0.3, floor * 1.5)))
    print(f"{name:14s} {t:7.3f} {on / SR:8.3f} {(on / SR - t) * 1000:8.1f} {20 * np.log10(m[i0:i0 + int(0.6 * SR)].max()):9.1f}")

q = 20 * np.log10(np.maximum(env, 1e-9))
silent = (q < -60).mean()
print(f"fraction of time below -60 dBFS: {silent * 100:.1f}%  (sparse layer, no constant bed)")
spec = np.abs(np.fft.rfft(x.mean(1)))
f = np.fft.rfftfreq(len(x), 1 / SR)
tot = (spec ** 2).sum()
print(f"energy <80 Hz {100 * (spec[f < 80] ** 2).sum() / tot:.2f}%, >10 kHz {100 * (spec[f > 10000] ** 2).sum() / tot:.2f}%")
