// types for lib/color.mjs (the preview imports the same file the render uses)
export type Tone = { r?: number; g?: number; b?: number; w?: number };
export type ColorTone = { lift?: Tone; gamma?: Tone; gain?: Tone; curves?: { m?: number[][]; r?: number[][]; g?: number[][]; b?: number[][] } };
export function pchip(points: number[][] | null | undefined): (x: number) => number;
export function hasTone(c: ColorTone | null | undefined): boolean;
export function chanFn(c: ColorTone, ch: 'r' | 'g' | 'b'): (x: number) => number;
export function toneTables(c: ColorTone, n?: number): { r: number[]; g: number[]; b: number[] };
export function curvesVf(c: ColorTone | null | undefined): string;
