export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) || 0) as RGB;
}

export function rgbToHex([r, g, b]: RGB) {
  return '#' + [r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
}

export function rgbToHsv([r, g, b]: RGB): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

export function hsvToRgb(h: number, s: number, v: number): RGB {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export function mix(a: string, b: string, t: number) {
  const [x, y] = [hexToRgb(a), hexToRgb(b)];
  return rgbToHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as RGB);
}

export function withAlpha(hex: string, alpha: number) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function isHex(s: string) {
  return /^#?[0-9a-fA-F]{6}$/.test(s.trim());
}

/** WCAG 상대 휘도 */
export function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/**
 * 흰 글씨를 올리는 테마색 버튼 바탕: 같은 색상(hue)에서 채도를 조금 올리고 밝기를 내려 흰 글씨 대비 4.5 이상(기본 파랑 → #4678B9).
 * 회색·흰색·검정 같은 무채색은 채도를 더하지 않고 어둡게만(다른 색이 끼지 않게). 사용자 요청 2026-10-21(친구 추가 버튼)
 */
export function deepAccent(hex: string) {
  const [h, s0, v0] = rgbToHsv(hexToRgb(hex));
  const s = s0 < 0.15 ? s0 : Math.max(s0, 0.62);
  for (let v = v0; v > 0; v -= 0.01) {
    const c = rgbToHex(hsvToRgb(h, s, v));
    if (contrast(c, '#FFFFFF') >= 4.5) return c;
  }
  return '#1B1C20';
}

/** 배경 위에서 보이도록(대비 min 이상) 색을 흰색/검은색 쪽으로 조금씩 옮긴다. */
export function ensureContrast(color: string, bg: string, min = 3) {
  const toward = luminance(bg) < 0.5 ? '#FFFFFF' : '#000000';
  let c = color;
  for (let i = 1; i <= 20 && contrast(c, bg) < min; i++) c = mix(color, toward, i * 0.05);
  return c;
}
