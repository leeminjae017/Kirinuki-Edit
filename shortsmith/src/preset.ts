/* Preset = everything about the look. Components read only this; nothing channel-specific lives in code.
   See schema/preset.schema.json. Sizes follow the ASS convention: `size` is the line box height in px
   (ascent + descent). `lineToEm` converts it to a CSS font-size; when absent it is measured at runtime. */

export type Stroke = { width: number; color: string };
export type Shadow = { offset: number; color: string };
export type Anim =
  | { type: 'fade'; inMs?: number; outMs?: number }
  | { type: 'pop'; ms: number; peak: number; upMs?: number; wobble?: boolean };

/* Vertical gradient over the line box. y0 / y1 are fractions of `size` from the line center (negative = up).
   stops: [position 0-1 between y0 and y1, color]. Past the last stop the last color continues. */
export type Gradient = { y0: number; y1: number; stops: [number, string][] };

/* One paint pass of a caption. Passes are drawn by ascending z; spans with different looks share z levels, so
   an outline at z 1 of one word is drawn under the fill at z 3 of its neighbour - the way ASS layers stack.
   Colors may be "$color" (the caption's color, e.g. a guest color) or "$dark" (that color darkened). */
export type Paint = {
  z: number;
  dx?: number; dy?: number;
  fill?: string | Gradient;
  stroke?: Stroke;
  blur?: number;
};

export type FontDef = { family: string; file?: string | string[]; path?: string; lineToEm?: number; ascent?: number; get?: string };

export type KindDef = {
  use?: string; font: string; size: number; fill?: string;
  outline?: Stroke; shadow?: Shadow; glow?: Stroke; blur?: number;   // shorthand, turned into `look`
  look?: Paint[];
  accentColor?: string;             // whole line in the accent design (captions.accent) with this fill
  box?: { pad: number; color: string }; wrap?: [string, string];
  x?: number; y?: number;
  lines?: { maxWidth: number; maxLines: number; shrinkStep?: number; lineGap?: number };  // word-wrap inside a box
  anim: Anim;
};

/* «word|name» marks. name -> a plain fill color (markColors), an accent design built from a color, or a kind. */
export type Accent = {
  inner: { width: number; light: string; dark: string; threshold: number };  // edge next to the glyph: white on light fills, black on dark
  outer: { width: number; darken: number };                                // outer edge: the fill color darkened
  sizeScale?: number;
  gapEm?: number;          // gap before/after a marked word so its thick edge does not touch the plain text
};

export type Preset = {
  id: string; name: string; version?: number; renderer?: 'react' | 'legacy-ass';
  canvas: { width: number; height: number; fps: number };
  layout: { window: { x: number; y: number; w: number; h?: number }; face?: [number, number]; captionY: number; maxTextWidth: number; cropAspect?: number };
  brand?: { background?: { file: string; path?: string; offset?: number } | null; hostColor?: string };
  fonts: Record<string, FontDef>;
  captions: {
    defaultKind: string;
    markColors?: Record<string, string | { fill: string; outline?: string }>;
    markStyle?: 'fill' | 'accent';
    accent?: Accent;
    markKinds?: Record<string, string>;
    kinds: Record<string, KindDef>;
    speakers?: Record<string, string | null>; speakerSuffix?: Record<string, string>;
    host?: string; guestKind?: string; guests?: Record<string, { fill: string }>; guestPalette?: string[];
    rules?: Record<string, unknown>;
  };
  inserts?: { background?: string; bgScale?: number; maxW?: number; maxH?: number; maxZoom?: number; hideCaptions?: boolean };
  /* title: one line from `top`, or several lines ("\n" or " / " in the text) centered on `centerY` with `lineGap` x size
     between baselines. «word|color» marks a key word: markColors color (or keyColor), `keyScale` x size. */
  title?: { font: string; size: number; top: number; fill: string; outline?: Stroke; shadow?: Shadow; maxWidth: number;
            centerY?: number; lineGap?: number; keyScale?: number; keyColor?: string };
  chat?: {
    height: number; border: number; radius: number; borderColor: string; fill: string;
    icon?: { file: string; path?: string; box: [number, number, number, number] };
    textX: number; padRight: number; font: string; size1: number; size2: number; textColor: string;
    scale: number; y: number; maxWidth: number;
  };
  image?: { popSec: number };
  effects?: { shake?: { amp: number; hz: number; zoom: number } };
  guidance?: string[];
};

/* Old shorthand (outline / shadow / glow / fill) -> paint passes, same stacking as before. */
export function lookOf(k: KindDef): Paint[] {
  if (k.look) return k.look;
  const b = k.blur;
  const out: Paint[] = [];
  if (k.shadow) out.push({ z: 0, dx: k.shadow.offset, dy: k.shadow.offset, fill: k.shadow.color, stroke: k.outline ? { width: k.outline.width, color: k.shadow.color } : undefined, blur: b });
  if (k.glow) out.push({ z: 1, fill: k.glow.color, stroke: k.glow });
  if (k.outline) out.push({ z: 2, stroke: k.outline, blur: b });
  out.push({ z: 3, fill: k.fill || '#FFFFFF' });
  return out;
}

export const animLenMs = (a: Anim) => (a.type === 'fade' ? a.inMs || 0 : a.wobble ? 360 : a.ms);
