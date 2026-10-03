# 담유이 (HONEYZ) editing style notes

A record of **this channel's** editing style, worked out from the existing DaVinci Resolve projects (Damyui-n*, Damui-*,
Damui-ss* etc.) and `Setting.txt`.

> General technical knowledge - Resolve / ffmpeg automation, API limits, the Whisper pipeline - is kept separately in
> [resolve-ffmpeg-automation-notes.md](resolve-ffmpeg-automation-notes.md).
> Current episodes use shortsmith presets (`presets/`); this file is the Resolve-era reference they were measured against.

## 1. Canvas and format

| Item | Value |
|---|---|
| Shorts resolution | **1080x1920 (portrait)** |
| Frame rate | **60 fps** |
| Longform reference resolution | 1920x1080 (landscape) - VOD highlight edits, a separate track from shorts |

> Many older `Damyui-n*` projects are 1920x1080, but those are longform or other uses.
> **Shorts are 1080x1920 based on the `DamuiPreset.mov` preset.**

## 2. Shorts track layout

```
V3  (top)     captions (Text+ templates, a style per speaker - see section 3)
V2            main video (scaled to the preset's video window)
V1  (bottom)  DamuiPreset.mov background frame, followed by the outro
```

- **V1 background preset:** `E:\Edit\DamUICLIP\EditVId\DamuiPreset\DamuiPreset.mov`
  - Source is portrait 1080x1920, 24 fps, about 200 s, meant for looping.
  - **Caution:** a "제목" placeholder title animates in and out during the first 0-2 s (frames 0-48 at 24 fps)
    -> **always set the in point after 2 s (48 frames)** so the empty placeholder text is never shown.
  - The frame already contains the top title area, the transparent / white "video window" in the middle, and the
    `HONEYZ` logo + `담유이` watermark at the bottom.
- **V2 main video:** auto-scaled to the preset's centre window (fit to width) -> a 16:9 source leaves the preset
  background visible above and below.
- **Outro:** appended right where the main video ends (same track as V1).
  - Latest: `E:\Edit\DamUICLIP\EditVId\DamuiPreset\DamuiEOVPreset3.mov` (1920x1080, 60 fps, about 7.47 s)
  - Older `DamuiEOVPreset.mov` and `DamuiEOVPreset2.mov` also exist (all 1920x1080 / 60 fps).

## 3. Caption and title templates (Text+ style sheet)

Source: `Setting.txt` (based on Fusion Text+ template categories; `cc` = category, `size` = normalised size,
`px/py` = normalised position).

### Shorts (reference values)

| Speaker / use | Category (cc) | size | px, py | Notes |
|---|---|---|---|---|
| 담유이 (default caption) | 여행&브이로그06 | 0.171 | 0.5, 0.25 | |
| Emphasis | 펫&키즈06 | 0.14 | 0.5, 0.25 | Text-Color `#aaffff` |
| 허츄 | 여행&브이로그07 | 0.171 | 0.5, 0.25 | Shading-Color `#ff55ff` |
| 망내 | 게임&오락02 | 0.135 | 0.5, 0.25 | |
| 로즈 | 패션&뷰티12 | 0.18 | 0.5, 0.25 | font `luxury` (Segoe UI Symbol) |
| 4포 | 게임&오락02 | 0.14 | 0.5, 0.25 | Shading-Color `#3d71ff` |
| Top title | 패션&뷰티04 | 0.204 | 0.5, 0.9 | |
| Bottom logo | honeyz로고 | scale 1,1 | px=0, py=-768 | |
| Bottom channel name | 담유이 - 슈돌20종 배민도현체 | 0.128 | 0.5, 0.75 | |

### Longform (reference - separate values)

Captions are generally smaller than in shorts (fixed around y=0.13) with more per-person styles.
A Gaussian Blur OpenFX is used on the intro. See the original `Setting.txt` for details.

### NOGARI / thumbnail

- NOGARI: each speaker name in its own colour (담유이 `#55ffff`/`#4172bc`, 망내 `#7b84a1`, 모네 `#ffaaff`/`#c66dd0`),
  font `배민 주아`, size 0.045
- Thumbnail font: `Jua`

### 3.1 Font file mapping

Font names in `Setting.txt` -> actual file -> **internal registered name** for ASS `Fontname` (may differ from the
file name). All are installed per user in `C:\Users\12612\AppData\Local\Microsoft\Windows\Fonts\`; ffmpeg finds and
renders them with no extra setup (how this was checked is in the general notes).

| Setting.txt name | File | ASS `Fontname` |
|---|---|---|
| 배민 주아 | `BMJUA_otf.otf` / `BMJUA_ttf.ttf` | `BM JUA OTF` |
| 배민 도현체 | `BMDOHYEON_ttf.ttf` | `BM DoHyeon` |
| 777별나라달님 | `777Starlandmoon.TTF` | `777Starlandmoon` |
| CookieRunOTF | `CookieRunOTF Black.OTF` / `Bold.OTF` | `CookieRunOTF Black` / `CookieRunOTF Bold` |
| Yu Gothic UI | system font | `Yu Gothic UI` |
| Segoe UI Symbol (for 로즈 luxury) | system font (`seguisym.ttf`) | `Segoe UI Symbol` |
| Jua (thumbnail) | no separate file -> use `BM JUA OTF` (effectively the same font) | `BM JUA OTF` |

> **슈돌20종 is not a font.** No font file of that name exists anywhere on the system (C: and E: included) -> most
> likely a **Resolve Text+ template pack category name**, like "여행&브이로그" or "패션&뷰티" (guess).

### 3.2 Measured Text+ template values (static layered styles, no animation)

Values measured by exporting each template from Fusion. All are static `TextPlus` nodes without keyframes (extraction
method: "Analysing Fusion Text+ templates" in the general notes). TextPlus stacks layers Element1 (fill) to Element5;
**a higher number is a layer further back (outside)**. Colours converted from 0-1 floats to 0-255 hex (reverse to BGR
for ASS).

| cc (category) | TEMPLATE_ID (pack path) | Default font | Layers (back -> front) |
|---|---|---|---|
| 여행&브이로그06 | `Edit/Titles/09. 여행&브이로그 11종/...06` | CookieRunOTF Bold | E3 glow `#05EBFD` (cyan, thickness 0.041, offset to bottom right) -> E2 outline `#00131A` (dark navy, 0.0315) -> white text |
| 여행&브이로그07 | `Edit/Titles/09. 여행&브이로그 11종/...07` | CookieRunOTF Bold | E3 glow `#FD6405` (orange, 0.041) -> E2 outline `#220E01` (dark brown, 0.031) -> white text *(overridden with Shading `#ff55ff` in Damyui projects)* |
| 펫&키즈06 | `Edit/Titles/11. 펫&키즈 11종/...06` | BM JUA_TTF Regular | E4 soft grey shadow `#555555` (thickness 0.1, very soft) -> E3/E2 blue outline `#00AAFF` -> yellow text (B=0) |
| 게임&오락02 | `Edit/Titles/10. 게임&오락 12종/...02` | Maplestory Bold | E4 navy shadow `#222F6C` (0.054, offset bottom right) -> E3 large soft outline (default colour) -> E2 cyan outline `#00FFFF` -> black text |
| 패션&뷰티12 | `Edit/Titles/06. 패션&뷰티 17종/...12` | tvN Enjoystories Bold | E4 bright red huge soft glow (blur 20,20) -> E3 pink `#FF7EC1` (0.024) -> E2 mauve `#A46DA4` |
| 패션&뷰티04 | `Edit/Titles/06. 패션&뷰티 17종/...04` | BM JUA_TTF Regular | E4 olive shadow 45% transparent (0.058, offset) -> E3 blue `#5096FF` 60% transparent (0.031) -> E2 outline (only R=0 set) |
| 패션&뷰티13 | `Edit/Titles/06. 패션&뷰티 17종/...13` | **BM DoHyeon** Regular | E3 magenta `#FF55FF` (same family as the text) -> E2 dark grey outline `#222222` (0.043) -> sky blue text `#00B8FC` |
| Memo_002 | `Edit/Titles/01. Memo Titles 30종/Memo_002` | Gong Gothic Light | a "memo box" built from rectangle layers (ElementShape 2/3): E5 dark `#191919` (outer box) -> E4 lime `#CCFF66` (accent box) -> E3 rectangle (default colour) -> E2 cyan rectangle `#00FFFF` -> near-black text `#191919` |

> **Memo_002 is a combination of rectangle (box) layers, not a simple outline**, so ASS `BorderStyle=3` (opaque box)
> alone cannot reproduce the multi-layer box - an exact copy needs rectangles drawn with `\p` vector drawing.
> The rest (outline + glow types) can be reproduced almost exactly with ASS `Outline` + `Shadow` + colours.

**Found but not matched by name:** `뭉쳐야쏜다2 MC_Point` (longform; several name combinations failed - postponed, low
priority) and `슈돌20종` (item names unknown - but Setting.txt already has the values actually used (font = 배민도현체
etc.), so the style can be built without a base preset).
`honeyz로고` is not a Text+ template but the image file `E:\Edit\DamUICLIP\Honeyz.png` (verified).

### 3.3 Finished ASS style sheet

A usable style sheet with the measured values above plus the `Setting.txt` overrides (size, position, colour) is in
[damyui_caption_styles.ass](damyui_caption_styles.ass), verified with an ffmpeg render (conversion formulas and
adjustments in the general notes). Summary:

- `TopTitle` overflowed the top of the frame at the theoretical value (`MarginV=1728`), so it was corrected by eye to `1250`.
- This channel's captions are large fonts designed for **short phrases of about 1-4 syllables** - long sentences wrap
  or leave the frame.
- No template was found for the channel name (`ChannelName`, 슈돌20종), so a basic outline style was built from the
  Setting.txt font (배민도현체) alone.
- Treat it as a **measured and verified v1 draft**, not as final - fine-tune to real line lengths.

## 4. Source and asset paths

| Use | Path |
|---|---|
| Chzzk clip sources | `E:\Edit\DamUICLIP\chzzk-clips\` |
| OBS recordings | `E:\Edit\OBS\<series>\` (e.g. 야낭0-8.mp4) |
| Preset / branding sources | `E:\Edit\DamUICLIP\EditVId\DamuiPreset\` |
| Background images | `E:\Edit\DamUICLIP\EditVId\LongBG.jpg`, `노가리BG.png` |

## 5. DaVinci Resolve project naming

- `Damyui-n###`: main edit projects numbered in sequence (higher = newer)
- `Damui-ss#`: caption / title template tests and previews (not real output, very short)
- `Damyui-p0`: clip collection project with date (YYMMDD) file names

## 6. Proper-noun hints for speech recognition

This channel's proper nouns for the Whisper `initial_prompt` and the post-processing dictionary (usage in the general
notes):

```
담유이, 허츄, 망내, 4포, 로즈, 담팬무, HONEYZ, 치지직
```

Observed misrecognitions -> corrections:

| Misheard | Correct |
|---|---|
| 아펨무 / 아킨부 / 담백무 | 담팬무 |
| 네로남부 | 내로남불 |
