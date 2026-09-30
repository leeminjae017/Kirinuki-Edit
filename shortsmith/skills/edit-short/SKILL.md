---
name: edit-short
description: Edit a vertical short from a long recording with the shortsmith CLI - choose what to keep from the transcript, write captions and fx.json, render, and apply feedback with minimal re-rendering. Use when the user asks to cut, caption, style or re-edit a short or highlight video.
---

# Edit a short with shortsmith

The CLI does everything deterministic (waveform cuts, crop, GPU encode, React caption rendering, caching).
Your job is only the judgment: **what to keep, what the captions say, which caption kind and effect goes where.**
Never write ffmpeg filter graphs, ASS tags or React code for a single video - if a look is missing, it belongs in a preset.

Check the machine first: `shortsmith doctor --preset <id>` (ffmpeg, GPU encoder, fonts, preset files).

## 1. Project

```
shortsmith init <dir> --source <video> --preset <id>     # writes edit.json
shortsmith presets                                        # available presets
```

Read the preset's `guidance`, `captions.kinds[*].use`, `captions.rules` and `pacing` before deciding anything.

Set `crop` in edit.json from a frame of the source (put the face inside, keep chat bubbles and alerts out;
`layout.cropAspect` is the target width/height).

## 2. Transcript and keep ranges

- Transcribe **once** (e.g. faster-whisper with word timestamps). Do not re-transcribe later; if you think you need to,
  say why and ask. Questions like "does a cut clip a word", "is there dead air", "do captions match the sound" are
  answered from levels, not from a new transcript.
- From the transcript pick `keep` ranges in source seconds (loose is fine). Use transcript times only to *choose*
  content - the waveform decides the exact cut points: `shortsmith cuts <dir>` moves edges to quiet points and removes
  dead air inside each range. Sources with music or room noise: set `levelSource` to a band-limited measuring copy.
- Check the total against `pacing.targetTotalSec`.
- A keep entry can carry `crop` (framing per scene), `gainDb` (boost a quiet scene, at most +6), or
  `{ "source": "outro.mov", "s": 0, "e": 7.47 }` for another file (not sped up, loudness matched on its own).
  `"speed": 1.1` in edit.json speeds up the main part when the user asks.

## 3. Captions

`captions.csv` with `start,end,speaker,text`. Output clock by default (`shortsmith map <dir> <sourceSec>` converts);
`"captionClock": "source"` for source seconds, `"timeline"` for the cut timeline before `speed`. A row with speaker
`title` (or 제목) is the title. The speaker picks the caption kind through `captions.speakers` / `speakerSuffix`
(e.g. HostAngry -> outburst); other speakers become guests with their own color when the preset has `guestKind`.
Mark single words with «word|name» (`markColors`, `markKinds`).
Follow `captions.rules` (e.g. no periods, repeats written out). Where the transcript is unclear, keep your best guess but
**mark it as a guess** in your notes; when the user corrects a word, the user's word wins over any earlier reasoning.

## 4. fx.json - the only hand-written design file

```json
{
  "kinds":  { "exact caption text": "punch" },
  "labels": [{ "text": "※ explanation", "from": 0, "to": "caption text", "y": 490 }],
  "images": [{ "src": "file.png", "from": "caption text", "to": "caption text", "x": 540, "y": 1000, "w": 420 }],
  "chats":  [{ "lines": ["exact chat text"], "from": "caption text", "to": "caption text" }],
  "inserts": [{ "from": 12.3, "to": 15.0, "grab": 140.2, "rect": [1578, 36, 216, 68] }],
  "bubbles": [{ "from": "caption text", "to": "caption text", "box": [950, 300, 1820, 660], "tail": [[956, 415], [876, 510], [956, 545]] }],
  "fx": [{ "type": "zoom", "z": 1.2, "at": ["caption text"] },
         { "type": "push", "from": "caption text", "to": "caption text", "z0": 1, "z1": 1.15 },
         { "type": "shake", "at": ["caption text"] }, { "type": "mono", "at": ["caption text"] },
         { "type": "blur", "from": "caption text", "to": "caption text", "sigma": 14 }]
}
```

Places are caption texts, so effects follow their lines when cuts change. Most lines stay the default kind.
Inserts cut a still out of the source (`grab` source seconds, `rect` x,y,w,h in source px, tight around the chat bubble
or alert) and show it large; captions hide meanwhile. Without a background image an insert covers only the video window (`"area": "window"`), so the preset background stays; `"area": "canvas"` covers everything. Images take `"bounce": {"period", "amp"}` for a talking character, and `"lead"` (seconds) to come up before `from` - a chat the host answers should appear before her reply caption.
Use only images the user provided or approved; ask before downloading anything.

## 5. Build and check

```
shortsmith build <dir>            # cuts (if missing) -> body -> scene -> render
shortsmith still <dir> 12.4 a.png # one frame, only when a visual judgment is needed
```

Report what you measured versus what you guessed. Do not paste large tables (waveforms, full transcripts) into the
conversation - print conclusions and the few lines that matter.

## 6. Feedback rounds

Re-work only what the feedback touches:

| feedback | re-check | re-render |
|---|---|---|
| caption wording / translation | that line | automatic: only chunks containing it |
| "this cut is wrong" at a place | ±2 s of levels there | that piece and later chunks |
| framing / zoom | that scene | its chunks |
| the same kind of complaint a second time | question the method, re-plan everything | all |
| global style / length / tone | everything | all |

Before a full re-plan, say in one line why and ask. Re-planning is not re-transcribing.

Audio: never add filters (denoise, highpass, limiter, loudnorm) unless the user asks. The renderer applies one fixed gain.
