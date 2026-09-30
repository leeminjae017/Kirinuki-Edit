import React from 'react';
import type { Caption } from '../scene';
import { lookOf, type Accent, type Gradient, type KindDef, type Paint, type Preset } from '../preset';
import { metrics, textWidth } from '../fonts';

/* A caption is drawn as stacked paint passes (see Paint in preset.ts). Each word span has its own look, and all
   spans share the z levels, which reproduces how libass stacks shadow < outline < fill inside one event and how
   separate ASS layers stack on top. Outlines are round-joined strokes of twice the ASS width. */
const MARK = /«(.+?)\|([A-Za-z]+)»/g;
export const stripMarks = (t: string) => t.replace(MARK, '$1');

type Span = { t: string; look: Paint[]; scale: number; mark?: boolean; dx?: number };

const hex = (c: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  return m ? parseInt(m[1], 16) : null;
};
const toHex = (n: number) => '#' + n.toString(16).padStart(6, '0').toUpperCase();
export function darken(c: string, f: number) {
  const n = hex(c);
  if (n === null) return c;
  return toHex((Math.floor(((n >> 16) & 255) * f) << 16) | (Math.floor(((n >> 8) & 255) * f) << 8) | Math.floor((n & 255) * f));
}
function luminance(c: string) {
  const n = hex(c) ?? 0xffffff;
  const ch = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

/* Accent design (user-defined, 삼성 2026-09-13): fill color, thin inner edge (white on light fills, black on dark),
   thicker outer edge in the fill color darkened. Two ASS layers: outer edge + fill, then inner edge + fill. */
function accentLook(color: string, A: Accent): Paint[] {
  const inner = luminance(color) >= A.inner.threshold ? A.inner.light : A.inner.dark;
  return [
    { z: 2, stroke: { width: A.outer.width, color: darken(color, A.outer.darken) } },
    { z: 3, fill: color },
    { z: 4, stroke: { width: A.inner.width, color: inner } },
    { z: 5, fill: color },
  ];
}

function kindLook(k: KindDef, style: Preset): Paint[] {
  if (k.accentColor && style.captions.accent) return accentLook(k.accentColor, style.captions.accent);
  return lookOf(k);
}

function spans(text: string, k: KindDef, style: Preset): Span[] {
  const C = style.captions, base = kindLook(k, style);
  const out: Span[] = [];
  let last = 0;
  for (const m of text.matchAll(MARK)) {
    if (m.index! > last) out.push({ t: text.slice(last, m.index), look: base, scale: 1 });
    const name = m[2], kindName = C.markKinds?.[name];
    if (kindName && C.kinds[kindName]) {
      out.push({ t: m[1], look: kindLook(C.kinds[kindName], style), scale: 1, mark: true });
    } else {
      const mc = C.markColors?.[name];
      const color = typeof mc === 'string' ? mc : mc?.fill;
      if (!color) out.push({ t: m[1], look: base, scale: 1 });
      else if (C.markStyle === 'accent' && C.accent) out.push({ t: m[1], look: accentLook(color, C.accent), scale: C.accent.sizeScale ?? 1, mark: true });
      else {
        // plain mark: swap the fill of the fill pass; an {fill, outline} pair also recolors the outline pass
        const edge = typeof mc === 'object' ? mc.outline : undefined;
        out.push({ t: m[1], scale: 1, mark: true, look: base.map((p) => {
          if (p.fill && !p.dx && !p.dy && !p.stroke) return { ...p, fill: color };
          if (edge && p.stroke && !p.fill && !p.dx) return { ...p, stroke: { ...p.stroke, color: edge } };
          return p;
        }) });
      }
    }
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last), look: base, scale: 1 });
  // 표시한 낱말은 테두리가 두꺼워 옆 글자에 붙어 보인다 (사용자 2026-09-28 "강조와 비 강조 부분이 너무 붙음").
  // 그 낱말 앞뒤로 틈을 준다 (em, accent.gapEm). 줄 가운데 맞추기는 CaptionView 에서 틈만큼 되돌린다.
  const gap = C.accent?.gapEm ?? 0;
  if (gap) out.forEach((sp, i) => {
    if (!sp.mark) return;
    if (i > 0) sp.dx = (sp.dx || 0) + gap;
    if (out[i + 1] && !out[i + 1].mark) out[i + 1].dx = (out[i + 1].dx || 0) + gap;
  });
  return out;
}

const clamp01 = (u: number) => Math.max(0, Math.min(1, u));
const passKey = (p: Paint) => `${p.z}|${p.dx || 0}|${p.dy || 0}|${p.blur || 0}`;

function wrapWords(text: string, family: string, css: number, maxW: number, maxLines: number) {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (cur && textWidth(stripMarks(next), family, css) > maxW) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length <= maxLines ? lines : null;
}

export const CaptionView: React.FC<{ c: Caption; t: number; style: Preset; width: number; uid: string }> = ({ c, t, style, width, uid }) => {
  const C = style.captions;
  const k = C.kinds[c.kind || C.defaultKind] || C.kinds[C.defaultKind];
  const f = style.fonts[k.font];
  const { lineToEm, ascent } = metrics(f);
  const raw = k.wrap ? k.wrap[0] + c.text + k.wrap[1] : c.text;
  let size = c.size || k.size;

  // lines: explicit \n, or word-wrap inside a box (shrink until it fits), else one line shrunk to maxTextWidth
  let lines = raw.split('\n');
  if (k.lines) {
    for (let s = size; s >= 20; s -= k.lines.shrinkStep || 5) {
      const w = wrapWords(raw, f.family, s * lineToEm, k.lines.maxWidth, k.lines.maxLines);
      if (w) { lines = w; size = s; break; }
    }
  } else {
    const maxW = style.layout.maxTextWidth;
    const w0 = Math.max(...lines.map((l) => textWidth(stripMarks(l), f.family, size * lineToEm)));
    if (w0 > maxW) size = Math.floor(size * maxW / w0);
  }
  const css = size * lineToEm;
  const x = c.x ?? k.x ?? width / 2, y = c.y ?? k.y ?? style.layout.captionY;

  const ms = (t - c.s) * 1000, left = (c.e - t) * 1000;
  let opacity = 1, scale = 1, rot = 0;
  const a = k.anim;
  if (a.type === 'fade') {
    if (a.inMs) opacity = Math.min(opacity, clamp01(ms / a.inMs));
    if (a.outMs) opacity = Math.min(opacity, clamp01(left / a.outMs));
  } else {
    const up = a.upMs ?? a.ms * 0.6;
    scale = ms < up ? a.peak * clamp01(ms / up) : ms < a.ms ? a.peak + (1 - a.peak) * clamp01((ms - up) / (a.ms - up)) : 1;
    if (a.wobble) {   // degrees clockwise: -6 -> 5 -> -3 -> 0 over 360ms (ASS frz sign flipped)
      const frz = ms < 120 ? -6 + 11 * ms / 120 : ms < 240 ? 5 - 8 * (ms - 120) / 120 : ms < 360 ? -3 + 3 * (ms - 240) / 120 : 0;
      rot = -frz;
    }
  }

  const sub = (col: string) => (col === '$color' ? c.color || k.fill || '#FFFFFF' : col === '$dark' ? darken(c.color || k.fill || '#FFFFFF', 0.6) : col);
  const lineSpans = lines.map((l) => spans(l, k, style));
  const passes = new Map<string, Paint>();
  lineSpans.flat().forEach((sp) => sp.look.forEach((p) => { if (!passes.has(passKey(p))) passes.set(passKey(p), p); }));
  const order = [...passes.values()].sort((p, q) => p.z - q.z);
  const gap = k.lines?.lineGap ?? 1.0;
  const n = lines.length;
  const baseY = (i: number) => size * (ascent - 0.5) + (i - (n - 1) / 2) * size * gap;

  const defs: React.ReactNode[] = [];
  const paintRef = (p: Paint, pi: number, si: string) => {
    if (!p.fill) return 'none';
    if (typeof p.fill === 'string') return sub(p.fill);
    const g = p.fill as Gradient, id = `${uid}-g${pi}-${si}`;
    defs.push(
      <linearGradient key={id} id={id} gradientUnits="userSpaceOnUse" x1={0} x2={0} y1={g.y0 * size} y2={g.y1 * size}>
        {g.stops.map(([o, col], j) => <stop key={j} offset={o} stopColor={sub(col)} />)}
      </linearGradient>);
    return `url(#${id})`;
  };
  const blurs = [...new Set(order.map((p) => p.blur || 0).filter(Boolean))];
  blurs.forEach((b) => defs.push(
    <filter key={`b${b}`} id={`${uid}-b${b}`} x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation={b * 0.5} /></filter>));

  const box = k.box && (() => {
    const w = Math.min(Math.max(...lines.map((l) => textWidth(stripMarks(l), f.family, css))), style.layout.maxTextWidth);
    return <rect x={-w / 2 - k.box.pad} y={-size * n / 2 - k.box.pad} width={w + 2 * k.box.pad} height={size * n + 2 * k.box.pad} fill={k.box.color} />;
  })();

  const body = order.map((p, pi) => (
    <g key={pi} filter={p.blur ? `url(#${uid}-b${p.blur})` : undefined}>
      {lineSpans.map((sps, li) => (
        <text key={li} x={(p.dx || 0) - css * sps.reduce((a, sp) => a + (sp.dx || 0), 0) / 2} y={baseY(li) + (p.dy || 0)} textAnchor="middle" fontFamily={`"${f.family}"`} fontSize={css}
          strokeLinejoin="round" strokeLinecap="round">
          {sps.map((sp, si) => {
            const own = sp.look.find((q) => passKey(q) === passKey(p));
            const fill = own ? paintRef(own, pi, `${li}-${si}`) : 'none';
            return (
              <tspan key={si} fill={fill} dx={sp.dx ? css * sp.dx : undefined} fontSize={sp.scale !== 1 ? css * sp.scale : undefined}
                stroke={own?.stroke ? sub(own.stroke.color) : undefined} strokeWidth={own?.stroke ? 2 * own.stroke.width : undefined}>
                {sp.t}
              </tspan>
            );
          })}
        </text>
      ))}
    </g>
  ));

  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${scale})`} opacity={opacity}>
      {defs.length ? <defs>{defs}</defs> : null}
      {box}
      {body}
    </g>
  );
};

export const TitleView: React.FC<{ text: string; style: Preset; width: number }> = ({ text, style, width }) => {
  const T = style.title;
  if (!T) return null;
  const f = style.fonts[T.font];
  const { lineToEm, ascent } = metrics(f);
  /* Lines: "\n" or " / ". Each line is spans; a «word|color» span is the key word - its own color, keyScale x size
     (the 다음 생 · 삼성 사본 titles, 2026-09-14: 핵심 낱말만 색 · 살짝 크게). A line wider than maxWidth shrinks as a whole. */
  const colors = style.captions.markColors || {};
  const lines = text.split(/\n| \/ /).map((ln) => {
    const out: { t: string; key?: string }[] = [];
    let last = 0;
    for (const m of ln.matchAll(MARK)) {
      if (m.index! > last) out.push({ t: ln.slice(last, m.index) });
      const mc = colors[m[2]];
      out.push({ t: m[1], key: (typeof mc === 'string' ? mc : mc?.fill) || T.keyColor || '#FFD23F' });
      last = m.index! + m[0].length;
    }
    if (last < ln.length) out.push({ t: ln.slice(last) });
    return out;
  });
  const ks = T.keyScale ?? 1.15;
  const sized = lines.map((sp) => {
    const w = sp.reduce((a, x) => a + textWidth(x.t, f.family, T.size * (x.key ? ks : 1) * lineToEm), 0);
    return { sp, size: w > T.maxWidth ? Math.max(40, Math.floor(T.size * T.maxWidth / w)) : T.size };
  });
  const pitch = T.size * (T.lineGap ?? 1.13);
  const multi = sized.length > 1 || T.centerY != null;
  const cy0 = (T.centerY ?? T.top + T.size * ascent / 2) - (pitch * (sized.length - 1)) / 2;
  const baseOf = (i: number, size: number) => multi ? cy0 + i * pitch + (size * ascent) / 2 : T.top + size * ascent;
  const layer = (dx: number, paint: (key?: string) => { fill: string; stroke?: string; sw?: number }) => sized.map(({ sp, size }, i) => (
    <text key={i} x={width / 2 + dx} y={baseOf(i, size) + dx} textAnchor="middle" fontFamily={`"${f.family}"`}
      fontSize={size * lineToEm} strokeLinejoin="round">
      {sp.map((x, k) => {
        const p = paint(x.key);
        return <tspan key={k} fontSize={size * (x.key ? ks : 1) * lineToEm} fill={p.fill} stroke={p.stroke} strokeWidth={p.sw || 0}>{x.t}</tspan>;
      })}
    </text>
  ));
  const sw = T.outline ? 2 * T.outline.width : 0;
  return (
    <g>
      {T.shadow && layer(T.shadow.offset, () => ({ fill: T.shadow!.color, stroke: T.outline ? T.shadow!.color : undefined, sw }))}
      {T.outline && layer(0, () => ({ fill: 'none', stroke: T.outline!.color, sw }))}
      {layer(0, (key) => ({ fill: key || T.fill }))}
    </g>
  );
};
