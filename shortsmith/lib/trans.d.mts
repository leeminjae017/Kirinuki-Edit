export declare const XFADE: Record<string, string>;
export declare function isWipe(t?: string | null): boolean;
export declare function isSlide(t?: string | null): boolean;
export declare function isXf(t?: string | null): boolean;
export declare function transIn(t: string | null | undefined, p: number, w: number, h: number): { clip: string | undefined; dx: number; dy: number };
export declare function transOut(t: string | null | undefined, p: number, w: number, h: number): { dx: number; dy: number };
