# Spacefast Time Machine: walkthrough shot list

**Concept:** a calm, captioned tour with sparse, subtle sound effects. It is a tour of the real public demo. One recording, played in real time with no speed changes and no faked UI. A navy caption panel (#121c23 / #c8eea5) on the left replaces the app's static sidebar, and the app content fills the remaining 1500x1080 at 1.11x to 1.30x. Only the crop window moves, with eased 0.7 s pans between chapters. There is no cursor overlay, strobe or kaleidoscope.

Source: `../raw/page@3eec0abb85de04ecfcfa84ba1274be4a.webm` (1600x1000, 25 fps, 32.40 s). Output time = source time + 1.844 s during footage.

Event times were measured by frame differencing (`find_events.py`): v1 selected 6.24 s; resize steps 9.76 to 11.16 s (7 steps); reset 13.80 s; Files 15.32 s; Before/after 20.72 s; Share 23.76 s; modal closed 28.28 s; Compare 28.44 s.

| Out (s)      | Src (s)                                          | Shot                                                                             | Crop                                                            | Caption                                                                                                                                                               |
| ------------ | ------------------------------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.0 to 2.5   | –                                                | Title card; crossfades into footage over its last 0.4 s                          | –                                                               | Spacefast Time Machine / Every version. Within reach.                                                                                                                 |
| 2.5 to 7.8   | 0.656 to 6.0                                     | Comparison loaded, v2 meets v1                                                   | FULL (x1.11)                                                    | 01 Compare any two versions                                                                                                                                           |
| 7.8 to 11.3  | 6.0 to 9.5                                       | v1 picked in history: v1 meets v2. Previews reload for about 0.3 s               | FULL, then pan to RESIZE at 9.0 to 9.7                          | 01 Pick a version from history                                                                                                                                        |
| 11.3 to 17.0 | 9.5 to 15.15                                     | Keyboard narrows v1 viewport 700px in 7 steps, then resets                       | RESIZE (x1.25), then pan to FILES at 14.6 to 15.3               | 02 Check any screen size                                                                                                                                              |
| 17.0 to 22.4 | 15.15 to 20.55                                   | Files tab: served-file unified diff                                              | FILES (x1.25)                                                   | 03 See what changed                                                                                                                                                   |
| 22.4 to 25.4 | 20.55 to 23.6                                    | Before / after view                                                              | FILES                                                           | 03 Before / after                                                                                                                                                     |
| 25.4 to 30.0 | 23.6 to 28.15                                    | Share modal with the exact comparison URL, then close                            | Pan to SHARE (x1.30, URL not stretched further) at 23.8 to 24.5 | 04 Share the exact comparison                                                                                                                                         |
| 30.0 to 35.2 | 28.15 to 32.36 (+0.95 s hold on last real frame) | Back on Compare. The app banner reads "Restore is disabled in this shared demo." | Pan back to FULL at 28.3 to 29.0                                | 05 Restore, with safeguards + tag PUBLIC DEMO – RESTORE DISABLED + "Connected accounts: typed confirmation, provider approval when required, then live verification." |
| 35.2 to 39.5 | –                                                | End card (0.4 s crossfade in, then 3.9 s full)                                   | –                                                               | Live demo URL, GitHub repo, "Recorded read-only on the public demo, where restore is disabled."                                                                       |

No restore is shown or implied. The restore chapter only explains the connected-account flow and is labelled as disabled.

## Sound design (added on request; replaces the earlier silent choice)

A restrained layer of original editorial effects. It is not captured website audio. There is no voice, music bed or downloaded sample. Every sound is synthesized in `sound.py` from sines and seeded noise, so the layer is fully reproducible. The effects are sparse: about 68% of the timeline sits below −60 dBFS. Effects mark only real UI events and the existing crop pans. Picture timing is unchanged.

| Out (s)                  | Sound                                                                                                                                                                     | Peak (dBFS)           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 0.18 to 2.6              | Opening mark: soft rising D-major chime arpeggio (D5 F#5 A5, then a quieter D6) over a faint D/A sine bed, with a small room                                              | −12.4                 |
| 2.05 to 2.60             | Light airy swish into the footage crossfade                                                                                                                               | −28.8                 |
| 8.064                    | Gentle click: v1 selected (event 8.084)                                                                                                                                   | −15.4                 |
| 10.76 to 11.71           | Swish for the pan into chapter 02                                                                                                                                         | −30.2                 |
| 11.584 to 12.984         | Seven tiny ticks on the measured resize steps (11.604, 11.844, 12.044, 12.284, 12.524, 12.764, 13.004). Pitch drifts down a quarter-tone per step as the viewport narrows | −23.3 to −23.8        |
| 15.624 / 15.694          | Two tiny rising ticks: viewport reset (15.644)                                                                                                                            | −23.0                 |
| 16.36 to 17.31           | Swish for the pan to Files                                                                                                                                                | −29.5                 |
| 17.144 / 22.544 / 25.584 | Clicks: Files (17.164), Before / after (22.564), Share (25.604)                                                                                                           | −15.8 / −16.2 / −16.0 |
| 25.62 to 26.57           | Swish for the pan to the share modal                                                                                                                                      | −29.4                 |
| 30.104 / 30.264          | Softer, lower click for modal closed (30.124), then a click for Compare (30.284)                                                                                          | −16.9                 |
| 30.19 to 31.09           | Softest swish, for the pan back out                                                                                                                                       | −29.8                 |
| 35.10 to 38.7            | Closing mark: a light swish, then a descending chime answer (A5 F#5 D5) over the faint bed. Below −60 dBFS from 38.67 s                                                   | −13.6                 |

Clicks lead the measured frame by 20 ms, because the UI reacts a frame after the key or click. In chapter 05 nothing plays beyond the two clicks and the pan swish. There is no rising "success" sound, and no sound suggests that a restore happens. The demo stays read-only.

The silent pass is kept as `spacefast-time-machine-walkthrough-silent.mp4`.

## Files

- `render.py`: the whole edit (timeline, crops, captions, title cards, encode). Run `python -I render.py`. It writes the silent picture. If you re-render it, write to `spacefast-time-machine-walkthrough-silent.mp4` and then run `sound.py`.
- `sound.py`: synthesizes the sound layer into `walkthrough-sound.wav` and muxes it as AAC. The H.264 stream is copied from the silent pass. Run `python -I sound.py`.
- `verify_sound.py`: decodes the AAC from the final MP4 and reports peaks, clipping, per-event onset timing and levels.
- `find_events.py`: frame-difference event finder used to place the cuts.
- `walkthrough.vtt`: captions matching the on-screen text.
