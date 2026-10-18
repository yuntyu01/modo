import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BRAND } from '../brand';
import { ACCENTS, DEFAULT_PREFS, MAIN_ACCENTS, mergePrefs } from '../state/prefs';

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

// JS를 읽지 못하는 곳(휴대폰 위젯)에 따로 적어 둔 대표색. src/brand.ts를 바꾸면 여기 적힌 곳도 같이 바꾼다.
const COPIES: [string, RegExp][] = [
  ['modules/modo-native/android/src/main/res/values/colors.xml', /name="modo_brand">#FF([0-9A-F]{6})</i],
  ['modules/modo-native/android/src/main/java/com/yuntyu01/naegirok/SurfaceTheme.kt', /const val BRAND = "#([0-9A-F]{6})"/i],
  ['targets/widget/Widgets.swift', /static let brand = "#([0-9A-F]{6})"/i],
  ['targets/widget/expo-target.config.js', /\$accent: '#([0-9A-F]{6})'/i],
];

test.each(COPIES)('%s의 대표색이 src/brand.ts와 같다', (file, re) => {
  expect('#' + read(file).match(re)?.[1].toUpperCase()).toBe(BRAND.toUpperCase());
});

test('기본 강조색과 색 목록 맨 앞은 대표색', () => {
  expect(DEFAULT_PREFS.accent).toBe(BRAND);
  expect(ACCENTS[0]).toBe(BRAND);
  expect(MAIN_ACCENTS[0]).toBe(BRAND);
});

test('예전 기본색을 쓰던 설정은 대표색으로 바뀐다', () => {
  const p = mergePrefs({ accent: '#96D3FD', mini: { linked: false, accent: '#72cdf4', card: null, opacity: 0.8 } });
  expect(p.accent).toBe(BRAND);
  expect(p.mini.accent).toBe(BRAND);
  expect(mergePrefs({ accent: '#FF7F6B' }).accent).toBe('#FF7F6B');
  expect(mergePrefs({ accent: BRAND }).accent).toBe(BRAND);
});
