# Edit audit tools (distilled from ten rounds of 프젝아 모캡, 2026-09-27)

Copy them into the episode folder and run them **from that folder** (they all read `edit.json`, `captions.csv`,
`src_audio.wav`, `src_level.wav` and `fin_audio.wav` from the working directory).

    cp ../../tools/edit_audit/*.py .
    ffmpeg -v error -y -i <final> -ac 1 -ar 16000 fin_audio.wav

## Before rendering - deciding where and how to cut

| Tool | Does |
|---|---|
| `speech_map.py` | full-band speech map (-52/-60, 0.30 s). **Cut only between the runs it shows** |
| `syllables.py` | sound peaks and valleys (used by the other tools). Do not try to count syllables by peaks - 8 characters gave only 3-5 |
| `align.py` | spreads characters over speech runs (DP) to get caption line times. Better than Whisper word times |
| `fit.py` | **does a caption line fit without shrinking the font, and is a two-line split lopsided** (measured with the preset font; takes the episode folder). Before writing: `fit.py <episode> "text"` |
| `cutmatch.py` | picks the cut point inside a pause where **the picture jumps least**. Difference = maximum over an 8x8 grid (an average misses an arm moving) |

## After rendering - four checks in order

| Tool | Catches |
|---|---|
| `verify_runs.py` | **did a cut eat speech** - compares speaking time per kept run in source and final |
| `scenes.py` | **does a cut run through the middle of a caption line** - whether the caption changes at each cut |
| `pauses.py` | **do groups match pauses** - whether each pause over 0.2 s is inside a line or at a line boundary |
| `check.py` | **is a caption shown over silence or starting mid-word** |

Finally **grab frames and look.** Never say "fixed" from numbers alone.

    ffmpeg -ss <sec> -i <final> -frames:v 1 -vf "crop=1080:340:0:1270,scale=420:-1" f.png

## When a word's position is disputed (the most expensive mistake)

Unvoiced fricatives (ㅅ, ㅆ, 슈, ㅎ) **do not show on the band level** - "슈" sat at -64 dB and was read as a pause.
The 3-7 kHz to 200-1500 Hz ratio rises more than +10 dB on them:

```python
S = np.abs(np.fft.rfft(a * np.hanning(n))) ** 2
hi = S[(f >= 3000) & (f < 7000)].sum(); lo = S[(f >= 200) & (f < 1500)].sum()
10 * np.log10(hi / lo)      # above 0 dB on a fricative, below -20 dB on a vowel
```

**Do not trust Whisper word times around pauses.** In this episode it placed "슈트를" at 4.32-6.38 across two runs and
1.6 s were spent in the wrong place. The real position was found from the fricative (5.92).

## Re-measure per episode first (퍼리 취향 2026-09-28)

The thresholds in these tools **differ per source.** Dropping them in and running gives false alarms. Measure these
three first and adjust:

    ffmpeg -nostats -i src_audio.wav -af ebur128 -f null -      # overall loudness
    speech / pause 20 ms RMS distribution (p5, p50, p90)         # set thresholds from this
    how many dB the band track (src_level.wav) sits above speech # `L - N` in speech_map

| Episode | Overall | speech p90 | pause p50 | speech_map threshold | band difference |
|---|---|---|---|---|---|
| 프젝아 모캡 | -28 LUFS | -19 | -64 | -52 / -60 | +6 |
| 퍼리 취향 | **-37.4 LUFS** | -34.6 | -56 | **-47 / -53** | +3.8 |

- Set `GAIN` in `verify_runs.py` to the fixed gain from the build log. Per-piece `gainDb` is subtracted by the script.
- `check.py` sets its speech threshold itself at (p5+p95)/2 - nothing to change.
- **Measure speech level per piece and even it out** (`gainDb` in `edit.json`). In 퍼리 취향, piece 3 was 4.5 dB lower than
  the rest and "나 믿는다" was buried. One gain per piece, not loudnorm (no filters on audio).
- **After editing `edit.json`, run `cuts` separately.** `build` uses the existing `cuts.json` - adding `gainDb` and
  running only build rendered it quiet again (퍼리 취향, first round).

## Spots without captions (퍼리 취향 re-edit 3, 2026-09-28)

When the user asks to delete a caption line, **leave that spot empty.** Stretching the lines before or after over it puts
captions on top of other speech. A line ends at most **at its own piece end + 0.10 s** (just enough not to flicker at the
cut). `scenes.py` does not count cuts through caption-free spots or 0.10 s overhangs as faults.
