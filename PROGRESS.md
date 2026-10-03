# Progress log (started 2026-09-03)

Read this file first when picking the work up again. Newest entries are at the bottom.

## State as of 2026-09-03 to 09-05

### Outputs
- `edited/고구마_ko.mp4`, `edited/고구마_en.mp4` - 51.09 s, 2 cuts, 18 captions
  (re-rendered from the dashboard timeline on 2026-09-04)
- `edited/마로_ko.mp4`, `edited/마로_en.mp4` - 16.08 s
- `edited/담아맷돌_claude_edit.mp4` - 32.40 s
- `edited/네모에게비틱_ko.mp4`, `_en.mp4` - 97.10 s (first **longform** edit, 2026-09-05)
- `edited/마법의날_ko.mp4` - 31.87 s (2026-09-07, first short with caption entrance animation)

### Styles (registered in the dashboard)
`dashboard/styles/`
- `담유이_다인쇼츠.json` - two or more people. Split into host (Damyui) and guest roles
- `담유이_1인일반쇼츠.json` - the same without guests
- `담유이_영도쇼츠.json` - reactions to video donations. No crop, full frame, loose cuts, captions placed under the video band
- `담유이_일반롱폼.json` - **landscape longform** (analysed 2026-09-04). Unlike the three above: 1920x1080, 60 fps,
  no preset background, no crop, stream overlay kept. See "Longform style analysis" below

Shared rules (the three shorts styles): cuts come only from the waveform (ASR times not used), caption width is measured
in pixels, not characters (`textwidth.py`, PIL width x 0.7286), no full stops, repeats are written out twice when they fit
and counted as (xN) when they overflow, outburst captions use a yellow -> orange-red gradient.

### Dashboard
Opening `대시보드.cmd` starts the server; closing the tab stops it.

**Projects - one edit is one project.** All dashboard state (cuts, captions, layout, edit notes, style choice) belongs to
the open project. State used to be one blob, so starting the next edit overwrote the previous one.

- Top-left **project chip** - what is open. Click to open the manager
- Top-right **menu** - new project / project manager / save (Ctrl+S) / import / export to file / clear this project
- **Project manager** (Ctrl+Shift+P) - five cards per row. Each card shows a thumbnail rendered from the final preview,
  name, style, length, cut / caption / note counts and modified time. Hover for open, rename, duplicate, delete
- Stored in `projects/<id>/` (project.json + meta.json + thumb.jpg). Deleted projects move to `projects/_trash/` and can
  be restored
- Without the server, state is stored in the browser and moved to disk as soon as the server connects
- Ctrl+S saves, and about 20 s after the last change it saves once more quietly. Closing without saving keeps the last
  state in the browser
- Edit notes (NOTES in export_project.py) appear in the log when a project opens. Before, they existed only in the file

**Everything in the final is a clip.** The background preset video, source video and audio, captions and the top caption
each sit on their own track. The top caption is a caption too, so it is exported as a caption clip and its text and design
can be edited like any other caption. Video clips carry a screen position (frame, canvas pixels): the background fills
the screen, the source is the middle band. Track roles (source / background / caption / title) tell the pipeline which
track is which - otherwise the background turns into cuts and the title into caption CSV rows.

- The preview stacks video clips in track order (upper track in front)
- Caption vertical positions were matched by measuring final frames. ASS places text on the baseline, the preview in the
  middle, so the difference (0.44 x size) must be subtracted. Top caption 16.3%, captions 74.9% - same as the final
- Why the preset background did not show: the server connects after the page, and the preview never redrew. It now
  redraws when the server connects
- Inspector **all captions** tab: captions as a list, edited in place. The caption on screen is highlighted in the same
  purple as caption clips. CSV open / save buttons removed
- The log pane was removed from user edit. Warnings and errors show as toasts
- **The font field lists every font on this computer.** The server reads font name tables (`/api/fonts`) and the dashboard
  keeps only names the browser resolves. The browser cannot find `BM JUA OTF` but can find `BM JUA_OTF` - which is why only
  the top caption was rendering in Malgun Gothic
- **Font size factor.** libass sizes by font height (winAsc+winDesc), CSS by em. Multiplying by `upem/(winAsc+winDesc)`
  makes them equal (CookieRun 0.735, Jua 0.912). Against the final, ink widths 420:423 and 668:668
- **Move, scale and crop directly in the preview.** Selecting a clip shows a box with corner handles. Shift keeps aspect,
  Alt slides the crop only. The inspector also has numbers (screen position, zoom, crop, caption x / y)
- Speaker names are not drawn (they are not in the final). They can be turned on in the inspector
- The timeline wheel scrolls horizontally (Shift vertical, Ctrl zoom)
- **Fixed clips not moving properly on the timeline.** The snap function `snap(t)` and the undo snapshot `snap()` shared a
  name, so dragging a clip returned a JSON string instead of a position and start became NaN. Saving turned NaN into
  null, and the 고구마 project held four clips with no position (fixed).
  Also fixed: broken clips are put back on open; a drag starts only after 3 px (a click must not nudge a clip); the
  timeline auto-scrolls at the edges (moving far); trim handles 6 -> 10 px; narrow clips move instead of trimming;
  Shift+click to deselect no longer drags; a cut passes screen position, crop and reverse to the right half too
- Screen position and crop reach the render: import_project.py -> layout_override.json -> build_edit.py (ffmpeg crop= /
  overlay=x:y)

**UI cleanup (2026-09-04).** Things that did not need to be shown were all forced on screen. Three changes:

- **Toolbar icons only.** Text removed from cut, delete, add caption, duplicate, add track, sync, snap and render and moved
  into tooltips. Save and menu in the top bar are icons, server status is one dot. "Audio preview" is a speaker button.
  New magnet icon for snap and layer icon for add track; the lock icon was missing from the sprite entirely and was added
- **Inspector in three layers.** One header line (name, time) -> click for a read-only list (track, start, length, end,
  source) -> "details" opens the editable numbers. Start, length and source offset were always expanded and pushed the
  caption text down. "Go to playhead" and "go to clip start" buttons removed. Captions keep text, font, size, colour and
  vertical position expanded; outline, background, horizontal position and alignment are folded. Video screen position
  and crop are folded too (set once, rarely revisited). Long hint text cut to one line
- **The timeline centres vertically.** With few tracks they clustered at the top with empty space below. The spare height
  is split in half to centre the track block (`--tl-vpad` applied to labels and lanes)
- **The timeline follows the playhead when it leaves the view,** putting it at 20% from the left - a little of the past and
  plenty of what is coming. While it stays on screen nothing moves (no jumps while scrubbing). Redraw and zoom set the
  scroll themselves, so they opt out with `setPlayhead(t, quiet, noFollow)`

**Cut editing (2026-09-04).**

- **Fixed the preview going blank after a cut.** Each clip had its own video tag, so crossing a cut threw the tag away and
  made a new one - re-reading and seeking the same file from scratch, blank for over a second. This happened after
  47.94 s (고구마's second cut). Tags are now shared per track + source, so adjacent clips reuse the tag and only move the
  time (the background video keeps readyState 4). Audio fixed the same way - sound cut out and reloaded at cuts
- **Cuts apply to all tracks.** Before, a selected clip was cut alone, so cutting with only the video selected left audio,
  captions and background whole. Pulling the rest forward then desynced sound and picture. Now every track under the
  playhead is cut (except locked tracks). To cut one track, lock the others
- **i / o mark a range.** i is the start of the range to remove, o the end. Both cut all tracks there, and with both set
  the clips in between are selected - one Delete removes the range. The marked range shows as a band. c (cut at
  playhead) is unchanged. Buttons stayed; only shortcuts were added. ㅑ / ㅐ (Korean layout) work too
- **Dragging empty space selects several clips,** like dragging over rows in a list. Touching is enough (requiring full
  enclosure makes long clips impossible to catch). Shift or Ctrl adds to the selection. Releasing without moving clears
  the selection and moves the playhead as before
- **The outburst caption outline was wrong.** ASS writes colours as &H00BBGGRR, but the outburst outline alone was copied
  straight from &H00382C1C to #382c1c - the final is dark blue-grey #1C2C38, the preview was dark brown. The other values
  are right: fill top #FBD65A -> bottom #FB5D4B, lime shadow #DAFD73, outline 7 / shadow 6.
  (The lime was once read as the top fill colour, but magnified it lies along the bottom edge, not inside the letters.
  fillTop #DAFD73 in the style JSON is that old reading and is stale - build_ass.py is the source of truth.) Saved
  projects are fixed on open, and two places in export_project.py were fixed
- **Outburst switch in the inspector.** The preview and the list drew outbursts, but nothing turned them on. The pipeline
  identifies outbursts by speaker name (speaker ends in "...발끈"), so the switch moves style.emphasis and the speaker
  label together - otherwise the preview is orange while the CSV speaker stays the same and it renders as a white caption

**Fixed outburst captions looking dark and smeared only in the preview (2026-09-04).**

They were drawn as one layer. A gradient set with `background-clip:text` is a background and sits under the text, while
`-webkit-text-stroke` straddles the middle of the stroke. With transparent text colour nothing covered the inner half of
the outline, so a 2.2 px outline on 15 px text ate most of each stroke (`paint-order` cannot move a background). So two
layers are stacked in the same order as ASS - outline + shadow behind, gradient fill in front. Ordinary captions have an
opaque text colour and keep one layer.

**The gradient window also matches the final.** ASS has no gradients, so build_ass.py slices the text into horizontal bands
and changes only the colour; the band window is fixed in canvas coordinates and outside it PrimaryColour (the top yellow)
remains. Measured on the 37.2 s frame of `고구마_ko.mp4`:

    text ink      y 1392 - 1482 (91 px)
    band window   y 1376 - 1476
    outline       7 px above and below the ink  (ASS Outline 7)
    lime shadow   6 px below the outline        (ASS Shadow 6)

The window starts 16 px above the ink top and ends 84 px below it - the bottom 8 or so pixels of the letters falling back to
yellow is really how it renders. The preview imitates that. 16 and 84 are canvas pixels at ASS size 130, so the browser
font size (font factor already applied) has to be divided back into canvas units. The ink top from actualBoundingBox is
unreliable for this font (it puts the exclamation mark 26 px low), so it is measured by drawing once and cached.

**Colours re-checked on frames.** Outline #192A38 (= #1C2C38), shadow #D8F16E (= #DAFD73), fill top #FBD65A -> bottom
#FB5D4B. The #FFBE4E measured at the ink top is because the band window starts 16 px above the ink, so it is visible from
f=0.16; the preview gets the same colour at the same spot.

**Rendered the dashboard timeline for real for the first time (2026-09-04).**

Until now `edited/고구마_ko.mp4` came from hand-written cuts in `timeline.py`; nothing edited in the dashboard reached it.
This time the dashboard render job (`jobs/20260904_024433_고구마렌더.json`) went through `import_project.py` into the
pipeline and everything was re-rendered.

    python import_project.py <job file>   # -> pieces_override.json + CSV
    python build_edit.py                  # -> edit_nocap.mkv
    python apply_captions.py              # -> 고구마_ko.mp4
    python apply_captions_en.py           # -> 고구마_en.mp4

Changes:
- Both cuts moved to the dashboard values. 4.93-53.05 -> **4.850-52.775**, 59.86-62.80 -> **59.827-62.995**. Final 51.30 s ->
  **51.09 s**
- Captions 13 -> **18**. The short reactions the user added in the dashboard (아아아 · 아 · 아 · 왜 안 나와? · 앗! 응? · 앗?
  아잇? · 아!) went in, and "아 이런!" / "이런!" became "아 이런 씨!" / "이런 씨!", snapping exactly to the seam (47.93 s)
- `seg_durs.json` was deleted before rendering. If left, timeline computes final times from **the previous render's
  lengths** and captions drift

**Rewrote the English caption CSV.** `고구마_en_subtitles.csv` matched the old 13-caption timeline: the new captions were
missing and the tail was 0.2 s late. Times and speakers now follow the ko CSV exactly and only the text was translated
(earlier sentences were kept). The top caption is the single constant `build_ass.TITLE`, so the English version still
shows "고구마" - an English title needs build_ass.py split per language.

**Checked** (final pixels and audio)
- 51.12 s / 1080x1920 / 60 fps / AAC 48k, all 18 captions in place
- Outburst caption unchanged: outline y1385-1489, fill from 1392, #FFBE50 -> #FF7046, lime shadow. Same picture as the
  dashboard preview
- Only two silences over 0.2 s, both content (44.60-45.10 the build-up before a sneeze, 50.86-51.08 the tail after the last
  shout). The seam at 47.93 s loses only 40 ms
- The final was re-transcribed and compared with the captions. The four "not heard" were all non-speech sounds (아아아 · 앗 ·
  슈우우 · 아악) the transcriber does not write down. **No sound passes without a caption**

**Fixed the first caption and re-rendered captions only (2026-09-04).**

Re-transcribing the final after the render showed only the first caption was off.

- The text was "어 뭐야!" but it is heard as **"이게 뭐야?"**
- It lasted only 0.31 s (0.263-0.569). This clip had once been broken with start = NaN and restored on open, so its length
  was the default

Fixed in the dashboard to 0.05-0.80 / "이게 뭐야?" and saved; the cuts were unchanged, so only `import_project.py` ->
`apply_captions.py` (+ en) were re-run. build_edit is skipped - with unchanged cuts there is no reason to rebuild
edit_nocap.mkv. Re-transcribed and compared: captions and speech now all match.

**Card thumbnails drew outburst captions twice.** After outbursts became two layers (outline + fill), `captureThumb` read
`.sub-text` as a whole, so the same words appeared twice side by side, and outline and colour were on the layers, not the
parent, so neither was applied. With layers it now reads `.emph-fill` (text, colour) and `.emph-back` (outline).

Two cases save an empty thumbnail - worth knowing to avoid confusion. If `#stage` is not visible (another tab, or the preview
folded), its size is 0 and capture gives up, and Store **keeps the previous image**. So saving with fixed code can look as
if the card did not change.

**Caption clip names did not follow their text.** The timeline and inspector show captions by text, but the log uses
`c.name`. Duplicated captions kept the original's name, so "clip moved: 어 소리 커!" appeared six times - no way to tell which
caption moved. The inspector's caption text field and CSV matching now update the name too (the all-captions tab already
did). The eight mismatched names in the 고구마 project were fixed.

**The dashboard renders by itself (2026-09-04).**

"Render" in user edit used to only drop a job file into `jobs/`; someone (a person or Claude) had to run three pipeline
commands by hand. Now the server runs them.

    POST /api/render          apply cuts -> render video -> burn captions
    GET  /api/render/status   progress and log

- **Video is re-rendered only when cuts change.** The server compares `pieces_override.json` before and after import and
  reuses `edit_nocap.mkv` when equal. A caption-only render drops from minutes to about ten seconds (15 s measured)
- **When cuts change, `seg_durs.json` is deleted first.** Lengths measured in the previous render would make timeline compute
  final times from them and shift every caption
- The folder belongs to the project (`render.dir`), written relative to the work folder - `edit/고구마`. Folders outside the
  work folder or without pipeline scripts are refused (the server must not become a way to run arbitrary scripts)
- Renders never overlap. Two in the same folder overwrite each other's intermediate files

**Claude is called only when captions need translating.** The language of a caption is decided by script (Hangul, kana,
Han, Latin). No dictionary or model needed.

- A caption set counts as language X only if X makes up **80% or more** of it. Below that the original cannot be
  determined, so nothing is decided and everything is handed over
- If captions are already in the chosen language they are **rendered directly**. If others are mixed in, only those go to
  Claude - handing over everything makes the model re-cut a good edit
- **Existing translations are reused.** Translations live as CSV in the pipeline folder, not in the project. If that CSV
  matches the current captions, Claude is not called and it renders directly. When cuts change, caption times change too and
  no longer match, so it is handed over again - rendering an old translation shifts every caption. Same if the caption
  count differs (`GET /api/translations`)
- **Times alone were not enough.** Comparing only times misses edits to caption text with unchanged cuts (changing the title
  to "감자" still reused the English translation - the old title stays on screen). Translation CSVs now have a **`src`
  column** holding the original text before translation. Columns are `start, end, speaker, text, src`, and a CSV is reused
  only if `src` matches the current captions character for character. A CSV without `src` is treated as unverifiable and
  handed over again (err on the safe side)
- 고구마 (19 captions, all Korean, languages ko and en) already has an en translation CSV, so one click produces both
  languages. Changing any caption sends en to Claude again
- **The top caption counts too.** It used to be the constant drawn by `build_ass.TITLE` and was not translated; it now goes
  into the caption CSV with speaker `제목` and is translated like any other caption

**Render and language settings in the inspector.** With nothing selected it used to say only "select a clip on the
timeline". Rendering happens after editing, usually with nothing selected, and then nothing was there. Now: folder, caption
languages, base language and the render button, with which languages render directly and which go to Claude, and steps and
log while rendering.

**Render folder and output folder are chosen separately.** There used to be one folder, and where the result went was
hard-coded in `apply_captions.py`.

| Field | What |
|---|---|
| Render folder | folder holding the render scripts (`import_project.py`, `build_edit.py`, `apply_captions.py`) |
| Output folder | where the finished video goes. Empty = the location in the script |

- Chosen with **browse**. The browser file picker does not reveal real paths (names only), so the server lists folders
  (`GET /api/dirs`). Nothing outside the work folder is shown, and folders with render scripts are tagged
- The output folder is passed as the environment variable `DASH_OUT_DIR`. `apply_captions*.py` saves there if set, otherwise
  to its built-in location - it must still work when run by hand without the dashboard. Missing folders are created
- The server picks up the `updated: <path>` line the script prints and shows the result path, so nobody has to dig through
  the log
- No explanatory paragraphs in the inspector. Field names (render folder, output folder, captions, base) and the result line
  say enough; more paragraphs push the field you came to change further down
- **With no clip selected, the only tab is "export".** That panel is not a clip inspector, and labelling it "clip / all
  captions" made it unclear what was on screen (the all-captions tab returns when a clip is selected)

**Progress uses times measured in the previous render.** With only three steps, "1/3, 2/3" left the bar stuck during a
minutes-long encode. The server records how long each step took in `.render_times.json` in the pipeline folder, and the next
render's progress uses those weights (averaged half and half with the previous value, so one unusually slow run does not
throw off the next).

- **Unknown steps are not invented.** If a step has never run, no remaining time is shown and the bar is striped to say
  "estimate". Invented seconds (treating it as a 1 s step) would hit 100% as soon as a minutes-long encode starts
- **Skipped steps are not learned.** A render that skipped the video step (cuts unchanged) records 0 s; learning that would
  freeze the bar for minutes the next time the video really renders
- It holds at 99% while finishing - it must not look done but stuck
- Measured: estimate 32 s, actual 33 s (66 -> 73 -> 79 -> 85 -> 92 -> 98 -> 100)
- The timeline's render button blinks so progress is visible without looking at the inspector

**Empty timeline space is timeline too.** With few tracks there was wide empty space above and below (centred), and clicking
there did nothing. Now a click moves the playhead there and clears the selection, and dragging box-selects clips - the
whole inner box listens, not just `.tl-lane` (`min-height:100%` on `.tl-inner`).

Added earlier:
- Local server (`server.py`) - drops jobs into `jobs/` as files and serves source videos by path via `/api/file` (the
  preview comes alive)
- User edit: add caption (T), duplicate (Ctrl+D), copy / paste (Ctrl+C/V), undo (Ctrl+Z / Ctrl+Shift+Z), select all (Ctrl+A)
- The preview looks like the final - preset background + video band + top caption + captions
- z-order fixed so the playhead is above clips

### Pipeline <-> dashboard round trip
- `export_project.py` - edit result -> dashboard project JSON + summary md
- `import_project.py` - cuts / captions edited in the dashboard -> back into the pipeline
  (if `pieces_override.json` exists, timeline uses it instead of the waveform)

    python import_project.py && python build_edit.py && python apply_captions.py

## First longform edit - 네모에게 비틱 (2026-09-05)

A job from the dashboard's "style apply". Source `E:/Edit/OBS/네모에게비틱.mp4`, 2 min 46 s -> final 1 min 37 s (main 89.55 s
+ outro 7.47 s), ko and en. Work folder `edit/네모비틱/`.

**The source is one shot from start to end** (model + background + chat top right). Cuts do not change the picture, so
**framing does the job of cuts** - the longform style's "10-14 scene changes per minute" was built from crops and zooms.

| Framing | What |
|---|---|
| wide | the 1920x1080 source as is (instruction: maximum zoom-out is the source size) |
| mid | 1.35x |
| close | 1.70x (instruction: the whole face must show - only sizes containing the face box x 860-1350, y 430-900) |
| chat | only the top-right chat (x 1580-1919, y 0-310), enlarged 2.4x on `LongBG.jpg` (1.1x) |

Chat crops were placed **only where speech engages with that chat**, because the chat is one side of the conversation, not
just a picture change.

- 96.3-98.3 s "왜너만 왜너만 왜너만" - when he says "당장 그만하라고?"
- 110.3-112.0 s "그거 비지니스야 ㅋ" - where he reads that chat
- 162.1-163.8 s "키보드 질투나" - just before showing off the keyboard

**Removed** (instruction): the donation speech (32-38 s) and the fly story (25-28 s). Everything else without speech was
cut. 54% of the source was kept - much higher than the references' 11-19%, because the source was already a trimmed excerpt.

**Mumbled speech was not used.** 7.6-12.3 s sounded different in two transcriptions ("네모쿤 밑으로" / "네모콘 밑에로").
Rather than make something up, it was cut entirely.

**Caption size was set by rendering.** Computing the size that gives 105 px of ink with PIL and entering 105 made libass draw
much smaller - the two draw the same size value differently (the same reason widths need the 0.7286 factor). Measuring went
wrong twice: measured on the white fill, the white clothes and sky blue in the background interfered and it jumped between
89 / 121 / 73 px depending on threshold. **The sky-blue glow (#03E9FB) appears only in captions on this screen**, so
measuring that was stable. Final FS 150 and MarginV 68 match the reference within 2 px (glow height 110 vs 112, bottom edge
0.9315 vs 0.9333).

**English was shortened.** Literal translations left eight lines too long for one line and produced lines with a single
word, like "You a / Nemo?". The reference always uses one line, so lines were shortened until they did not split.
`사람을 긁으면 안 되지` -> `Don't poke the bear` (translating 긁다 as scratch keeps the meaning and loses the flavour).

**Loudness did not imitate the references.** The two references were -19.5 and -14.2, and one was clipped at +0.9 dBFS
peak - there was no levelling process. Following the style JSON's -16 gave -17.0 LUFS, true peak -0.9 dBFS.

## Log split per project (2026-09-05)

The log was one blob, so switching projects kept the previous entries. Each line now records the project open at the time
(`pid`) and only that project's lines are shown. It is saved in the project, so reopening shows the previous history (last
500 lines in `project.json`).

- Lines tagged `server`, `app` or `fonts` show in every project. "No server, jobs go to the clipboard" matters in any edit
- The counters below are per project too, and **clear** removes only the current project's lines
- Each line carries a real timestamp (`ts`) besides the h:m:s shown (`t`). Without it, previous-session lines mixed with
  this session's (they did at first)

## Styles moved out of projects (2026-09-05)

**Fixed only one style showing.** `styles/` had four files but the screen showed only the one just registered. Styles were
saved inside project state (`ai.styles`), so each project had its own list - 고구마 had 0, the test project 1. Styles exist
to be "analysed in one episode and reused in the next", so that made no sense.

Styles now belong to **the whole dashboard** and live in `dashboard/styles/`. A project remembers **only the name** of its
choice (`ai.styleSel`).

- Server: `GET /api/styles`, `POST /api/style/save`, `POST /api/style/delete`
- Re-read when the page opens, and again if the server connects late
- Deleting removes a style from every project, so it asks once
- Styles left inside projects from old saves are moved to the store on first open

**The migration rule went wrong once.** At first it was "upload if the name is not in the store", so pressing delete made the
style, still in the old list, come straight back - **delete undid itself.** The candidates must be "never came from the
store" (no `file`).

Also fixed: when the list fell back to the first entry by itself, the chosen name was not recorded and the project forgot
its choice. `styleSel` and `project.style` (shown on the card) are now kept in step.

## Longform style analysis (2026-09-04)

A job from the dashboard's "style analyse". 10 sources -> 2 finals (`E:/Edit/pair/Longform`). Result:
`dashboard/styles/담유이_일반롱폼.json`.

**Longform is not a long short.** Orientation, frame rate, background, crop and overlay handling all differ. Only the captions
(same font and colours) and the attitude "leave no silence" are shared.

| | Shorts | Longform |
|---|---|---|
| Screen | 1080x1920, 24 fps | 1920x1080, 60 fps |
| Background | video band on DamuiPreset.mov | stream screen as is |
| Crop | person only | none |
| Chat / donations | removed | kept |
| Caption font / colour | CookieRunOTF Black, white fill + dark outline + sky-blue glow | **same** |
| Caption size | 130 (0.068 of canvas height) | 105 (0.097) |
| Caption position | 0.795 from the bottom | 0.925 from the bottom (ink baseline) |

- **Selection is thinning.** Tracing each moment of a final back to the source, source time only ever moves forward. Later
  scenes are never pulled earlier. That is why 89% of the source can be thrown away without breaking the story (kept 11% and
  19%)
- **Segments are short, 1-2 s** (median 1.5 s). Every join is a hard cut, not a single dissolve
- **No silence at all.** Zero spots below -60 dB for 0.3 s or longer in both. Even with every gap between words cut out, the
  bed sound never breaks
- **The outro is always `DamuiEOVPreset3.mov`** (7.47 s, hard cut at the very end). `유이 사람 아니야.mov` ends with the old
  `DamuiEOVPreset2.mov`, which is not taken as a rule (user instruction). No intro
- Captions use **the same font and colours as shorts**: `CookieRunOTF Black`, white fill + dark outline + sky-blue glow. Only
  size (105 px of ink = 0.097 of the screen, font size about 105) and position (baseline 0.925) differ. Emphasis is a red
  gradient (#C30000 -> #820000) with a yellow outline, different from the shorts outburst (yellow -> orange-red + dark navy
  outline)

**Three points where the two samples disagree** - recorded as observations, not rules.

| Item | 유이 사람 아니야 | 곧 눈알 장아찌 |
|---|---|---|
| Time with a caption on screen | 98% | 69% |
| Date tag | first 4.75 s (yellow box, red text) | none |
| Loudness | -19.5 LUFS / peak -3.7 | -14.2 LUFS / **peak +0.9 (clipping)** |

The last row is closer to a defect than a style. New edits should use -16 LUFS and true peak -1 dBTP.

**Caption size was mismeasured twice.** First a white receipt box overlapping the caption was counted as text (137 px), then
joining rows containing ink swallowed faint white in the background into one blob (180 px). Both led to the wrong conclusion
that the two videos used different sizes. **Cropping the same spot 1:1 side by side showed the same size.** Next time, plot
pixel counts per row first and see where the caption blob starts.

**Aspect ratio did not separate the fonts.** Five candidates fell within ±5%. Overlaying the isolated white fill with the same
line rendered in each candidate (IoU) did - CookieRun Black 0.709 / CookieRun Bold 0.598 / Jua 0.344 / Malgun Gothic 0.331.
Black won on all three lines.

**Measuring method** (for next time; scripts in `scratchpad/`): shrink frames to a 32x14 grey fingerprint and match against the
whole source to find the segment; count caption pixels only as "white fill pixels with a very dark pixel within a 5 px radius"
to filter out white and sky blue in the background.

## 네모비틱 longform - second fix (2026-09-05)

After the first version the user raised eight points. Six came from one cause: **boundaries set from word times.**

**Cut boundaries were re-set from the waveform** (`audio.py` borrowed from 고구마). Using Whisper word times directly gave:

| | Word time | Waveform |
|---|---|---|
| First scene start | 0.00 | 0.66 (0.66 s of nothing) |
| "네모쿤" start | 39.44 | 39.98 |
| "너희는 멤버들" start | 144.14 | 144.86 (0.72 s of nothing) |
| "손편지 없잖아" end | 118.66 | 119.19 (0.53 s cut off) |
| "전화번호 없잖아?" end | 132.72 | 133.30 |

Every head carried 0.6-0.7 s of nothing before speech, and every tail cut off 0.4-0.6 s of speech. The user's "after a cut
there is a gap before speech" and "all captions appear but the speech is clipped" had the same cause. **Whisper word times
are early at both start and end.**

`audio.pieces` could not be used as is: it re-sets boundaries its own way and pulled an existing boundary earlier, cutting
"좋아해요" (to 101.82) at 101.59. A separate `timeline._thin` removes **only the dead time in the middle** without touching
boundaries.

**No scale change inside a scene.** The old version switched close -> mid in the middle of a sentence. Scale changing without
a cut made the picture wobble ("chaotic"). `SCENES` is now the unit of scale, and `check()` asserts that neighbouring scenes
differ - a cut whose picture does not change looks like a glitch, not a cut.

**Less zoom, lower captions.** Below the mouth is source y 845, the chin 890, and caption ink sits at 910-1032. So wide 1.00 /
mid 1.20 / close 1.36 are the limits. The old close was 1.70x, and at that scale the mouth went behind the caption in the "웃어"
scene. `ORIGIN_Y` 937 -> 959 (instruction: a little lower), and the emphasis gradient band (`EMPH_Y0/Y1`) moved with it.

**Loudness matched per scene.** The quietest speech, "당장 그만하라고?" (RMS 0.049), and the loudest, "야 나한테는..." (0.158),
were 10.1 dB apart. Only scenes below the target (0.115) are raised, by up to 6 dB. Squashing all to one level would lose the
dynamics of speech, so loud scenes are left alone.

**Repeats are counted by code.** Merging into one line `웃어 (x5)` drew a complaint (already received once on shorts). `LINES`
now lists repeats as they are and `mark_repeats` numbers them - nothing written by hand, so nothing can be missed. The
waveform shows six repeats 0.38 s apart, so it goes to (x6).

**유희 -> 유이.** Whisper misheard Damyui's own name (at 152.54 "유이가" was heard correctly). English: "Yuhui-senpai" ->
"Yui-senpai".

**Re-transcribing the final caught four spots** (`verify_final.py`), after every source-based check had passed:

- `다시` - the tail of a cut word ran to 12.72. The waveform blob starts at 12.61 and does not split, so it was pinned at 12.74
  by hand
- `거야` - must be kept to 84.20 to be heard. Cutting at 83.88 lost it entirely
- `없잖아` -> `없어` - the drawn-out "아" runs to 148.65. Extended to 148.10
- `다 좋아하는 거 봐` -> only "어어어어..." is audible. Whole-file and sliced transcriptions disagreed completely (the middle
  1.07 s is silent), so the scene was removed

**`export_project.py` did not exist for this episode.** This is what the user meant by "I said apply everything to user edit,
why isn't it applied?". 네모비틱 had no such file, so two renders went by with nothing reaching the dashboard.

**Dropping a file was not "applying" either.** At first a `네모비틱_project.json` was created in the pipeline folder with
"open it with import". The project card the user had run style apply on (`projects/pmtn3puhja7yt`, "네모에게 비틱") **stayed at
0 cuts, 0 captions.** Now the export writes straight into the store - name, creation date, log, prompt and dropped files are
kept, only the timeline is filled, and a frame from the final is rendered into `thumb.jpg`.

Three mistakes were made while writing it, and two dashboard bugs were fixed along the way.

| Mistake | Symptom | Correct |
|---|---|---|
| `clip.crop` written in pixels | x, y clamped to 0.999 and w, h to 0.001, the preview video vanished (only captions showed) | it is a **0-1 fraction** |
| "no sound" written as `track.muted: true` | `activeClips` skipped the whole track, the quote cards and background vanished | that switches the track off; no sound is clip `volume: 0` |
| cards exported as source video clips | the render pins the frame at 90.20 s, but the preview played 3 s of video and showed other chat | grab that frame as PNG (`cards/`) and use an **image clip** |

- **The preview box aspect did not follow the canvas** (`editor.js syncRatio`). The dropdown defaulted to 9:16, so longform
  opened with landscape video in a portrait box. It now follows the project canvas, and a manual choice wins
- **The preview could not draw still images.** The server blocked `.jpg` with 403 (`MEDIA_EXT`) and the preview only created
  `<video>`. Images are now served and drawn with `<img>` - the card background (LongBG) and quote cards need it

**If the dashboard has the project open, the export gets overwritten.** The browser treats its localStorage state as "always
newer than the folder copy" (`app.js boot`) and saves on every open. That is why the export was silently reverted five times.
Close the tab or switch projects before exporting.

## 봉누도 불참 (2026-09-05, 담유이 1인 일반 쇼츠)

82.7 s cut to **41.45 s**, then **1.1x speed** at the end - final **37.68 s**. `edit/봉누도불참/`, final
`edited/봉누도불참_ko.mp4`, project `projects/pmtoeopic7soe`.

**This source sounded nothing like the earlier ones.** At -41.7 LUFS it is 25 dB quieter, with background music under the
speech from start to end. Run as is, waveform detection found only 32 speech runs (there are 112). Energy at 100-250 Hz is
**higher in silences than during speech**, so with full-band RMS the music always crosses the threshold. So the level is
measured separately:

- `src_level.wav` - only 700-3000 Hz, raised 34 dB. `audio.py` measures levels from it if present. Thresholds re-measured
  (THR_HI 0.050 / THR_LO 0.022 - silence p90 0.023-0.032, speech p50 0.034-0.077)
- `src_audio.wav` - full band + 24 dB, for transcription and probe
- The final is brought to -16 LUFS with loudnorm in `apply_captions.py` (same as earlier finals)

**A stop closure inside a word can be longer than MERGE (0.20 s).** The closures in "맞겠다" are 0.21 and 0.24 s, so the
pipeline read them as pauses and split the word - only "막" was audible in the final. `audio.pieces(join=, merge=)` and
`timeline.JOIN_BY_GROUP` raise the threshold for that group only. `verify_gaps` uses the same values and ignores gaps left on
purpose.

**Crop re-measured.** It is a solo close-up filling the screen, not a two-person stream, and the chat balloon appears from
x 1580. `x 548-1572, y 0-1080` (1024x1080 = 0.948, the style's ratio) -> scaled to 1080x1140 and placed at y=407.

**New annotation captions** (job instruction: smaller than the normal font, 배민 주아, must not cover the face). The `Note` style
in `build_ass.py`, CSV speaker `주석`. Shown only **the first time** a word appears.

Feedback changed the look once - first a translucent black plate near the top (BorderStyle 3, MarginV 500), then **right above
the caption, no background, same look as the top caption** (BorderStyle 1, outline 2 / shadow 3, bottom-aligned MarginV 518).
Placement is by ink - rendering only the captions on black: caption ink 1420-1527, annotation ink 1342-1395, 25 px above, and
never above the bottom of the face (1282). Words that get an explanation carry a leading `*` in the caption so it is clear
which word it refers to (`*봉누도는`, `*소빙하기가`). Four: 봉누도, 아담, 소빙하기, 이사 빙하기; RP was removed on instruction.

All five checks pass. For a while `verify_cuts` kept flagging the end of group 7 (68.93) - "필요하겠다" is intact up to 68.95 and
"라고" bleeds in from 68.96 - until the user restored "라고 판단을 했습니다" and that boundary disappeared.

**Re-transcribing the final paid off three times.** Source checks caught none of these: "맞겠다" -> "막", "필요하겠다" ->
"필요하겠", and "그래서" audible without a caption.

Note: **wide-window transcription invents words.** This time "지만" (thought to be the tail of the cut "모르겠지만") and "진짜";
re-listening with a narrow window, neither was there. Conversely "겹칠 거기 때문에" agreed in three narrow windows and in the
final re-transcription - the whole-file transcript had missed it.

One open question was answered - **"아담" is Damyui's fan name**, so it got an annotation. Still unsure: **whether "진짜" follows
"RP도 살짝"** (heard twice only in the final's transcription, never in the source's).

### One feedback round (2026-09-06)

Two things returned by the dashboard went straight into the pipeline:

- **Restore** - when the user clicks a removed word in the all-captions view, it lands in `restore.json` as `[[68.9, 69.86]]`.
  `timeline.py` reads it and extends the nearest group (`RESTORE_JOIN 1.50`; Whisper times are early, so pushed later by
  `RESTORE_LAG 0.25`). "라고 판단을 했습니다" came back and the length went 40.2 -> 41.45 s
- **Four instructions in the prompt box** - spelling (이사빙하기 -> 이사 빙하기, 엑스 -> X(구 트위터)), drop the RP note and add
  an 아담 note, change the annotation look, and **1.1x speed at the end**

**Speed is applied once, after the captions are burned.** `apply_captions.py` pulls picture, sound and captions together with
`subtitles=...,setpts=PTS/1.1,fps=60` + `atempo=1.1`. Speeding up first would mean rewriting the CSV and the whole pipeline in
sped-up time. Instead **every value pointing into the final must be divided by `timeline.SPEED`** - the CSV comparison in
`verify_final`, the review `captions` and word `out` in `export_project` (the feedback view seeks there), and `meta.duration`
on the card. Otherwise it drifts 3.8 s by the end.

The final re-transcription after the speed-up passed too. The remaining three flags are known false alarms - "X(구 트위터)"
(spelling changed on purpose), "봉누도" (Whisper hears 공노도 or 농란도), "RP" (the comparison counts Hangul only, so 알피 does
not match). "지만" was checked once more with a narrow window - the 0.42 s seam is silent.

### The dashboard overwrote exported edits (fixed)

After exporting a project with `export_project.py`, opening it in the dashboard **wiped the edit just exported.** Nothing showed
on screen either - open called `stash()`, which wrote the old screen state (0 captions, 60 s) over the file first, and then read
back the broken file. Three layers of defence:

- `stash()` does not save **unless something was changed in the browser** (`P.dirty`)
- Autosave **skips when the file is newer** (`diskNewer`). Only saves the user explicitly asked for (save button, rename,
  import, clear) use `force: true`
- The value compared is **the time the disk was last read or written** (`P.diskAt`). The on-screen `savedAt` is re-stamped by
  the browser autosave every time a tab closes, so comparing it always made "the screen newer" and disabled the check. Missing
  this kept the overwrites going even with the first two layers in place

### Dropping from the all-captions view (2026-09-06)

The opposite of restore. **Clicking a remaining word in the all-captions view removes it in the next render.** Until now only
restoring removed words worked.

- `feedback.js` - words take four states: `keep`, `dropped` (orange, removed by the user), `cut` (red, removed by Claude) and
  `restored` (green). One click works both ways. Dropping a remaining word first takes you to that spot - listen, then decide
- `server.py` - `_write_ranges` writes `restore.json` and `drop.json` together
- `timeline.py` - `_with_drop`. At a group's head or tail it **shrinks the group** (audio.pieces moves the boundary to a quiet
  spot), in the middle it goes into that group's TRIM, and if it covers the whole group the group is removed. Runs after
  restore

**Also caught: restored words disappeared again on the next save.** Restoring does not change GROUPS in `timeline.py`; it lives
only in `restore.json`. After a render the word becomes `keep=true` and drops out of the restore list, the server reads
"nothing to restore" and deletes `restore.json`. Now `export_project.py` tags already-applied restores on the words with
`restore`, and the list is built from that tag, not from `keep`.

### English version (2026-09-06)

`make_csv_en.py`, `rebuild_from_csv_en.py`, `apply_captions_en.py`. `edited/봉누도불참_en.mp4`.

- Times come from **the same function as Korean** (`make_csv.build`). Counting separately would put the two versions' captions in
  different places - only the text may differ
- Top caption **"Sitting It Out"**. 불참 here is choosing not to go rather than being unable to, so this fits better than
  Absence (828 px at BM JUA 190 px, limit 960)
- Names are not translated - 봉누도 -> Bongnudo, 아담 -> Adam. 소빙하기 and 이사 빙하기 are coinages in Korean too, so they are
  translated literally and explained in the notes
- **The name plate baked into the preset is replaced as well.** DamuiPreset.mov has "담유이" baked in, so leaving it would give
  a video where only the captions changed. That spot (ink x 412-666, y 1728-1825) is covered with a black shape and Damyui is
  redrawn in the same look (white fill #FDFDFD, blue outline #00A8FD). Faster than a new preset and the source video is
  untouched (same method as 고구마)
- English is much wider than Korean. Every line was measured with `textwidth` to fit within 1020 px - over that it splits at a
  word boundary and leaves one-word lines
- **The top caption sits differently in the two versions** (`TITLE_MV_EN = 197`, Korean 229). English has descenders (p, g, y),
  so at the same position the tails bit into the video band (top 407) - "Skipping" overlapped by 22 px. Rendering only the
  captions on black and measuring the ink, the bottom was set to 397 (same 10 px margin as Korean)
- **Notes can differ between versions.** '아담' is a known name to Korean viewers, so its note was dropped there, but English
  viewers have no clue, so it was added (`make_csv_en.EN_EXTRA_NOTES`). The `*` in captions appears only in English

### Feedback prompts were wiped before being read (fixed)

**None** of the instructions the user wrote in the feedback prompt box were applied. They are saved as `review.prompt`, but
`export_project.py` rebuilt the review block from scratch each time and wiped them - gone before anyone read them.

- `server.py` drops them into the work folder as **`feedback_prompt.txt`** on every save (next to restore.json and drop.json).
  Emptying the box deletes the file
- `export_project.py` stashes it once more before wiping

**The same trap existed for drops.** A dropped word becomes `keep=false` in the next version and is no longer picked up as "to
drop", so `drop.json` empties and the dropped words come back. As with restore, `export_project.py` tags already-applied drops
on the words with `drop`, and the list uses that tag, not `keep`. The screen now distinguishes red `cut` (Claude) from orange
`dropped` (user).

**Old state left in the browser is still dangerous.** If localStorage holds an old review, one save overwrites the file with it.
`diskNewer` stops autosave but not a save the user pressed (force). `drop.json` was lost twice this way and it only cleared after
emptying `localStorage` and reopening. **To see results of a new dashboard edit, reload the page and reopen the project.**

## 맘터귀칼가챠 (2026-09-06, 담유이 일반 롱폼 - first multi-source edit)

The first "style apply" request queued in `jobs/` (from the dashboard AI edit tab) that was run all the way through. The target
was five sources (`맘터귀칼가챠0~4.mp4`: 18.8, 11.6, 8.55, 32.7 and 32.9 s), so they were **first joined in stream order into one
source** (`src_full.mp4`) and cuts and captions were set on that - the rest of the pipeline assumes one source, and handling five
separately would need special cases at every boundary.

**Same style as 네모비틱 ("담유이 일반 롱폼"), but the cuts are of a different nature.** That style JSON records keeping 11-19% of a
90-minute VOD, but this source is already a 104.6 s highlight of the gacha moments, so the same ratio would be wrong. Silence
detection (-34 dB, 3 s or longer) removed only long gaps between speech, keeping 73% (76.08 s).

**Source 4 (opening the box and showing the photo) was not cut at all.** The instruction ("focus a bit more on the photos") was
read as "cut less" - the 16.8 s of silence inside it (79.45-96.25) is exactly where the box is opened; anywhere else that length
would have been cut, but here it is the core scene. The picture was used as is (no crop) - the browser search results and the
gacha box photo already fill most of the screen, and zooming would cut off what must be shown.

Two transcription errors fixed: "기우" -> "기유" (a character name given in the instructions), "담린이 남진" -> "담린이 남긴"
(Whisper mishearing; "담린이" looked like a viewer nickname). Damyui's pun "탄지러워" (탄지로 + 반가워) was given a new English pun
"Tanji-yay!" to keep the wordplay. *(Both readings were wrong - see the second and third feedback rounds below.)*

The final was re-transcribed with `verify_final.py`. Whisper hears "탄지러워" back as the real word "탄지로", so it all shows as
differences - the comparison tool cannot understand a pun missing from its dictionary, not an editing error (same kind as the
"지만" false alarm in 봉누도). But "오케이" (29.60-30.48) and the third "짜자잔" (67.11-68.51) came out inaudible in the comparison,
and volumedetect alone could not tell whether they were buried in background sound or really empty - confirming that would need
the user to listen.

With several sources, the 네모비틱 version of `export_project.py` (which assumed SHOTS, CARDS, crop and per-scene gain) could not be
used. A light version with only `timeline.KEEP` (range list) was written - with no crop and no cards, simple was right. The
dashboard project was found not by name but by **the five dropped target file names** (project `가챠`, `pmtp7csakr2mm`).

## 맘터귀칼가챠 - feedback applied (2026-09-06)

From the dashboard feedback tab: one drop.json entry (14.20-17.14 "그냥 죽여줘 (x2)") and five written instructions.

**"The cut editing is a mess" was right.** The first edit set cut points only from the transcript (word times), so it could not
see sounds that are not words. Re-measuring RMS 0.5 s around each boundary showed three wrong spots:

- 48.05 -> 48.25: 0.1 s of the tail of "오케이" was cut off
- 57.80 -> 57.25: the first "탄지러워!" (really starting at 57.35) was cut off entirely
- 61.65 -> joined: **a 3.2 s laugh at 61.5-64.75** was being cut through the middle. A laugh is not a word and leaves no line in the
  transcript. It is the biggest reaction in the video, and the first edit thought that spot was "silence".

Lesson: **cut points must come from loudness, not the transcript.** The transcript says what was said, not when sound happened.
This check went into verify_struct.py (no AI).

**"Did you use every caption?"** - answered with one re-transcription. Same model, same audio, only looser decisions (no_speech
0.6 -> 0.15, log_prob -1.0 -> -2.5, temperature ladder): the same 21 sentences, 0 new words. Nothing was missed - the 105 s source
really has only 50 spoken words. That the first edit "removed no captions at all" was the source, not a bug. But as the laugh
shows, "everything is in the transcript" does not mean "the cuts are right".

**Framing differed per scene for the first time.** The first edit used scale 1.00 throughout (judging that the browser and photos
already fill the screen). The instruction was "focus more on the face for reactions and on the photos for photos". Split with
timeline.SHOTS:

| Range (source) | Name | crop | Why |
|---|---|---|---|
| 0-33 | wide | none | browser. The text is small; zooming cuts off search results |
| 33-71.70 | face | 1600x900 @(0,180) | dropping the top 180 px puts the eyes (y 580-740) and mouth (y 760-852) in the middle |
| 71.70-74.50 | wide | none | the photo fills the screen and then shrinks to the left. Cropping would cut the photo |
| 74.50- | photo | 1600x900 @(0,84) | the smallest window holding both photos (box and 탄지로 card) |

Two things set the scale limit.
- **Captions must not cover the mouth.** The text top is at y 884, so 1.20 is the largest scale that keeps the mouth (y ~800) above it.
- **Overlays are kept whole or dropped whole.** Pinned at x=0, the left stream info overlay is kept entirely and the right chat
  balloon dropped entirely. A half-cut overlay looks worst.

**Two caption lines were split at word boundaries** (instruction). After splitting, the following "탄지러워! 탄지러워!" became the
second occurrence and got a new (x2) - repeat marks must be recounted after every split.

**make_csv.build() bug:** captions outside the cuts were filtered by start time only, so a caption touching the end of a cut
survived with zero length. Now judged by the midpoint, and anything shorter than 0.2 s is dropped. timeline also got MIN_PIECE
(0.35 s) to drop slivers left next to removed spots - a 0.16 s piece is just a flash on screen.

Result: 7 cut pieces (9 counting framing changes) 77.43 s + outro 7.47 = 84.90 s, 20 captions, 74% of the source kept. The
re-transcription budget (1) was spent on the source, so verify_final.py (final re-transcription) was not run this time.


## export_project.py was wiping user feedback (2026-09-06)

`export_project.py` rebuilt and replaced the whole `review` block on every export. That block holds not only pipeline values
(transcript, captions, kept) but also **values the user wrote**:

- `review.prompt` - instructions written in the feedback box
- `review.notes` - pins on the video

Both were hard-coded to `""` / `[]` and wiped on every export. prompt had already been rescued by having `server.py` drop it into
`feedback_prompt.txt` on save (that code comment records this bug), but **notes had no rescue at all** - once wiped, nothing to
restore from.

Fix:
- `save_to_store()` carries over `review.notes` / `review.prompt` from the current `project.json` and replaces only pipeline values
- `project.json.bak` is written before overwriting

This time both were empty, so nothing seems lost, but whether earlier exports wiped anything cannot be checked (there were no
backups then).


## 맘터귀칼가챠 - second feedback (2026-09-06)

All four points were right. Two were **bugs I introduced**.

### "The captions I edited are not applied either, are they?"

The answer was in the `project.json` log:

```
13:22:21  caption 16 edited: 탄지로! 탄지로!   (src: feedback)
```

The user edited the caption in the dashboard at 13:22, and each of my exports at 13:17, 14:25 and 15:24 rebuilt
`review.captions` from the CSV and **overwrote it three times.** The same accident as `notes` and `prompt`, but captions were
overlooked.

Fix: `save_to_store()` carries `by == "user"` captions over to the line with the nearest start time and prints what it moved.
`server.py` also drops `captions_user.json` into the work folder on save (next to `feedback_prompt.txt`).

**Also revealed:** I assumed the user's "탄지로" in the first feedback was a transcription of what was heard, read Whisper's
"탄지러워" as a Damyui coinage, and invented the English pun "Tanji-yay!". It was just the name. **Never overwrite the user's
wording with my own interpretation.**

### "The timestamps after 1:16.14 are off too"

The third "짜자잔!" was transcribed at 95.66-97.06, but **the actual sound is 96.15-97.90** - the caption appeared 0.55 s early.
Whisper word times cannot be trusted for short exclamations over background sound. This line alone was re-measured from the sound.

A check went into `verify_struct.py`: **open the final and see whether there is sound inside each caption window.** A quiet window
with sound within 2 s before or after means it is misaligned. It needs no re-transcription and costs no budget.

### "There is too much empty space after this point"

85.00-92.60 (7.6 s) was cut. Sound -70 dB, scene difference < 3 - nothing happens.

**The ending almost got deleted.** Right after it, 92.80-94.50 is the full-screen 탄지로 card, and its **scene difference is 0.1**
(a still image). Cutting by motion alone would remove it first. No motion does not mean no content - the same trap as the laugh
in [[cut-points-from-level-not-transcript]].

### "Why isn't it focused on the face either (it leans to one side)"

Because the crop was pinned at `x=0` to keep the left stream info overlay whole. Damyui is not in the centre of the frame and moves
left and right between scenes (face centre x between 850 and 1280), so the face was pushed right.

The face position was measured per scene and crop x set accordingly (162 / 130 / 320 / 410). A half-cut overlay is accepted -
**the face comes before preserving overlays.**

### "Some speech cuts off or sounds unnatural"

Both were addressed.

- A 10 ms fade at every piece join. Cutting where the waveform is not at zero makes a click
- **loudnorm switched to two-pass.** A single pass moves the gain constantly and quiet spots swell and shrink. Measure the whole
  first, then apply again with those values and `linear=true`

Result: 8 cut pieces (10 counting framing changes) 69.83 s + outro 7.47 = 77.30 s.


## 맘터귀칼가챠 - third feedback (2026-09-06)

The same complaints for the third round: "I keep pointing it out, why don't you fix it?" This time the **method of producing cut
and caption times** changed instead of fixing spots one by one.

### Cause: trusting transcript word times

In this source Whisper word times are off by up to 1.4 s. Compared with re-measured sound:

| Caption | Transcript | Actual | Difference |
|---|---|---|---|
| 담유이 남친 카이가쿠라고? | 0.00 | 1.34 | 1.34 s early |
| 오니가 되는 것도 아니고 그냥 죽여 | 4.12 | 5.10 | 0.98 s early |
| 나는 지금 데스크테리어가 | 20.22 | 21.30 | 1.08 s early |
| 상자 열었어요 | 52.70 | 53.98 | 1.28 s early |
| 짜자잔! (x3) | 95.66 | 96.20 | 0.54 s early |

Last round only the final line was re-measured from sound. The rest stayed, so "the timestamps are off" could never be fixed.
The new `plan_cuts.py` derives both cuts and captions from loudness (-48 dB). Thresholds were measured on this source - speech
-37 to -45 dB, background -50 to -57 dB, breaks -88 dB.

### Gaps: main part 69.83 s -> 44.36 s

Criticised three rounds in a row. Biggest removals:

| Source range | Length | What |
|---|---|---|
| 0.00-1.19 | 1.2 s | before speech starts (leading gap) |
| 68.30-71.70 | 3.4 s | only the face, nothing happens |
| 81.16-92.60 | 11.4 s | the box card frozen as is |
| 98.00-104.63 | 6.6 s | tail with the last card held |

Pauses in the middle of sentences were also cut ("나는 [1.0 s] 탄지로 나오면 좋겠다", "제발 [1.0 s] 제발"). The caption is not
split but stays one line across the cut - `make_csv.build()` was changed to keep a line if its start, middle or end survives
(checking only the middle drops such lines entirely).
Spots that must not be cut even without sound are protected by `plan_cuts.VIS`: 71.70-73.30 (box card) and 92.80-95.20 (the
full-screen 탄지로 card - the ending of this video).

### Sound: main part and outro had to be levelled separately

User: "the main part is quiet and then only the outro is loud, it hurts my ears."

    main    I = -40.58 LUFS,  max -28.10 dBTP
    outro   I = -15.85 LUFS,  max  +0.06 dBTP   <- 24.7 dB apart

EBU R128 integrated loudness excludes everything 10 LU below the average (relative gate). Measuring the joined file **gates out
the entire main part and measures only the outro.** That was exactly last round's "-16.73 LUFS, only +0.8 dB needed, gain constant
throughout" - it was measuring the outro and the main part shipped at -40 dB. **The wrong thing was measured and passed.**
Now main and outro are each brought to -16 LUFS and then joined. The main part's maximum is -28 dBTP, so +24.1 dB does not hit the
limiter. Per-piece loudness was already even (-38.3 to -42.1 LUFS), so no compressor was used.
Result: main -15.9 / outro -16.0 LUFS, -15.0 to -17.5 LUFS in each spoken passage.

### Caption wording: the same mistake two rounds in a row

"담린이 남진 카이가쿠라고?" -> **"담유이 남친 카이가쿠라고?"**
Whisper heard "담린이 남진", and I went further and "fixed" it to "담린이 남긴", even writing in a `make_csv.py` comment that "the
transcript misheard 남긴 as 남진". It is 담유이 (the streamer's name) 남친 (boyfriend). I had written
`[[user-wording-is-canonical]]` and broke it again in the same file.

### drop.json times are transcript-based too

User: "'오니가 되는 것도 아니고 그냥 죽여' only plays up to '그냥 죽'." The dashboard's drop [14.20, 17.14] was the transcript range
as is, so it actually cut 0.16 s off the tail of 13.42-14.36 "카이가쿠는 좀".
`timeline._snap()` moves both ends of a drop range to piece boundaries within 0.70 s inward.

### Checks

`verify_struct.py` now takes its cut-boundary threshold from `plan_cuts.THR`. Cutting at -48 dB and checking at -50 dB flags even
quiet spots as "speech cut" on this source with -48 to -57 dB background. The window looks only 0.30 s, matching the margins.
Final problems: 0.

Final **51.92 s** (main 44.36 + outro 7.47), 20 captions, 15 cuts.

## Cheaper re-edits (2026-09-06)

User: "the first edit and a feedback round cost almost the same tokens - I can only afford one or two feedback rounds." Three fixes.

### 1. Piece render cache (`piece_cache.py`)

Fixing one caption word re-rendered 1920x1080@60fps CRF18 three times in full (main + ko + en). Now each piece is rendered
separately and only changed pieces are redone.

    layer 1 cut_*    piece cut from the source with crop applied
    layer 2 burn_*   layer-1 piece with only its own captions burned

Joining is `-c copy`, no re-encode.

| | Everything new | With cache |
|---|---|---|
| Main (`build_edit.py`) | 1 min 48 s | **3.3 s** |
| Caption burn (per language) | 13 of 28 pieces | 1-2 pieces per fixed caption line |

**One trap.** The caption style pops in from `\fscx0\fscy0` via `\t(...)`, and that timing is relative to when the Dialogue line
appears. Splitting a caption that spans a cut into per-piece lines **replays the animation in the second part.** 9 of 20 captions
spanned cuts. `_settle()` strips `\t(...)` and the start scale from continuation parts to freeze them in the finished state.
Verified on final frames (same text size at 12.68 / 12.76 / 12.84 s).

### 2. Zero re-transcriptions by default (`ai_budget.py`)

`transcribe.py`, `transcribe2.py` and `verify_final.py` are gated. With permission, add `ALLOW_AI=1`. When speech happened,
whether a cut clipped speech, whether captions match the audio and where the gaps are can all be answered from loudness.

### 3. Tokens: output was expensive, not analysis

Re-scanning the whole waveform takes **0.6 s** and zero tokens. What was expensive was pouring the result into the conversation -
last round printed about 400 lines of RMS table.
`probe.py` asks for just the spot needed, in under ten lines:

    python probe.py 26 29      sound, cuts, picture, captions, transcript for source 26-29 s
    python probe.py -o 12 14   in final time

The waveform is cached in `level.json`, so later calls take 0.2 s. Rules are in `CLAUDE.md` (zero re-transcriptions, re-edit scope
table, cache, token rules).

## Region notes and traces on the feedback layer (2026-09-06)

Notes on the video used to be **points**. User: "what I want is regions - notes stuck onto an area of the video like sticky notes."

**Region note (`kind: 'region'`)** - drag a rectangle and a note whose text stays visible over the picture is attached. The note
can be dragged elsewhere while the region it points to stays put - a pointer arrow follows from the note to the **nearest edge** of
the rectangle (drawn to the centre it would cross the rectangle and hide its inside). The default note position is pushed outside
the rectangle after measuring its height - the height depends on the text length and cannot be computed beforehand.

**Trace (`kind: 'curve'`)** - dragging draws the mouse path as is and adds an arrowhead at the end. For motion instructions. Before
there was only the straight arrow.

**Shapes moved to pixel coordinates.** Lines were drawn in percentages (`x1="50%"`), but `polyline` `points` cannot take percentages.
A `viewBox` coordinate system would stretch 16:9 and distort the arrowheads. The stage size is measured on every draw, pixels are
used, and `ResizeObserver` redraws.

**Toolbar rebuilt** (instruction). Similar tools are grouped with dividers:
`select | note, region note | line, arrow (straight), arrow (curve) | clear`.
Tooltips give only names, with a short addition for the two whose icons are unclear. The line icon became a straight line instead of
a pen so it reads as a group with the two arrows. The prompt box and note list split the height half and half (the prompt used to
be fixed at three lines).

**`server.py` drops `feedback_notes.txt` into the work folder.** Until now notes on the video lived only in `review.notes` in
`project.json`, invisible to the pipeline (the same accident as the prompt and user captions). Coordinates are included:

    [0:00.00] (region 55%,41% ~ 73%,75%) 여기 얼굴이 너무 작다 — 더 크게 잡아줘
    [0:00.00] (trace 12%,75% -> 82%,75%, 41 points) 이 경로로 사진이 날아오게 해줘

Top left of the screen is 0%, bottom right 100%. A note saying "this area here" is useless without its position.

## 마법의 날 (2026-09-07, 담유이 1인 일반 쇼츠)

71.28 s to **31.87 s**. No speed change. `edit/마법의날/`, final `edited/마법의날_ko.mp4`, project `projects/pmtq0xkm97dua`.
Source `E:\Edit\OBS\마법.mp4`.

Damyui grumbling about period pain. She personifies the uterus as a self-deluded "도끼병" type - it builds a house (the lining)
on its own hopes and smashes everything when nothing comes of it - and the joke rolls on as one piece. Top caption '마법의 날'
(instruction).

### Not trimming what she said, but removing what she did not say

Measured on the waveform, sound is present for 40.9 s. Usually speech must be trimmed to reach shorts length, but this time
**removing only what was not Damyui speaking** already reached the 30s. Removed spots and reasons:

- **19.5-23.0 s** - heard twice consistently as "신나는 여행 멋진 친구들", and the mouth is closed in four frames in between.
  Looks like background audio or a notification (no banner on screen)
- **45.9-56.4 s** - only one groan ("으", 52.16-53.56). In the 53.5 s frame the mouth is open but there are no words
- **13.6-15.3 s**, **after 64 s** - breathing and fillers ("어")

Waveform detection puts such sounds in as "speech". Left in, it would be 43.3 s with 11 s of no content. **The waveform decides
where to cut, not what to keep.**

### Use only transcriptions heard twice

On this source the narrow-window probe invented speech too - "다음 영상에서 만나요" at 49-56 s and "고맙습니다" at 7-12 s.
There is no sound at all in either spot. Conversely, the wide window was wrong and the narrow one right in one case - "자궁"
(43.54-43.96) came out as "자국나마" in the wide window.

**Word times are 0.2-0.9 s early on this source** (0.2-0.3 on earlier projects). "어?" was placed at 29.60, but the waveform has
sound from 30.47. Cuts and captions are set by the waveform.

Two guesses remain (marked as such in comments): **"껀덕지도 안 줬네"** is the transcript's "안 좋네" changed to pair with the
previous sentence ("껀덕지도 안 주는데"), and **"년아" in "자궁 년아"** is where the transcript heard "넘어" or "나마".

### Caption entrance animation brought to shorts (instruction)

The same values as the longform (맘터귀칼가챠) - 0 -> 107% in 80 ms, back to 100% in 67 ms. No exit animation.

**The anchor must change from `\an2` (baseline) to `\an5` (box centre).** With an2 libass pins the baseline and grows only upward,
so it does not spread from the centre like the reference. Values were matched by rendering only the captions on black:

    an2 · MarginV 393       ink y 1417-1524
    an5 · \pos(540,1470)    ink y 1425-1532   (8 px lower)
    -> ORIGIN_Y = 1462; rendered and re-measured: 1419-1526, 2 px off

Outburst captions use the same animation. During the 0.13 s growth the letters are small and misaligned with the gradient band
(`\clip`), but in rendered frames it does not catch the eye.

The shorts pipeline burns captions in one pass (`edit_nocap.mkv` + `subtitles=`), so it needs nothing like the longform
`_settle()` - not rendering in pieces, the `\t(...)` reference never shifts at a seam.

### Outburst captions chosen by loudness

The instruction was "mix outburst captions and normal captions appropriately". The style says "once or twice per video; in a row
they lose their force". Two were chosen, **by measuring p85 of src_level.wav, not by feel**:

    아니 없다고          0.284   <- loudest in the video
    이런 개 미친        0.261
    다 때려부숴 슈밤    0.250
    껀덕지도 안 주는데  0.241
    망할 자궁 새끼      0.139   <- a swear, but muttered

The line with the swear seemed like an outburst, but measured it was not. Both chosen lines are **Damyui protesting directly**
("다 때려부숴 슈밤", imitating the uterus, is loud but is voice acting rather than an outburst, so it was left out). In the final
they are at 8.5 s and 27.4 s, 19 s apart. *(The user overruled this - see the first feedback below.)*

### Crop

    x 318-1342 (1024x1080 = 0.948), y 0-1080  ->  1080x1140, y=407

The silhouette sits in x 380-1240 with its centre at 810; the face centre moves between 790 and 900 per scene. 830 was taken as
the crop centre as a compromise. The chat balloon starts at x 1575, 233 px away (봉누도불참: 1580, almost the same).

Sound is **-44.8 LUFS**, 3 dB quieter than 봉누도불참 (-41.7). Raised 27 dB and set to -16 LUFS at the end (measured -15.7).
봉누도불참's thresholds were reused - silence p90 0.015-0.038, speech p50 0.048-0.202, nearly the same distribution.

### Two pipeline fixes

- **The header-key fix in `piece_cache.py` exists only in longform.** Shorts do not use the piece cache, so that file was not
  brought over
- **`build_ass.py` required a transcript on import.** `rebuild_from_csv.py` also imports this module just for the header and
  caption styles, and it crashed then too if `word_level_large.json` was missing. It now passes with an empty list

### Checks

`verify_cuts` 0, `verify_gaps` 0, `verify_sync` 0 suspicious of 26. `verify_timing` flagged 8, all "no syllable start to snap
to" - shown when only the caption changes while speech runs on without a pause.

**The final re-transcription (`verify_final`) was not run.** In 봉누도불참 it caught three things source checks missed. It can be
run with permission if needed.


### 마법의 날 - first feedback (2026-09-07)

Two instructions.

```
내가 원하는 대로 / 안됐네 / 다 때려부셔 슈밤  -> outburst
and re-check the outburst caption design
```

The user had also edited four caption lines directly (`captions_user.json`).

#### Three of the four were my typos

```
꺼덕지도 안 주는데   ->  껀덕지도 안 주는데
다 때려부숬 슈밤     ->  다 때려부셔 슈밤
이번엔? 이잔아       ->  이번엔? 이잖아
꺼덕지도 안 줌네     ->  껀덕지도 안 주는데   (typo + wrong guess)
```

**Why:** `make_csv.py` was written in Python inside a heredoc with all Korean as `\uXXXX`. Four hand-computed code points were
wrong - 껀 (U+AEF0) as 꺼 (U+AEBC), 숴 (U+C220) as 숬 (U+C22C) - and **were rendered straight into the video.** Written that way
in the file, I could not see them on re-reading either, and the console garbles Korean, so they could not be caught by eye.

**From now on, files containing Korean are written with the Write / Edit tools.** No heredoc + `\uXXXX`. If a heredoc is
unavoidable, re-read the file afterwards and print just the Korean. -> [[no-unicode-escapes-for-korean]]

The fourth ("안 줬네") was a typo plus **a wrong guess**. The transcript's "안 좋네" had been written "안 줬네" to pair with the
previous sentence, but the user corrected it to **"껀덕지도 안 주는데"** - she really said the same thing twice. There are eight
captions between the two, so it is not a consecutive repeat and gets no `(x2)`.

#### Outburst design - the lower part of the letters floated in yellow

The user gave three example images. Rendering on black showed a real problem:

```
ink y 1416-1527         <- actual position after moving to \an5
band (clip) y 1407-1507 <- still the value from the \an2 days
```

**The bottom 20 px of the letters were outside the band.** There the style's PrimaryColour (yellow) shows through, with the lime
shadow under it - measured (228, 222, 97) at y 1511, where it should be orange-red. The position moved with the entrance animation
but **the band range did not move with it.**

Three fixes:

- `EMPH_Y0/Y1` set to measured values (1414-1530). Measure the ink, not MarginV arithmetic
- The style's `PrimaryColour` set to the bottom colour (#FB5D4B), so any pixel the band misses falls back to red, not yellow
- **Top colour from yellow (#FBD65A) to apricot pink (#F7A094).** In the examples the letters are pale apricot pink at the top
  turning orange-red downward - no yellow visible. **This value was picked by eye from the images, not measured (guess).** If the
  examples arrive as files, measure the pixels and correct it

Old and new were rendered side by side; the new one matches the examples.

#### Outbursts went from two to five

My first-edit reason for excluding "다 때려부셔 슈밤" was **"it imitates the uterus - voice acting, not protest"**. The user
overruled that. User instructions come before the style's "once or twice per video".

The three are consecutive (final 14.6-17.6 s), so the whole sentence reads as one outburst - one block, not three separate pops.
By loudness "다 때려부셔 슈밤" is fourth loudest at 0.250 too.

Cuts were untouched, so `edit_nocap.mkv` was reused and only captions re-rendered. `verify_sync` 0 suspicious of 26,
`verify_cuts` / `verify_gaps` 0.


### 마법의 날 - filters removed from the audio (2026-09-07)

User: "the sound seems a bit different, did you touch something to remove the BGM?" -> "the difference is bigger than I thought"
-> "no filter is much better. **From now on, no filters until I ask.**"

The cause was **inheriting 봉누도불참's audio chain although the source had changed.** Measured, all three were touching the sound
for nothing:

```
afftdn=nr=12       during speech  1-3 kHz -3.1 dB / 3-6 kHz -8.4 dB / 6-8 kHz -11.4 dB
highpass=f=70      voice band 0.0 dB, only 30-70 Hz -4.5 dB
alimiter=0.92      raising 27 dB peaks at -0.4 dB, no overs. With it the peak sticks at
                   0.0 dB and the average rises 0.7 dB - it squashes and boosts rather than protects
```

The 3-8 kHz that `afftdn` cuts is where sibilance and air live. It removes voice along with noise. 봉누도불참 had low-frequency
noise and background music and needed it; this source does not - already measured in the first edit (the low band gets 4.0x louder
during speech; with background music it is the reverse).

**Current chain**

```
build_edit.py     volume=27dB                    (one plain gain)
apply_captions.py volume=<measured value>dB      (not loudnorm)
```

**loudnorm was removed too.** It compresses dynamics while levelling, which also touches the sound. `apply_captions.py` measures
the joined audio with ebur128 and raises it once by `min(-16 - I, -1.5 - TP)`. This version was -14.9 LUFS / peak -0.4 dBTP, so
it was lowered 1.1 dB and the final came out at -16.1 LUFS / -1.5 dBTP.

**ebur128 parsing trap:** it prints `I:` every frame, so a regex over the whole output catches the first frame's value (-70 LUFS).
Read only after `Summary`. One round was wasted that way.

The band limit (700-3000 Hz) of `src_level.wav` for cut detection stays - that track is **only for measuring** and never reaches
the final.

`_afftdn_version.py` was kept for comparisons. It takes the picture from an already rendered final with `-c:v copy` and rebuilds
only the audio, so it finishes in 20 s and the A/B differs purely in sound. To compare another chain, change the single `GAIN`
line.


### 마법의 날 - captions 8% larger (2026-09-07)

Side by side with the reference, the text was 8% smaller. `FS_DAMYUI` 130 -> 140.
The 130 came from the style file's `sizeNorm 0.068 x 1920 = 130.6`, but the reference that style was taken from is about 140 -
**the style file is the less accurate one.** Fill height went 96 -> 102, almost equal to the reference (104).

**Three things to re-measure when changing font size:**

- `ORIGIN_Y` 1462 -> 1460. an5 pins the box centre, so growing the text grows the ink both ways. Better to keep the caption
  band's **bottom** fixed - the screen edge is close below, and above it is open towards the face (set to 1526)
- `EMPH_Y0/Y1` 1420-1515 -> 1414-1516. The outburst gradient changes colour by **fraction** of the fill height, so the fill range
  must be re-measured
- **Line width.** Two lines exceeded the 1020 px limit and were split:

      상태 안 좋을 때만 시작해  1081 px  ->  "상태 안 좋을 때만" / "시작해"
      아 슈밤 이번 안 해주냐?   1033 px  ->  "아 슈밤" / "이번 안 해주냐?"

  Captions went from 26 to 28.

Cuts untouched, so `edit_nocap.mkv` was reused and only captions re-rendered. Checks pass (verify_sync 0 suspicious of 28).


### Style files corrected to measured values (2026-09-07)

The three shorts styles in `dashboard/styles/` held wrong values. All were corrected by re-measuring 12.5 s of
`아야와 현실 합방.mov` - **that file is recorded in measuredFrom and is still on disk.** *(Later rule, 2026-10-02: presets no
longer record sources.)*

| | Before | After |
|---|---|---|
| host sizeNorm | 0.068 (=130.6) | **0.0729 (=140)** |
| outburst fill top | #FBD65A yellow | **#DAFD73 lime** |
| outburst outline | #1C2C38 | **#0C262A** |
| outburst shadow | #DAFD73 | **#DAFA78** |
| outline width | (none) | **3** |
| dark layer offset | (none) | **11** |
| lime layer offset | (none) | **15** |

New fields: `fillStops` (12 measured stops), `fillRange` (top 42% only), `depth` (thickness in four directions) and
`howToReproduce` (three ASS layers).

**A wrong record sent me in circles.** `fillNote` said "the lime is not the top of the fill but a shadow lying along the bottom
edge", which is false - lime is the top colour of the fill. `fillMid` in the same file ("top to bottom lime -> amber -> orange-red")
was right; the two records disagreed and I believed the wrong one. The file now also says why it was wrong.

**Scope of the change:** the outburst look does not depend on the speaker, so it was copied to 다인쇼츠 and 영도쇼츠 as is. Size was
measured on a solo short, so it was copied only to 다인쇼츠 and **marked as a guess**; 영도쇼츠 has a different layout (no crop,
captions below the video band), so it was not changed, only marked "measure before deciding". The 다인쇼츠 guest size (0.07) uses a
different font (Bold), so it was left and marked. Longform uses a different outburst colour entirely (red) - its own measured
values, left alone.

**Still undecided:** a reference line is 917 px wide, but the same text rendered at 140 is 880 px (4.2% narrower). Letter spacing
3.4 or ScaleX 104 both give 917, and it is not settled which. Height matches at 140, so the size is right. Recorded in
`openQuestion`.

### 다음 생 - first edit (2026-09-07)

`다음생.mp4` 112 s -> **38.7 s**, 34 captions (2 outbursts), 11 cuts.
Final `edited/다음생_ko.mp4`, dashboard `projects/pmtqynkwa5tuo`.

A chat asks "그래도 다음생에 유이로 태어나줄거죠?" and Damyui answers "저는 돌멩이로 태어나고 싶은데요". Not just any stone - it has to
be **a stone in an indoor flower bed of a rich house**, and with the reason it closes as one bit. Then she suddenly dies in a game
and screams - ending on "지지 / 나 안돼 / 무리 무리 무리".

**No values inherited. This source is completely different from the previous project.**

| | 마법의 날 | 다음 생 |
|---|---|---|
| Integrated loudness | -44.8 LUFS | **-15.8 LUFS** |
| Gain | +27 dB | **0 dB** |
| THR_HI / THR_LO | 0.050 / 0.022 | **0.022 / 0.010** |
| Crop | x 318-1342 | **x 393-1417** |

Inheriting +27 dB would have clipped everything. Thresholds were re-measured too, because the silence / speech distributions differ
per source (silence p90 0.0105, speech p50 0.0319).

**The waveform was wrong twice, and both were caught.**

1. 74.7-76.5 is a flat hum at level 0.013, just above THR_LO (0.010), so the waveform held it as one blob. The end of speech
   ("싶습니다") is the peak at 74.9 and real speech resumes at 76.80. 1.4 s were cut
2. In "실내에 있는 부잣집", **"집" vanished entirely and it ended at "부잣".** The closure between "잣" and "집" is 0.14 s, longer than
   JOIN (0.12), so "집" became a separate 0.11 s piece and was discarded by MIN_PIECE (0.20). Joined with `JOIN_BY_GROUP[2] = 0.16`.
   **verify_cuts cannot catch this** - the cut fell in a real gap. Found by separately scanning for sound within 0.35 s after each
   piece boundary

**The donation alert at 78.30-86.10 s was removed entirely.** It sits at source x 70-470, y 100-393, overlapping the left crop edge
(393) by 77 px, so cropping cannot avoid it. The style says donations go, sound and picture, and the previous blob ends at 78.86,
so cutting at 78.3 clips no speech.

**+9 dB on the scream** (instruction: "make 1:32 - 1:35 louder"). Measured at -25.3 LUFS, 10.9 dB below the speech (-14.4) - the user
was right that it felt quiet. New `timeline.GAIN_DB`, applied by `build_edit` when rendering the piece. -17.5 LUFS in the final,
1.7 dB below speech.

**Four transcript fixes.** "유희로" -> "유이로" was confirmed by reading the chat balloon at 4 s, not guessed. "쥐지" -> "지지" (GG)
and "쥰내" were words the user flagged as confusing - 지지 was right and **쥰내 was not found** (re-listening at 90 s gave "배 죽나
봐"). "부자칩" -> "부잣집" is certain from context but not verified (guess).

### 다음 생 - first feedback (2026-09-08)

Only captions re-rendered. **Cuts untouched** (38.74 s, `edit_nocap.mkv` reused).

**Five caption text fixes** (`captions_user.json`):

| First edit | Fixed |
|---|---|
| 또 실외에 있는건 안돼 | **근데** 또 실외에 있는건 안돼 |
| 아 나 배 죽나 봐 | **아 나 배 쥰내 아파** |
| 지지 / 지지 지지 / 잠깐만 지지 | **GG / GG GG / 잠깐만 GG** |

**"배 죽나 봐" was my mistake.** I cut just those 2.6 s and re-listened twice, with and without a hint, got the same result both
times and took it as correct. **Feeding the same sound to the same model twice makes the same mistake twice - that is not
verification.** The job listed "confusing words: ... 쥰내", I did not find it and reported "not anywhere in the transcript". If a
flagged word cannot be seen, it was not found - not absent.

Same with "GG". In the instruction "GG(지지)" the parentheses gave the **pronunciation**, but I read it as the spelling and wrote "지지".

**The user hand-timed ten caption lines** ("caption length fix", final time). They went into `make_csv.USER_TIMES` as is and take
precedence over `span()` / `snap()`. Neighbour boundaries were left alone - the existing rules (pull back the previous end on overlap,
fill gaps under 0.5 s) handle them.
One value received was **25.37-25.44 (0.07 s, four frames)**, treated as a typo for 26.44 (guess - the user was told).

**The outburst on "나 안돼 나 안돼" was removed** (instruction). Only one outburst remains.
"근데 또 실외에 있는건 안돼" is 1158 px, over the 1020 limit, so it **shows as two captions** ("근데 또 실외에" / "있는건 안돼"). The
outburst gradient band is fixed in pixels for size 140, so shrinking the text would misalign it; it was split instead.

### 모캡 밀림 - first edit (2026-09-09)

`모캡밀림.mp4` 69 s -> **31.3 s**, 28 captions (2 outbursts), 16 cuts.
Final `edited/모캡밀림_ko.mp4`, dashboard `projects/pmtth2gr62trh`. The job prompt was empty, so it followed "same as before".

Damyui sulking. She thought she would be the first to use the facial expression studio, but she had not even heard how it was going,
and although they "were going to call her first", they did not. Ends on "속상 속상하다는 것이야".

Speech covers 32.7 s, so almost all of it went in. Only "안녕하세요" (greeting the chat) and one sound were removed.

**The audio values differed again** - all three sources differ:

| | 마법의 날 | 다음 생 | 모캡 밀림 |
|---|---|---|---|
| Integrated | -44.8 LUFS | -15.8 | **-18.4** |
| Gain | +27 dB | 0 dB | **0 dB** |
| THR_HI/LO | 0.050/0.022 | 0.022/0.010 | **0.016/0.006** |
| Speech / silence separation | 11.8x | 16.9x | **56.8x** |

**The final is -18.7 LUFS, 2.1 dB quieter than the earlier videos (-16.6).** The source peak is already -0.9 dBFS, so a fixed gain has
no room. Measured, that peak is one plosive at the start of "나는", and **1 sample of 35,040 exceeds -1 dB** (0.5 ms). A limiter would
allow another 2 dB, but filters are forbidden, so it was not applied and the user was told.

**Another "not speech" sound caught.** The waveform treats 24.63-24.82 as speech, but it peaks at -17.8 dB and is barely audible.
Transcribing just those 0.35 s gave "넵"; with a wider window, nothing. With it removed, "아직 안 된 줄 알았는데" was fully inside the
previous piece. *(This was wrong - see the first feedback below.)*

**Transcript verification changed** (after 다음 생 made the same mistake twice). Instead of feeding the same window twice, **vary the
window size** - different context gives a different hearing. That caught two:
- "일바다로" (not a word) comes out as **"1번 따로"** with a narrower window -> read as **"일빠따로"** (still a guess)
- Confirmed the first word of each phrase ("나는", "내가") really is in that piece. On this source Whisper word times are **1.0-1.5 s**
  early (it pulls the preceding silence into the word). The two items verify_sync left are false alarms for that reason

**Two guesses remain:** "일빠따로" and "표정화 스튜디오" (transcript as is, not verified what it is). The top caption uses the project
name; the dashboard says "모캠 밀림" and the file "모캡밀림.mp4" - **written as 모캡 (motion capture)**.

### 모캡 밀림 - second feedback (2026-09-09)

**Cut to 28.7 s, then 1.1x -> 26.1 s** (instruction). Speed is applied once **after** captions are burned - picture, sound and captions
speed up together.

**The tail of "그니까" was left in front of "먼저".** The user's drop ended at Whisper's `먼저@40.90`, and **that time was wrong.**
Counting peaks:

    41.61 먼 · 41.88 저 · 42.11 불러 · 42.81 주시기로 · 43.82 했 · 44.27 는데

the eleven syllables of "먼저 불러주시기로 했는데" line up, and **40.92-41.44 is the drawn-out tail of "그니까".** Whisper pointed 0.7 s
early.

**I disagreed with the user twice here.** I read 40.92-41.44 as "먼" and pushed back that "cutting it removes 먼저". The user listened
again and said *"I hear '먼저' after 17.72"*, and they were right. **Never argue against the user's ears with Whisper word times** -
counting syllable peaks is free. (Take spans above 0.020 in `SM` and match them to the word's syllable count.)

### 모캡 밀림 - first feedback (2026-09-09)

**31.3 s -> 29.4 s.** Cuts and captions both changed, so everything was re-rendered.

**Two removals** (feedback tab drop.json): the second "뭐 한 거 아니야?" and "그니까 그니까". The first was an outburst, so only one
outburst remains. 1.4 s shorter than the style's 30-40 s - the user decided it, so it stays.

**A drop alone leaves a tail.** Even with `_with_drop` cutting the group head at 35.03, `audio.pieces` pushed the boundary back to a
quiet spot (HEAD_REACH 0.40) and 0.35 s of 34.83-35.18 survived. Fixed by raising the GROUPS start to 35.30. **After applying a drop,
always check the piece list by eye.**

**The transcript was wrong again, and two windows did not catch it.** "표정화 스튜디오" came out the same in two separate windows and was
left, but the answer was **"프젝아 스튜디오"**. **Names only insiders know cannot be caught by transcription** - splitting windows does
not help. "일빠따로" had the right sound but the wrong spelling (**"1빠따로"**, with a digit).

**Three sentence endings were cut off** - "쓸 줄 알았[는데]", "아직 안 된 [줄]", "알았[는데]". I **misread this as a caption fix and
shortened the captions.** The user corrected me: *"The speech can't be heard, so make it audible. If it were just a caption fix I
wouldn't have written it in the prompt box."* **Which box the feedback was written in tells what to fix** - caption text goes in the
caption editor; things the pipeline must change go in the prompt box.

Two causes:
1. "는데" (6.69-6.87) has levels of 0.0070-0.0136, **above THR_LO but never above THR_HI (0.016), so the hysteresis never started a
   blob.** There was sound, but it never entered SOUNDS and was cut entirely -> THR_HI lowered to 0.013
2. The 0.22 s between "알았" and "는데" exceeded MERGE (0.20), so the piece split and the remaining 0.19 s was discarded by MIN_PIECE
   (0.20) -> new `MERGE_BY_GROUP`, raised to 0.28 for that group only

**The 24.63-24.82 cut as "not speech" was exactly that "는데".** In the first edit, transcribing those 0.35 s alone gave "넵" and it
was judged not to be speech, but **Whisper produces arbitrary words for such short isolated slices.**

**The dashboard not showing it was the browser's doing.** `js/app.js:201` assumes "the browser is always newer than the copy in the
project folder" and restores the last state. After my export the folder has the new version but the screen draws the old one.
**Reloading does not help; it reads from the folder only when the card's `open` is clicked again in the project manager.** Server, API
and files were all fine (opened directly: video 31.25 s, 1080x1920, readyState 4).

## Open items (as of 2026-09-09)

1. **고구마 22 s "왜 아만해?"** - undecided, left without a caption. Needs a human ear (three transcriptions disagree: 왜 아만해 / 왜
   암하네 / 왜 안 하냐)
2. **`import_project.py` exists only in the 고구마 folder** - must be made shared to use in other edits (only the file name changes)
3. **마로 and 담아맷돌 have no project JSON** - copying export_project.py creates the cards (고구마 and 네모비틱 have them). Always export
   when an edit is finished - otherwise nothing shows in the dashboard
4. **The 영도 style has only one reference** - caption density 58% and the video band position come from a single sample; re-check when
   more 영도 episodes exist
5. **Guest outburst captions are a decision, not an observation** - only host cases were seen in published videos

## Working notes

- Do not drag one edit out too long. Run verification in one batch, and re-render fully only when the timeline changes (captions only
  -> apply_captions is enough)
- When transcriptions disagree, **trust neither; decide by the waveform.** This used to say "trust the whole-file transcription", but in
  봉누도 both were wrong - the whole-file transcription missed "겹칠 거기 때문에" entirely and the wide window invented "지만" and "진짜".
  Check three things: agreement of several short windows + an actual sound blob at that spot + the final re-transcription
- Escapes get mangled when inserting JS strings from Python. Always check with `node --check` afterwards (broke it twice this time)

## 맘터귀칼가챠 - fourth feedback (2026-09-06)

All five items from the dashboard applied and re-rendered. Main 42.24 -> 41.89 s, final 49.46 s.

**One explanatory line at the start.** A new Note style shown small above the captions (54 px, ink y 843-881, above the caption ink top
at 910). A CSV speaker of "설명" uses this style with no entrance animation. Text as instructed: "*맘스터치 x 귀칼 콜라보 세트를 시킨
유이" / "*Yui ordered the Mom's Touch x Demon Slayer collab set (Korea only)". The English line fits on one line within 1620 px at 54 px.

**The face re-measured per piece.** Damyui sits around x=1100, not in the centre. Last round framed scenes at 962 / 850 / 1280 / 1130,
and the first two pushed the face 100-250 px right - that was the "character leans to one side" complaint. `timeline.FACE_CX` records the
per-piece measurement (centre between the eyes) and crop x derives from it. The frame changes only at cuts, which is different from
moving within a scene.

Only the 33-40 s scene has the face swinging 200 px in 1.5 s (34.8:1130 35.3:1330 35.9:1200), so it stops at cx 1120, the right edge of
the 1600 window. A smaller window would fit it, but that changes the scale - zoom was instructed only for the scream.

**1.6x only for the scream.** Final 26.30-30.50 (source 63.48-67.68) pulled in to 1200x675. The vertical start 320 is for the captions:
the bottom of the mouth at source y=880 becomes (880-320)x1.6 = 896, staying above the caption ink top at 910. The other framings were
checked with the same arithmetic (face close 853, face mid 840, wide 880).

**Three 짜자잔 lines.** The captions vanished before the speech. Sound runs to 75.70-77.40 / 78.90-80.94 / 96.24-97.78 - extended by
0.30 / 0.14 / 0.18 s.

**"Between words" added to where drop ranges snap.** Last round only piece boundaries were candidates; the dashboard's 44.38 was more
than 0.70 s from any piece boundary, so it stayed and split a word in the middle (44.12-44.58 "제발"). Now a drop's end moves to 0.15 s
before the next word starts and its start to 0.22 s after the previous word ends. The joining gap is 0.25 s - with `plan_cuts`' 0.95,
"제발 기유 나와라 기유" becomes one blob and the 0.30 s gap before 44.88 disappears. 44.38 -> 44.73, and the split "제발" went out entirely.

**Lines whose speech is gone but whose caption remains are dropped.** The minimum surviving length rose from 0.20 to 0.50 s. "제발 제발"
was left as a 0.45 s flash.

Thanks to the cache, 6 cut pieces and 9 caption pieces were re-rendered; the second version after fixing the drop range needed only 1 cut
and 1 caption piece. `verify_struct` 0 problems.

## 맘터귀칼가챠 - fifth feedback (2026-09-07)

Final 48.97 s, in ko and jp.

**First fixed the path feedback was not taking.** Pressing `render request` saved nothing. It emitted a `render:request` event and logged
a line, and **nothing anywhere listened for that event.** The screen showed "[feedback] render request: edit/맘터귀칼가챠" and looked as
if it went through. Three blockages:

  render request button   logged, never saved
  Ctrl+S                  sat below the isTyping check, so it did nothing while typing
  save button             called without force, so right after I exported an edit
                          ("the file is newer") it silently skipped

The third was especially nasty - every render and export of mine makes the file newer, so saving never works again after that. All three
were fixed and checked against the server.

**Japanese version.** Font Yu Gothic. CookieRun has almost no kanji or kana (none of the four in 鬼滅の刃), so leaving it would switch
fonts within a line. Noto Sans JP is a variable font that libass draws thin, and Meiryo is thinner still - all three were rendered and the
one closest in weight to CookieRun Black chosen. Names are returned to kanji rather than transliterated (탄지로 -> 炭治郎, 기유 -> 義勇,
카이가쿠 -> 獪岳, 귀칼 -> 鬼滅の刃). Damyui is a streamer name, so ダムユイ. Japanese has no word spaces and so no line-break points; only
the line that overflows got one space at a breathing point (it breaks there only when overflowing).

**Outro transition.** A 0.45 s overlap (xfade + acrossfade). The outro is a full different scene from its first frame, so a hard cut
jarred. Only that spot is re-encoded, so the join is no longer pure -c copy - about 45 s more per final (1 min 20 s total).

**Explanatory caption 54 -> 62 px.** Ink sits at y 837-887, leaving 23 px to the caption top (910).

**The piece cache key lacked the caption header.** Styles (font, size, colour) live only in the header, so changing the explanatory
caption size still reported "cache 29" and produced the old picture. After one wasted round `_HEAD` went into the key.

en was not rebuilt, as instructed. **So only the en final lacks the transition and still has a 54 px explanatory caption** - one line,
`python apply_captions.py en`, fixes that.

## Two caption lines, and a save that rewound everything (2026-09-07)

The user edited two caption lines directly in the dashboard (`captions_user.json`): `짜자잔! (x2)` -> **`짜자잔~`**, `짜자잔! (x3)` ->
**`짜자잔!`**. The (x2)/(x3) counting was dropped - the second is a drawn-out sound (2.06 s), so `~`, the third a fresh shout, so plain
`!`. Only ko re-rendered (instruction: not jp). The same words went into the en/jp dictionaries so they follow next time.

**One save rewound the whole project.** The user's open tab was very old - the saved project.json had the caption `담린이 남긴
카이가쿠라고?` and kept ended at `[92.6, 104.63]`. **That is the state before feedback 3.** The browser sent those old values and the
server wrote them as is.

Last round's change of the save button to `force: true` exposed this. Before, "the file is newer" made it skip so nothing rewound -
but feedback never got saved either. Both were broken.

The server now splits what it accepts (`save_project`):

    file is canonical      kept · transcript · captions · video · base · canvas
    browser is canonical   prompt · notes · drop · restore · edited captions (by=user)

The browser never creates pipeline values, so its copy is always equal or older. Edited captions are placed on the line with the
nearest time (within 1.5 s); if the tab is too old and times do not match, it is logged and passed on only through
`captions_user.json` - which was the case this time (52.74 s / 61.35 s were times on the old timeline with nothing to attach to).

jp was added to the dashboard's list of finals.


## 악성메일단 first edit (2026-09-11, 담유이 일반 롱폼)

`jobs/20260911_005238_스타일적용.json`. One source (`E:/Edit/OBS/악성메일단.mp4`, 320 s). Instructions: **"under 2 min 30 s"** and **"focus
on the chat where Yui reads it out"**. Result: **final 144.87 s = 2 min 24.9 s** (main 137.76 + outro 7.47 - overlap 0.45), 25 cut pieces
(25 counting framing), 63 captions.

### A source with a background bed cannot be cut from the full-band waveform

This source never drops below -60 dB. Measured, **a -48 dB threshold counts 91.8% of the 320 s as "sound"** (p5 is -51.7 dB). Carrying
over the earlier projects' thresholds would have separated nothing.

So **a measuring track filtered to the speech band (700-3000 Hz)** (`src_level.wav`) was made and used - the shorts technique brought to
longform for the first time. The band track separates clearly:

    speech            band p50 -32 to -35 dB, p90 -14 to -19
    no speech         band p50 -50 to -51 dB, max -42

Threshold -46 dB. This track is only for measuring and never enters the final.

### Removing silence cannot reach 2:30 - content must be thinned

Even removing every gap at the most aggressive threshold (-46 dB) leaves **222 s**. The target is 150 s. The longform style is "thinning,
not restructuring", so speech blobs were grouped into story units (13) and whole passages were chosen for removal. 43% of the source
(137.8 s) was kept - much higher than the references' 11-19%, because this source is already a 5-minute cut on one topic.

Removed: repetition (the same question twice, "그 사람들은" x2, "한화생명 기다릴게요" x2, "너네밖에 없다" x3) and digressions (chatter
about where viewers came from, "뭐 뭐 뭐" filler, the closing "혜지맨" x4).

### Four loud spots missing from the transcript

The waveform found them first. **121-136 s held a scream ("으아아아") and chat reading, and the first transcription left not one
line.** Only re-listening to those 15 s with loose settings (no_speech 0.15, log_prob -2.5, temperature ladder) showed it was speech.
Same kind as 맘터귀칼가챠's 3.2 s laugh - **never decide cuts from the transcript alone.**

There was a judgement in the other direction too. **16.6-21.2 s** is also empty in the transcript but has sound, and this time it was
removed. Three reasons: two different window sizes caught not one word, it is 12 dB below speech (max -22 to -29 dB), and **the frames
show the mouth almost closed.** A laugh would have stayed, but it is mumbling. To restore it, put the three pieces back (noted in the
`timeline.py` comments).

### Words: the chat on screen is canonical

Damyui reads chat a lot, and **that chat is on screen as text in the top right.** Cropping frames and reading them was faster and surer
than re-listening with several windows. Fixed this way:

| Transcript | Actual | Evidence |
|---|---|---|
| 한생여행 · 하나생명 · 대치생명 · 해치생명 | 한화생명 | chat at 3.0 s "유이 한생유입 은근 많더라" |
| 담요잉 · 담요엘 | 담유이 | chat at 288.0 s "악성팬덤 소유자 담유이님 안녕하세요" |
| 매일단 · 매일 다들 | 메일단 | chat at 175.0 s "메일단창설 ㄷㄷ", 298.0 s "악성메일단 운영중이신 담유이님" |
| 취직 스트리머 | 치지직 스트리머 | chat at 145.5 s, confirmed in several windows |

"테러 아님?" (chat 173.5 s) and "고객센터 폭파" (chat 229.5 s "유이의 도파민을 위해서 고객센터 폭파하자는거구나") were confirmed from chat too.

**Three remaining guesses** are marked "(guess)" in the `make_csv.py` header and the dashboard notes: 253.6 "스트리머 걔가 뭐야" (three
windows split between 개그 / 계획 / 걔가), 150.4 "장문으로 보내봤다" (both windows heard "오픈해", which makes no sense), 296.3 "악성 메일단을"
("악성" is not in the transcript).

The instruction wrote "울프", but **what she actually said is "울쌤"** (the same in two windows). The caption follows what was said.

### Five framings - keep the chat whole or drop it whole

|Name|crop|Scale|Used where|
|---|---|---|---|
|wide|none|1.00|talking to the camera without reading chat|
|mid|1344x756 @(232,180)|1.43|face, no chat|
|close|1152x648 @(416,220)|1.67|face centre, no chat|
|chat|1440x810 @(480,0)|1.33|reading chat|
|chat close|1280x720 @(640,0)|1.50|chat larger|

The first face framing at 1600 wide **caught half a chat balloon at the right edge** - exactly what 맘터귀칼가챠 recorded as "a half-cut
overlay looks worst". The balloon's left edge is x=1575, so face framings were re-set with `x + w <= 1575`. Because of that, **face
framings start at 1.43x** - anything wider catches the chat.

The zoom limit is where the mouth does not cover the captions. Measured: bottom of mouth y=580, chin 650, caption ink top 910. Chat
framings must start at y=0, so the scale cannot exceed 910/580 = 1.57 - why chat close stops at 1.50.

**Frames confirmed there really is something to read in the chat.** At 147-152 s (reading a long chat post) the post had already scrolled
up leaving only a "?" balloon, so it was framed on the face, not the chat. Same for 68-77 s.

Every scale change **sits at a cut** (all 18 boundaries confirmed inside removed ranges).

### Emphasis chosen by measurement

The speech-band p90 was measured for every caption line, and two meaningful ones were picked from the loud end: "하지만 파트너가 될 수
있다면" (-13.4 dB, 4th overall) and "너네밖에 없다" (-14.4 dB, 8th). 3.4 s together = 2.5% of the main part (reference: 3.5 s, 4%). The
loudest line was "막 와아아아아" (-11.6 dB) but it is sound rather than words, so it was excluded.

### Per-scene gain - only the two short by 3 dB or more

RMS was measured per piece **over speaking frames only** (band level above -40 dB). Nine of 25 fell short of the target (0.115), but only
the two short by 3 dB or more were raised:

    piece 3  21.20-23.94   rms 0.0780 (-22.2 dB)  +3.4 dB
    piece 22 275.54-276.40 rms 0.0382 (-28.3 dB)  +6.0 dB  "나 울게"

"나 울게" is **11 dB below** the rest and inaudible otherwise. Touching 1-2 dB pieces too would make the background bed jump at every cut,
so they were left.

### loudnorm replaced with a fixed gain

The longform `apply_captions.py` used `loudnorm ... linear=true`. Following the CLAUDE.md rule ("final loudness with one fixed gain, not
loudnorm") it now **measures with ebur128 and applies one `volume=NdB` line**. Even with linear=true, loudnorm has a true-peak limiter
inside. This source's main part was -14.8 LUFS / max -0.4 dBTP, so it was lowered 1.2 dB to -16 LUFS.


## 악성메일단 - first feedback (2026-09-11)

All twelve points were right, and four were **my mistakes**.

### "Why so much leading space?" - captions over sound can still leave space

Last round "every caption window sits over sound" was checked and passed. But **sound above the threshold (-46 dB) is not the same as
speech.** The first caption is an example:

    2.12-2.32 / 2.58-2.74 / 2.90-3.04   three 0.2 s filler noises
    3.44-4.84                            "나 한생 유입 많다고?"

With the caption hung at 2.12, the caption alone stood on screen for 1.3 s. The user's "00:01.4" was **exactly** 3.44 converted to final
time.

Fix: within each caption window, re-measure **where clear speech (-32 dB) starts**, and move the ten captions with gaps over 0.3 s. `-46 dB`
is the threshold for "where to cut" and `-32 dB` for "when to show a caption" - **use them separately.**

### Donation alerts were being missed

Opening the spot for "0:53.82-0:58.40 -> donation speech" showed **a donation alert in the top left** (source 140.8-153.4 s).

    익명의 후원자 님이 1,000 후원!
    유이야 내가 한화생명에 치지직 스트리머 프로젝트아이 소속 담유이
    파트너 달라고 장문으로 보내봤다

Last round I wrote "a long chat post she reads, already scrolled up at 148 s and unreadable" and guessed the captions. **It was a
donation, not chat, and the text was on screen the whole time.** I looked only at the chat in the top right, not the top left.

That confirmed one guess - "장문으로 보내봤다" matched the alert text, and "프로젝트" was "프로젝트**아이**".

Lesson: **first look for the spoken content as text somewhere on screen** - chat, donation alerts, overlays. Cheaper and surer than
re-listening with several windows.

### What was taken for laughter was speech

"1:11.30 -> the '다' is inaudible (cut at '너네밖에 없')". Source 164.60-165.94 was cut as laughter, but measured it is **-9.6 dB, speech
level**. The cut end moved 164.60 -> 166.14.

Last round the opposite case (the mumbling at 16.6-21.2 s) was removed correctly, judged by level (-22 to -29 dB) and mouth shape. This
spot's level was never checked.

### Zooming pushed the face right

"The character feels shifted right -> centre it; too much of the head is cut off." The face centre is x=1000, but **dropping the chat
balloon (x>=1575) entirely means the crop cannot pass 1575.** Last round's wide crop (1344) pushed the face to 1097. A narrower width puts
it exactly in the centre (960):

    mid   1344x756 @(232,180) 1.43x  ->  1152x648 @(420, 80) 1.67x
    close 1152x648 @(416,220) 1.67x  ->  1024x576 @(488,120) 1.88x

The vertical start moved up to 80 / 120 so more of the head shows. The limit is the mouth (source y=580) staying above the caption ink
(y=910) - chat framings must start at y=0, so their scale cannot exceed 910/580 = 1.57.

### The staff role-play section was redesigned

Two pins and the prompt were combined in one spot (source 248.90-274.70):

- **Gaussian blur** on the source (sigma 14)
- **화난고객센터.png** on the left (533x797 @248,191)
- **Constant-speed bounce** while speaking. Measured on the reference ("개 짱짱 빵댕이를 갖고 싶은 유이.mp4" 93-95 s): **period 0.24 s,
  vertical travel 11% of height**. The instruction said "slight", so half that, 5% (40 px). Constant speed means a triangle wave, not a
  sine
- Captions in a **speech balloon** on the right in **ONE Mobile POP OTF 130 px**, as if the staff member speaks. One balloon for the whole
  section with only the text changing - redrawing it per caption would blink every 1-2 s. At most two lines inside, never breaking a word

`fx` (blur, overlay) was added to `piece_cache.cut()`. It is part of the key, so changing a value re-renders only that piece.

The end the user gave (1:58.97) was mid-sentence, so it was set to **where "이러는 거 아니야?" ends**. "나 울게" right after is Damyui, not
the staff.

### Result

27 cut pieces, main 134.42 s, final 141.44 s (2 min 21.4 s), 66 captions (14 staff balloons, 4 outbursts).

### A feedback range is [start of first caption, start of last caption]

The user asked: "Did you take my feedback as caption end timestamps?" Matching the numbers against last round's caption table (68 lines
left in `project.json.bak`), **both ends of each range were 'start' values.**

The proof is `1:31.56 ~ 1:32.68 "그건 안된다" -> why two captions?`. In that version the two captions were 91.56-92.62 and 92.68-94.52.
Only reading 92.68 as the second caption's **start** puts both inside the range.

Reading it as an end time **missed one outburst caption** - "0:40.86 ~ 0:44.16" covers three captions up to "나 오렌지색으로 안 태어났는데"
starting at 44.16. Fixed and re-rendered.

Read the same way, "1:58.97" (blur end) is the start of "이러는 거 아니야?", so the range runs to where that caption ends - **the result is
what I did**, but my explanation "moved because it was mid-sentence" was wrong.

On the other hand the numbers in the "leading space" item (1.4, 6.33, 38.27) do not match caption boundaries. Those point at **where speech
is heard** - 38.27 was 0.01 s from source 113.70 where a stumble ends. The two kinds must be read differently.


## 악성메일단 - second feedback (2026-09-11)

Fourteen items. The big one: **the picture changed from 'framing' to 'covering'.**

### Inserts - pictures not tied to cut points

Instruction: "for donations and chat zooms, lay LongBG.jpg as the background and show them enlarged like a screenshot (chat or donation in
the centre; for donations include the character), no captions".

Until now every picture was a crop, and **a crop could only change at a cut** (scale changing inside a scene wobbles). Because of that,
last round a forced 0.18 s cut was added to end the donation section, and it came back this time as "unnatural cut transition ('다' not
heard properly)".

An insert **covers the whole screen.** The picture changes rather than the scale gliding, so it can start and end mid-piece. The forced
cut is gone.

    fill 1920x1080 with LongBG.jpg
    enlarge the cell cut from the source to 1440x1080 and place it centred (x=240)
    chat 420x315 @(1500,0)  3.43x   donation 520x390 @(10,45)  2.77x

Cells were measured so that **the balloon (x1580-1908) and the donation alert (x70-470) sit in the middle of the cell**. 240 px of
background shows on each side, the same proportion as the reference screenshot.

**One big detour.** At first the insert was cut from the already-cropped picture and showed the wrong area - it must be cut from the
source. After fixing that the picture still did not change, another detour: **the piece cache key did not include the filter structure,
so the old picture came back.** `piece_cache.FX_VERSION` went into the key - bump it whenever filters change.

### Partial emphasis

Instruction: "emphasis -> whole-line and partial emphasis / 하지만 파트너가 될 수 있다면 -> partial emphasis on 파트너 / colour words ->
partial emphasis in that colour".

Whole-line emphasis (Emph) is built by stacking horizontal slices of the gradient, so **a single word cannot be coloured.** Partial
emphasis uses another device - inside an ordinary caption line only that word changes to a solid colour:

    파트너    #C30000 + yellow outline (same as outburst)
    하늘색    #5AC8FA
    오렌지색  #FF7A00

The CSV writes `«word|colourname»`; rendering to ASS turns it into colour tags, and exporting to the dashboard strips the mark.

### Another way to cut time - enable

"Show the staff only up to '절대 주기 싫어졌어', back to normal from '이러는 거 아니야?'". There is no cut there. But **gblur and overlay can
be limited in time with `enable=`** - the blur and overlay end without a cut.

The point of this round: cuts, crop, inserts and enable are separate layers.

### Other

- "I deleted all of the 한화생명 화이팅 part, why is it still there?" - drop.json contained only 0.5 s (clips deleted on the timeline do not
  become drops). The intent was clear, so the whole passage was removed
- 37.20-37.50, thought to be "혹시", was **breathing at -43.8 dB**. The real "혹시" is 38.12-38.40 (-17.3 dB). The breath piece and 1.5 s of
  leading space were removed
- "1:41.26 메일을 쥰내 보낸 거야?" - "메일을" starts 1.02 s before the caption (source 259.34). The previous caption's end was pulled back
- Balloon side margins 70 px, **auto-fit per line** (130 -> down by 5 until it fits). One line ended at 125
- Staff bounce 0.24 -> 0.34 s ("a bit slower")
- "하지마 하지마 하지말라고" left as the source (wide) - "focus on body movement"
- **Final at 1.1x** (main part only, after burning captions)
- 12 user-edited captions applied

### One restore held back

restore 112.76-114.76 ("색이 맞아서") was not applied. Inside it, 113.12-113.70 was **removed last round on the user's own instruction,
"that part stumbles, better removed"**, and another point in this round says "more empty space than expected", so restoring would
contradict both. It was read as an attempt to undo a struck-through word in the transcript tab, and the reason is recorded in
`timeline.IGNORE_RESTORE`.


## 악성메일단 - third feedback (2026-09-11)

### An insert is "cut tight", not "placed in the centre"

"For chat, zoom in on that part and centre it ... you did it well on '네모에게 비틱'". A 4:3 window was taken and placed in the middle of
the screen, but **the balloon still leaned right** - it hugs the right edge of the screen, so it is on the right inside the window too.
Centring the window does not centre the content.

네모비틱's quote cards were the answer: **cut tight around the text**, enlarge that and centre it. The cut regions were read by eye with a
grid overlay:

    "유이 한생유입 은근 많더라"            (1578, 143, 242,  60)  5.95x
    "악성팬덤 소유자 담유이님 안녕하세요"    (1577,  16, 336,  94)  4.29x
    donation alert + character            (  10,  45, 520, 390)  2.77x

Scale is `min(1440/w, 1080/h, 6.0)`; the background is LongBG enlarged 1.1x to fill.

### Default emphasis colour from red to pastel blue

"Unless told otherwise, write emphasis captions ... in an eye-catching pastel blue. Red seems better for expressing real anger."

Red came from **measuring two references.** Still, when the user decides, that wins - measurement is observation, the instruction is a
decision.

    default (pastelBlue)  #E3F6FF -> #5FC9F3  outline #1B4E6B
    anger                 #C30000 -> #820000  outline #FCFC7D   speaker "...분노"

### Saved into the style file

As instructed ("save the chat and donation parts properly in the editing style, and save the constant-speed bounce as 'speaking motion'"),
four new entries in `dashboard/styles/담유이_일반롱폼.json`:

- `caption.emphasis.default/kinds/partial` - pastel blue default, red for anger, how partial emphasis is built and its colours
- `overlays.zoomInsert` - chat / donation zoom (how to cut, scale, background, no captions)
- `overlays.speakingMotion` - **speaking motion** (triangle wave, period 0.34 s, 5% of height, plus the value measured on the reference and
  why it was halved)
- `overlays.roleplayInsert` - blur + person + speech balloon (role-play)

### Two dashboard fixes

**"The captions and timestamps under 'after cut edit' differ from the real ones"** - the problem passed off for several rounds with "please
reopen from the project manager". At boot `app.js` **assumed the state left in the browser is always newest**, but when Claude exports
again the folder is ahead. Now after boot it checks the folder's `savedAt` and reads the folder if newer (`freshenFromDisk`). If the user has
unsaved edits (dirty) it does not touch them and only says so.

**"Let me change the speaker and timestamp - enter the start, keep the caption when changing the timestamp, change only that clip's
start"** - a caption line's start time and speaker can now be edited in place. A time edit is carried as `c.s2` and the caption text stays -
the pipeline moves only that clip's start. Edited lines are highlighted yellow (`is-retimed`). Both "1:23.45" and "83.45" are accepted.

### Result

24 cut pieces, main 130.90 s, **final 126.17 s (2 min 6.2 s, 1.1x)**, 61 captions (2 whole-line emphasis, 3 partial, 14 staff balloons).


## 악성메일단 - fourth feedback (2026-09-11)

Only the edit was applied and rendered (2 min 6.2 s). **Leave the dashboard items alone** - the user said "just list them for now, don't
proceed".

**Edit (done)**
- Two chats as zoom inserts: "색이 맞아서 오시면..." (source 113.92-116.30) and "테러아님?" (173.54-177.14). No captions.
  - **By the time she reads them the chat has already scrolled off.** "테러아님?" is visible only at 173.0-174.2 and she says it at 175.16.
    So inserts got a `grab` time and **the cell is cut from that frame as a still card** (piece_cache.still, FX_VERSION 4).
- Outline of an emphasised word = 0.35 x its colour (the darker side). Instruction: "change the outline colour too (darker than the
  inside)". Before, sky blue and orange used the default dark navy outline and looked detached. "파트너" is #00FFA3 + #005939 (mint).
- Staff balloon three lines -> four ("글쎄 뭐 / 치지직 파트너 스트리머 / 걔 그...뭐야 / 담유이?"). The splits are between words measured in the
  speech band.
- drop 142.18-145.04 and restore 202.26-202.88 applied. "악성 메일단을" -> "메일단을" (the guessed "악성" removed).
- The "색이 맞아서" restore (112.76-114.76) **was confirmed as a display issue** - the edit stays. Noted in the timeline.IGNORE_RESTORE
  comment.

**Dashboard (not started - held by user instruction)**
1. Caption edits come back with old-version timestamps. Of this round's 12 lines, 11 were the current caption or **the text of the line
   next to it.** captions_user.json is keyed by (s, e), and times change every version, so edits attach to other lines.
   -> change the key to something other than time, or re-match by text on export.
2. "Timestamps under 'after cut edit' don't match, and the last value exceeds the video length" - **caption times were not divided by
   SPEED (1.1).** Last caption 130.9 > final 126.17. export_project.py divides full_dur but not captions. Probably also the cause of 1.
3. The timestamp column is narrow and every line wraps -> widen it.
4. Wording: "렌더링" -> "재 편집", "렌더" -> "편집".


## 피곤해 - first edit (2026-09-11)

`피곤해.mp4` 143 s -> **31.6 s** (1.1x), 25 captions (2 outbursts), 14 cuts.
Final `edited/피곤해_ko.mp4`, dashboard `projects/pmtx0a8ybfo19`. Style 담유이 1인 일반 쇼츠; the `edit/모캡밀림` pipeline was carried over.

- Audio re-measured: -19.2 LUFS / -0.4 dBTP, band RMS p50 0.0081. The style defaults 0.014/0.006 were right (at 0.013: sound 48%, 96
  blobs; raising to 0.020 grows it to 119 and splits inside speech).
- **Transcript times are 0.5-1.7 s early on this source.** All group boundaries and caption times use waveform blob boundaries.
- The chat on screen is canonical: "앗 나도 한영키" in the 44 s frame (transcript: "아 나도").
- Two outbursts chosen by measurement - "언제 나오는데" (p85 0.2374), "피곤해" (0.2131).
- Only 0.02 s between "없거든" and "나는", so the cut carried a trace of "거든". Removed with TRIM {6: [(96.20, 96.56)]} (verify_cuts 0).
- Crop x=428 (face centre 940). Cut left of the chat column at 1560 so no half balloon shows.
- **Two chat cards** (instruction "show only the English chats and the 앗 나도 한영키 part"). The whole video happens in chat, but the crop
  removes the chat and viewers cannot tell what is going on. Balloons are grabbed and placed over the picture (y=430, max 900x330).
  timeline.CHATS, build_edit._chat_png. With a height of 400 the two-balloon card **covered the eyes (y=855)**, so it was reduced to 330.

**피곤해 - caption pass (same day)**
- **Captions merged from 39 to 25.** Instruction: "you split them so words don't get cut or become hard to read when too long, but now
  they're split far more than needed". **The only reason to split is width** - if it fits in 1020 px it is one caption.
  ("와 / 영어 개많아 / 왜" -> "와 영어 개많아 왜", "나는 / 이 세상이 / 싫어" -> "나는 이 세상이 싫어")
- An explanatory caption was added and then removed. **Parentheses in the job instructions are background, not text to put on screen** -
  nothing that was not asked for.
- "한말도" -> "아무말도", outburst "피곤해" -> "피곤해!" (both instructed).

**피곤해 - first feedback (same day)**
- **Two rounds were wasted without seeing the feedback.** The dashboard had written `feedback_prompt.txt` and `captions_user.json` into
  `edit/피곤해/`, and **the work folder was never checked.** Unnoticed until the user asked "I kept sending feedback, why isn't it in?".
  **Read the feedback files in the work folder before starting a new round.**
- **Leading space (second time for the same complaint -> the method was fixed).** The problem was **the cuts**, not caption times.
  Hysteresis traces a sound blob back to THR_LO, and this source's room tone is 0.006-0.010, so THR_LO (0.006) joined whole gaps between
  words - leaving 0.5-1.0 s of space inside cuts. **THR_LO 0.006 -> 0.011** (re-measured on this source). Pieces 14 -> 20, main 35.8 ->
  31.4 s. Leading space before all 25 captions is now under 0.05 s. (20 pieces = 34 cuts per minute, matching the style's cutsPerMin 33)
- Caption times also start **where audible sound (THR_HI) begins** (make_csv.cue). A blob start is not audible yet.
- **The "데!" of "언제 나오는데!" was cut.** 130.74-131.30 is that "데!", but Whisper wrote it as a repeated "그래서" and the cut was at
  130.69. The level is **flat** at 0.20 for 0.5 s - three syllables would show three peaks. Extended to 131.45.
- Final 28.5 s, 1.5 s under the style's targetTotalSec (30-40) - a result of removing space. Whether to add more speech is the user's call.

## 악성메일단 - fifth feedback (2026-09-12)

**What "everything feels late" really was: the picture lagged the sound by 0.135 s.** When rendering a piece, sound is cut at exactly (b-a)
s but the picture is in frames and rounds up (at most 0.017 s at 60 fps). Over 24 joined pieces it accumulated. Evidence: final video
126.167 s / audio 126.032 s. Captions and the staff overlay are burned into the picture, so they lag with it.

The user's words were the diagnosis: "at the start the captions come early ... after that slightly late ... only '메일단을 직접' is in time".
That caption is at 112 s in the final, where the lag (0.12 s) cancels the leading margin originally given (0.12 s).

Fixes
- `timeline._quantize()`: KEEP snapped to the 1/60 grid (at most 8 ms moved).
- `piece_cache.cut()`: each piece is pinned with `-t` to a length that falls on a frame count, and audio is padded to that length with
  `apad`. Picture and sound become exactly equal.
  -> final video 126.067 / audio 126.046 (0.02 s, a third of a frame)
- `make_csv.cue()`: captions switch on at **-32 dB (the threshold where speech becomes clear)**. The cut threshold (-46 dB) catches breaths,
  so captions came early.
  -> all 60 within 0.15 s leading space (up to 0.51 s before)
- `STAFF_RANGE` aligned with the staff captions (249.30-273.72). Before, the figure popped out 0.35 s before the first staff caption.

**On the cache:** touching cut times invalidates every piece (24 re-rendered). A caption-only round re-renders 1-2 - why this one was slow.

## Dashboard feedback repairs (2026-09-12)

**The two real causes of "the 'after cut edit' captions differ from reality".**

1. **`freshenFromDisk` never ran.** At boot it **called `D.Server.online` like a function, but it is a boolean.** At boot it is still false,
   so the condition always returned early. The feature "fixed" last round was actually dead. -> the server check was removed and failure is
   left to the fetch's catch.
2. **The time compared with the folder was wrong.** `savedAt` is when the browser saved, so it becomes **now on every reload.** Comparing it
   made the browser always newer. -> the folder time that was read is carried separately as `diskAt` (core.serialize + app.freshenFromDisk).

Also
- Edits (dirty) are now **merged.** Pipeline output (caption list, cuts, transcript) comes from the folder, and only user values (prompt,
  notes, drops, restores, caption edits) are laid on top. No more "open it from the project manager".
- **Caption edits find their line by `orig` (text before editing), not time.** Cuts shift every version, and matching by time overwrote the
  neighbouring line - in the fourth round 11 of 12 edits attached to the wrong line. If not found, the edit is discarded.
- **Longform export did not divide caption times by the speed.** The last caption at 130.9, beyond the video length (126.07), was the
  symptom. -> `/ T.SPEED`.
- Timestamp column 46 px -> 62 px, no wrapping (every line wrapped to two).
- Wording: 렌더링 -> 재 편집, 렌더 -> 편집.

Checked: the dashboard shows 60 captions, first line at 0:02.07 (before: 61, 0:02.20).

## Reference caption timing measured (2026-09-12)

After the complaint "you keep failing to get when captions appear and where they end", **only when captions appear relative to sound** was
measured on four finals. The caption band was binarised at source resolution, ink counted per frame and compared with speech-band RMS.
Script: `tools/caption_timing.py <final>` (finds the caption band automatically).

| Reference | Animated | Appear - sound | Settle time | Line change at dip | Disappear - speech end |
|---|---|---|---|---|---|
| 허츄의 뒤를 잇는 2대 곡예사 (rap) | no | -0.050 | - | 84% | +0.24 |
| 일본에서 화상 입은 유이 | yes | -0.060 | 0.050 (3f) | 82% | +0.16 |
| 집에서 미끄러져서 응급실간 유이 | yes | -0.045 | 0.067 (4f) | 85% | +0.03 |
| 유이가 말아주는 러브송 (song) | no | -0.060 | 0.000 (0f) | 66% | +0.01 |

**Captions appear 0.05 s (3 frames) before speech is heard - regardless of animation.** Line changes happen at **the end of the dip**
between words (next speech 0.00-0.09 s after the change). A caption is never switched off before the speech ends.

The current pipeline **pins captions to speech** (0.00 to +0.15). To change it, subtract 0.05 s from what `make_csv.cue()` returns - cuts
are untouched, so only captions need re-rendering. **Not applied yet (awaiting the user's decision).**

A misreading worth recording: looking only at one animated reference I said "the settle moment is the speech start", but across four
references the settle moments scatter and **the appearance starts cluster.** Setting a rule from one reference mistakes that reference's
animation length for the rule.

## 냉면 - first edit (2026-09-13)

`냉면.mp4` 70 s -> **31.9 s**, 25 captions (3 outbursts), 14 pieces. No speed change. Style 담유이 1인 일반 쇼츠; the `edit/피곤해` pipeline
was carried over.

- **Transcription rule changed (user instruction):** the first edit runs one transcription without asking. Only additional ones are asked
  about (recorded in CLAUDE.md).
- **`probe.py` runs Whisper = an additional transcription.** Misjudged by name as a sound-only tool, three spans were run without asking.
  Now gated with `ai_budget.require`.
- Audio: -16.1 LUFS / -0.7 dBFS. Band track room tone p90 0.0066, speech p50 0.0380 -> thresholds 0.014/0.011 unchanged (70 blobs).
- Transcript times 0.4-0.9 s early -> all group and caption boundaries from waveform blobs.
- Removed: "고맙습니다" (looks like thanks for a donation; guess), two gaps over 8 s, "원 투 쓰리".
- Crop x=468 (face 960-1000, chat column 1580). No chat cards (not instructed).
- **Captions appear 0.05 s before sound (make_csv.LEAD)** - the first project applying the four-reference measurement.
- Three outbursts (instruction "here and there"): "물냉면은 진짜 내가", "아 뭔 물냉면이야", "너네는 뭐 먹었는데?" - chosen by p85 among the arguing
  lines.
- Guessed words: "불냉면은", "물냉면은 비냉이지", "왕만두의 비냉이".
- Checks: cuts 0, gaps 0, sync 0. Two timing flags on lines split without a gap ("뭐 먹었는데요?" 64.35 guessed, "말해봐" 66.41 level dip).
- **`build_ass.py` main rebuilds captions from the transcript** - building ASS from the CSV is `rebuild_from_csv.py`. Running main drags in
  cut-off speech like "말해봐 원".

**냉면 - first feedback (same day)**
- User: "for the first time the speech and caption timing is perfect" - **waveform blob cuts + cue() + LEAD 0.05 is the reference
  combination.** The next project is carried over from edit/냉면.
- 5 caption edits (captions_user.json; no orig, but the times matched the CSV exactly, so they were matched that way): 땡기는데? -> 땡기네,
  먹는거지 -> 먹는거임~, 물냉면은 비냉이지 -> 냉면은 (my guess was wrong), 물비빔면 -> 물비빔은, 것이 -> 것이~. The other two lines had the same
  text and speaker - nothing changed.
- drop 63.44-66.84 = the closing "여러분들은 ... 말해봐". Cutting with the drop's LAG 0.25 gives 63.69 and leaves the head of "여러분들은", so
  the group end was set directly to the end of the previous blob, 63.51. The third outburst went too, leaving two. **28.5 s** (below
  targetTotalSec 30).
- **seg_durs.json ordering trap:** when the piece count changes, timeline computes TOTAL_DUR from the old seg_durs and the CSV is wrong. Run
  make_csv **again** after build_edit.
- rebuild_from_csv got shrinkOverLongLine: lines over by less than 6% shrink `\fs` to stay one caption (a 1050 px line was about to be split
  by character count).

**냉면 - second feedback (same day)**
- "It only plays up to 인정입니, needs the '다' at the end" - last group end 63.51 -> 63.71. **The blob boundary was in the wrong place:** "다"
  (peak 63.55) and the following "여러분들은" were one blob from 63.54, so removing the latter needed **the dip in the 5-frame average level**
  (63.70, 0.022), not the blob end. When cutting right before a removed passage, do not trust blob boundaries; look for the dip.

**냉면 - closed (same day)**
- The user closed it after the second feedback version. Final 28.7 s, all checks 0. Remaining guessed words: "불냉면은", "왕만두의 비냉이"
  (no user comment).

## 삼성 - first edit (2026-09-13)
- Scripts carried over from edit/냉면 (the combination whose timing was "perfect"). One transcription (default).
- 103 s, -14.1 LUFS, -0.5 dBFS. Thresholds 0.014/0.011 unchanged (room p90 0.0091).
- **The donation speech was not in the transcript.** Asked the user: "아 끝나는 줄 알았는데 왜 안 끝남?" - the only speech the transcript missed in
  the middle was 64.4-66.4, so that was taken as it and removed (guess). How it was found: sound above THR_HI not covered by transcript words
  (+0.2 to +1.0 s), collected over 0.5 s.
- Speech totals 51.6 s, so to reach 30-40 s **I chose overlapping lines to remove** (timeline header "for length"). The user can restore them.
- Splitting captions within a line: transcript word times on this source wobble 0.3-1.1 s per span and cannot be used - estimate by dividing
  blob length by syllable count + 5-frame dips.
- **The first line splits were one phrase late** (all 10 verify_sync flags heard the neighbouring phrase). Syllables were divided over the
  transcript blob range, and that range was wrong. Dividing by **the speaking time of the pieces left after cutting** and snapping to piece
  heads / dips left 1 flag (a caption crossing a cut and hearing the next piece's "여러분도"). If two dips are adjacent and produce a 0.14 s
  caption, merge or split differently ("솔직히 업무 / 환경에서 쓰려면은").
- 1.5 s of sound not in the transcript (3.78-5.32) after the first line was removed for length (not verified).
  Final **40.00 s**, cuts / gaps / caption starts 0, one sync suspect (above).

**삼성 - first feedback (same day)**
- "한 달" and "솔직히" were inaudible: group heads 25.95 -> 25.50, 33.37 -> 32.74. **In the first edit the dip in continuous speech was taken
  as the head, and that dip came after the first syllable** - only the transcript blob range was looked at, never where the previous line
  ended. Counting peaks at 50 ms level showed separate silences before (25.05-25.55, 32.72). When cutting a head, **go back to the silence
  before it** and check the syllable peak count matches the word.
- "아무리 어? / 뒤를 구르고 앞으로 구르고 / 옆으로 구르고 날아다녀도": "어?" (36.10-36.20) was not in the transcript. Syllable estimates cannot know
  about missing words, so they go wrong.
- The user's 0:27.45 and 0:31.45 are **final times of the current version, so they were converted to source times (51.45, 63.13) before
  moving cuts.** Both were piece heads - the syllable estimate ran late across the piece boundary.
- Partial emphasis «word|blue» brought over from 악성메일단 (build_ass, rebuild, export).
- drop.json 81.4-84.14 = the whole "근데 아이폰 14년 썼으면은..." group.
- 3 caption edits (captions_user.json): "삼성폴드가 더 좋죠?", "삼성? 연락주세요", "아무리 어? 뒤를 구르고" (followed the split in feedback_prompt).

**삼성 - second feedback (same day, in progress at the time)**
- **Dashboard saves were dropping speakers.** The log showed "caption 6 speaker: 담유이발끈" but captions_user.json and project.json had the old
  speaker. The review merge in server.py save_project carried only text and by from edited captions -> now speaker, s2 and orig too.
  **Needs a server restart to take effect.** This round's three speakers were read from feedback_prompt.
- Partial emphasis colour per word: 승자 yellow, 1년 뒤 sky (#6FCFF5), 구형 핸드폰 brown, 삼성 폴드 8 lavender, 삼성? blue (#7FA8FF). Fill values
  were picked from the names alone (guess).
- The fourth column of make_csv LINES also accepts a speaker name ("담유이강조").
- **Emphasis design** (user instruction; unified for whole-line and partial emphasis, font and size unchanged): fill = emphasis colour, inner
  outline = white if the fill is bright, black if dark, outer outline = a darker shade of the fill. Drawn as two layers (build_ass
  emph_layers). Widths 7/16, luminance threshold 0.35 and darkening 0.5 are eyeballed from captures (guess). The gradient outburst is not
  used under this unified design.

**삼성 - third feedback (same day)**
- **Outbursts taken out of the emphasis design** - "outburst and emphasis must look different / the outburst is right as it was".
  Outburst = gradient (emph_lines), emphasis design = 담유이강조 + «word|colour». One round earlier, "unify all emphasis (whole-line and
  partial)" was read too broadly, with "whole-line emphasis" stretched to include outbursts.
- Emphasis outer outline 0.5 -> 0.75x ("too dark"). Emphasis text 140 -> 130 ("looks bigger than normal captions" - because of the two
  outlines). Yellow #FFE27A -> #FFC83D ("hard to see"), Samsung blue #7FA8FF -> #7384CA (logo #1428A0 with 45% white). All values are
  guesses.
- Caption edit: "330만원 실화냐~". Split: "솔직히 / 업무 환경에서 / 쓰려면은".

**삼성 - fourth feedback (same day)**
- **"The emphasis outer outline looks like a shadow (3D)"** = my bug. In the third round the emphasis text shrank to 130, but the upper
  layer (inner outline) of partial-emphasis lines only made the emphasised part transparent and did not return the size to 140. The two
  layers ended up with different line widths, the \an5 centring disagreed and the outer outline stuck out on one side. **Captions drawn
  as two stacked layers need identical size and font tag flow in both layers** - including the transparent parts. Whole-line emphasis was
  fine because both layers were the same.
- It was checked on a sheet with four lines scaled down and missed there. Check outline shapes **cropped at full size.**
- Partial outburst «진짜|balkkeun»: in the outburst layer (emph_lines) only that word is visible, in the ordinary layer only that word is
  transparent - the same line drawn twice.
- Colours: 담유이강조 #6FCFF5 -> #45B4EA ("a bit stronger"), 삼성? = logo (20,40,160) hue at value 0.75, saturation 0.78 (pastel). Caption
  edits: "256GB가?", "삼성 폴드가 더 좋죠?".

## 담유이 테스트 쇼츠 - reference channel analysis (2026-09-14)
- User: "analysis only", "it's the first time, don't apply the preset". The 삼성 copy and the preset were untouched.
- Prepared only: project "삼성 사본" (pmu0vhh61j3b1) got its own work folder edit/삼성_사본 and final name 삼성_사본_ko.mp4, and the export
  target id was pinned (it shares the source file with the original, so finding by name picks the original). Preset copy:
  dashboard/styles/담유이_테스트_쇼츠.json.
- Results, scripts and images: docs/테스트쇼츠_참고분석/ (분석.md). Top 5 by views each from 형독, 미도미도 마요, 라코코 and 자석사냥꾼 정타비,
  downloaded at 360p (with permission; yt-dlp updated to 2026.8.19) and measured.
- Gist: the energy comes **from the source inside the window changing about every second**, not from camera moves (라코코 48-91 per minute,
  median 0.34-0.96 s). Letterbox + hook title with a coloured word is common to all four. Slow zooms are rare. Sound effects and music
  could not be separated numerically and were not checked.

## 삼성 사본 - screen energy, first pass (2026-09-14)
- User: "apply it to 삼성 사본 and edit". Caption arrangement and preset unchanged.
- **Shared module assets/fx/fxlib.py** (for other projects too): cards, chapter titles, focus brackets, crown, spinning arrow, sliding arrow,
  hook title (ASS), window zoom, image pop (ffmpeg filters).
- **Per-project effect table edit/삼성_사본/fx_plan.py**: effects attach by caption text (no hard-coded times).
  33 picture size changes (W/1.25/1.55, cut right at line changes), 28 ASS effects, 2 original chat captures (삼성 안써요 1.2 s, 광고
  받으셨나 99.6 s - only where speech and time match). rebuild_from_csv adds the fx styles and events, and the hook title replaces the old
  top caption. apply_captions applies zoom and images before captions.
- Picture motion 0.4 -> 1.9 (reference channels 2.0-12.5).
- Three accidents: (1) Bash heredoc ate backslashes and the patch did not apply - write patches with Write and use chr(92). (2)
  cv2.imwrite fails **silently** on Korean paths - use imencode + open().write. (3) ffmpeg cannot open image inputs at absolute Korean
  paths - use paths relative to the work folder. Also the -loop image input was long and made the final 1 s longer - add -t FINAL_DUR to
  the output.
- All guesses (before user confirmation): hook title text, card text, zoom scales, chapter split. Internet images (product photos, logos,
  いらすとや people) in the second pass with permission.

**삼성 사본 - second pass (same day)**
- User: "drop things like 1. price, 2. who bought first and do the second pass". Chapter titles removed (fxlib.chapter kept).
- User: "if you need images of people, mostly from いらすとや (free)". The terms were checked: free for commercial use, but **21 or more in
  one work is paid** (duplicates count once). This work uses 9. The list and sizes were shown and downloaded with permission.
- **Shared source folder assets/irasutoya/** (+ SOURCES.md: source URLs, summary of terms). Transparent PNGs, no cut-out needed. No Korean in
  the path, so ffmpeg reads absolute paths. Images containing Japanese text (POP) were not chosen.
- Images go on the left by the hair, avoiding the card (top right). At first 230-380 wide they looked like small stickers; enlarged 1.25x.
  The "안 할 듯" image overlapped a focus bracket corner, so the bracket shrank to 560 and the image moved top right.
- Picture motion 1.9 -> 2.0 (still images barely raise the number).

**삼성 사본 - third feedback (same day)**
- Prompt: "real images for products that exist, いらすとや only for people". Seven notes on the video: money -> Korean money / remove
  "お断りします" / focus brackets only when focusing on the face / rolling -> a person animation / side arrow -> image / exchange rate image
  -> a real chart / the price arrow points up -> down.
- **The arrow direction was my bug:** in ASS `\frz` positive is counter-clockwise, so 90 on a right arrow points up. ffmpeg rotate is the
  opposite, positive clockwise - noted in fxlib.
- The "iPhone fold" was announced on 2026-09-09 as **iPhone Duo** (Apple Newsroom). Damyui also calls it "아이폰 듀오".
- Downloaded (with permission; sources in each SOURCES.md): assets/products (Apple Newsroom press photos, Samsung product page KV),
  assets/photos (Unsplash 10,000-won note - the original was mostly grey floor, so only the note was cropped), assets/irasutoya (+ rolling,
  two balloons), assets/data (FRED DEXKOUS). Samsung Newsroom blocks bots. **The FRED CSV body was downloaded once while checking its size -
  before permission; the user was told.**
- New shared tools: fxlib.image_move_filter (spin while crossing, float), image_pop_filter border (photo cards),
  assets/fx/make_rate_chart.py (draws the chart from public data - no screenshots of other people's charts).
- Both focus brackets removed (judged not to be moments that need the face - guess).

**삼성 사본 - larger hook title (same day)**
- User: "make the title bigger overall", "key words slightly bigger than the normal title text".
- fxlib.hook_title got size and key_size (shared). 삼성 사본: 92 -> 124, key words "삼성 폴드8" 142 (about 1.15x). Widths measured with
  textwidth: line 1 833 px, line 2 906 px. Line centres at y 195 / 335 to fit in the top band (0-407).

## 담유이 테스트 쇼츠 - second reference analysis + 모캠 밀림 copy (2026-09-14)
- User: 15 more each from 정타비 and 로션욤, including caption design. "Too much like generic mass-produced shorts". And "not the 삼성 copy -
  make a 모캡 밀림 copy and apply it there". Analysis: docs/테스트쇼츠_참고분석/분석2_정타비_로션욤.md.
- Gist: in the reference channels **captions look different for each use** (dialogue small, stage directions in parentheses pale yellow,
  chat as character-coloured pills / mascot labels, only punchlines large). The cam stays, and things are added only when needed. Colours
  come from the character. Our videos looked mass-produced with one caption template + zoom on every line + black cards + stock images
  (guess).
- Accident: the list file had CRLF line ends, so the first download of 30 videos all failed (recorded in memory). Downloaded resolution is
  608x1080.
- 모캠 밀림 copy: projects/pmu0z5vpip86u, edit/모캡밀림_사본 (final 모캡밀림_사본_ko.mp4, export target id pinned). Only fx wiring was added to
  the old pipeline (09-09) - captions and cuts as the user fixed them three times.
  **At 1.1x, effects are rendered on the pre-speed timetable (TOTAL_DUR) and only the output is cut at FINAL_DUR.**
- New fxlib parts (shared): stage_note (parenthesised stage directions), chat_pill (character-coloured double-outline pill),
  question_ripple, mono_filter (only the window in black and white), push_filter (slow zoom - a resizing image placed on black and cropped).
- First render of the 모캠 밀림 copy: the question ripple and "(기대 중)" did not show. **fx_plan.L matched by partial text**, so "먼저" hit
  "제일 먼저" (2.69 s) and "나는" hit "나는 내가" (0.08 s), and the end came before the start. Fixed with L(..., exact=True). In videos where
  the same word appears in several lines, match effect keys exactly.
- The slow zoom seemed not to work, but **it did** (eye width 125 -> 180 px, about 1.45x). Misjudged by eye on a scaled-down sheet - compare
  sizes by measuring the same spot.

## 담유이 테스트 쇼츠 style overhaul + 다음생 copy (2026-09-14)
- User: "the style is too different? It's not about restraint, the style itself is the problem", "the caption types are too monotonous",
  "keep only the cut-editing parts of the current preset and change / add everything else to fit the style", "make a 다음생 copy and apply
  it", and "why only 로션욤?" - **my design had drifted towards 로션욤 (a consistent template that yields clean numbers).** The original
  instruction weighted 라코코 and 정타비. Re-mixed around 정타비 and 라코코 with some 로션욤 and 형독.
- Preset dashboard/styles/담유이_테스트_쇼츠.json: kept only cut, audio, pacing and verify; rewrote caption, video and notes (caption type
  table, screen frame, effect rules).
- Shared style assets/fx/refstyle.py: black letterbox (top 0-290 title / window 290-1429 / bottom credit), seven caption types - line (라코코,
  Gmarket Bold), hand (Nanum Brush Script), char (Damyui colour), punch (라코코 red, Black Han Sans), react (Jalnan), label (형독 white box),
  note (로션욤 parentheses) - title (large + key words larger), credit (정타비), checklist. Text shrinks when wider than 1000 px (PIL width
  converted on an ascent+descent basis).
- 다음생 copy: projects/pmu135i3ixdks, edit/다음생_사본. build_edit background is lavfi black, Y_TOP 290. rebuild_refstyle.py instead of the old
  CookieRun rebuild_from_csv. fx_plan: chat pill (original "그래도 다음생에 유이로 태어나줄거죠?"), condition checklist, 4 parenthesised
  directions, 4 zooms, a slow zoom (resolve), shake (scream), black and white (GG), a living-room photo, いらすとや stomach ache.
- In the first render all text was small (dialogue at 80 looked much thinner than 라코코) -> 1.15-1.35x. Nanum Barun Pen looked like a gothic,
  so the handwriting became Nanum Brush. **Decide whether a font name works by rendering the candidate names on one sheet** (both English and
  Korean names worked).
- The Unsplash stone photo could not be found (the search page structure differed) and was dropped. Credit date = source file time (guess).
- User: "use cookierunotf instead of plain gothic and put the video preset in / the rest is better than before". refstyle default font
  CookieRunOTF Black (handwriting, punch and reaction unchanged), background back to DamuiPreset, window y 407, credit removed (the preset
  has a name plate). Title in the top band 0-407 at 124 / 142. Preset JSON fixed too.
- User: "the basic captions are a bit small, make them a little bigger, the gap to the big captions is too large". refstyle line 96 -> 112
  (outline 9), char 98 -> 114. punch 132, reaction 150, handwriting 124 unchanged.
- User: "make the big captions a little smaller". refstyle punch 132 -> 122 (with its white outer layer), react 150 -> 138.

## 담키니 - first edit (2026-09-15, 담유이 테스트 쇼츠)
- Job: "edit with the focus on the outfits, and include every risqué situation / word". 137.6 s -> 40.5 s.
- Pipeline: cuts and caption timing from edit/냉면 (waveform cuts + cue + LEAD 0.05), caption templates and effects from refstyle + fx_plan
  (rebuild_refstyle.py, fx filters in apply_captions). Background DamuiPreset, default font CookieRun.
- The birthday planning (0-23 s) has nothing to do with outfits and was removed. A sound heard as "빅뱅빅댄스" has 8 syllables but 3 peaks, so
  it was taken as humming and removed (guess). "뭘 안 늦어" has 4 syllables and 10 peaks - the transcript missed words - removed. Of the
  repeated "그건 그냥 가을이라서" only the later one was kept.
- Guessed words: "유인이라 하지 맘대로 떳니", "겨울에 벗어주세요란 걸?" (matched to chat), "산타걸이요", "에바네", "호초 언니".
- Chat pills only for chats visible before Damyui reads them (checked at 29, 36, 80.5, 95.8, 114.2 s).
- Images: いらすとや swimsuit and Santa (with permission). For the nurse the user said "don't use that, find another online" -> a Smithsonian
  CC0 cap photo was chosen, then the user provided a costume photo directly (assets/photos/nurse_costume_user.jpg, source not checked).
  **Attaching photos of real people to risqué passages was avoided** - which is why the NLM 1960s nurse photo was dropped. The original
  Smithsonian page showed a bot check (CAPTCHA) and was not entered.

## 담키니 - second pass (2026-09-15, feedback)

- Sources changed: swimsuit -> the user's "허츄 수영복.png" (assets/photos/huchu_swimsuit_user.png), Santa -> the user's "산타걸.png"
  (santa_costume_user.png). Both transparent PNGs, source not checked (SOURCES.md)
- Top caption: the test-shorts two-line title was removed for the solo-shorts TopTitle (BM JUA 190, MarginV 229), one line "담키니" -
  rebuild_refstyle.py takes the style line from build_ass.HEADER. Text from the CSV title row
- 3 drop.json spots = lines matching transcript words exactly: "성인 / 유인이라 하지 맘대로 떳니", "스타일리스트... / 다녀오려면...", "일을 하지
  마" -> three groups removed entirely
- _with_drop: if the shifted (+0.25) end lands inside a sound blob, it is moved outside the blob - the 87.08 drop nearly ate the tail of
  "하는 거예요?" (sound 86.81-87.80)
- "this caption appears a bit late": 왜 벗어요 83.45 -> 82.89 (where sound resumes, 0.56 s late), 껴입어야지 84.91 -> 83.75, 뭔 소리 86.24
  -> 85.45 (the blob gap nearest the transcript word start)
- Caption edits (captions_user.json): 호초 -> 허츄 x2, "뭔 소리 하는 거예요?", "에바네.."
- **Trap:** running make_csv before build_edit after a cut change made timeline mix lengths from the old seg_durs.json (25 pieces), giving
  TOTAL_DUR 27.92 (actual 33.91). After cut changes: build_edit -> make_csv, or run make_csv once more
- Result: 33.91 s, 23 lines, checks cuts/gaps/sync/timing all 0, -16.5 LUFS, pushed to the dashboard

## 담키니 - third pass (2026-09-15, feedback)

- Caption edit: "어머 유이 너 벗을래?" -> "어머 유이도 벗을래?" (make_csv + four keys in fx_plan: type, zoom, shake, parenthesised direction)
- Note at 0:06 "make it bigger and centre it on the x axis": 허츄 swimsuit image width 330 -> 480, centre (210,850) -> (540,880)
- "brighten the Santa girl slightly": fxlib.image_pop_filter got pre (colour correction on the image only). colorlevels white point 0.88
  (about 14% brighter). eq works in yuv and loses the PNG alpha, so it was not used
- Two mistakes: (1) checks run before make_csv hit the old CSV and raised KeyError, (2) a conditional precedence bug in the pad expression
  dropped pre for borderless images - fixed with parentheses
- drop.json same as the second pass (nothing new removed)
- **Correction:** brightening with colorlevels (pre) broke the Santa image into horizontal bands on every other frame (seen in a 5 fps strip
  - the single +0.4 s frame on the review sheet looked fine). Baked into a file instead: assets/photos/santa_costume_user_bright.png
  (RGB/0.88, alpha kept). After re-rendering, all 9 frames of that span are clean. fxlib's pre argument remains but must not be used on
  moving images - bake colour corrections into the file

## 봉누도2 귀신 - first edit (2026-09-17, 담유이 테스트 쇼츠)

- Job: 봉누도 = 봉누도2, focus on the conversation between Damyui and chat, Damyui is not taking part in 봉누도2 -> explanatory remark at
  the start. 109.9 s -> 29.75 s
- Project edit/봉누도2귀신 (담키니 scripts copied). Crop x468 and face (540,920) unchanged - same picture, same screen frame
- Audio -19.8 LUFS, band track gain 0. 12 speech islands, 30.0 s - only the empty time waiting for chat was removed, no speech at all
- Whisper times are 0.1-1.2 s earlier than the sound (4.70 vs 5.94). Line splits proportional to syllables in sound blobs (scratchpad
  bn_split.py)
- verify_sync put "아니요" in the previous line, boundary 33.27 -> 32.86 (the sound blob 32.86-33.23 is 아니요). One "그래?" flag is due to
  an early transcript time (sound 93.30-93.61, transcript 92.68-93.30) - left
- Guessed words: 봉누도 (transcribed 복무도 / 복노도), 유이님 (유인님), "님 그거 유령임" (요령임), "헷갈릴 정도임..." (chat text), "약간 비슷한
  느낌이"
- The three chat-reading lines at 57.86-62.49 have 38 syllables in 4.6 s - fast. Split at the only pause, 60.03|60.45 (guess)
- 10 chat pills: text read from crops at 3.5, 19.5, 29, 40, 55, 68.5 and 89 s as is. "귀신 ㄷㄷㄷ" and "유사품에 주의하세요.." were reactions on
  screen at 90 s - when they were posted was not measured
- Opening explanation: white label "※ 담유이는 봉누도2 참가 안 함" (0 to 제가요?)
- Title: solo-shorts TopTitle, one line "봉누도2 귀신" (following the 담키니 second-pass instruction - the preset JSON has a two-line title;
  the mismatch needs checking)
- Effects: zoom 1.2 on 예? and 제가요?, 1.35 on 귀신임 and 그 정돈가?, slow zoom on 안타깝게~, shake + black and white on "그거 귀신임 귀신". No
  images (a ghost image needs download permission)
- Audio: peak -1.1 dBTP, so the fixed gain is -0.4 dB -> -19.6 LUFS (cannot reach -16 without filters)
- Checks cuts 0, gaps 0, sync 1 (그래? above), timing 0. Dashboard projects/pmu56rn62sahe

## 봉누도2 귀신 - second pass (2026-09-17, feedback)

- drop.json 41.46-43.32 = "다같이 잠이 덜 깼나봐" -> group head 41.80 -> 44.70. Caption "오늘도" -> "봉누도" (captions_user)
- "뭔소리?" chat and "결론 나옴" stage direction removed
- Timing of "비슷한 소리 들었으면 / 그거 귀신임 귀신": 7 syllable peaks at 72.16-73.60 = "혹시 저 같은 비슷한", pause 73.60-74.05. After the big
  blob 74.10-74.88 (저는 말), pause 74.90-75.05, then small at 75.10-75.85 -> "그거 귀신임" at 75.05 (first pass 74.43, 0.6 s early). The
  final "귀신" was removed from the text as the user said (the small sound at 75.54-75.85 is outside the cut)
- Chat pills -> cards modelled on the user's "채팅 자막 예시.png" (chat_cards.py): rounded box with mint outline + the black icon cut from the
  example + GmarketSans Bold (font is a guess). Scale 0.80 for all, a card shrinks only if wider than 1000, y 640
- いらすとや young female ghost ① 笑顔 ② 笑った顔 downloaded (with permission, 151 KB and 152 KB) + faces composited from the expression folder
  "놀리는 유이.png" and "크게 웃는 유이.png" (ghost_faces.py, expression choice is a guess). The ghost head was removed, the face cut to the
  chin at 0.90/0.95 placed on it, edges blurred 5%. The triangular headband was removed at the user's "take it off"
  - the teasing ghost during "님 그거 유령임", the laughing ghost during "그거 귀신임", window left (225-240, 1030)
- Result 27.91 s, checks cuts 0, gaps 0, timing 0, sync 1 ("봉누도" - a user edit, so differing from the transcript is correct), -19.7 LUFS

## 봉누도2 귀신 - third pass (2026-09-17, feedback)

- Label "※ 담유이는 봉누도2 참가하지 않음" (user edit). Chat card font GmarketSans Bold -> CookieRunOTF Black (user)
- "잘못 들으신 듯 -> the 듯 is inaudible": after the dip at 62.51 there is a 0.010 blob at 62.69-62.84 (transcript also has 듯) -> below the
  threshold (0.011), so the piece was cut at 62.57 (guess). Extended to 62.90 with timeline.EXTEND_TO
- "check whether it's 그거 귀신임 귀신": after the dip at 75.49 (0.002) there is a 0.010-0.014 blob at 75.52-75.85, and the transcript also has
  "귀신" -> taken as spoken (guess, not checked by ear). Piece 75.54 -> 76.05 (0.2 s of tail - which also addresses "goes by too fast"), text
  back to "그거 귀신임 귀신"
  - In the second pass the user's "the last 귀신 is inaudible" was read as a wrong text and only the text was removed, but really the cut
    clipped a quiet sound (guess). "Inaudible" may mean the sound was clipped - check the piece end before the text
- verify_gaps flags the two tails as DEAD AIR (62.49-62.90, 75.46-76.05) - intentional, quiet speech below the threshold
- "혹시 저 같은  비슷한" in captions_user.json differs only by a double space - treated as a mistake and kept with one space (guess)
- Result 28.75 s, cuts 0, timing 0, sync 2 (봉누도 user edit, 그래? early transcript time), -19.8 LUFS

## Pipeline switch: React + ffmpeg (2026-09-17)

- Instruction: ffmpeg -> React (captions, design, animation) + ffmpeg (cuts, hardware encoding), save tokens, caption fixes visible
  immediately in the feedback preview, a source file field in style apply. Goal: one 30 s short with a preset within 20% of a session
- `render/` (Remotion 4.0.525, React 19). body.py, make_scene.py, render.mjs, still.mjs, preview/entry.tsx, src/
- Tried on 봉누도2귀신: fx_plan table -> fx.json. Compared side by side with the old final at 1.0, 4.5, 18.8, 24.2 and 25.2 s - nearly
  identical (by eye)
  - Only the title (BM JUA) was 9% wider, so cssPerAss 0.93 (measured on ink width at 13.9 s). Other font ratios are the PIL getmetrics
    values as is - not compared on ink
- Speed (measured): body.py first render 2 min 32 s (21 pieces, mostly source seeking and QSV session setup - guess), cached 2.5 s.
  render.mjs total about 50 s (186 overlays / 1725 frames), one caption fix 10 s
- The GPU is an Intel Arc A350M (no NVENC) -> h264_qsv. 10 s of 1080x1920 60 fps: x264 medium 36 s / QSV 16 s
- Dashboard: scene preview in the feedback tab (dampreview.js), server.py also serves scene*.json, otf and ttf, style apply tab "source
  files / folders" (job.assets, listed in the prompt)
- Audio: one fixed gain as before (-0.4 dB; peak -1.1 dBTP so -16 cannot be reached)
- Not yet: existing episodes stay on the old pipeline. Multilingual (scene_en.json with only captions changed) and wiring the dashboard
  "render" button not done. Font paths are tied to this computer's user font folder (damui.ts FONT_DIR)

## Public package shortsmith + presets in English (2026-09-17)

- Instruction: polish the presets (English unless a special case or proper noun) so others can use them (distribution, sharing). User's
  choice: both CLI and skill, general presets public, Damyui presets private
- `render/` -> `shortsmith/`. The Python scripts (body.py, make_scene.py) were ported to Node, so a recipient needs only Node 18+ and ffmpeg
  - lib: cuts (port of audio.py), body (three pieces in parallel), scene, render, preset (lookup, fonts, extends), encoder (tries NVENC >
    QSV > AMF > VideoToolbox > x264 by actually encoding)
  - React reads only the preset JSON (no hard-coded Damyui values or C:/Users paths). Font ratios are measured in the browser when missing
  - Skill `skills/edit-short/SKILL.md`, plugin `.claude-plugin/`, README, `schema/preset.schema.json`. License not decided yet (UNLICENSED)
- Verified (measured): cuts.mjs = audio.py (same 8 ranges). The 봉누도2귀신 CLI build = the earlier React render (only a few px at chat card
  edges differ, mean difference under 1.4, cause not investigated).
  One still with the basic-shorts preset (Pretendard missing, fallback font). The dashboard preview loads the new bundle
- Added edit.json and cuts.json (timeline.PIECES as is) to the episode folder edit/봉누도2귀신. The final edited/봉누도2귀신_ko.mp4 unchanged
- Accident: style names became English, so the dashboard autosaved the 봉누도2 귀신 project's style as the first entry (Video-donation) ->
  fixed to find old names via aliases and restored to "담유이 Test Shorts". Other projects checked in the files - unchanged
- Not yet: React rendering of the four legacy-ass presets (outburst gradient, guest name tags, quote captions, longform inserts), a
  transcription command (the skill calls Whisper separately), multilingual scene, publishing the dashboard itself (Korean UI and a Python
  server, so only the preview bundle was split out this time)

## AGPLv3 + React rendering of the old presets (2026-09-17)

- License: shortsmith is AGPL-3.0-only. LICENSE is the official gnu.org text (downloaded with permission, 34,523 bytes)
- Caption engine generalised: a list of layers (look) - z order, shadow offset, outline, blur, vertical gradient; word emphasis design
  (inner and outer outline); «word|balkkeun» partial outburst; speaker -> kind (speakers, speakerSuffix, guest colours); gap filling;
  multi-line balloon text
- Effects: balloon shapes, bouncing images (triangle wave), still-frame inserts from the source (captions hidden while shown), blur. Body:
  per-piece crop, other files (outro), speed (outro excluded), separate outro loudness
- The four presets were ported with the old script values and compared with old finals (measured):
  - solo (냉면): caption ink y 1424-1527 identical, outburst identical. The title was 17 px low, so BM JUA ascent 0.8 -> 0.711 (the
    봉누도2귀신 title also 240 -> 241, matching the old one)
  - solo (삼성 사본): partial outburst, yellow word, whole-line emphasis and purple word identical by eye
  - multi (담아맷돌): 아야 captions identical. Damyui is larger because the preset has 140 + pop-in versus the old episode's 130 and none -
    the preset's guess was left
  - donation (고구마): band and title identical, white caption ink within 1 px. **Unlike the old description (black background), the actual
    edit uses the DamuiPreset background** -> followed the edit
  - longform (악성메일단): normal, emphasis gradient, word colours, donation inserts, role-play (blur + balloon + bouncing staff) identical by
    eye. Differences: the old "no grab" inserts were a live picture and are replaced by a still from the middle time; the outro 0.45 s
    overlap became a straight join (length 126.07 -> 126.48)
- First longform build 594 s (main 115 s at 60 fps 1920x1080, 64 chunks). First shorts builds 105-158 s
- Not yet: measuring the multi host size, the donation quoted kind (no episode uses it, guess), live inserts and overlap in longform

## Feedback preview repeating sound (2026-09-17)

- User: "I hear it several times". Measured: in 4 s of playback the preview clock advanced only 0.6 s, the window video ran ahead and was
  rewound twice with 9 buffering stalls -> the same words were heard again
- Three causes: Video's pauseWhenBuffering (one video buffering stops everything), re-syncing even on small drift, and server.py's
  Cache-Control no-store (re-downloading on every rewind)
- Fix: pauseWhenBuffering removed, the window video re-syncs only when more than 0.3 s off (0.5 froze the sound 0.35 s ahead of the
  captions, 0.2 rewound once right after play starts), the background is not synced, the server sends no-cache + Last-Modified
- Checked: 4 s of playback at 2, 12 and 20 s - 0 rewinds, max drift 0.31 s (right after start), within 0.2 s afterwards

## 생일방송컨 first edit (2026-09-18, shortsmith · damui-test-shorts)

- 136.8 s -> 40.5 s, 21 cuts, 22 captions. First build 166 s (Remotion downloaded Chrome Headless Shell, 113 MB, once automatically)
- Judgements and guesses in `edit/생일방송컨/notes.md` (exported as dashboard editNotes). Audio -16.1 LUFS / peak -1.9, no filters
- Caption builder `make_captions.py`: measuring each word's overlap with waveform pieces dropped words inside kept speech and pulled in cut
  sound pieces -> **if the middle of a transcript sentence is inside a keep range, take the whole sentence**; line times within a sentence
  by character ratio. Bound nouns (건, 거, 적 ...) never start a line
- Two cut-off sentence ends found on the waveform and keep extended: 9.6 -> 9.9 (tail of "스튜디오?"), 106.1 -> 106.8 ("수준이었어요");
  "아무튼 그거랑 별개가" was cut by the waveform at 133.15, pinned as raw 131.9-133.45
- **Shared export `tools/export_shortsmith.py <episode>`** - the per-episode export_project.py made common for shortsmith episodes. Keeps
  review.notes and user captions, writes project.json.bak, links scene.json
- Remaining: two いらすとや birthday illustrations (awaiting download permission)
- **User: "where did the preset source go?"**: the first insert (donation alert) covered the whole screen in black and the DamuiPreset
  background (HONEYZ 담유이) vanished for 5.7 s. Inserts got `area` - inserts without a background image default to `window` (covering only
  the video window). Longform (with LongBG) stays `canvas`
- **Re-edit (8 user points)**: cuts rebuilt as 11 sentence-level raw pieces (waveform cuts split sentences in the middle because of the
  music). Caption times based on `blobs.py` sound blobs - Whisper is 0.3-1.2 s early **only on the first word of a sentence** and right
  within +0.3 s inside it. TTS end 7.7 -> 6.3, title "생일 방송", explanation band and cheese image removed, the 언아카 explanation goes into
  description.txt. A 1 px line above the window: ffmpeg placed the window on an even row (406), so video showed above the insert box (407)
  -> 2 px margin above and below insert boxes. Export now stashes the previous feedback (feedback_*.json) and clears it
- **"The video freezes now and then, captions are fine"** (dashboard preview): the final has no freezes (freezedetect). The preview played
  the two 60 fps 1080 render videos (bg 1080x1920, window 1080x1140, 31 MB) as is and the browser could not keep up - background at 0.4x,
  window occasionally waiting. body now renders preview-only `window_preview.mp4` (30 fps, 720 wide, g15, 5.7 MB) and `bg_preview.mp4`
  (30 fps, 540 wide) separately. Measured: both videos at 1.0x, waiting 0
- **Crossfades at seams (with permission)**: `edit.json` `crossfadeSec: 0.15` (also via preset `audio.crossfadeSec`). Sound only, centred
  on the cut: the previous piece runs 0.075 s longer while fading out and the next starts 0.075 s early fading in - picture cuts, total
  length and caption times unchanged. Level difference 30 ms either side of a seam: max 14.6 dB -> 4.2 dB. Comparison file
  edit/생일방송컨/겹쳐넘기기_전후비교.m4a
- **Re-edit 3**: 1.1x (captionClock timeline), piece ends +0.3-0.45 s ("sentence ends are cut"), TTS end 6.7, donation alert full width
  (maxW 1080), the open-armed Yui only during "무슨 모션 스튜디오?", three line splits as the user gave them, "그렇게 축하 받아 본 적이" pulled to
  95.95 (was late).
  Audio: peaks are spread evenly (top 8 spots -21.9 to -24.5), so gain alone stops at -16.2 LUFS -> a limiter A/B was made and offered (+2 dB:
  -14.3 LUFS, only 3 of 82 0.5 s windows lose more than 0.5 dB / +3.5 dB: -12.9, 7 windows, max 1.7 dB)
- **"The preview is quiet"**: the preview (window_preview.mp4) carried the window audio before the final fixed gain the render applies, 20 dB
  quieter on this episode. body now applies the same formula (min(-16 - I, -1.5 - TP)) to the preview. Preview -16.2 LUFS = final -16.2 LUFS
- **Edit / Render buttons split (user instruction)**: feedback tab "edit" (AI) = save + a jobs/ file; "render" (no AI) = server /api/render
  runs, for episodes with edit.json, apply_review -> shortsmith build -> export --keep-feedback. Test: the user's dashboard edit "끝나는
  수준이었어서" went in, only one chunk was re-rendered, done in about 35 s, the project reopened with the by-user marks intact
- Edit button purple (.btn-ai, AI icon), render progress pane (step n/3, bar, elapsed / remaining, last log line). Test: done shown at 24 s.
  Also fixed: a reload sent the goodbye signal and the server shut down at once ("Failed to fetch") -> it now shuts down only after 10 s
  with no page

## 2시 first edit (2026-09-21, jobs/20260921_114702 - 114531 was an earlier version of the same request)
- Source C:/Users/12612/Downloads/Quick Share/2시.mp4 (313 s, 1726x970 letterboxed at y54). Transcription only from 155 s (clip_timestamps)
- 12 pieces, 38.6 s from 160-251 s, sentence-level raw pieces + crossfade 0.15. Six chat captures as fx images (inserts would cover captions)
- Captions with make_captions.py (생일방송컨 rules). One guess: "아까부터 2시라고" (transcript "조시라고") - notes.md
- Final edited/2시_edit.mp4, dashboard pmuan4xqbjnff. Build 143 s (first build, Remotion downloaded headless Chrome)
- Re-edit 1 (jobs/20260921_121224): piece edges with edges.py (head: start at -25 dB minus 0.06, tail: end at -20 dB plus 0.25), pieces 0+1
  merged -> 11 pieces, 42.6 s. damui-test-shorts preset got the outburst kind (copied from solo). Build 103 s
- Re-edit 2 (jobs/20260921_122350): **cause found - source audio start_time 0.450** (video 0). The analysis wav and transcript were 0.45 s
  early -> sentence ends cut, captions early (raised twice). wav adelay=450.2ms (given in samples it counts at the 48k input rate and only
  shifted 0.15 s), transcript +0.45. Final offset +0.455 -> +0.010.
  body.mjs now warns when audio and video starts differ. scene.mjs images got lead (chat -> caption order). 11 pieces, 42.3 s

## 손질 first edit (2026-09-25, jobs/20260925_225918)
- Source E:/Edit/OBS/손질.mp4 (66 s, 1920x1080, audio start_time 0). Cleaning a crab, edited so that "crab" is never said (user instruction,
  no illustrations)
- 8 pieces, 38.5 s. Crop x488 w1024. Two chat captures (무서워, 칼을 입에 넣고 돌려) - the chat at 12 s where the crab is visible is not used
- make_captions: first line = voice start, following lines = Whisper + snap to syllable start; if it falls in a pause, the next voice start
  within 0.8 s (Whisper is 0.3-0.5 s early on this source). The first line also follows the words and advances j (otherwise a later line
  attaches to the same word in an earlier line - "배를 똑 따준")
- Final edited/손질_edit.mp4, build 108 s
- 손질 re-edit 1 (jobs/20260925_231326): 1.1x, 34.75 s. Every caption time checked against speech blobs - 2 lines and 2 piece heads fixed.
  Snapping rule: inside speech only ±0.12, in a pause move forward (±0.25 snapped to the previous word). Three いらすとや tool images (with
  permission; still no crab) + bounce
- 손질 re-edit 2 (jobs/20260925_233446): shake and bounce removed, scissors (left) / knife (right) only while speaking, rotation on
  "돌려버리면", a tombstone on "보내줄 수 있잖아요" (R.I.P. engraved by hand - いらすとや has no RIP tombstone). shortsmith got image spin
  {period, from}
- 손질 re-edit 3 (jobs/20260925_234943): the three requests (1.1x, tombstone, both rotating) were already applied, but the rotation looked
  frozen on screen. render.mjs overlaySig lacked the spin phase, so frames reused one PNG (the angle jumped only at caption changes). Added,
  VERSION 6. **Any new per-frame animation must go into overlaySig too**

## 프젝아 모캡 first edit (2026-09-27, jobs/20260927_114218)
- Source E:/Edit/OBS/프젝아 모캡.mp4 (80 s, audio start_time 0, quiet at -28 LUFS). 10 pieces, 34.2 s -> 1.1x, 31.1 s
- **Thresholds re-measured for a quiet source** (-52/-55, syllables -42/-32). Cuts at real pauses, not transcript sentence times (the
  transcript was up to 0.9 s early)
- All 24 caption lines checked, only 1 fixed (AT). Five chat captures (a later chat used earlier - allowed by the user). No illustrations,
  shake or zoom
- Final audio offset within -0.02 s. Build 131 s
- 프젝아 모캡 re-edit (2026-09-27, jobs/20260927_1224): 8 pieces, 36.36 s -> 1.1x, 33.05 s, dashboard pmuj7mh4jf2ps
  - Every cut padding re-measured (edges3.py, speech threshold -38 dB, head 0.22, tail 0.35). Piece 4's tail carried the last burst of
    "있어요", and piece 8's head was 0.86 s of breathing and silence
  - **Whisper word times are 0.2-0.4 s early around pauses** - two caption lines floated over silence / breathing (8.72 -> 9.08, 55.30 ->
    55.96). Worse on quieter sources. Do not use lines not checked against the level
  - Chat captures use only the balloon cut out (img/cut_bubble.py). A rectangular capture brings the stream background along as a box = the
    "empty space" the user mentioned
  - check.py, which inspects only the final, was left in the episode folder. The previous round's check was caught on window edges and gave
    20 false alarms (check the check itself)
- 프젝아 모캡 re-edit 2 (2026-09-27, jobs/20260927_170429): user score 3/10. "The timestamps don't match at all, 반팔 is inaudible, there's a
  caption but the speech is skipped". 7 pieces, 39.14 s -> 1.1x, 35.58 s
  - **The caption clock was fine.** Verified by measuring the screen in pixels (caption band at 20 fps, where it changes) - +0.09 s versus
    csv/1.1 (the pop animation). The dashboard preview uses the same clock (export divides by speed). So "doesn't match" came from **speech
    that was cut out**
  - **Real cause: cuts ran through the middle of speech.** Cutting at band-track -45/-62 segment boundaries, soft syllables fell below, so
    "반팔이랑" (14.24-15.48) was cut at 14.72 and "힘들어" (~32.04) at 30.85
  - speech_map.py (full band -52/-60, 0.30 s) draws the speech map and cuts **only in pauses**. verify_runs.py compares run lengths in the
    final (all ±0.06 s)
  - Captions: two user edits ("어? 슈트인가 하셨겠지만" - the sound at 8.71 was that; "하고 있거든요?")
- 프젝아 모캡 re-edit 3 (2026-09-27, jobs/20260927_171806): 5/10, "captions and speech don't match well". 7 pieces, 34.82 s
  - **Line times are solved by spreading characters over speech segments** (edit/프젝아모캡/align.py). Segment lengths are measured, character
    counts are known; DP makes characters per second even. Catches errors Whisper word times cannot ("그래서 이제" was 1.23 s early)
  - Counting syllable peaks failed (3-5 peaks in an 8-character segment). Solve by segments + character count, not peaks
  - Cut margins unified at head 0.15, tail 0.25. The caption clock was checked three times and is right (final pixels, project.json, preview)
- 프젝아 모캡 re-edit 4 (2026-09-27, jobs/20260927_173956): 6.5/10. 14 pieces, 34.54 s -> 1.1x, 31.40 s
  - **One speech run = one piece.** The pauses left inside pieces (0.38-0.88 s) were the "remaining empty space" the user meant.
    Gaps between runs unified at 0.30 s, and only where one caption line spans two runs they are joined tighter at 0.20 s **so grouping
    shows through pauses**
    (in the previous version the "제가|슈트를" pause was longer than "슈트를|입고", so by ear 슈트를 attached to the next line - user)
  - Repeated words are dropped too: the first "아~" in "아~ 아 힘들어" (user instruction)
- 프젝아 모캡 re-edit 5 (2026-09-27, user: "the grouping isn't fixed, 이랑 goes to the next cut"): 10 pieces, 32.91 s
  - The previous version (a piece per run) was wrong. Trimming pauses creates cuts, and **a cut through the middle of a caption line makes
    the rest a different scene.**
  - Rule: **cut only where the caption line changes.** Leave pauses inside a line as in the source, and leave the pause at a line change
    longer than that (measured in the final: 제가|슈트를 0.60 < 슈트를|입고 0.80, 반팔|이랑 0.36 < 이랑|이렇게 0.50)
  - Added a check that measures every pause over 0.2 s in the final and marks it as inside a line or between lines
- 프젝아 모캡 re-edit 6 (2026-09-27): 7 pieces, 34.08 s. **Cuts only between sentences, long pauses at line boundaries.**
  - A mocap source is always moving, so removing even 0.2 s changes the pose = "next scene" to the viewer. Measured with cutmatch.py
  - If a pause must be shortened, cut where **the picture jumps least** (제가|슈트를: difference 1.7 = neighbouring-frame level, invisible)
  - If a line has a pause over 0.45 s in the middle, split the caption there ("그래서 이제" -> "그래서" / "이제 너무 복잡한 이런")
  - pauses.py: measures every pause in the final and marks inside-line / line-boundary
- 프젝아 모캡 re-edit 7 (2026-09-27): 10 pieces, 33.01 s. **A word the user puts in quotes is a caption line name** - "'이게' moves to the next
  scene" was read as a word and the wrong place was fixed (one round wasted). "이게" + "슈트가 아니에요" merged into one line
  - Space after "하고 있거든요?" 0.80 -> 0.38 (cut point via cutmatch), "제가|슈트를" pause 0.40 -> 0.30
- 프젝아 모캡 re-edit 8 (2026-09-27): 9 pieces, 33.42 s. The "제가 슈트를" grouping for the fourth round.
  - **Pause difference made 3x** (0.34 : 0.96). 1.3-1.6x cannot be told apart by ear
  - **Whether a cut jumps is measured by the cell (8x8) maximum difference, not the average.** A spot recorded as average 3.8 = "invisible"
    was 21.9 by cells, and the arm really had changed abruptly (the wide background dilutes the average). Neighbouring frames: median 2.0,
    90% 13.6
  - Frames were grabbed to see how captions appear on screen - do not say "fixed" from numbers alone
- 프젝아 모캡 re-edit 9 (2026-09-27): 9 pieces, 33.32 s. **"It's not a padding problem, the problem is the scene changing"** (user).
  A caption line must sit inside one scene. However well the pauses are tuned, a cut splitting a line ruins it - five rounds were lost
  adjusting only pauses.
  scenes.py: checks whether the caption changes at each cut (all 8 now within 0.25 s)
- 프젝아 모캡 re-edit 10 (2026-09-27): 8 pieces, 33.80 s. **The position of "슈트를" was wrong for five rounds.**
  Found by fricative (3-7 kHz): 슈 is at 5.92 (level -64, so the band alone reads it as a pause). Whisper spanned it as 4.32-6.38.
  The caption "입고 있는 게 아니에요" showed at 5.96 **over 슈트를**, with a cut before it -> moved to 6.76 and the cut removed
  - **Unvoiced fricatives do not show in the band level.** When a word's position is disputed, look at the 3-7 kHz ratio too
- **프젝아 모캡 retrospective** (2026-09-27): why it took ten rounds is in `edit/프젝아모캡/돌아보기.md`.
  The check tools moved to `tools/edit_audit/` (speech_map, align, cutmatch, verify_runs, scenes, pauses, check + README).
  Eight lines of "cuts and caption grouping" rules added to CLAUDE.md


## 퍼리 취향 first edit (2026-09-28, jobs/20260928_115551)

Source 122.53 s -> **12 pieces, 19 caption lines, 31.44 s** (speed 1.0). Dashboard pmuknjjx20v5j.
As instructed: trust in fans -> trust in 담비 (a fan character) -> furry taste. Details in `edit/퍼리취향/notes.md`.

- **Done from the start by the rules set after ten rounds of 프젝아 모캡** (CLAUDE.md "cuts and caption grouping"):
  runs drawn on the full-band speech map with cuts only between runs, one caption line = one scene, line times by spreading characters over
  speech segments, four checks after rendering + frames by eye. Finished with all four checks at 0 and no re-edit
- **At -37.4 LUFS the source is the quietest so far.** The previous episode's thresholds would read the whole source as "speech" - measured
  speech p90 -34.6 and pause p50 -56 and lowered to -47/-53. `tools/edit_audit/README.md` records the per-episode re-measurement procedure
  and both episodes' values in a table
- **Three check tools were wrong and gave 10 false alarms.** All from "values fitted to the previous episode" - mixing the band track only
  for the source, a hard-coded 1.1x speed, speech threshold p60. Fixed and put back into `tools/edit_audit`.
  **When fault values lean evenly to one side, suspect the check first** - the rule held again
- One more transcription was run (with permission) and came out nearly the same. Sentences that looked like repetitions really were -
  **if the speech map has separate runs, a Whisper repetition is not a hallucination.** Next time look at the speech map before
  re-transcribing
- Canonical words (아담이, 담비, 퍼리) were asked of the user by sending clips. Following the rule of asking early where the waveform cannot
  decide, it took two questions
- Effects: the donation speech as a capture card (a white border must be baked in or it melts into the background), three preset chat cards,
  one label card, one 1.2 zoom, one push. A 2D model, so seams look like neighbouring frames and cuts are invisible

### 퍼리 취향 re-edit 1 (2026-09-28, jobs/20260928_160546)

12 pieces, 31.96 s, all four checks 0. Fixes in `edit/퍼리취향/notes.md`, the three caption tracks in `edit/퍼리취향/자막.md`.

- **The caption speaker column became a 'design name' column** (user: "mark it by font design such as basic / outburst / sad / emphasis,
  not by speaker"). The preset's `captions.speakers` maps name -> kind, and **chat, donation and explanation are null**, so they stay in
  the list but are not drawn (their pictures come from fx.json). All episodes go this way from now on
- Partial emphasis «word|sky» (ported from the solo preset's accent design), a new sad caption kind, chat cards default to the middle of the
  screen
- **"Zoom in focusing on 담비" was done with a piece crop, not the zoom fx.** zoom looks only at the preset's single face point and cannot
  target anything else. A crop on the piece gives that scene its own framing (window ratio 0.948 kept)
- The 0.09 s sliver cut as "filler" in the first edit was **the "고" of "해놓고"** (user: "해놓(speech cut off)").
  A short sliver at the end of a run can be **a final consonant or last syllable**, not a breath - before cutting, check it against the
  character count of the previous segment

### 퍼리 취향 re-edit 2 (2026-09-28, jobs/20260928_162411)

Six of nine points were **my misreading of the instructions.** Details in `edit/퍼리취향/notes.md`.

- **"Classify into transcript captions / after cut edit / all captions" meant three separate files.** They were written as three tables in
  one document and all mixed into captions.csv, which earned "why did you merge them?".
  Now `captions_전사.csv`, `captions_컷후.csv` and `captions.csv` (everything - the only one rendered)
- **The speaker column stays the speaker and a new `kind` column was added** (basic, partial emphasis, emphasis, sad, punch ...).
  Last round the speaker column was overwritten with designs and 담유이 disappeared. scene.mjs, apply_review and export_shortsmith carry the
  new column
- **The dashboard preview did not know the preset's "speakers not drawn".** So chat, donation and explanation lines were drawn again as
  captions, appearing twice and overlapping (fixed in `dashboard/js/feedback.js` to skip them).
  **A new kind of line in the pipeline needs changes in all three: the renderer, the dashboard preview and the manual edit tab**
- "An effect like sadness / gloom" was read as black and white (mono), an effect never asked for - removed.
  **Interpret an ambiguous request as narrowly as possible within what was asked** (here, one caption design)
- Gap around partial emphasis words `accent.gapEm` (Caption.tsx), chat card scale 1.0, 담비 close-up 1.5x more

### 퍼리 취향 re-edit 3 (2026-09-28, jobs/20260928_164438)

Two caption lines deleted ("왜냐면", "그러니까 난") and three fixed. 31.96 s, all four checks 0.

- **A deleted line's spot stays empty instead of being absorbed by its neighbours.** At first the next line was pulled earlier and the
  caption appeared over other words ("왜냐면"). Line ends are capped at their own piece end + 0.10 s (just enough not to flicker at a cut)
- **A screenshot is not a caption** (user: "you can't change its content"). The donation capture was removed from the caption list; chat
  cards and label cards are text and stay, but **editing them in the preview now updates the card immediately** (feedback.js)
- **The dashboard render button erased chat text in fx.json.** With a caption line and a chat line at the same time, an empty edit landed
  on the wrong one. `apply_review.py` now **never copies empty text into fx.json**

### 퍼리 취향 re-edit 4 (2026-09-28) - the "three caption tracks" were dashboard tabs

The same instruction misread three times: three tables in a document -> three csv files -> **the caption tabs in the feedback tab**.
Checking the screen the user was looking at would have settled it at once.

- `dashboard/index.html` caption pane now has three tabs: **transcript captions, after cut edit, all captions**.
  There used to be two, and the tab called "all captions" actually showed the transcript (wrong from the name)
- Caption rows are built once and re-planted per tab (`fillSubs`). Rows got a **design (kind) column** that can be seen and edited. The
  all-captions tab also shows the title, label cards and chat cards
- The transcript file is chosen by `"transcript"` in `edit.json` (better for re-transcribed episodes)
- **When the user asks "why is it split like this", look at the screen the user sees first, not my files**

### Preset renames (2026-09-28)

담유이 Solo Shorts -> **담유이 Solo Shorts I**, 담유이 Test Shorts -> **담유이 Solo Shorts II** (user instruction).
Ids (`damui-solo-shorts`, `damui-test-shorts`) unchanged. Old names kept at the front of `aliases` - if an old name in a project cannot be
found, the first style is picked and autosaved (happened once on 봉누도2 귀신). The dashboard reads preset.json each time, so the new names
show at once (checked).

### Feedback tab caption pane (2026-09-28) - transcript / all captions / timestamps

User: "remove 'after cut edit' and make it transcript captions / all captions, they overlap anyway. Instead add a timestamps tab and write
timestamps (start ~ end) or clips there; don't write timestamps in the other tabs".

- "After cut edit" removed (it overlaps all captions). Three tabs: **transcript captions, all captions, timestamps**
- **Times only in the timestamps pane.** The transcript and all-captions panes lost their time column (text only)
- Timestamps pane: **12 clips** (final start-end, length, source start-end) and **caption lines** (start-end, design, text).
  Editing start times moved here too (c.s2: keep the text, move only that clip's start). Text can change, so this pane is **redrawn every
  time it is shown**
- Clip times are exported by `export_shortsmith.py` as `review.clips` (both source and final times)

### Why empty "첫 프로젝트" projects kept appearing (2026-09-28)

User: "why does 첫 프로젝트 keep appearing? I delete it every time".

`Projects.blank()` **assigned an id up front.** So: with no state saved in the browser, `blank('첫 프로젝트')` -> caught by the 20 s
autosave (`P.dirty && cur().id`) -> **an empty project appears in the folder.** Deleting the open project did the same via
`blank('새 프로젝트')`.

- `blank()` **gives no id.** `ensureId()` assigns one when actually saving (creating a new project is a forced save, so that still works)
- Autosave and `stash()` run **only with an id or some content** (`hasContent()`: clips, captions, notes, prompt, dropped files). Nothing
  empty is created in the folder
- The one leftover empty project (`pmukvvm5m0v2p` 첫 프로젝트) is for the user to delete or not

### Timestamps pane at a glance (2026-09-28)

A long list of times made it impossible to see what was what (user: "not intuitive").
**Clips are headings with the captions starting inside them indented below** - which words are in which piece, and how final and source
times line up, is visible at a glance. Lines present for the whole video, like the title, are pulled to the top as "whole video".

### All captions = a two-axis timeline (2026-09-28/29)

The timestamps pane was **removed.** The two-axis drawing the user made went into the **all-captions pane** as is (instruction: "remove the
timestamps pane, apply the current design to all captions, keep transcript captions for now"). The caption pane now has two tabs:
**transcript captions, all captions**.

Two thin axes on the left (**source**, **edit**), caption text on the right. The "source" / "edit" headers are centred on their axes.

- **Gaps between lines are shown by lines, not words** (instruction: "don't write things like 'joined in edit' ... mark it with a line in
  between -> a solid line in the active colour -> joined, a dotted line -> blank frames"). Labels like "cut 6.3 s, removed from source"
  all went
  - edit axis: **solid (active colour) = joined** (within one frame), **dotted = blank frames**
  - source axis: parts kept inside a piece are **a continuous band the width of the axis**, only removed spots are **hatched**. The hatch
    top and bottom touch **the previous piece end and the next piece start** (instruction: "the removed parts must also follow each clip's
    start and end, not be a simple shape"). Pieces are adjacent on the edit clock (`pk.oe === ck.os`), so that single point is the hatch
    position - split by the previous piece's tail and the next piece's head length
- **The selected line gets a blue area.** Text, speaker, design, start and end are edited there. Selecting **moves the video to its start**
  ("go to video position" button removed - editing moves it by default)
- **Start and end are horizontal spin boxes** (− value +). Holding speeds up - one frame (1/60 s) at first, five after 1.2 s, ten after
  2.5 s. Up / down arrows also step one frame
- **Length cannot be edited** - it derives from start and end (instruction)
- Edited values are `c.s2`, `c.e2`. `apply_review.py` now **reads s2/e2** when writing captions.csv (before it read only s/e, so times
  edited in the dashboard never reached the render). They also go into the preview and the text passed to Claude
- **No number labels** (instruction: "don't show things like clip n, caption n, cut n") - piece numbers, counts and line numbers all removed
- Lines shown for the whole video (title) are not drawn on the axes ("whole video" at the top). Lines over 4.3 s fold with `≈` (stops one
  chat card from taking the whole pane)

### Two-axis timeline restored, source / edit separately, undo (2026-09-29)

User: "where did these go?" (hatched triangle + ≈) and "it changed too much from what we discussed" - eleven drawings sent again.
**Those drawings are canonical.** Only "gaps shown by shapes instead of words" was kept; the rest reverted to the drawings.

- No gap -> the two axis bars **touch** (before: 5 px apart with a solid line). Gap -> **separated by that length** with a dotted line, ≈
  over 1.2 s
- Cut -> hatching on the source axis + a **hatched triangle** between the axes (source range -> one edit point) + ≈ on both axes. Edit axis
  solid in the active colour (joined)
- A cut inside a caption -> hatching inside the source bar, the edit bar continues. A caption end overrunning the piece end by under 0.15 s
  counts as tail margin (in this episode every line ends at piece end +0.10 s; without this every line would get a triangle)
- Overlap (between 담유이 lines) red, gaps shorter than 0.15 s yellow. Gaps are measured from the latest end of previous lines (frontier) -
  because chat cards float over speech
- Selected line: both axes and the text in one blue band, dots at both axis ends, source time on the left
- **Source and edit are edited separately.** Clicking the source bar edits only source time (`os2`/`oe2`), clicking the edit bar or text
  only edit time (`s2`/`e2`). Only the active axis's dots are filled and draggable. A source edit is **a cut**, so the render button does
  not apply it - it goes into the text for Claude as `[source time a~b → c~d - cut adjustment]` and `apply_review.py` mentions it
- **Ctrl+Z undo, Ctrl+Shift+Z (Ctrl+Y) redo.** Caption lines (times, source times, text, speaker, design) and transcript words (kept /
  dropped) are recorded. Repeated changes to the same thing within 0.8 s (holding a spin, dragging) count as one. Inside a text field the
  browser's text undo applies

### Caption pane = source / edit (2026-09-29)

User: "where's the display of removed transcript clips on the source, and how can there be so many long-gap skips?",
"don't split transcript / all captions, make it source and edit ... controlled separately / shown together", "move the timeline further
left", "source and edit should do what the transcript display does now", "clicking the background deselects".

- Two tabs, **source and edit**. The tab only picks **what is edited**; both axes always show. The transcript caption pane (#subsTrans) is
  gone
- Lines are in **source time order**. At each cut a hatched band is laid on the source axis with **the removed speech (transcript) clips**
  standing in place inside it with red outlines (this episode: 12 spots including the head cut, 12 removed-speech clips). **≈ only for
  silences over 1.2 s without speech** - before it was attached to every cut
- Source tab: 담유이 lines show **the transcript words at that spot** instead of caption text, click to drop / restore (what the transcript
  pane did). Selecting a line shows source time spins
- Edit tab: caption text, speaker, design, edit times
- Matching remaining words to lines uses **a word x line DP** (seconds away x 1.5 - character match ratio x 2.5, order preserved).
  Using time only let words at line ends leak into the previous line because Whisper is early ("어 잠깐만 구독 | 풀려서"). Single-syllable
  "나" and "아" can still go either way (guess)
- Words straddling cut boundaries (8 kept words without out) find their edit time from source time
- Axes moved left (source x=6, edit x=40, text x=64). Source time numbers are written inside the card, not beside the axis
- Clicking the background deselects

### Caption pane: only the timelines shared, text panes scroll horizontally, word-level transcription (2026-09-29)

User: "showing them together means only the timelines; control the timelines separately with horizontal scrolling", "the start and end of
removed parts aren't shown properly", "no transcript captions in edit, nothing but transcript captions like chat in source, no timestamp
editing", "make removed parts polygons that follow the start and end, not triangles", "restoring or removing should show up in edit",
"clicking the background, not just clips, deselects", "re-run the transcription and from now on timestamp at word level".

- The two timelines on the left are **laid out separately**: source on source time (piece bars, hatched removed spots, **every word**), edit on
  edit time (caption bars). Kept ranges are bands between them (source range -> edit range), removed spots hatched from a source range to one
  edit point, touching the piece end and next piece start
- The text area on the right holds **two pages, source and edit,** scrolled horizontally (tab, horizontal wheel, Shift+wheel). Switching keeps
  the time in view
- Source page: transcript words only, click to drop / restore, no time editing. Edit page: captions only (chat and labels faint on the right,
  a purple line beside the axis)
- Restores and drops **show on the edit timeline immediately**: kept ranges = pieces - dropped words + restored words. Restored spots green,
  words to drop orange
- Clicking empty space (not text, bars, cards or buttons) deselects - the empty part of a text line counts as empty
- Transcription: `tools/transcribe_words.py` (new). VAD was tried and dropped (words 90 -> 71; "사람은 아직 믿어?" and "아 맞다 나 단미지", both in
  the edit, went missing). Without VAD, the same model and settings give the same transcript as before, so it was not re-run - only stage 2
  (spreading characters over speech segments) with `--from word_level_loud.json`.
  Median difference to caption starts (measured) 0.96 -> 0.52 s. Sentence-initial words are still nearly 1 s early when preceded by sound (a
  forced-alignment model would fix that - needs a download, not done)

### Synced switching, separate source scale, colours (2026-09-29)

- Why switching was not synced (measured): source 1510 px and edit ~700 px differed in length, so there was no scroll position putting the
  moment seen in source at the same height in edit and it stuck to the top. -> **the source scale is chosen separately to make both timelines
  the same length** (keeping one text line's height; if still longer, edit is stretched). Both 858 px in this episode
- **A yellow playhead line** is drawn across both timelines and joined between them. When switching pages with the playhead on screen, scroll
  keeps that line at the same height (measured: 300 px -> 300.5 px -> 300 px). Otherwise the time at the centre of the screen is matched
- Colours: spots where speech was removed red hatching, spots where only silence was removed grey hatching (6 and 6 in this episode), to drop
  orange, to restore green, kept pieces alternating blue / purple (source bar and band share a colour - follow which band is which piece)

### Two columns on the edit side, a fix button for same-layer overlap, source lines not split (2026-09-29)

- The edit text page split in two: 담유이 on the left (62%), chat / labels / donations in a narrow right column, each at its own time.
  Right-column items push down when they overlap (measured: 담유이 16, right 7, text box overlap 0)
- Overlap on the same layer (담유이 with 담유이, same-speaker chats) is an error -> red + a card button "set previous caption end to next
  caption start". Different layers (a chat card over 담유이's speech) overlap by design and are left alone
- Source lines are not split by word state - restoring or dropping used to split a line into new lines. Split only by Whisper sentences and
  pauses over 0.5 s

### Unbaked preview (2026-09-29)

User: "can the added parts be applied in the preview without rendering?" -> "make it".
- `tools/src_preview.py`: a light copy of the whole source, `src_preview.mp4` (1280 wide, 30 fps, keyframe every 0.5 s, took 21 s, 31 MB) +
  `review.srcPreview` in project.json and per-piece `crop` and `gain`. Gain = the final's fixed gain (+17.20) + the largest piece gain (+4.0)
  = +21.20 dB; per-piece differences are reduced by the preview's volume. Called at the end of `export_shortsmith.py`
- shortsmith `scene.plan` (preview only): kept source ranges played in order as `<Sequence>` + `<Video>` (preloaded 0.6 s). Piece crops are
  matched by scaling and shifting the full frame (the 담비 zoom piece too)
- Dashboard: with any restore or drop it switches to this preview automatically (green badge top left). Caption, card and effect times move
  to plan time, and seeking, notes and the playhead line convert to and from edit time via toVid / nowEdit. Undoing everything returns to
  the rendered preview
- Measured: restoring "그런 거 아니지" (17.07-22.43) -> 31.97 -> 37.33 s, plan time 10.48 s plays source 19.2 s. Dropping "사심이라고" gives
  36.22 s
- Differences from the render: no crossfade at seams, may stutter slightly at seams (not verified - not listened to)

### Only removals as polygons, empty space inside the blue area deselects, less dense (2026-09-29)

- Polygons between the two timelines **only for removals** (speech removed red, silence removed grey, to drop orange). Kept-range bands are
  not drawn. Source bars in one colour
- Inside a selected caption's blue area, clicking anything that is not an input, button or spin deselects
- Less dense: minimum line height 24 -> 30, text 13 px, line spacing 19, 5 px between source lines, removed words on the source page as faint
  red strike-throughs without boxes (fainter for fully removed lines), remaining word bars faint (only dropped, restored and to-drop stand
  out), the right column (chat, labels) one line + …, legend as five colour swatches instead of text lines

### Spins that did not edit (2026-09-29)

User: "even when I extend it, it doesn't change in the edit and doesn't show in the preview". Reproduced: pressing + changed one frame and
then the card closed. A spin redraws the pane while held, so the pressed button is detached, and the browser fires the following click on
the empty background -> the just-added "click on empty space deselects" read it as empty space. Fixed to decide by **where the press began
(mousedown)**. Measured: holding end + for 1.5 s 8.14 -> 8.73 s, the card stays, the caption shows in the preview at 8.44 s, clicking empty
space still deselects.

### Restored spots as caption lines on the edit side (2026-09-29)

User: "the added part can't even be selected and nothing is added in edit". Restored speech appeared only as a green bar on the edit axis,
with no line in the text pane, so it could not be selected.
- Each restored range (restoreRanges) gets **a 담유이 line on the edit side** (with a green + in front). Text is filled from the words there;
  text, speaker and design are editable. Times follow the restored words (only source time on the card, no spins). Clicking the green bar or
  text selects it and moves the video there
- Carried in `R.restoreCaps` with source time (src) (there is no current edit time for that spot, so it cannot go into R.captions). Undoing
  the restore removes the line. Text edited by the user survives changes to the restored range. Included in undo
- The unbaked preview shows the caption. The render button does not apply it (the cut comes first); it is written into the text for the edit
  (AI) as `[restored spot caption - source time]`
- Measured: restoring "그런 거 아니지" (source 17.07-22.44) -> 1 green line, 1 bar; selecting and editing to "그런 거 아니지!" shows as is in the
  preview and in the hand-off text

### Restore / drop a whole source line (2026-09-29)

User: "add adding / removing a whole line too". + (restore whole line) and - (drop whole line) at the end of each source line. The same rule
as clicking words one by one, applied to all words in the line at once, undone in one step. The button with nothing to do is dimmed.
Measured: "구독 풀릴까봐" + -> 2 words restored, a green line on the edit side, 31.97 -> 37.29 s / "이제 풀렸으니까 구독 안 해도 되겠네" - -> 6 words
dropped, 34.36 s / two Ctrl+Z back to the start. Also fixed the second line being cut off by the buttons (line width measured 22 px wider).

## 야설 낭독회2 first edit (2026-09-29, jobs/20260929_160658)

Source 야겜낭독회2.mp4, 139.27 s -> **10 pieces, 38.44 s** (speed 1.0). Dashboard pmumc0danb4r3. Details in `edit/야설낭독회2/notes.md`.

- A loud source (-18.5 LUFS) with a high background floor (-40). Speech map -26/-33 and check tool thresholds to match (verify_runs GAIN -0.8,
  pauses -30)
- **transcribe_words.py draws runs at a fixed -52/-60 when speech_map.json is missing** - on a source with a -40 floor everything becomes one
  run and the stage-2 fit goes nowhere. For this episode the speech map was drawn first and only stage 2 re-run with `--from` (no AI). **Next
  episode: speech map before transcription**
- Damyui sits at the very bottom corner of the source, so **a large crop makes captions cover the mouth** (seen in frames of the first
  render). Narrowed to 465x490 (2.3x)
- Remotion downloaded Chrome Headless Shell (113 MB) by itself during the build (first render)
- Guessed words: 퉁실이, 비실이 (Whisper 퉁시리, 비시리) - before user confirmation

### 야설 낭독회2 re-edit 1 (2026-09-29, jobs/20260929_163201)

9 pieces, 35.80 s. 퉁실이 and 비실이 confirmed by the user. Two captions fixed, the last piece ("이거 보내놔야겠다") removed.
- **When Damyui sits at the very bottom of the source, the more you zoom the higher the mouth climbs in the window** (the bottom edge is
  fixed). User: "zoom in more to reduce the space above and keep more of the lower face" -> 398x420. The first version 626x660 had captions
  over the mouth, and 465x490 had too much space above
- Feedback tab: while playing, when the playhead line drops to the bottom quarter the timeline follows down (`follow()`, line put at 30%
  from the top). Not while paused or within 1.5 s after touching the wheel / scrollbar. Verified by playing in the browser (scroll 0 -> 190
  -> 380 -> 779)

### The render button bakes restores and drops too, source-side timeline (2026-09-29)

User: "manage cut editing in the preview too" -> **render the cuts heard in the preview, as is, with no AI.**
- `tools/apply_review.py` rewrites edit.json keep with **the same maths** as feedback.js (plan, toPlanT, planScene's piece splitting)
  (edit.json.bak). Pieces inherit crop and gainDb; restored gaps take the previous piece's crop and gain 0. Caption and fx.json numeric times
  move too, caption lines whose speech is gone are dropped (effects pointing to them get that spot's numeric time). Restored-spot captions
  (restoreCaps) go in as lines
- The server (`dashboard/server.py` shortsmith_job) runs `shortsmith cuts` first if edit.json changed - **needs a server restart**
- A rule fixed on both sides: a segment left with no speech after dropping is discarded (dropping a whole line left 0.6 s of piece margin
  and a caption floated over empty sound); restored words get 0.10 s before and 0.15 s after; caption lines with less than 0.1 s of their
  source range left are not drawn
- Crossfades at seams in the preview too (Window.tsx PlanRange, same length as the render - scene.body.crossfadeSec). The picture switches
  at the frame
- Test (on a copy of the episode folder, deleted afterwards): drop "오케이 좋은데요 여러분?" + restore "가 될 수도" -> preview 34.51 s, render
  34.53 s, line order checked on frames
- Source-side text pane: the edit timeline and polygons removed, the source axis widened to 44 px at scale 1 (18 px/s) - transcript lines sit
  beside their piece bar at the same height. The edit side keeps two timelines as before (source scaled to the edit length)
- (Same day) Restored spots did not go to the scrub bar and captions did not show: ① the scrub bar treated video time as edit time and moved it
  again via seek() - a restored spot has no current edit time, so it went somewhere wrong -> the scrub bar uses video time as is. ② the zIndex
  given to PlanRange with crossfades put the video above the caption layer, **hiding every caption in the unbaked preview** -> removed.
  Verified by screenshot. `D.Feedback.sceneNow()` (the scene passed to the preview) is exported for checking
- (Same day) the +/- buttons at the end of source lines were "hard to see": grey at 55% until hovered -> always green + / orange - (23x21,
  bold). Only buttons with nothing to do are dimmed to 30%
- (Same day) +/- glyphs sat low in the button (measured: ink centre 2 px low, due to the font) -> centred SVG lines instead of text.
  Re-measured 0 px
- (Same day) line buttons 23x21 -> **17x16** (8 px symbols, top 2 px centred on the first row). Text offset LINEOPS 54 -> 44
- (Same day) creating a new project opens the AI edit tab first (projects.js create). Opening an existing project or importing a file still
  goes to the feedback tab
- (Same day) new project name field: non-existent class inp -> .input (same look as other fields), Enter = create (ignored during Hangul
  composition)
- (Same day) the feedback tab's "which final to view" field is hidden in scene preview (captions drawn directly) and with one final or none.
  It shows only when viewing several language finals as mp4

## 모캡영도랜디 3-second design check (2026-09-29, jobs/20260929_173303)

First use of Basic Shorts (public preset). One piece, 영도모캡랜디.mp4 8.60-11.60, only the first 30 s transcribed. Dashboard pmumey27ghgew.
Details in `edit/영도모캡랜디/notes.md`
- **Basic Shorts = 담유이 Solo Shorts II (no background video)** (same day, user instruction). shortsmith/presets/basic-shorts/preset.json was
  copied from damui-test-shorts v3 with only id, name and visibility changed to Basic's, brand.background null; the old v1 (OFL fonts only)
  is preset.json.bak. The title is **two lines + a coloured key word at 1.15x** like 다음 생 and 삼성 사본 (Black Han Sans unchanged, 124 /
  line centres 195 and 335). shortsmith TitleView now takes two lines ("\n" or " / ") and «word|colour» (preset title.centerY, lineGap,
  keyScale, keyColor). The 3 s of 모캡영도랜디 were re-rendered and checked on frames
- 모캡영도랜디 3 s, version 3: "sounds like 말 우리가 월말에 ~" - the piece was cut in the middle of the previous run (8.60). Re-measured on the
  waveform: 9.40-12.40.
  **Word fitting (transcribe_words stage 2) is off by a whole run on drawn-out words and numbers** (it assumes an even rate; "10" has 0
  Hangul characters). Cut points are always set from the speech map (pauses between runs) - skipped this time for a 3 s piece, and it bit.
  transcribe_words.py speech run thresholds became source floor (p10) +7/+14 (the fixed -52/-60 read a source with a -40 floor as one run)
- Basic Shorts fonts back to OFL (user "let's fix the fonts"): body Pretendard ExtraBold, reaction Black Han Sans, handwriting Nanum Brush
- Basic Shorts chat: **original chat captures** instead of cards (user: chat design differs per stream). Recorded in the preset guidance and
  the chat card icon (a local path) removed - zero local paths in the public preset. Text size left as is (instruction). Memory
  chat-as-capture

## 모캡영도랜디 first edit (2026-09-29, jobs/20260929_173303, Basic Shorts)

Source 영도모캡랜디.mp4 211.77 s -> **11 pieces, 18 caption lines, 37.92 s**. Dashboard pmumey27ghgew. Details in
`edit/영도모캡랜디/notes.md`.
- Speech map before transcription (a source with a -39 floor, so -26/-33). The 3 s version's cut through the middle of a run was not
  repeated
- **Chat as captures for the first time** (user instruction): pill balloons cut out with img/cut_bubble.py (finds the body by its blue
  outline); shadows baked in because they melted into the white background
- Checks: line splits 0, grouping 0; one verify_runs flag is a false alarm (difference per cell equals the gain), one check flag is a ㅎ
  liaison with no dip
- Unverified word "푸젯하고"; the title is a guess

## 2026-09-30 모캡영도랜디 version 2 (Solo Shorts II, title "영도 모캡", focus on 영도)
- 9 pieces, 38.98 s, dashboard pmumey27ghgew. The haptic suit passage shortened, the 영도 dance and birthday mocap explanation (39-74 s) added.
  Three chat captures.
- The Basic version is kept as *.basic.* and edited/영도모캡랜디_edit_basic.mp4. Details in edit/영도모캡랜디/notes.md

## 2026-09-30 Ripple on/off switch in the feedback tab
- User: "make a ripple on/off switch next to the source / edit tab switch" + an explanation of ripple delete and ripple trim in editors.
  Off: removed spots become gaps (black window, silence) and restored speech overwrites.
- Changed: dashboard/js/feedback.js (plan returns [source s, e, edit time]; with ripple off, edit time = plan time), index.html and
  feedback.css (switch), tools/apply_review.py (same maths, {gap} in keep), shortsmith cuts.mjs, body.mjs and util.mjs (gap pieces),
  Window.tsx (gaps are a black window, bundle rebuilt), export_shortsmith.py and src_preview.py (gap pieces are not dashboard pieces, the
  ripple setting is kept)
- Tests: 300 random cases with ripple on = the old maths; ripple off keeps remaining pieces in place, 0 overlaps; JS = Python on 40 cases.
  In a copy render the 2.94 s gap is -91 dB and a black window, length 38.98 unchanged.
  In the browser, a test project: on 37.20 s / off 38.98 s, gap shown as a black window; test folder deleted afterwards (the copy render made
  Remotion download the 113 MB headless Chrome shell again - it does so for every new episode folder)

## 2026-09-30 Height of the selected caption card in the feedback tab
- User: "when editing captions on the edit side, the clip doesn't need to grow that much; it takes less space than you'd think"
- Measured: the card content is 119 px for one text line, but CARDH was 150 and multiplied by the edit-side stretch factor (matching the source
  length; 2.26 for 모캡영도랜디) gave 339 px.
  -> cardNeed (text line count, 101 + 20/line) divided by the factor and re-measured (up to three times). If it overflows (the overlap fix
  button), draw and measure once more. Result 122-130 px.

## 2026-09-30 Ripple trim, pushing edit cards down, centred text, save omissions fixed
- User: "there's no difference on the edit tab between ripple on and off; with ripple on, extending a clip still shows an overlap", captions
  hidden by the card should go below it, text centred on the clip
- feedback.js setT: with ripple on, moving the end (e) moves following captions on the same layer (start >= old end - 0.02) by the same
  amount. Edit-side 담유이 text is centred on the clip and pushed below the card and earlier text (mainFree)
- Found during testing: the save merge in server.py dropped the word drop / restore table, e2, os2/oe2, kind, ripple and restoreCaps ->
  now accepted, server restarted.
  Verified with a test project that the word table, e2, pushed captions' s2/e2 and ripple false stay in the file. app.js mergeUserBits keeps
  ripple too

## 2026-09-30 Playhead line: fixed, draggable, click the source axis
- User: "while editing, the playhead line stays fixed whether clips are pushed or shrunk; let the playhead line be dragged; clicking on the
  source timeline moves there; for a removed part, move to whichever side (start | | end) of the removed clip's middle is closer"
- feedback.js: setT no longer seeks to the edited time; srcSeek (source time; in a removed spot, by the middle, to the previous range end
  minus one frame or the next range start); .tl-ph dragging (source line uses srcSeek, edit line ME.t); clicking the source axis. css: .tl-ph
  grab zone 6 px above and below
- Test (copied project): removed spot at 20% -> 2.483 (previous piece end), 80% -> 2.50 (next piece start); editing the end time keeps 12.05;
  dragging with the mouse 12.05 -> 14.75, card stays open

## 2026-09-30 The playhead line did not move during playback
- User: "it must move during playback even while editing / the playhead line is there to check the absolute position at the current moment;
  moving it by user action changes the current moment"
- Measured: during playback timeupdate fired 0 times regardless of the card (the time display froze too). bind in
  shortsmith/preview/entry.tsx attached to the player only once, two frames after the first draw, and if the player did not exist yet it never
  reattached (only on the next update()). It now retries every 50 ms until attached. Bundle rebuilt.
- Verified: after a reload, touching nothing, playing with the card open -> 8.13 -> 9.55 s, line 470 -> 535 px

## 2026-09-30 Fixed line (layout, scale), selecting does not move the line, roll edit on overlap
- User: "why does the playhead line move when I extend and shrink clips? The clip length should change and the line stay fixed" / "clicking
  an edit clip must not move the line" / "on overlap, eat the overlapping caption by that much, keeping the total fixed (3:7 to 5:5 or 2:8)"
- Cause: the selected clip was stretched to the card height (short clips kept the same bar when the end moved), and the edit-side stretch
  factor (matching the source length) was recomputed on every edit, so the whole view grew and shrank.
- feedback.js: the selected line does not change layout (card over the text column, following text below the card); the scale is frozen while
  a card is open (FROZEN); pick does not seek; setKey + roll: the end moves the next line's start when ripple is off, the start always moves
  the previous line's end (adjacent lines follow when shrinking too; neighbours keep at least one frame)
- Test (copy): selecting keeps t 9.00; end 10.633 -> 11.367 makes the next line 11.367-11.817 (its end unchanged); shrinking, the next line's
  start follows; pulling the start earlier, the previous line's end follows; with ripple on the next line keeps its length and is pushed; the
  line stays at 517.956 px throughout, bars 124 -> 158 -> 121 px
- The user's project contains the user's own edits (first line end 1.73 -> 1.5 pulled with ripple, ripple off) - not touched

## 2026-09-30 Card only on text click, line fixed on screen (scroll compensation), roll only the adjacent line
- User: "don't open the card when manipulating clips, only when clicking text" / "the line is fixed and everything else moves - what editor
  moves the line like this when you control a clip?"
- feedback.js: CARD flag (bar = select + end handles, text = card); fillSubs measures the line's screen position before and after redrawing
  (PH_ANCHOR) and compensates the scroll (scroll unchanged if the line is off screen); roll edits only the adjacent line (the 0.02 tolerance
  exceeded a frame, so continued dragging pulled the start of the line after next)
- Test (copy, two real mouse drags): line screen position 693 px unchanged, only the adjacent line down to one frame, the line after it at
  11.817 unchanged, 0 overlaps. Clicking a bar = no card, 2 handles
- Recorded as a rule in memory timeline-playhead-nle-rules

## 2026-09-30 Edit-side scale linear in time
- User: "shrinking a clip doesn't shrink it and extending doesn't extend it, only the line moves up and down; and why does it scroll while I
  control a clip?"
- Cause (confirmed from the user's project history: first line end 1.50 -> 2.35, "10월 말" one frame): each edit-side line had a minimum text
  height, so even a one-frame clip kept its bar, and instead everything after was pushed and the line moved, then the scroll compensation made
  the view shake. Dragging was divided by PPS, so the handle moved 2.26x faster than the mouse.
- feedback.js: edit side ME = straight line (KE px/s, set only by the edit length and the source-side height - unchanged by caption edits),
  text pushed down by mainFree, dragEdge divides by KE. (First named K, which clashed with the piece list K and briefly broke the tab -
  renamed KE)
- Test (copy, real mouse): first line end dragged up 40 px -> handle 473 -> 433 (with the mouse), bar 115 -> 59 px, next line 2 -> 57 px,
  line at 513 px, scroll 0 unchanged

## 2026-09-30 Roll edit overwrites, clip control first on the selected clip
- User: "why can it shrink but not extend? And on the clip being manipulated, prioritise clip control over dragging the line"
- Cause: roll kept neighbours at one frame, so once a neighbour was one frame it could not extend further (the user's first line was in that
  state); the line (z 7) covered the handle (z 6)
- feedback.js: when a neighbour is fully eaten it is overwritten to length 0 (struck-through faint text, .is-eaten) and the next line keeps
  shrinking; pressing the line over the selected clip (±8 px) drags the nearer end. css .tl-dot z 8. apply_review.py: zero-length lines are
  dropped from the render (fx references get that spot's time)
- Test (copy, line placed over the first line's end, real mouse): extend 2.35 -> 3.683 ("10월 말" eaten, next line rolled), shrink -> 1.433
  (next line follows), line at 473 px, playback 2.35, scroll 0 unchanged

## 2026-09-30 Ctrl+click on the edit timeline = move the playhead
- User: "make ctrl+click on the edit timeline move the line" (first written as source, then corrected)
- feedback.js: capture-phase mousedown / pointerdown / click on the edit-side stage - Ctrl (Cmd)+left click blocks bar, text and handle actions
  and sets the playhead to ME.t(y)
- Verified (user project, playhead only): on text -> 4.53 s (no card), on a bar -> 5.93 s (no selection), nothing edited (dirty false)
- Note: screenshots of my browser window sometimes show the preview video black - reading video pixels through a canvas shows the picture
  (window average 216). Taken as a capture issue (guess)

## 2026-09-30 Caption line length and balanced splits (all presets)
- User: "too many characters in one caption -> the font shrinks, so write only as much as fits without shrinking / split by meaning, but not
  8:2 - similar numbers of characters - for all presets"
- tools/edit_audit/fit.py: measures with the preset font (found via lib/preset.mjs) using the renderer's yardstick (size*lineToEm width >
  maxTextWidth). Matched against browser canvas values: 113/119/99/102% identical. Also flags two lines without a pause skewed beyond 70%.
  Rules in memory shorts-caption-rules and CLAUDE.md
- Caught: 모캡영도랜디 6 shrinking, 5 skewed; 야설낭독회2 6 shrinking. Fixing them is asked of the user (모캡영도랜디 has user edits in progress
  in the dashboard)

## 2026-09-30 Wider edit axis + waveform
- User: "put the real waveform inside edit clips (vertical, top to bottom, centred on the axis, mirrored left and right)", "stretch all clips
  on the edit timeline sideways"
- tools/src_wave.py: source audio 20 ms peak in dB (-60..0) as one byte each (211 s = 10.6 KB, base64 14 KB), cached as wave.json in the
  episode folder. export_shortsmith.py puts it in review.wave (for 모캡영도랜디 written directly into project.json - user edits untouched)
- feedback.js: edit axis width EXW 44 (source axis stays 22, X_SIDE and X_PAGE shifted), drawWave: maps source time to edit time through the
  keep ranges [s,e,at] and draws the per-pixel-row peak left and right from the axis centre. Piece gain added. The scale runs per source from
  the floor (bottom 10%) to loud (top 0.5%) - with a fixed -60 dB, a -39 dB-floor source filled half the bar even in pauses
- Verified: canvas 44x2079, bar 44 px, pauses and speech visibly distinct
- 2026-10-01 feedback tab edit timeline: "make clip boundaries more visible / the gap-compression mark between clips shouldn't be blue
  (confusing when controlling clips)". Clip bars shrunk 1 px top and bottom for a 2 px gap (scale and end grabs unchanged), border white .36
  -> .62, the waveform also clears 3 px at clip boundaries. The join line where something was removed (tl-join) from blue (the selected clip
  colour) -> pink #ff5fa8 (every other colour already has a meaning). 2 px gap and pink verified in the browser.
- 2026-10-01 continued: "the gap-compression mark -> a barely visible colour, clip joins fully continuous". The 2 px gap and the waveform break
  were reverted (boundaries shown only by the .62 border; the waveform canvas lowered to z 1 so the border shows above), tl-join pink -> white
  .14. Zero gap verified in the browser.
- 2026-10-01 repository: E:\Edit\Claude connected to github seoldam82/Kirinuki-Edit (public). .gitignore excludes projects, episode folders,
  videos, private presets, Damyui styles, image assets, davinci-resolve-mcp and .mcp.json. E: does not record file owners, so git needs a
  safe.directory exception.

## 2026-10-01 Dance(C:S) Solo Shorts preset (static camera moves)
- User: "when the character looks like leaving the frame, mostly (not always) move to keep a full shot, or so the character's centre is in the
  middle, without much space on any side. A slight zoom in / out when needed". References: 4 YouTube videos + Damyui-n152-1.mov (the portrait
  rework of -0.mov).
- Measured (-1.mov, camera every 0.1 s, body box every 0.25 s): above the head 0.073h, below the feet 0.053h, sides 0.18w; 30 pans wider than
  0.1 at 0.85 s and 0.116h/s; 4 single-frame jumps; scales 0.787 / 0.842. 4 YouTube videos: body centre 0.50, body height 74-95%. R14ZVrYoWSs
  challenge 19.2-23.2 s upper-body cut-in (0.14 above the head).
  -1.mov follows a little every 0.3 s, so as the user said "only when about to leave", SIDE was narrowed (guess).
- Subscription / donation alert chibi images were taken as the body (n152 7.9-14.2 s) -> large blobs outside the body are excluded.
- Made: presets/damui-dance-cs-shorts, tools/dance_camera.py, shortsmith body.mjs camera.keys (holds = crop, moves = perspective).
  Fixed: two keys at the same time -> a 0 s piece joined as a broken file and 2.7 s vanished (one boundary now). perspective's in starts at 1
  -> moves were one frame early (in-1).
- Test (source 40-70 s, temporary work folder): 15 moves, 2 cuts, scales 880/968, length 30.003 s, audio offset from source 0, ±0.3 dB at 27
  piece boundaries, positions during moves within ±1 px of the plan, viewed side by side with the reference. Moments where 2-6% of the toes are
  cut (leg kicks) are left.
- Remotion downloads Chrome into the working directory (E:\Edit\Claude\.remotion appeared at 521 MB and was deleted; added to .gitignore).
  Every episode folder already holds 521 MB - raised as a separate task.
- Version 2 (same day): user "far too unnatural / follow the character's centre as continuously as possible, like tracking".
  Matching the -1.mov camera against the body's centre of mass: horizontally it follows the centre smoothed with σ 0.2 s with no lag (RMS
  16.5 px, 90% of differences within ±0.05 width), vertically σ 2 s. Ported as is: a key every 0.2 s, scale on the 80th percentile + up to 10%
  only when it does not fit. body.mjs renders consecutive linear keys as one 3 s piece with a perspective path (clip per segment). Test 40-70 s:
  10 pieces, 95% within 1.4 px of the plan, no jumps at piece boundaries, audio at boundaries -0.15 to 0.01 dB, nearly identical side by side
  with the reference. Toes cut 11-18% during leg kicks are left.
- Version 3: user "use zoom in and out so the whole body shows as much as possible". The 10% zoom-out limit removed; scale = the height at
  which the widest spread of the body (height and width) within ±0.6 s fits with margins (σ 0.4 s, up to the source height). If it still does
  not fit, centre on the range (following the centre of mass cut only the kicking side).
  Test 40-70 s: cut-off 18% -> 2% (65.8-67.2 s leg kick, body width 578-639 px equals the 608 px width of a crop of the full source height -
  cannot fit more), scale h 850-1080, plan differences x 1.4, h 1.7 px (95%). The reference cuts the feet at the same spot.
- Version 4: user "the camera must not move before or after the character". The σ 0.2 s Gaussian and the ±0.6 s window made the camera move
  before the body.
  The body is measured every 1/30 s with isnet silhouettes every 0.2 s + optical flow in between (Farneback 480x270, propagated forward and
  backward and blended), and the camera uses the same frame (only jitter smoothing σ 0.05 s). Scale widens on the frame the body spreads and
  pulls in only at 0.5h/s. Flow estimate vs directly measured centre of mass: 9 of 10 spots within 18 px, 38 px at the 67.2 s kick.
  Camera vs body horizontal speed lag 0 frames. body.mjs: up to 40 points per piece (32K command line), camera pieces with -frames:v (1797
  -> 1800 frames, 30.000 s). Audio offset 0, 17 boundaries -0.15 to 0.10 dB.
- Version 5: user "big zoom in / out repeating over and over is dizzying, so in such cases zoom out slowly instead (like around 25-27 s), the
  rest is good". If zoom peaks (rising more than 8%) follow each other at under 1 s intervals two or more times -> a repeating span: from the
  foot of the first peak, over 1 s, to the widest scale in the span, held until the last peak, then out at the same speed. Test 40-70 s:
  only 64.8-67.2 s caught (5 peaks -> 1), the rest unchanged. Cut-off not increased, 1800 frames.
- Version 6: user "refer to the video on my computer I gave as an example of how it's handled / still far too dizzying ... big changes should
  move slowly instead ... during back-and-forth, zoom out slowly to the maximum width -> then proceed normally". -1.mov's camera re-measured
  (99th percentile): horizontal speed 0.314h/s, acceleration 1.10h/s², vertical 0.072, scale change 0.099/s (median 0.002 - nearly fixed); the
  64-70 s leg kick widens 7% over 2.5 s and holds.
  Camera = ignore narrow jitter (horizontal 2.5% of width, vertical 2%, scale 3%) + follow within these limits (speed, acceleration, slowing by
  stopping distance, past values only) + scale = widest over the last 2.5 s. Back-and-forth = more than four turns or zoom peaks within 0.6 s
  of each other (one in the test, 64.9-67.2 s) -> aim slowly at the whole swept width.
  Result (reference): horizontal speed median 0.023 (0.037), 90% 0.203 (0.153); scale change median 0 (0.002), 90% 0.053 (0.015). 1-6%
  cut-off in 30 moments (due to slow following).
- Version 7: user "(in cases like 25-27 s) the zoom-out is too fast, and it must not zoom out before the character moves (until the motion
  leaves the frame) / motion -> camera or motion == camera (depending on the case; usually motion == camera), camera -> motion is strictly
  forbidden".
  The previous version aimed at the whole back-and-forth span's width (including the future) from the start of the span and sped up, plus a
  σ 0.05 s two-sided smoothing. Fixed: inside a span only the width swept so far; zoom aims wider only when the body exceeds the current frame
  (1% margin); pulling in only when the full shot of the last 2.5 s is more than 3% smaller (never inside a span); zoom speed at the reference
  limit; no smoothing. Check: 0 frames zoomed out to a size the body has not yet exceeded; horizontal +5 frames (0.17 s) behind the body.
  At the 65.9 s leg kick it widens over 2.5 s after the foot leaves the frame (toes clipped meanwhile - motion -> camera). 1-5% cut-off in 59
  moments.
- Version 8: user "it must not zoom out too much; allow only up to 8:2 (character : space), no more; 25-27 s was handled well, but 27-28 or
  early 29 is the normal case ... zoom back in to minimise space and proceed, and zoom out slowly again when it goes back and forth".
  FILL 0.8: the fuller of body height and width cannot drop below 80% of that frame (inside a span, the swept width). Hold time of a widened
  scale 2.5 -> 0.5 s. Following does not overshoot the target. Check: minimum fill 0.800 (0 frames below 0.8), median outside spans 0.883,
  horizontal 5 frames behind, 1800 frames. 0.4 s after the kick ends (67.2 s) it pulls in to the full shot (8:2 pulls it in).

## 2026-10-01 Dance(C:D) Solo Shorts preset (dynamic camera moves)
- User: "use the camera to show the dance more dynamically (mostly zoom in / out on the beat, sudden punch-ins and pull-outs) -> when there's
  little movement, base it on Dance(C:S) Solo Shorts but with extra flair, base : flair about 3:7". References: VzGBBlqDzqA, 52qgpnCjxcU,
  pPZ3raGlOh0 (docs/dance_cd_refs, downloaded with permission).
- Measured (per-frame similarity transform against the background): cut scale on entry x2.0 / x2.7-3.3, on exit x0.5-0.67 (pPZ3 steps 2.01,
  3.27, 2.01, 2.02), pushes over 4.5-4.9 beats x2.1-3.3, pulls over 1.4-2 beats x0.45-0.5, full-shot time 14-49%. Punch-ins: only five 0.08 s
  x1.1 peaks in pPZ3 (close to a guess).
  Whether cuts land on beats could not be proven - with 4-6 onsets per second any time falls within 3 frames of one. 52qg's cumulative scale
  drifts, so it cannot support time shares.
- Made: presets/damui-dance-cd-shorts (extends C:S, camera.mode "dynamic"), tools/dance_beats.py (beats, bars, shot plan), dance_camera.py
  stats got the head top (central body band) and upper-body centre of mass; keys break at every cut.
- Test 러브어택260921.mp4 (1726x1080, 31 s, episode folder edit/러브어택): 112.2 BPM, 15 bars, 9 cuts, flair 61% (bars where the upper body does
  not fit a shot were excluded, so 70% was not reached), shot time full 36, punch 3, push 14, upper body 14, above thighs 26, pull 7%. Frames
  around cuts checked (changes in one frame).
- Fixed in the first version: the last frame of a bar is the cut point, so putting it in a close-up turned the cut into a one-frame zoom (88%
  of the body cut off); flair bars clustered in the last 9 bars, giving 18 s of close-up (max 3 bars per block); applying the reference's x2 as
  is was already upper-body on 러브어택 (shot sizes as fractions of the body - 0.65 / 0.40, eyeballed); a 3.6-5.8 s upper-body cut filmed only
  sky (the feet stay but the upper body sways widely -> only when the swept width fits the shot; the head is held within 15-85% of the frame);
  cuts between equal sizes (jump cuts -> merged into one shot).
- This source's audio starts 0.021 s before the video (under a frame of beat time difference; left as is).
- Version 2 (허니하트260921.mp4, 2.5-25.85 s - the first 2.46 s are the stream face screen and were excluded): user "too much space above the
  head, and you need to see where the motion is / the face should generally show, but if the hand moves are dynamic and get cut off while only
  the face shows, it looks wrong". Space above the head 0.14 -> 0.04 (references 0-5%, eyeballed on a scene sheet).
  Where it moves: silhouette difference (XOR) is useless because the twin tails and clothes swing too (1600 points every 0.2 s, as wide as an
  above-waist shot), and skin colour too (the hands are white under the lights)
  -> mediapipe pose_landmarker_full (downloaded with permission, ~/.cache/mediapipe): wrists and index fingertips every 0.2 s (episode
  pose.npz). Tracks the 3D model well (6 frames checked by eye).
  Shot size from two levels -> per bar the smallest that contains the head + fast hands (0.40 / 0.50 / 0.65 / 0.80 of the body). Result:
  106.9 BPM, 11 bars, 6 cuts, flair 42% (a dance with fast hands 76% of the time, so the bars at 7.2, 18.7 (wide sideways), 20.9 (arms wide)
  and 23.2 s (up and down) are full shots), shots full 56, punch 2, push 10, face 5, medium 23, pull 5%.
  DANCE_DEBUG=1 prints per bar the fitting shot, hand inclusion and swept width.

## 2026-10-01 Dance pipeline speed (user "optimise this whole pipeline")
Measured (허니하트 23.4 s, i7-1260P, Arc A350M): camera first run 158 s = isnet silhouettes 115 (0.97 s per frame, CPU already saturated -
changing thread or session counts gave 0.90-0.97) + Farneback 23 + pose 7. Rendering 74 s = body 44 (18 pieces - just starting the QSV encoder
costs ~2 s per piece: 6 frames 2.17 s, 180 frames 2.38 s) + render 28 (re-encoding the window with zero captions and effects) + the rest.
- Optical flow: flows needed per span computed first on 8 threads (19.8 -> 5.0 ms per frame). The 310 keys are identical.
- Body: camera pieces split per third of the keep (+1 s) instead of 3 s / 40 keys - a cut is a point jumping on that frame inside a piece (gte),
  and the one-frame hold before a cut is not a piece either. Long expressions go into -/vf files (32K command line). Expressions are summed as a
  balanced tree - a+b+c... makes ffmpeg fail with "Cannot allocate memory" from ~97 terms. Before perspective, crop to just the range the path
  covers (it did 3-10x the work of the full 1726x1080; 2.28 -> 0.70 s per 3 s). fps=60 before perspective: the expressions count input frame
  numbers, and an OBS recording dropped a frame at 18.807 s, drawing everything after one frame late (8 px). Black background cached (6 s per
  render). 18 pieces -> 3, 44 -> 17.6 s.
  Checks: per-frame evaluation of the expressions is within 0.25 px of the keys (1401 frames), within 1 px (output px, 14 frames) of a reference
  image (cropped directly from the source with the same box). The old version was 4-5 px off on frames before cuts.
  Quality: the intermediate resolution is the cropped size rather than 1726 wide, so Laplacian sharpness is ~10% lower (not distinguishable
  by eye).
- Render: if the overlay is a single fully transparent image for all frames (alphaextract YMAX 0), the window is the full screen and there are
  no window effects, the pieces are not re-rendered and the window.mkv picture is copied. 28 -> 5 s.
- CLI: render.mjs (Remotion) is loaded only for render, build and still - cuts 1.7 -> 0.3 s, and cuts, body and scene run without
  node_modules.
- An ordinary episode (봉누도2귀신, 24 captions, 7 effects) gives a bit-identical video (PSNR inf) to the code before the change in the same
  environment.
- isnet silhouettes on the discrete GPU (with permission): the already installed OpenVINO 2024.6 gives 0.070 s per frame on the Arc A350M (CPU
  0.97, integrated Iris Xe 0.23). onnxruntime-directml was not installed - onnxruntime is used by faster-whisper. Half precision, but
  silhouette IoU 0.9994-1.0000 (6 frames); camera keys have the same cuts, median box difference 0.1 px (max 9.6 px in one spot). Without a GPU
  it falls back to onnxruntime CPU. Compile cache ~/.cache/openvino.
  Camera first run 158 -> ~40 s (~70 s on the run that first builds the compile cache).

## 2026-10-01 Dashboard output mode (user "let me choose whether outputs are edited separately per video or several videos output as one")
- [separate | combined] next to "planned output" in the style apply tab (shown only with more than two target videos). Combined = target
  videos joined in drop order (list order inside folders) into one result (one per language); the name is the folder name if there is one
  folder, otherwise the first video + _합본. The join order is shown under the results.
- Job JSON outputMode ("each" | "merge") + outputs[].sources; the prompt's "## 출력" states the output mode and order (shortsmith joins with
  { "source" } in keep).
- Saved as project ai.outputMode (core.js default and save, projects.js new project, app.js import). The server does not filter ai.
- Checks (worktree dashboard 8898, three videos put in state): switching by button, two languages give two results, the style apply job file
  (json, md), save and reopen, 0 console errors.

## 2026-10-01 A compilation as one episode (user "why doesn't it show in feedback?" -> "re-bind it as one episode")
- Dashboard job (D(C:S)SS test, output mode combined): 사준완 from 2.67, 제로투 from 3.53, 터미널 from 4.32 to the end (the beat just before the
  dance moves). At first the three were rendered as separate episodes and the finals joined, but export_shortsmith treats one episode as one
  project, so it could not show in the feedback tab.
- So edit/260921_합본: an intermediate source src_merged.mkv joining the three ranges (1726x1080 60 fps; 터미널 scaled 970 -> 1080 with 98 px
  cropped on each side; x264 crf 12) + three keep ranges (seams at 27.783 and 38.200 s). Each range's fixed gain +15.80 / +13.70 / +13.70 dB
  (same formula as the render) is baked in - measuring after joining only measures the loud part. 터미널 is -20.5 LUFS because of its peaks
  (the others -16).
- dance_camera.py: with several keep ranges, the camera state (following, jitter ignore, scale, 0.5 s hold window, back-and-forth) restarts at
  the first frame of each range with a cut, and the first key of a range is at the keep start (the 1/30 s key grid made it one frame late). The
  boundary frame of joined keeps belongs only to the later range. mkv length taken from format.
  Episodes with one keep keep identical keys (checked on 제로투).
- export_shortsmith.py: also exports episodes without a caption file or title (dance).

## Dashboard: style falling back to the first entry, server shutting down behind a hidden tab (2026-10-01)
- Style selection: opening a project empties selectedStyleId, and drawing the list before the server connected did not look up the name
  (styleSel) but fell back to the first entry, overwrote styleSel with its name and autosaved (D(C:S)SS test became the top entry, Dance(C:D)).
  It now always looks up the name and aliases; if not found it shows "none - please choose" and keeps the name. The first entry is used only
  for a new project with an empty name. Merely re-reading the list does not mark the project unsaved. Verified with a copied project in four
  cases: server connected, disconnected, missing name, new project.
- Server shutting down: not caused by git pull (it shut down without a pull too). Browsers slow ping timers in hidden tabs down to once a
  minute, while the server took 12 s of silence as closed. Pings now carry hidden (sent immediately on visibilitychange and freeze), and hidden
  pages are waited on for 2 hours. Closing a tab still shuts it down at once via bye.
  Verified: pings stopped while hidden = alive after 25 s; visible = shut down after 28 s.

## Dance C:S camera: tracking again (2026-10-01, compilation feedback "it follows late or doesn't rise on jumps, it cuts below the ankles")
The same complaint a second time ("I told you to track") - the following method itself changed. Four causes (measured on the 260921
compilation):
1. **Silhouette times were 0.083 s in the future**: ffmpeg `fps=5` emits the last frame of each 0.2 s slot. Silhouette frames (every 0.2 s)
   were in the future while the flow between them was on time, so the body position jumped ahead and back. `fps=5:round=up` (the
   highest-IoU frames were at 21.2/21.4/21.6 -> 21.30/21.50/21.70; now the same times, 0.92-0.96).
   dance_beats.py poses had the same bug - fixed too (pose.npz is regenerated).
2. **Vertical scale bug**: silhouettes are stretched to 480x270, and y was also scaled by SW/MW. The compilation source is 1726x1080, so the
   body shrank 10% and the feet were placed 105 px high -> below the ankles was cut in 90% of frames by the real feet (other episodes with
   16:9 sources were unaffected).
3. **Notification graphics taken as the body**: at 터미널 45-51 s isnet caught only the subscription alert chibi (or joined it to the body).
   check_masks: if position and area do not continue from the previous body, re-detect cropped around the previous body; failing that, leave
   empty (compilation: 32 frames - 25 re-detected, 7 emptied).
4. **Following limits**: the reference speed limits (horizontal 0.31, vertical 0.07 h/s) + a jitter-ignore band - vertical lagged 0.9 s. Position
   now uses a one-euro filter (1 Hz at rest, +3 Hz per h/s of speed) on the same frame, and if still exceeded it is pushed in on that frame.
   Scale zooms in slowly only (0.10/s), zooms out at 0.6/s.
Result (compilation, 1609 frames): lag horizontal 1, vertical 0 frames; feet cut 176 -> 0, head 11 (within 1%), raised fingertips 8. Vertical
speed 99th percentile 0.55 h/s (before 0.07) - it rises and falls with the body.
- The compilation source drops a frame at 38.200 s (the 터미널 seam), so the piece starting there was one frame short (3215 frames, picture
  17 ms early after it). body.mjs `fps=..:start_time=0` - an empty first frame is filled by stretching the next. 3216 frames.
- 허니하트 (C:D) was only checked to run with the new code (edit.json not written).

## Dance C:S camera: fitted to the user's answers (2026-10-01 third, "the moves and the zoom are all wrong ... you have the answers, analyse again")
Answers = Damyui-n152-1.mov and Damyui-n153-2.mov, re-framed by the user by hand (source -0.mov, same timeline - n153-2 only 0-120 s, the rest
appended).
At 10 fps, SIFT + RANSAC (scale + translation) recovered the frame box inside the source (rotation under 0.01°, 150-280 inliers) and it was
compared with this tool's body measurements (_ref_n152 and _ref_n153 episode folders).
- Answers: scale at the same value 91% and 87% of the time (mostly 849 and 910, changing with 1-2 s linear ramps), vertical still 86% and 84%,
  horizontal still 39% and 46%, horizontal lag 0, horizontal offset 0.01 of height.
  Body vertical centre at the frame centre (0.50-0.53), median body height / frame 0.78-0.87, top margin including hands at the 1st percentile
  0.041 and 0.042. Only a big jump (n153 59.5-60.2 s) followed the head up and back. Widening 9% per second (933 -> 1053), tightening 3.4% per
  second.
- Previous version (same-frame tracking): vertical still 46%, scale changes 0.34 per second (answers 0.05), scale 0.89-0.94x (tighter).
- New version: per span, scale and vertical position held fixed, widening only on overflow / rising only when digging into the 0.045 top
  margin / horizontal band 0.01 + jitter filter.
  Against the answers: scale 1.00 and 1.04x, vertical still 80% and 84%, scale still 87% and 96%, horizontal still 45% and 49%, horizontal
  offset 0.012 and 0.013 (same as before), body cut 0.7% and 0.9% (before 1.0 and 1.9).
- Re-applied to the compilation and rendered (594 keys, 0 cut, 3216 frames). 허니하트 (C:D) only checked to run.
- The dashboard's "the video size changes every time I press play" could not be reproduced (6 play / pause cycles, at 1600x900 too, player and
  video size unchanged) - asked the user again.

## Dance C:S camera: vertical judder (2026-10-01 fourth, "when she jumps or crouches even slightly the camera judders very unnaturally")
- Cause: vertical position stood still and then followed at body speed on the frame the head top or feet touched the margin line (compilation
  20.3 s: the feet dropped 0.06h and it moved 35 px in 0.15 s; the 21.4-22.4 s jump went down -> up -> past rest -> down -> rest). The rest
  margins were only 0.07 top and 0.06 bottom, so even a small crouch touched them.
- Fix: a knee that joins with a quadratic curve from 0.04h before the margin line, a vertical one-euro (1 Hz, 1.5), then a cut-off line (head
  and feet 0.005h - fingertips may be cut for a moment). FILL0 0.86 -> 0.82. Five variants run on the compilation and both answers to choose:
  compilation vertical kinks (frames over 8 h/s², seams excluded) 51 -> 5, direction changes per second 0.22 -> 0.09, head and feet cut 0.
  Against the answers: vertical still 87% and 85% (answers 86 and 84), scale 1.05 and 1.04.
- "The video size changes every time I press play" again not reproduced in the dashboard (75 measurements every 0.1 s over 3 play / pause
  cycles - player 544x967 throughout). The compilation scale does not change within a song (0% of frames change in 0-27.8 s); it changes only
  at the two song seams (so the body fills 0.82 of the frame per song).

## Feedback tab: preview size changing (2026-10-02, "the video size keeps changing every time I press play" + two screenshots)
- The user's two screenshots: the same 0:01.62, one with a 544x967 stage (9:16), the other 534x967 - only the width 10 px narrower, breaking
  9:16, so the player fitted 9:16 inside it with black bands above and below and a smaller picture.
- Cause: fitStage sets the stage box in px, but runs only on load and when dragging pane gutters. If the surrounding pane narrowed afterwards
  (a scrollbar etc. - the video pane was overflow:auto), CSS max-width:100% trimmed only the width. Narrowing the pane by 10 px reproduced
  534x967 (0.5522) exactly as on the user's screen.
  What narrowed the pane could not be reproduced in this window (a browser with hidden scrollbars) - (guess) the video pane's scrollbar.
- Fix: a ResizeObserver on .fb-stage-wrap -> fitStage; fitStage reads and uses the padding; video pane overflow:hidden.
  Verified: pane narrowed 10 px -> 534x949 (0.5627), restored -> 544x967.

## 2026-10-02 가시나0 (only 하늘머리; no dashboard project)

- `camera.region` in `dance_camera.py` - in a source with two dancers side by side, silhouettes are taken only inside the band. The black-haired
  dancer's left edge minimum is 0.450 (measured at 10 fps), band [0.1, 0.45].
- Scale fixed at h 917, 120 keys, 25.15 s, 1509 frames. Final `edit/가시나0/out/short.mp4`. A few frames catch a little of the black-haired
  dancer's hair at the right edge (unavoidable at this scale).
- Second version, "way too much space / lots of motion but the camera is too static": the feet are at the bottom edge of the source, so the
  frame was pushed to the edge with 0.155 of space above the head (0.004 below). Put against the source edge and the top margin pulled to 0.09
  (h 843, body 0.91). Both C:S (`out/short_CS.mp4`, `edit_cs.json`) and C:D (`out/short_CD.mp4` = short.mp4, the current edit.json) rendered
  for the user to choose. C:D: 124.4 BPM, close-up 32%, push 23%, full 28%.
- Third version, "C:S arms go out of frame (with lots of space on the left) 7/10 / C:D mechanical and artificial 3/10, like VzGBBlqDzqA":
  - Arms: cropping to the region band before detecting missed an arm reaching outside the band (0.45) to 0.49 -> detect on the whole frame and
    pick the blob mostly inside the band. Even then the 99.5th percentile of the body's horizontal extent dropped the fingertips (a thin arm is
    under 1% of the points) -> the k-th point from the edge. At 12 s the frame edge 913 -> 937 (fingertip 941).
  - C:D: watching the reference at 5 fps, the first 12 s have no cuts; push 0-2.4 s (small full shot -> above the thighs), slow pull 2.4-8 s,
    push again. Background similarity transforms read 0 because the background is almost plain, and pose torso length was lost too often - both
    unusable.
    Comparing the first version at 2 fps: ours held head-to-chest close-ups for 2-3 s and full shots for 3-4 s. -> plan_flow (0 cuts, scale moving
    67% of the time, wide 26 / medium 41 / above thighs 33%). Horizontal direction changes 1.79 -> 0.20/s (jitter band + hand inclusion before
    the filter), hands / head cut in 1 of 126 frames, 1%.
  - The old C:D preset is recorded in previousVersion (dance_beats.plan code kept).
- Fourth version, "C:D wide shots have too much space / C:S is much better apart from the judder":
  - C:S kinks (more than 0.15 h/s change within 0.1 s): only horizontal, 5 spots (11.7-12.7 and 21.1 s, arm extensions) - fingertips were
    clamped after the filter, jerking with the arm. Hand inclusion moved before the filter, with an acceleration limit after it of 3 h/s² (3x
    the reference's 99th percentile 1.1). No limit / 1.5 / 3 / 6: max kink 0.68 / 0.17 / 0.18 / 0.24, fingertip px out of frame 4 / 17 / 15 /
    12. -> 0.68 -> 0.18, fingertips out by 15 px only during the 0.2 s arm extension.
  - C:D: wide 0.74 -> 0.88. Kinks caught one by one - restarting the cosine every bar (speed broke to 0) -> two springs; hand-width scale taken
    as max after the springs (jerks at 9.2 and 11.1 s) -> into the target; a feet-inclusion switch (c<0.5) + in shots where the body does not
    fit, including the feet hit the head line -> only gradually and only when the body fits; follow's speed went to 0 when passing the target
    -> snap=False; following a nodding head down -> highest point over the last 0.6 s.
    Scale kinks 26 -> 0, vertical 12 -> 3, horizontal within the limit (0.2), hands / head out 31 -> 6 frames (39 px for a 0.3 s pointing gesture
    at 11.8 s - the scale cannot follow; even a limit of 4 leaves 34 px).

## 2026-10-02 Analysis sources removed from presets

- User: "the presets mention ~project and video names; remove where or with which video they were analysed". From 9 presets (7 private, 2
  public) the sources.measuredFrom and portedFrom lists were removed, and project names, video file names, YouTube URLs and reference reframe
  files inside descriptions, basis and guidance were replaced with phrases like "an earlier edit", "a published solo short", "a reference
  short".
  Kept: asset paths used by the render (background, outro, LongBG, chat icon), fonts, the host's name and name plate, style aliases, translation
  example words (고구마 = frustration).
  Which video things were measured on remains in this file's dated entries and in tools/*.py comments. All 9 pass loadPreset.

## 2026-10-02 Export to Kdenlive (first version)

- User: the free DaVinci Resolve connects but cannot edit cuts and captions as wanted -> another program. No existing editor source was usable
  (OpenCut: being rebuilt from scratch, DesignCombo: different engine, Remotion editor starter: paid, a big engine bridge) -> Kdenlive 26.08.1
  installed (with permission, checksum matched).
- tools/export_kdenlive.py. Tested on 퍼리취향: 12 pieces, 1918 frames (same as the final), 18 caption lines, overall gain +17.20 dB.
  A Kdenlive render (without captions) compared with the final: window, background and name plate positions identical. melt render (with
  captions), four scenes: caption position, font and colour (sad, partial emphasis) identical, label box two lines. Opened in the UI and alive
  for 40 s.
  Fix order: no profile name (rendered 720x576 25 fps) -> crop value basis (zoomed only in Kdenlive) -> crash with captions (sequence id,
  kdenlive_id; finally confirmed as a bug in --render itself) -> per-piece rounding (2 frames short).
  Approximated: emphasis (double outline -> one inner outline), outburst (gradient -> the bottom colour only).
- Next (at the time): overlays such as the title, images and chat as transparent video layers, reading back a project the user edited
  (two-way), dance camera moves as keyframes. *(Later: not used in the current flow - the user edit tab replaced it.)*

## 2026-10-02 User edit tab (direct cut control)

- User: Kdenlive "the UI and controls are hard" -> "better to implement just effects and audio from GitHub source and build a new UI" -> "start
  with direct cut control, add a user edit tab next to the feedback tab ... UI style like DaVinci Resolve".
- Made: dashboard/js/useredit.js (625 lines), css/useredit.css, index.html tab, app.js shortcut wiring, feedback.js (sceneFor, basePlan, userClips
  as the plan), server.py (save userClips), apply_review.py (render userClips, episodes without captions too).
- Verified (test dashboard 8898, a copied compilation project, real mouse): click a clip -> selected, line stays at 275 px / drag the right end
  -> 27.78 -> 20.37 s, following pulled in, line unchanged / Ctrl+B cut at 10.02 s / Delete with ripple / Ctrl+Z / drag to the very front (first
  measured by centre and went behind the first clip -> now by the drop start) / blade tool / ripple off -> a 1.93 s gap, no drop on overlap /
  survives a reload (saved on the server).
- apply_review copy test: compilation with 4 clips -> edit.json keep in the same order, captions.csv untouched. 퍼리취향 (piece 3 removed, piece 5
  moved to the front): 11 pieces, 29.24 s, the moved caption "아 맞다 나 담비지" at 4.18 s, 2 caption lines of the removed piece dropped, title end
  29.24.
- Next (in the user's planned order): sound (waveform, clip volume, sound effects, music) -> colour -> transitions and motion. Caption line
  dragging in this tab too.
- Second version, "show captions in the inspector too, add / remove words in the inspector / three tabs: transcript captions and render ... the
  feedback tab only keeps extra sources, prompt, note list and the edit button":
  - Three right-hand tabs in user edit. Clicking a caption line edits text, speaker, design, start and end in the inspector (this timeline's time
    -> written back as baked edit time s2/e2). Label cards (scene l0) are found via explanation lines in review.captions and edited.
  - Transcript captions: words edit the clip list directly (one source of truth). Test: dropping "풀려서" in a 퍼리취향 copy, 9.57-10.41 -> 31.97 ->
    31.10 s, restore -> back (adjacent clips merge). Overlapping captions stacked on rows, text edit + Ctrl+Z checked (real mouse).
  - At first "어 잠깐만" seemed missing although it is in the video: this episode's transcript word times are about 1 s early (잠깐만 7.97-9.07,
    piece from 8.72). keep is canonical - kept word runs outside or straddling pieces are measured as moved inside. 35 words missing (36 not in
    the pipeline keep).
  - Feedback tab: extra sources / notes (left), prompt + edit button, video. The video pane stays as the place to draw notes (the user did not
    list it, but notes attach there).
- Third version (2026-10-02), "media / clips -> change to adding source folders, make the user edit layout resizable like feedback, share the
  video between the feedback and user edit tabs / changes in the feedback preview apply in user edit too, user edit - waveform on audio, for
  video capture a thumbnail every so often onto the clip, match the overall theme - change colours to the user edit theme":
  - Shared video: user edit dropped its own player and borrows the feedback screen (.fb-stage-wrap - video, notes, arrows) into its viewer
    while shown, returning it on leave. Playhead, scene and notes are the same.
    Clip edits -> review.userClips -> feedback plan -> D.Feedback.livePreview(keepT) (keeps that tab's timeline time). Test: 12.5 s -> feedback
    tab 0:12.50, 20 s there -> edit tab 00:00:20:00, deleting one clip 31.97 -> 28.02 s with the moment unchanged.
  - Sources: the left pane is a list of sources added by folder (first group = this episode's source copy). The server reads folders and shows
    a picker (/api/media/browse, list, poster) - the browser does not give real paths.
    review.srcFolders (added to the server.py save list), [source folders] in the edit (AI) text. The clip list was removed (the timeline shows
    everything). Sources could not yet be dragged onto the timeline (the structure rendered only one source).
  - Thumbnails: /api/media/thumbs takes a frame from the source copy every 0.5 s (under 600 above 300 s) into one 20-column grid jpg (퍼리취향
    123 s, 246 frames, a few seconds the first time). V1 clips show the picture at each cell's source time.
    Waveform: old episodes without review.wave use /api/media/wave (same formula as src_wave.py). Both cached in the server temp folder
    kirinuki_media (keyed by path, size, modified time). V1 and A1 split the timeline pane height.
  - Pane sizes: three handles (source | viewer | inspector width, timeline height) - .ue-grid in split.js, floating bands between panes
    (.ue-gut). Double-click = default.
  - Theme: base.css tokens changed to Resolve's neutral greys (--bg #141417, --panel #232328 ...), and the navy / blue-grey in other css (green
    and purple accents kept) mechanically changed to greys of the same lightness (87 spots).
    On states (toggles, tab icons, gutters) orange --on #f39c38, primary buttons Resolve blue #3a6fd0.
## 2026-10-02 Render once at the end, cutting via captions, clip height

- User: "the clips are too tall, shrink them", "the feedback approach itself shouldn't render every time - render once at the end and use the
  preview until then ... rendering takes long and costs more tokens, and especially when captions add or remove cuts I can't see it in the
  preview right away".
- Clip height: V1 and A1 splitting the timeline pane height (third version) -> fixed 50 px.
- `shortsmith preview`: only cuts + scene (body length from estimateBody - the sum of piece lengths; window height by the same formula as
  buildBody). body.json and the final are untouched.
  `tools/preview_update.py`: preview + export_shortsmith.py. Removing one keep from a 퍼리취향 copy and running it took 1.1 s (rendering takes over
  50 s). src_preview.py reuses the previous copy's gain if window.mkv is old (no re-render).
  export_shortsmith.py: review.unbaked = the final is older than scene.json. feedback.js planNow plays the plan (source copy) when unbaked, even
  with nothing edited.
- Blocking AI rounds from erasing user edits: apply_review.py leaves applied_review.json (sha1 of userClips and the word drop / restore table),
  and preview_update.py stops if the project's current table differs.
  Test: run with userClips present -> stops -> passes after apply_review, 25.50 s (same as the user's cuts).
- Cutting via captions: inspector source start / end (os2, oe2). Moving the source start of "나 믿는다" 23.40 -> 22.40 restores the 0.92 s before
  it, 25.50 -> 26.42 s; Delete (remove this line from the cut) 23.68 s; Ctrl+Z 26.42 s.
  The render side (apply_review) also puts that line at 4.14-6.87, matching the preview (4.14-6.869).
- Small fixes: the export_shortsmith and src_preview store can be redirected with KIRINUKI_PROJECTS (for tests); relpath / commonpath crashed for
  episode folders on another drive.
- The text passed by the edit (AI) button starts with a [method] line of three steps (apply_review -> edit -> preview_update, no rendering).
## 2026-10-02 Tracks (video above, audio below), dragging sources in, layer sound, colour, fades

- User: "let me drag source files onto the timeline too / on the timeline, below the vertical centre is the audio area and above is the video
  area (including captions); video goes up from the centre 1, 2, 3, 4, ... scrollable, audio goes down from the centre 1, 2, 3, 4, ... scrollable
  / and keep going with the rest - audio, effects and so on".
- Timeline: headers and lanes split into a video area (anchored at the bottom, scrolling up) / centre line / audio area (anchored at the top,
  scrolling down). Track count = used + one empty (min 2).
- Layer clips: dropping a source row reads length, size and sound via /api/media/info. Video = a linked V + A pair (moved, cut and selected
  together); on overlap it moves to an empty track (settle). Blade, Delete, Ctrl+Z.
- Test (퍼리취향 copy, real mouse drags): bg.mp4 -> V2, c_13.2.png at the same spot -> moves aside to V3, clip_17_23.mp3 -> A2 (waveform). At 12.3 s
  in the preview the V2 video and the 50% image show.
  Render (build in the ss copy): same position and size, captions on top. Mixed sound: correlation between output 4.92-6 s and the mp3 0.64 (delay
  -0.003 s) / 0.05 elsewhere.
- Preview bundle rebuilt (src/parts/Layers.tsx). render.mjs's fast path for window-only episodes is skipped when layer video exists. Chunk keys
  include layer clips and file signatures.
- Not yet (at the time): original (V1) clip colour, transitions (dissolve etc.), motion (keyframes), positioning by dragging in the viewer.
## 2026-10-02 Original colour correction and transitions

- User: "why do I see only captions and no video? The chat icons are missing too and the original preset video isn't applied / and keep going with
  the rest, original colour correction and transitions".
- The missing video: what the user saw was my test tab (localhost:8897) whose server I had stopped after testing - the page stayed but without a
  server the video, background and chat images could not load and only captions were drawn.
  The main dashboard (8899) showed both feedback and user edit fine for 모캡영도랜디. **Close the test tab when a test ends** (the user sees the
  same screen).
- Original colour: eq (contrast, saturation) + colorchannelmixer (brightness) per piece - part of the piece cache key, so only changed pieces
  re-render. The preview uses a CSS filter.
- Transitions: centred on the cut, an xfade piece rendered separately from both handles and laid over the window in the render composite.
  Lengths and captions unchanged.
- Test (퍼리취향 copy): clip 3 saturation 0 + a 1 s dissolve from the previous clip (cut at 7.78 s). Render picture saturation (window band outside
  the layer clips) 6.9 s 57.9 -> 7.4 s 53.0 -> 7.78 s 31.1 -> 8.15 s 11.5 -> 8.6 s 6.1.
  Preview at 7.78 s: previous clip opacity 1 + mono clip 0.50. Transition and colour survive reopening after a render. tsc passes (ss copy).
## 2026-10-03 Layer clip motion (keyframes), dragging in the viewer

- User: "keep going" (left over from the last report: motion, positioning by dragging in the viewer, transitions between layer clips, transitions
  on dance episodes).
- Render: changing size with ffmpeg scale eval=frame makes overlay freeze at the first frame's size (a width that should be 250 at t=1.5 s stays
  100). perspective (sense=destination, eval=frame) has only in and on as variables (no t) - time is built as in/fps, and the image is scaled to the
  largest box and placed inside a transparent margin (2 px) so edge stretching becomes transparent. On a test image x 200 and width 250 exact.
- Test (퍼리취향 copy): two keys (0 s 270,693 540x569 -> 4 s 40,200 270x284, smooth); render frames at 7.85, 9.78 and 11.9 s overlap the expected
  boxes.
  Dashboard (real mouse): the viewer box sits where the preview picture is (first 3 px off = the player's centring margin, fixed), drag-move 270 ->
  662 (survives save and reload), add key -> at 11.5 s drag the top-left corner -> 2 keys, bottom-right fixed (1202, 1452), at 10 s 776 / width 425
  (computed 776.5 / 425.5), ◀ to the 8.5 s key, Ctrl+Z and redo.
  Ctrl+B cut V1 instead of the selected image -> with a layer clip selected, only that is cut. After the cut the last key of the first part = the
  first key of the second (777,1004 425x448).
- Small fix: waveform requests for videos without sound (bg.mp4) returned 500 -> now "none".
- Dissolve between layer clips: two adjacent clips on one track (V3, two image pieces, the second at saturation 0, 1 s). Preview at 9.58 s second
  piece 0.08, at 10.23 s 0.73 (computed 0.083, 0.733);
  render saturation at the image 9.3 s 29.7 -> 9.75 s 22.5 -> 10.0 s 15.4 -> 10.25 s 8.2 -> 10.7 s 2.4 (a straight 1 s dissolve computes 22.3, 14.9,
  7.4).
  When the inspector's length field overflowed its pane the mouse hit the timeline (a test mistake, not a feature problem).
- Not yet (at the time): transitions on dance (camera path) episodes, transitions other than dissolve for layer clips, curve choice between keys
  (now straight / smooth only).
## 2026-10-03 Dance episode transitions, five layer clip transitions

- User: "keep going with the rest, the dance episode transitions and other transitions".
- **Fixed accident: after #23, rendering crashed for episodes without layer clips** ("Cannot read properties of null (reading 'filter')") - the
  first-computation condition in render.mjs visLayers (EFF_OF !== scene.layers) was false with no layers (undefined === undefined), leaving EFF
  null. Revealed by the dance test copy. Added !EFF.
- Dance (camera) transitions: body.mjs draws both handles of a transition piece with the camera path at that source time (cameraSpans, pathVf -
  same formula as the pieces). 가시나0 copy (0-9 and 11-25.15, 1 s dissolve):
  mean difference between the final and window.mkv 1.5 at the transition's first end (8.52 s) and 1.2 at the last end (9.48 s) (1.1 outside the
  transition; 10-12 between frames 0.1 s apart) - it follows the path. 11.8 in the middle at 9.0 s (two scenes blended).
- Camera in the dance preview: src_preview.py puts review.srcPreview.camera (277 keys) -> planScene -> plan.camera -> Window.tsx camBox (same maths
  as body.mjs).
  Dashboard (real mouse): source copy positions at 0, 5.02 and 12.02 s equal the computation (-887.2/-502.1/4306, -1694.2/-947.3/6350.7,
  -985.3/-655.3/4578.2 vs -985.2/-655.1/4577.9), second range at 9.02 s 0.52 (computed 0.517).
  Before, the unbaked preview (always the case in the user edit tab) did not show the camera.
- Five layer clip transitions (the same list as original clips): wipe and slide = transparent clips with ffmpeg xfade (wipeleft, slideleft; the
  alpha channel works - tested), inside the box only; slide pushes the previous clip out too.
  Through black / white = nothing beyond the cut is used; the last h of the previous clip and the first h of the next get fade color=. **fade
  color= on rgba also lowers the alpha channel, so the clip turned see-through** (the video below instead of black) - convert to yuva444p first
  (rgba [0,0,254] -> yuva444p [0,0,0]).
  Render frames 4×5 (cut -0.6, -0.25, 0, +0.25, +0.6 s) all as expected. Preview at 13.23 s wipe 76.67% (computed 76.7), 16.73 s slide -293 /
  +107 px (-293.3 / +106.7), 19.23 s black 0.47 (0.467), 22.75 s white 0.50.
- render.mjs VERSION 6 -> 7 (the composite formula changed but piece keys stayed the same, so old pieces came back - "done" in 2.1 s). The next
  render of every episode re-renders composite pieces once.
## 2026-10-03 User edit, fourth version (timeline control, inspector, colour, transform, groups)

- User: separate video / audio in the inspector, sound slider + number, colour RGBW, curve graph, brightness / contrast / saturation tabs, reset,
  moving tracks (V1 <-> V2) + an icon for moving sound together or separately, blade c, I / O range (dim outside), source / effect tabs, wheel
  scrolls areas vertically (Ctrl = horizontal), drag to box-select, right-click groups, no render in the first edit either + fix the picture by
  eye (move, zoom and rotate every video and caption clip, X / Y sliders + read-only numbers), remove the log pane, merge the feedback tab into the
  AI edit tab, render tab settings (codec, quality, aspects matching the video orientation), aspect choice in style apply.
- This version (first batch): C, I, O, wheel, box select, link icon, groups, inspector tabs, sliders, RGBW, curves, transforms for original clips /
  layer clips / captions. The rest in later batches.
- Test (퍼리취향 copy, in-page events - the window was covered so screenshots did not work): zoom 150% -> source copy width 2025 -> 3040 px,
  rotation 10°. Curves (0.5 -> 0.7) and B gain -40 -> SVG tables R(0.5) 0.70, B(1) 0.775 (as computed).
  Box select 8 clips, group "앞부분" -> clip 2 saturation 0 applied to the group's three original clips (layer clips are a different kind and
  unchanged), saved. I / O range 26.4 -> Delete 15.6 s -> Ctrl+Z.
  Wheel: plain = video area 100 px vertical, Ctrl = horizontal 100, Alt = zoom. Render frames: 1.5x, 10°, a yellow tint (gain after saturation 0),
  label -200 / -15°, caption +100 / 8°, group clips in mono.
- **One accident:** once label cards became editable, server.py's "attach to the line with the nearest start" overwrote the text of the "어?
  잠깐만" line, which starts at the same 0.05 s, with the label text (revealed when the render stopped with "fx.json: no caption 어? 잠깐만"). Now
  matched by text (orig) -> speaker -> nearest line; the test copy was restored.

## 2026-10-03 Moving between tracks (V1 <-> V2, link on / off)

- User: "a track move feature, e.g. v1 <-> v2 etc., with an icon to choose whether audio moves with it or separately" - the icon is the fourth
  version's link (chain) button.
- Original clip -> layer video: the AI crop (piece crop) fitted to the window aspect in source px + tf (move, zoom, rotate) as the box. With link on,
  a sound layer clip too (vol = clip dB + piece gain); off, vhide on the V1 clip.
- Test (퍼리취향 copy, dashboard 8897): four ways of raising / lowering by right-click and drag; vhide and crop survive a reopen; lowering was
  blocked by a 0.2 px (a few ms) overlap with the previous clip -> within two frames it snaps.
  A purely vertical drag did not count as a move -> moves now accept 6 px vertical. Render: 5.5 s (link on, group saturation 0 follows) and
  16.5 s (picture only, layer video over black V1) both look the same as V1.

## 2026-10-03 Effects tab (sources / effects)

- User: "split into source / effect tabs, organise effects by category and make them draggable -> applicable to clips".
- Screen effects attach the existing scene fx (zoom, push, shake, blur) to clips - no new filter expressions. The render push formula (scale
  eval=frame overlaid on a black plate) was tested separately for size changes (1 -> 1.5x, works - the layer clip failure was a case with another
  overlay after it).
- Test (퍼리취향 copy): six drag-and-drops (screen effects refused on layer clips), preview window transform (zoom 1.2, push-in 1.135 in progress),
  save -> apply_review -> four user entries in fx.json -> render frames (zoom and blur visible), export -> review.clips fx -> three badges after
  reopening (no badge on clips whose picture moved up).
- Fixed: effects also landing on the previously selected clip besides the drop target (only together when the drop target is selected); clips
  under a transition marker not found (elementsFromPoint).
- **Bug found along the way:** reopening a project with the user edit tab visible froze load - viewerMsg, when clearing a message, also removed
  #ueEmpty, which shares the class.
- Note: after a page reload, diskAt is empty and autosave skips as "the folder is newer" (a safeguard) - test after reopening with Projects.open.
  *(Fixed in the fifth round - see below.)*

## 2026-10-03 Render settings and style aspect

- User: "in the render tab put the render button at the bottom, make every setting needed for rendering customisable - codec, quality etc. - and
  match the video: only portrait aspects for portrait video, only landscape for landscape; add an aspect choice to style apply".
- Settings take effect only in finish so the piece cache is not broken - if anything differs, the joined picture is encoded once more (one more
  generation of quality; with defaults it is copied).
- Test (퍼리취향 copy): HEVC, quality 24, 720x1280, 30 fps, 128k, -14 LUFS -> hevc_qsv chosen, ffprobe hevc/hvc1 720x1280 30/1, aac 130k, finish
  3 s (0/14 pieces re-rendered).
  -14 LUFS stopped at -15.2 - the fixed gain hit the peak ceiling (-1.5 dB) (no limiter, per the rule). Software = libx264 slow, libx265 medium.
- Containers (mov, mkv instead of mp4) were not added - the final path is hard-coded in export and in how the feedback tab finds the video, so
  changing the extension would break that (not a guess: export_shortsmith.py FINAL).

## 2026-10-03 Feedback tab merged into the AI edit tab, log pane removed, no render in the first edit either

- User: "remove the log pane, merge the feedback tab into the AI edit tab -> allow instructions on the video in the first edit too; tab name AI
  편집", "no rendering in the first edit either -> it doesn't really touch the source but should feel like editing the source ... if I want 1.5x
  zoom and it zoomed 1.6x, I can't change it".
- One instruction box (#fbPrompt = review.prompt), shared by the first edit (style apply) and re-edits. ai.js reads it when building the job
  (promptNow).
- Video before the first edit: plays the first edit-target video as a blob. A new project has no review and was not saved - dump now sends only
  instructions and notes (the server takes them as is when there is no old review).
- Test (dashboard 8897): dropping a source into a new project switches to landscape layout, a note at 3.2 s (first 0 - the previous project's PLAN
  lingered, fixed), notes survive a reload, the style apply job text (send intercepted) has aspect 16:9, the instruction and two notes; switching
  to another project kept the old source aspect and framed portrait as landscape (fixed); the video pane goes to the user edit tab and back.
  shortsmith preview background: with bg_preview removed from 퍼리취향, 540x960, 60 s, 2.3 s.
- The first-edit job text's execution principles pointed at the old pipeline (render/body.py, make_scene.py) and only said "render once at the
  end" - changed to shortsmith and preview_update.

## 2026-10-03 Timeline fifth version, README, guide

- User: tracks only as far as used, captions on video tracks, an add-caption button, one more track while dragging, audio track moves too, orange
  marker when lowering, Ctrl+Z for settings with selection kept, colour not checkable in the preview, select only the transition and drag its
  length, remove explanatory text and use words, unify reset names, more effects, AI edit "pre-render preview ..." -> 미리보기, drag files in from
  outside, README and guide.
- Test (dashboard 8897, 퍼리취향 and 모캡영도랜디 copies):
  - only V1 and A1 + captions on V2 / V3; V4 and A2 appear while dragging
  - audio lowered / raised with the orange marker both ways, caption V2 -> V3
  - add caption, selection kept after undo, transition 1 -> 2.85 s and undo
  - two outside images (timeline and source pane)
  - render: flash, vignette, horizontal flip and slide ↑ frames; the new caption burned in; the lowered span -91 dB in window.mkv, -28.7 dB in the
    final (A2 sound)
- Why the orange marker did not show when lowering: xMove drew it, then draw() rebuilt the lanes and wiped it.
- **"Colour not checkable in the preview" could not be reproduced** - on a copy of the user's project saturation 0 turned mono at once, and an RGBW
  preset measured on the same frame drawn to a canvas went red 165 -> 155, blue 245 -> 251. Static files are no-store (not cached). It may have
  been confused with the viewer not showing the selected clip when it is not under the playhead (guess) - the user was asked for the situation.
- Also: autosave kept being skipped after a reload (app.js freshenFromDisk did not fill diskAt when the times were equal).

## 2026-10-03 Dashboard audit (PR #32)

- User: "check optimisation and bugs across the board again, with other projects too; check that feedback notes on the video work properly".
- Opened 10 projects in a test store (8897): no console errors. Old projects (exported before review.clips existed) show an empty timeline - the
  message said "open a project" -> now "컷 정보 없음".
- Notes: note, region, line, arrow and curve all draw, save (autosave 20 s) and reach the job text in time order; clicking a list row seeks; the
  source mode before the first edit works. Fixed: cancelling (cancel, X, Esc) a freshly drawn note left an empty note -> it is removed (`D.modal`
  onCancel). Dropping the same file into "edit target" again stacked duplicates -> it replaces (dnd.js, key = path + size).
- **Ripple closed every gap** (`pack()` laid all clips end to end on any ripple trim, delete or insert), including the gap left when a V1 clip is
  moved up to V2, so the layer ended up over a different scene. Now `gapsOf` / `pack(G)` keep every gap except the edited one, and `shiftRest`
  moves layer clips and userCaps by the same amount (Resolve-like). Undo restores layers too (the snapshot is taken from before the drag).
- **Captions under a clip moved up to V2 were dropped** as "speech gone". Source layers now count as kept ranges for caption mapping only (`PC` in
  apply_review.py and feedback.js planScene). 야설낭독회2 copy: 4 dropped lines -> 0.
- Splitting a clip by dropping a word lost its effects and `ahide` -> the halves copy every field.
- Drag speed: 22 ms per mouse move -> about 11 ms. The inspector and words pane are not rebuilt while dragging, the ruler only when width or
  scale changes, waveform canvases are reused, and mouse moves are coalesced to one per frame.
- Renders on copies of 야설낭독회2 (damui-test-shorts: flash, sepia, slide ↑, vignette, track moves with link on and off, new caption) and 260921_합본
  (dance camera: cine colour, circle transition, horizontal flip), then export: everything survives, the added caption becomes an ordinary caption.
- Remaining explanatory sentences in the AI tab and project manager reduced to words.
- Internal docs (this file, CLAUDE.md, dashboard/README.md, tool READMEs, analysis notes) translated to English; user docs (README.md,
  docs/대시보드_가이드.md) polished in Korean (user: "polish the documents shown to users and write all the internal rule documents in English").
