# Product walkthrough

[Watch the video](https://space-xx8uckgsp.space.fast/walkthrough/) · [Download the MP4](https://space-xx8uckgsp.space.fast/walkthrough/spacefast-time-machine-walkthrough.mp4)

The 39.466-second walkthrough uses a real recording of the deployed public demo. Claude Code read the user's existing video-editing skill, planned the shots, edited the actual footage, rendered two passes, and reviewed the final contact sheet. Codex independently checked the frames, file metadata, and full decode before publication.

The video has burned-in chapter captions, a separate WebVTT track, and a text transcript on its player page. Its chapters show version selection, side-by-side previews, viewport resizing, real served-file diffs, before/after text, and an exact comparison link. The restore chapter explicitly labels the public demo as read-only and describes connected-account safeguards. No simulated restore is presented as a live action.

The MP4 is H.264 High, 1920×1080, yuv420p, 30 fps, 1,184 frames, BT.709, with faststart enabled. It is 8,024,598 bytes. At the user's request, Claude added original synthesized clicks, light transitions, and opening/closing sounds in a 48 kHz stereo AAC track. These are editorial effects, not captured website audio. No music or voice is included. The reviewed picture is unchanged; the silent pass remains preserved locally. Full decode completed without errors; automated black-frame detection found no black segments. See [Claude's edit notes](walkthrough/SHOTLIST.md) and [QA report](walkthrough/QA.md). Sound levels, clipping, and timing were checked programmatically; no listening review is claimed.

The generated MP4 is hosted on Spacefast and excluded from Git to keep the source repository small. To include it in a fresh self-hosted build, download the public MP4 into `public/walkthrough/spacefast-time-machine-walkthrough.mp4` before building. The poster, captions, and player page are included in source. An offline copy was also delivered to the user's Downloads folder.

To rebuild the edit, download the [original public-demo recording](https://space-xx8uckgsp.space.fast/walkthrough/source-recording.webm) as `docs/walkthrough/source-recording.webm`. With Python, NumPy, SciPy, Pillow, ffmpeg and the Windows Segoe UI fonts available, run `python render.py spacefast-time-machine-walkthrough-silent.mp4`, then `python sound.py` in `docs/walkthrough/`. `TM_WALKTHROUGH_SOURCE` can select another local copy of the recording. These edit scripts are optional; the web application's build does not require Python or video rendering.

The launch card is a deterministic 1200×630 PNG using an actual public-demo capture. `scripts/create-social-card.py` regenerates it with Pillow and the supplied README screenshot (Windows Segoe UI fonts). Both Open Graph and Twitter metadata point to the same versioned public image.
