export const animLen = (a) => (a.type === 'fade' ? a.inMs || 0 : a.wobble ? 360 : a.ms);
