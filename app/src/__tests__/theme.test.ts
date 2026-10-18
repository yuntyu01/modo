import { ACCENTS, DEFAULT_PREFS, MAIN_ACCENTS } from '../state/prefs';
import { hexToRgb } from '../ui/color';
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
