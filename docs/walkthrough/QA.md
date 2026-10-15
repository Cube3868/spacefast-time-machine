# QA: spacefast-time-machine-walkthrough.mp4

## ffprobe facts (final render)

| Field           | Value                                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codec / profile | h264, High (encoded with h264_nvenc; libx264 fallback is in `render.py`)                                                                           |
| Resolution      | 1920x1080                                                                                                                                          |
| Pixel format    | yuv420p, tv range                                                                                                                                  |
| Color tags      | bt709 matrix, primaries and transfer                                                                                                               |
| Frame rate      | 30/1 (r and avg)                                                                                                                                   |
| Frames          | 1184                                                                                                                                               |
| Duration        | 39.466016 s (container and video); audio 39.466 s, 1851 AAC frames                                                                                 |
| Size            | 8,024,598 bytes (7.65 MiB), about 1.63 Mb/s overall; video 1,456,840 b/s                                                                           |
| Audio           | AAC LC, 48,000 Hz, 2 channels (stereo), about 160 kb/s. Source WAV `walkthrough-sound.wav`: PCM s16le, 48 kHz stereo, 1,894,369 samples (39.466 s) |
| Faststart       | yes: `moov` at byte 32, before `mdat` at byte 45010                                                                                                |
| SHA-256         | final `ba38ee34…eeffb95`; silent pass `7c367d84…64dd434` (the original final, unchanged); WAV `edd4cd6a…eceadae`                                   |

## Decode validation

- A full decode of video and AAC audio (`ffmpeg -v error -i ... -f null -`) finished with no errors.
- **The picture is unchanged.** The H.264 stream was stream-copied from `spacefast-time-machine-walkthrough-silent.mp4`, not re-encoded. Per-packet `framemd5` (pts, dts, size and hash for all 1184 packets) is byte-identical between the two files. The stream MD5 (`c8dbec89…`) and the decoded-frame MD5 (`0a0c31bf…`) match too.
- `poster.jpg` and `walkthrough.vtt` are untouched: their SHA-256 hashes are the same as before the sound pass.
- `blackdetect=d=0.1:pix_th=0.05` found no black segments.
- `walkthrough.vtt` parses in ffmpeg: 9 cues covering 0 to 39.466 s.
- `poster.jpg` is 1920x1080, taken from the final MP4 at 8.5 s (chapter 01, v1 meets v2).

## Contact sheet review (`contact-sheet.jpg`, 1 fps, 40 tiles)

I checked every tile, plus full-resolution frames at 4.0, 11.4/11.5 (mid caption change), 20.0, 24.7, 27.7, 32.0 and 37.0 s.

- **0 to 2 s:** the title card, with both the "Spacefast Time Machine" title and the "Every version. Within reach." tagline legible. The crossfade into the footage finishes by 2.5 s.
- **2 to 7 s:** the real comparison (v2 meets v1), app content at 1.11x. Caption 01 is visible.
- **8 to 11 s:** v1 selected, now "v1 meets v2". The real preview reload flash at the click is kept unedited. The caption dips through navy and old and new text never overlap (verified at frame 344).
- **11 to 16 s:** zoomed to 1.25x on the comparison panes. The v1 viewport visibly narrows (1280 to 580 px label) and resets. Caption 02 is visible.
- **17 to 22 s:** at 17 s the frame is mid-pan as the app scrolls after the Files click. The unified diff with red and green lines is legible at 1.25x. Caption 03 is visible.
- **23 to 25 s:** the Before / after split, with the Before · v2 and After · v1 headers readable.
- **26 to 29 s:** the share modal at 1.30x. The title, the "v2 → v1, in the current view" sentence and the URL field are readable. The earlier sliver of the dimmed app sidebar at the left edge is fixed (the crop starts at x=252).
- **30 to 34 s:** back on Compare at full crop. The app's own banner reads "Restore is disabled in this shared demo." Caption 05 shows the PUBLIC DEMO – RESTORE DISABLED tag and the connected-account safeguard sentence. No restore action appears.
- **35 to 38 s:** the end card shows both URLs in large type, plus the note that this was recorded read-only on the public demo.

## Sound checks (programmatic; `python -I verify_sound.py` plus ffmpeg `ebur128=peak=true`)

| Check                                                      | Result                                                                                                                                                                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| True peak (ebur128, final AAC)                             | −11.8 dBTP, 6.8 dB under the −5 dBTP ceiling. `sound.py` asserts a 4x-oversampled true peak below −8 dBTP before writing                                                                                                                   |
| Sample peak (decoded AAC / WAV)                            | −11.83 / −11.84 dBFS. Samples at or above 0.99 full scale: 0, so there is no clipping                                                                                                                                                      |
| Integrated loudness                                        | −27.3 LUFS, LRA 19.9 LU. Expected for a sparse layer: fixed gains, never loudness-normalized, no limiter                                                                                                                                   |
| Sparseness                                                 | 67.6% of the timeline is below −60 dBFS. There is no constant bed                                                                                                                                                                          |
| Effect levels                                              | Opening and closing marks −12.4 / −13.6 dBFS peak. Clicks −15.4 to −16.9. Resize and reset ticks −23 to −24. Swishes about −29 to −30                                                                                                      |
| Spectrum                                                   | Energy below 80 Hz and above 10 kHz: 0.00% each (70 Hz high-pass, 14 kHz low-pass). No rumble or harsh air. DC offset is about 1e-7                                                                                                        |
| Sync (onset detected in the decoded AAC against the event) | All 15 click and tick onsets land 19.5 to 19.7 ms before their measured frame events, which is the intended 20 ms lead. Opening mark +4.8 ms, closing mark +8.4 ms (bell attack). AAC priming is handled by the MP4 edit list, so no drift |
| Tail                                                       | Below −60 dBFS from 38.67 s. The last 0.3 s peaks at −84 dBFS, and the file ends in silence with no cut-off tail                                                                                                                           |
| Reproducibility                                            | Rerunning `sound.py` writes a bit-identical WAV (seeded RNG)                                                                                                                                                                               |
| Visual check                                               | Spectrogram and waveform images (`work/spectrogram.png`, `work/waveform.png`) show discrete events only at the planned times, with silence between them                                                                                    |

**Listening limitation:** I had no audio playback or listening tool in this session, so I have not listened to the mix. Everything above was verified by measurement only. Things only a listener can judge: whether the chime marks feel elegant and not like notifications, whether the swishes (about −30 dBFS, noise) come through on small laptop speakers, and whether the seven resize ticks feel pleasant and not fussy. Each is one gain or pitch constant in `sound.py` (`MASTER_DB`, `SWISH_TRIM` and the per-call dB values), and a rebuild takes seconds without touching the picture.

## Honesty / constraints checklist

- All footage is the real recording, played in real time. There are no speed ramps, fake cursor or simulated clicks. The resize is the app's own keyboard-driven behavior.
- Restore is never shown or implied. It is labelled disabled, and the safeguards are explained as the connected-account flow.
- No music, voice, downloaded samples or captured site audio. The only generated media is the sound-effect layer, synthesized in `sound.py`. It is editorial and is not the website's own audio. Nothing in it suggests that a restore happens.
- Motion is limited to eased crop pans of about 0.7 s, crossfades of 0.4 to 0.5 s and no flashes.

## Known weak spots

- At the 25 fps to 30 fps conversion, every fifth source frame is shown twice. The keyboard resize steps can show a very slight judder, though it is hard to notice in UI footage.
- The left edge of the zoomed Files and Resize crops cuts through the Version history card. This is intentional, to keep the diff larger.
- The tiny app text inside the 33%-scaled site previews is unreadable, as it is in the app itself. The captions carry the meaning.
- The end card's live-demo line ends in `?demo=1`. The URL the share modal produces carries extra parameters, which is truthful because it is a different link.
