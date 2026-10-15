"""Spacefast Time Machine walkthrough: original editorial sound layer, synthesized with numpy/scipy.

Usage: python -I sound.py
Writes walkthrough-sound.wav (48 kHz stereo, 16-bit) and muxes it as AAC into
spacefast-time-machine-walkthrough.mp4, copying the H.264 stream of the silent pass unchanged.
No samples, music, voice or captured site audio: every sound is generated here from sines and seeded noise.
Effects sit on real UI events and crop pans only. Nothing suggests a restore; the demo is read-only.
"""
import os, subprocess
import numpy as np
from scipy import signal
from scipy.io import wavfile

HERE = os.path.dirname(os.path.abspath(__file__))
SILENT = os.path.join(HERE, "spacefast-time-machine-walkthrough-silent.mp4")
OUT = os.path.join(HERE, "spacefast-time-machine-walkthrough.mp4")
WAV = os.path.join(HERE, "walkthrough-sound.wav")

SR = 48000
DUR = 39.466016                  # exact duration of the silent pass
N = int(round(DUR * SR))
OFF = 1.844                      # output time = raw recording time + OFF during footage
CLICK_LEAD = 0.02                # a click lands just before the frame where the UI visibly reacts
MASTER_DB = 2.0                  # fixed gain; never loudness-normalized
SWISH_TRIM = 5.0                 # swishes are broadband noise; keeps them audible on laptop speakers
rng = np.random.default_rng(20261015)

# Real UI events, raw recording seconds (frame differencing, find_events.py)
V1_SELECT = 6.24
RESIZE_STEPS = [9.76, 10.00, 10.20, 10.44, 10.68, 10.92, 11.16]
RESET = 13.80
FILES, BEFORE_AFTER, SHARE = 15.32, 20.72, 23.76
MODAL_CLOSED, COMPARE = 28.28, 28.44
# Chapter crop pans (raw seconds, from render.py CROP_KEYS): 02, 03, 04, 05
PANS = [(9.0, 9.7, -0.25), (14.6, 15.3, 0.2), (23.8, 24.5, -0.2), (28.3, 29.0, 0.25)]
INTRO_XF = (2.1, 2.5)            # title card crossfades into footage (output seconds)
OUTRO = 35.154                   # end card crossfade starts (output seconds)

dry = np.zeros((2, N))
send = np.zeros(N)               # mono send into the small room


def db(x): return 10 ** (x / 20)
def tt(d): return np.arange(int(d * SR)) / SR


def place(buf, t0, x):
    i = int(round(t0 * SR))
    j = min(i + x.shape[-1], buf.shape[-1])
    buf[..., i:j] += x[..., : j - i]


def put(t0, mono, gain_db, pan=0.0, rev_db=-18.0):
    """Equal-power pan into the dry bus plus a reverb send."""
    a = (pan + 1) * np.pi / 4
    x = mono * db(gain_db)
    place(dry, t0, np.stack([x * np.cos(a), x * np.sin(a)]))
    place(send, t0, x * db(rev_db))


def ramp_in(x, ms):
    k = max(1, int(ms * SR / 1000))
    x[:k] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(k) / k)
    return x


def band(x, lo, hi, order=2):
    return signal.sosfiltfilt(signal.butter(order, [lo, hi], "bandpass", fs=SR, output="sos"), x)


def tick(f, body=1.0, d=0.09):
    """Soft rounded click: a short noise tap plus a fast-decaying tuned body (wooden/glassy, not sharp)."""
    t = tt(d)
    tap = band(rng.standard_normal(len(t)), 1800, 6500) * np.exp(-t / 0.0016) * 0.35
    tone = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.016)
    tone += 0.35 * np.sin(2 * np.pi * f * 2.71 * t) * np.exp(-t / 0.006)
    low = 0.5 * body * np.sin(2 * np.pi * f * 0.42 * t) * np.exp(-t / 0.012)
    return ramp_in(tap + tone + low, 1.2)


def bell(f, d=2.2, tau=0.7):
    """Warm chime note: sine with soft upper partials, 10 ms attack, exponential decay."""
    t = tt(d)
    x = np.sin(2 * np.pi * f * t) * np.exp(-t / tau)
    x += 0.22 * np.sin(2 * np.pi * f * 2 * t) * np.exp(-t / (tau * 0.45))
    x += 0.06 * np.sin(2 * np.pi * f * 3.01 * t) * np.exp(-t / (tau * 0.25))
    x = ramp_in(x, 10)
    x[-int(0.05 * SR):] *= np.linspace(1, 0, int(0.05 * SR))
    return x


def pad(freqs, d, rise):
    """Quiet sine bed that swells in and fades out (only under the opening/closing marks)."""
    t = tt(d)
    x = sum(np.sin(2 * np.pi * f * t + k) for k, f in enumerate(freqs)) / len(freqs)
    env = np.minimum(t / rise, 1.0) ** 2 * np.clip((d - t) / (d - rise), 0, 1) ** 2
    return x * env


def swish(d, lo=(500, 1400), hi=(2200, 6500)):
    """Airy pan swish: pink-ish noise crossfading from a lower to a higher band under a smooth swell."""
    t = tt(d)
    u = t / d
    n = np.cumsum(rng.standard_normal(len(t))) * 0.02 + rng.standard_normal(len(t))
    a, b = band(n, *lo), band(n, *hi)
    a /= np.abs(a).max()
    b /= np.abs(b).max()
    env = np.sin(np.pi * u) ** 2 * np.exp(-1.2 * u)
    return (a * (1 - u) + b * u * 0.7) * env


def put_swish(t0, d, gain_db, pan_to):
    """Swish that drifts a little across the stereo field, in the direction of the crop move."""
    x = swish(d) * db(gain_db + SWISH_TRIM)
    p = np.linspace(-pan_to, pan_to, len(x))
    a = (p + 1) * np.pi / 4
    place(dry, t0, np.stack([x * np.cos(a), x * np.sin(a)]))
    place(send, t0, x * db(-14))


# Opening sound mark: rising D-major arpeggio over a faint D/A bed, tucked under the title card
D5, FS5, A5, D6 = 587.33, 739.99, 880.0, 1174.66
put(0.18, pad([146.83, 220.0, 293.66], 2.3, 0.6), -30, 0.0, -20)
for t0, f, g, p in [(0.25, D5, -21, -0.2), (0.45, FS5, -22, 0.0), (0.65, A5, -22, 0.2), (0.95, D6, -26, 0.05)]:
    put(t0, bell(f, 1.9, 0.6), g, p, -8)
put_swish(INTRO_XF[0] - 0.05, 0.55, -28, 0.15)

# Chapter 01: v1 picked in version history
put(V1_SELECT + OFF - CLICK_LEAD, tick(1900), -19, 0.1)

# Chapter 02: crop pan in, then seven small descending ticks as v1's viewport narrows, then the reset
s, e, p = PANS[0]
put_swish(s + OFF - 0.08, e - s + 0.25, -24, p)
for k, ts in enumerate(RESIZE_STEPS):
    put(ts + OFF - CLICK_LEAD, tick(3000 * 2 ** (-k / 24), body=0.4, d=0.05), -25 - 0.2 * k, 0.15)
put(RESET + OFF - CLICK_LEAD, tick(2600, body=0.4, d=0.05), -25, 0.15)
put(RESET + OFF - CLICK_LEAD + 0.07, tick(3100, body=0.3, d=0.05), -27, 0.15)

# Chapter 03: pan to Files, Files tab, then Before / after
s, e, p = PANS[1]
put_swish(s + OFF - 0.08, e - s + 0.25, -24, p)
put(FILES + OFF - CLICK_LEAD, tick(1700), -19, -0.05)
put(BEFORE_AFTER + OFF - CLICK_LEAD, tick(1800), -19, 0.05)

# Chapter 04: Share opens the modal, pan to it
put(SHARE + OFF - CLICK_LEAD, tick(2000), -19, 0.1)
s, e, p = PANS[2]
put_swish(s + OFF - 0.02, e - s + 0.25, -25, p)

# Chapter 05: modal closes, Compare tab, pan back out. Kept softer and neutral: no "success" sound here.
put(MODAL_CLOSED + OFF - CLICK_LEAD, tick(1450, body=0.6), -23, -0.05)
put(COMPARE + OFF - CLICK_LEAD, tick(1700), -20, 0.0)
s, e, p = PANS[3]
put_swish(s + OFF + 0.05, e - s + 0.2, -27, p)

# Closing sound mark: gentle descending answer to the opening as the end card fades in
put_swish(OUTRO - 0.05, 0.6, -28, -0.15)
put(OUTRO + 0.05, pad([146.83, 220.0, 293.66], 3.0, 0.7), -31, 0.0, -20)
for t0, f, g, p in [(OUTRO + 0.15, A5, -22, 0.2), (OUTRO + 0.37, FS5, -22, 0.0), (OUTRO + 0.62, D5, -21, -0.15)]:
    put(t0, bell(f, 2.6, 0.8), g, p, -8)

# Small room: decorrelated exponential-noise impulse responses, darkened, one per channel
ir_t = tt(0.9)
irs = []
for _ in range(2):
    ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t / 0.2)
    ir = signal.sosfilt(signal.butter(2, 4500, "lowpass", fs=SR, output="sos"), ir)
    irs.append(ir / np.sqrt(np.sum(ir ** 2)))
wet = np.stack([signal.fftconvolve(send, ir)[:N] for ir in irs])

mix = (dry + wet) * db(MASTER_DB)
mix = signal.sosfiltfilt(signal.butter(2, 70, "highpass", fs=SR, output="sos"), mix, axis=1)
mix = signal.sosfiltfilt(signal.butter(2, 14000, "lowpass", fs=SR, output="sos"), mix, axis=1)
mix[:, -int(0.1 * SR):] *= np.linspace(1, 0, int(0.1 * SR))

tp = np.abs(signal.resample_poly(mix, 4, 1, axis=1)).max()
print(f"sample peak {20 * np.log10(np.abs(mix).max()):.2f} dBFS, 4x true peak {20 * np.log10(tp):.2f} dBTP")
assert tp < db(-8), "too hot: lower MASTER_DB rather than limiting"

pcm = mix + (rng.random(mix.shape) - rng.random(mix.shape)) / 32768    # TPDF dither
wavfile.write(WAV, SR, np.round(pcm.T * 32767).astype(np.int16))

subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", SILENT, "-i", WAV, "-map", "0:v:0", "-map", "1:a:0",
                "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", str(SR), "-ac", "2",
                "-metadata:s:a:0", "title=Editorial sound effects (original, synthesized)",
                "-movflags", "+faststart", OUT], check=True)
print("wrote", OUT)
