/* scene.json - one finished video, written by `shortsmith scene`.

   ffmpeg makes two things (cuts, crop, audio):
     body.window   the cut source video at window size (PCM audio)
     body.bg       the background at canvas size (no audio)
   Everything else - window placement, zoom, shake, mono, captions, images, chat cards, title - is described
   here and drawn by React. `style` is the resolved preset (font and file paths filled in).

   All times are output seconds. Paths are relative to the scene.json folder unless absolute. */
import type { Preset } from './preset';

export type Caption = {
  s: number; e: number; text: string;
  kind?: string;            // preset caption kind, default preset.captions.defaultKind
  x?: number; y?: number;   // text center in canvas px, default (width/2, layout.captionY)
  size?: number;
  color?: string;           // per-caption color for "$color" paints (guest colors)
  id?: string;
};

export type Overlay =
  | { type: 'image'; s: number; e: number; src: string; x: number; y: number; w: number; border?: number;
      anchor?: 'center' | 'topleft'; pop?: boolean;
      bounce?: { period: number; amp: number };
      spin?: { period: number; s: number } }        // triangle wave (constant speed), amp in px, while shown
  | { type: 'chat'; s: number; e: number; lines: string[]; x?: number; y?: number; scale?: number; maxW?: number }
  | { type: 'bubble'; s: number; e: number; box: [number, number, number, number]; radius?: number;
      tail?: [number, number][]; fill?: string; stroke?: { width: number; color: string } }
  /* full-canvas insert: a still cut from the source (src) centered and enlarged over a background image */
  | { type: 'insert'; s: number; e: number; src: string; srcW: number; srcH: number; area?: 'canvas' | 'window';
      background?: { src: string; scale?: number }; maxW: number; maxH: number; maxZoom: number };

/* hand-laid extra track clip (dashboard user edit tab): file seconds [s, e] placed at output second `at`.
   box: canvas px (video / image). vol dB, fin / fout fade seconds, color 1 = unchanged. */
export type Layer = {
  id?: string; kind: 'video' | 'image' | 'audio'; track: number; src: string; at: number; s: number; e: number;
  box?: { x: number; y: number; w: number; h: number }; opacity?: number; vol?: number; mute?: boolean; fin?: number; fout?: number;
  color?: { brightness?: number; contrast?: number; saturation?: number };
};

export type Fx =
  | { type: 'zoom'; s: number; e: number; z: number }
  | { type: 'push'; s: number; e: number; z0: number; z1: number }
  | { type: 'shake'; s: number; e: number; amp?: number; hz?: number }
  | { type: 'mono'; s: number; e: number }
  | { type: 'blur'; s: number; e: number; sigma: number };

export type Scene = {
  fps: number; width: number; height: number; duration: number;
  dir?: string;
  style: Preset;
  body: { window: string; bg?: string; windowPreview?: string; bgPreview?: string };
  window: { x: number; y: number; w: number; h: number };
  face?: [number, number];
  title?: { text: string; s?: number; e?: number } | null;
  captions: Caption[];
  overlays?: Overlay[];
  fx?: Fx[];
  layers?: Layer[];
  kinds?: Record<string, string>;
  hideCaptions?: [number, number][];     // e.g. while an insert shows the text being read
  /* Dashboard preview only: play a planned edit straight from a light copy of the whole source instead of the cut
     window video, so restored/dropped words can be heard before anything is rendered. Ranges are source seconds,
     placed back to back at output second `at`; crop is in source pixels, vol 0-1 (per-piece gain below the loudest). */
  plan?: { src: string; srcW: number; srcH: number; xf?: number;   // xf: crossfade at real cuts, like the render
           ranges: { at: number; s: number; e: number; crop: { x: number; y: number; w: number; h: number }; vol?: number;
                     color?: Layer['color'];                                 // piece colour (1 = unchanged)
                     tin?: { type: 'dissolve' | 'black' | 'white' | 'wipe' | 'slide'; d: number } }[] };   // transition into this range
};

export type Env = {
  url: (abs: string) => string;   // absolute file path -> URL (render: local server, dashboard: /api/file)
  preview?: boolean;
};

export const abs = (dir: string | undefined, p: string) =>
  /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/') ? p : (dir ? dir.replace(/[\\/]+$/, '') + '/' + p : p);

export const on = (t: number, s: number, e: number) => t >= s && t < e;
