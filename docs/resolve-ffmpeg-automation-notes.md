# DaVinci Resolve + ffmpeg automation - general technical notes

Only **reusable methods** that do not depend on a specific channel or project.
Channel-specific style values (fonts, colours, track layout) are in [editing-style.md](editing-style.md).

## 1. DaVinci Resolve scripting API limits (free edition, via the MCP server)

- **Speech-to-subtitles (`Timeline.CreateSubtitlesFromAudio`) is Studio only.** On the free edition it returns only
  `success:false` with no error message (silent failure). If later calls start failing one after another after a
  Studio-only call, Resolve may be stuck behind an upsell dialog - a person has to close it.
- **There is no API to import an SRT into a subtitle track** (File > Import > Subtitle is UI only).
- **`Timeline.InsertTitleIntoTimeline` / `InsertFusionTitleIntoTimeline` cannot target a track.**
  Measured: they always insert at **the very start of the timeline (frame 0)** on the current video track (usually V1),
  and ripple every later clip (other tracks included) by the inserted length. `insert_fusion_title`, on the other hand,
  was observed to **append to the end of the track** (repeated calls on the same track stack up at the end).
  -> Neither can target a track, so moving to the wanted track needs `move_clips`.
- **But title / generator clips have no `MediaPoolItem`, so `move_clips` cannot move them**
  (`"Timeline item has no MediaPoolItem (generators / titles without pool media cannot use this)"`).
  -> Conclusion: **automating frame-exact placement of captions on a chosen track / position through the API is
  practically impossible.** That is why the workaround is "make captions in ffmpeg and lay them on as ordinary clips".
- **`timeline.ripple_insert` always pushes every track**, so inserting a new clip into an existing multi-track layout
  (parallel layers such as background + main video) also shifts the other tracks and breaks alignment. When clips must
  go onto several tracks at once, **pass the `clip_infos` of every track in a single `ripple_insert` call** (separate
  calls per track make the second call push the clip inserted by the first).
  - `start_frame` / `end_frame` in `clip_infos` are **SOURCE frames (frame numbers of the source clip at its own fps)**.
    With a source whose fps differs from the timeline (e.g. a 24 fps source on a 60 fps timeline), compute "how many
    seconds" as `source fps × seconds`; Resolve conforms to the timeline fps (measured: 1440 frames of a 24 fps source
    (= 60 s) became exactly 3600 frames (= 60 s) on a 60 fps timeline).
  - It is destructive and needs a `confirm_token`. **When calling again with the token, keep exactly the same parameters
    as the original call** (dropping an extra parameter such as `dry_run` on the second call was once treated as a
    parameter mismatch and handled like a dry run again).
  - Even with `success:false` + `missing:[...]` in the response, the insert may have worked if `readback.after_counts` or
    `found_duration` from a real `get_items_in_track` query matches the expectation (probably a false alarm from the
    pre-check comparing pre-conform frame counts - guess). **Always re-check with `get_items_in_track`.**
- `insert_title` / `insert_fusion_title` require the `name` parameter. Fusion template names are sensitive to Unicode
  typos (e.g. `즈` versus a similar-looking precomposed syllable) - if it fails, suspect a typo first.

## 2. Analysing Fusion Text+ templates

The actual style values of a Fusion template can be extracted even through the Resolve bridge (free edition):

1. Insert the real template into the timeline with `timeline(action="insert_fusion_title", params={"name": "<exact
   template name>"})` (must match the Effects Library display name exactly; the leading number is often unnecessary -
   e.g. "펫&키즈06" worked, while adding a made-up prefix such as "11. 펫&키즈06" can fail).
2. Export that item's Fusion composition as a `.comp` file (Lua text format) with
   `timeline_item_fusion(action="export_comp", params={track_type, track_index, item_index, index:1, path})`.
3. Read the file as plain text. Confirmed structure:
   - `CustomData.TEMPLATE_ID` exposes the template's real pack path (e.g. `Edit/Titles/09. 여행&브이로그 11종/09.
     여행&브이로그06`) -> the package name and item count ("11종") can be read from it.
   - `Tools.Template` is a `TextPlus` node whose `Inputs` hold `Font`, `Size`, `Center` (normalised x, y), `StyledText`
     (default placeholder text), and per-layer colour / thickness / offset / softness as
     `RedN/GreenN/BlueN/ThicknessN/OffsetN/SoftnessN` (N = 2, 3, 4, 5...).
   - **Measured: no animation keyframes at all** - these templates are not motion graphics presets but "static style
     presets" of a font plus layered outlines / glows. TextPlus stacks layers from Element1 (text fill) to Element5;
     **a higher number is a layer further back (outside)**.
   - Colours are 0-1 floats; convert to 0-255 with `round(v*255)`.
4. **Easy mistake:** repeated `insert_fusion_title` calls stack items at the end of the track, so `item_index` must be
   increased correctly for every later export. Fixing `item_index=0` re-exports **the first inserted item every time**
   (if every result is identical, suspect this bug).
5. When a template is found but the name does not match, the cause is usually not knowing the exact item name -
   knowing only the package name (e.g. "슈돌20종") without the item number makes insertion fail. Searching the file
   system for the template assets (`AppData\Roaming\Blackmagic Design\...\Fusion\Templates`,
   `ProgramData\Blackmagic Design\...\Fusion\Templates`) **usually finds them empty** - the pack files live elsewhere
   or were imported into a PowerBin without the originals - so trying several name candidates is faster than digging
   through the disk.

## 3. Making captions with ffmpeg + ASS

### Checking fonts

- Extract the font's **internal registered name** with `fontTools` (`pip install fonttools`) - it often differs from the
  file name:
  ```python
  from fontTools.ttLib import TTFont
  f = TTFont(path)
  f['name'].getDebugName(1)  # family name - use this as the ASS Fontname
  f['name'].getDebugName(4)  # full name (if needed)
  ```
- The ASS `Fontname` must match this internal name exactly.
- **Measured:** the gyan.dev ffmpeg full_build (`--enable-fontconfig`) finds fonts installed per user on Windows
  (`AppData\Local\Microsoft\Windows\Fonts`) without a `fontsdir`. So "the font does not show" is usually caused by
  **writing the file name into Fontname**, not by a missing file.
- The surest way to verify the font was applied: render the same text with that font and with a default font (e.g.
  Malgun Gothic) and compare the images (different = success).
- With the `fontsdir` option, the colon in a Windows `C:` path collides with the filtergraph option separator (`:`).
  Git Bash (MSYS) path conversion makes it worse, so **run it from PowerShell with an absolute path and forward
  slashes - but first check that fontsdir is needed at all** (usually it is not; see above).

### Converting Fusion coordinates and sizes to ASS

- Fusion TextPlus `Center` is a normalised `{x, y}` (0-1) with **y = 0 at the bottom, 1 at the top** (OpenGL style).
  The `MarginV` of ASS `Alignment=2` (bottom centre) is "distance from the bottom of the screen", so conveniently it maps
  **without conversion: `MarginV = round(PlayResY × py)`** (x = 0.5 is simply centred).
- `Fontsize ≈ round(PlayResY × size)` is the starting point, but **the theoretical value can overflow the frame with
  large fonts or near the edges** (especially py above about 0.85). Render, look, and fine-tune MarginV - the formula is
  a starting point, not the answer.
- ASS colours are `&HAABBGGRR` (alpha + BGR). From Fusion / ordinary RGB 0-1 floats:
  ```python
  def to_ass_color(r, g, b, a=0):
      R, G, B = round(r*255), round(g*255), round(b*255)
      return f"&H{a:02X}{B:02X}{G:02X}{R:02X}"
  ```
- Fusion `Softness` (soft outline / glow) has no direct ASS field - approximate it with override tags such as
  `{\blur3}`-`{\blur4}` in front of the Dialogue text.
- If a template is built from **rectangle / box layers** (e.g. a memo-paper background), `Outline` / `Shadow` cannot
  reproduce it; the shapes have to be drawn with `\p` vector drawing - much harder than ordinary outline + glow captions.
- Long caption text (full sentences) wraps or leaves the frame with large fonts - make a habit of grabbing rendered
  frames to check the fit (do not trust the numbers alone).

## 4. Local Whisper (faster-whisper) pipeline

Reusable script: [whisper_transcribe.py](whisper_transcribe.py)

### Installation and Windows issues

```bash
pip install faster-whisper
```

- **`OMP: Error #15` crash:** the OpenMP bundled with ctranslate2 collides with another library's OpenMP (usually
  numpy / MKL). Work around it with `KMP_DUPLICATE_LIB_OK=TRUE` (officially discouraged because of the safety trade-off,
  but practical for a local one-off script).
- **`OSError: WinError 1314` (symlink privilege error):** on a Windows account without admin rights or developer mode,
  HuggingFace Hub fails to create symlinks in the model cache. Work around it with `HF_HUB_DISABLE_SYMLINKS=1` (uses a
  little more disk, works fine).
- Even if Korean output looks garbled in the console (mojibake), a file saved with `encoding='utf-8'` is fine - open the
  file itself with the Read tool (do not judge failure from terminal output).

### Choosing a model size (i7-1260P, 12 cores / 16 threads, no GPU, int8 on CPU, measured)

| Model | Time for a 60 s clip | Perceived accuracy |
|---|---|---|
| small | a few to tens of seconds | frequent repetition / slurring errors (e.g. "어?" wrongly repeated 7 times) |
| medium | about 48 s | far more stable - skips ambiguous spans instead of forcing text; natural sentences |

**The assumption "this computer cannot run a better model" is mostly wrong for shorts (tens of seconds to a few
minutes).** medium runs close to real time, and large is expected at about 1.5-2.5x medium on this CPU (estimate) -
still fine for batch work. It only matters when latency matters, such as live streaming transcription.
-> If accuracy is lacking, **measure one model size up before giving up on the model.**

### Improving accuracy

1. **`initial_prompt`:** giving the channel's proper nouns (speaker names, catchphrases, brand names) as a prompt before
   transcription raises their recognition rate. Entirely new coinages (the stream's own meme words) can still be wrong
   with a prompt - it is not a cure-all.
2. **Dictionary post-processing:** proper nouns that `initial_prompt` misses are fixed most reliably by a final regex
   replacement dictionary, e.g. `아[펨킨]무` -> `담팬무`. Each channel has recurring misrecognition patterns, so a list made
   once keeps paying off (see `CORRECTIONS` in `whisper_transcribe.py`).

## 5. ffmpeg vs DaVinci Resolve - when to use which

- **If a person plans to step in and polish in the Resolve UI** -> work in a Resolve project (it leaves a `.drp` project
  that can be edited freely in the GUI later).
- **For an automated pipeline judged only by its output, with no human in the middle** -> ffmpeg wins.
  The Resolve scripting API assumes a GUI editor, so it keeps needing workarounds (`confirm_token`, per-track ripple
  pushes, titles that cannot be placed or moved by track), while ffmpeg handles scale / overlay / concat / caption
  burn-in deterministically in a single filtergraph. Far fewer failure points, and faster.
- **A mixed strategy also works:** structural parts such as background compositing and placing the main video go on a
  Resolve timeline (multi-track placement in one `ripple_insert` - see section 1), and only the captions that need
  precise timing are rendered as a separate video in ffmpeg and laid on a track as an ordinary clip. Useful to get
  around the Resolve API limit (no automatic subtitle-track placement) while keeping a project file.
