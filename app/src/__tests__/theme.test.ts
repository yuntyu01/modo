import { ACCENTS, DEFAULT_PREFS, MAIN_ACCENTS } from '../state/prefs';
import { contrast, deepAccent, hexToRgb, rgbToHsv } from '../ui/color';
import { makeTheme } from '../ui/theme';

test('살짝 푸른 회색 테마도 그라데이션은 회색(남색이 아니다)', () => {
  for (const accent of ['#A7B0BE', '#ABAEB6', '#4B4F58', '#FFFFFF']) {
    const [r, g, b] = hexToRgb(makeTheme({ ...DEFAULT_PREFS, accent, themeMode: 'dark' }, true).gradientTop);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(8);
  }
  // 하늘색(대표색)은 남색 그라데이션 그대로
  const [r, , b] = hexToRgb(makeTheme({ ...DEFAULT_PREFS, themeMode: 'dark' }, true).gradientTop);
  expect(b - r).toBeGreaterThan(20);
});

test('꾸미기 첫 화면 4색(파랑·차콜·화이트·주황)은 전체 팔레트에도 있다', () => {
  expect(MAIN_ACCENTS).toHaveLength(4);
  for (const c of MAIN_ACCENTS) expect(ACCENTS).toContain(c);
});

test('흰 글씨 버튼 바탕은 같은 색상의 진한 쪽(흰 글씨 대비 4.5 이상), 무채색은 색이 끼지 않는다', () => {
  for (const c of ['#85ADE2', '#2C6FB8', '#B4473F', '#C8796D', '#3E8E4E', '#F2F3F5', '#1B1C20']) {
    const d = deepAccent(c);
    expect(contrast(d, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    const [h0, s0] = rgbToHsv(hexToRgb(c));
    const [h1, s1] = rgbToHsv(hexToRgb(d));
    if (s0 >= 0.15) expect(Math.abs(h1 - h0)).toBeLessThan(4);
    else expect(s1).toBeLessThan(0.15);
  }
  expect(deepAccent('#85ADE2').toUpperCase()).toBe('#4678B9');
});
