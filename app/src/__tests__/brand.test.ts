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

test('체크 위치는 처음 설치하면 오른쪽, 이미 저장된 설정은 그대로', () => {
  expect(mergePrefs(null).checkSide).toBe('right');
  expect(mergePrefs({ checkSide: 'left' }).checkSide).toBe('left');
  expect(mergePrefs({ accent: BRAND }).checkSide).toBe('right');
});

test('위젯·미니창 투명도: 기본은 투명 20%(불투명 0.8), 완전 투명(0)·완전 불투명(1)도 그대로 남는다', () => {
  // 위젯은 홈·잠금화면 모두 투명도 60%(불투명도 0.4)가 기본, 미니창은 20%
  expect(mergePrefs(null).widget.opacity).toBe(0.4);
  expect(mergePrefs(null).lockWidget.opacity).toBe(0.4);
  expect(mergePrefs(null).mini.opacity).toBe(0.8);
  // 예전 기본(0.8)을 그대로 두던 홈 위젯은 한 번 새 기본으로, 직접 고른 값은 그대로
  const old = { linked: true, accent: BRAND, card: null };
  expect(mergePrefs({ prefsVersion: 2, widget: { ...old, opacity: 0.8 } }).widget.opacity).toBe(0.4);
  expect(mergePrefs({ prefsVersion: 2, widget: { ...old, opacity: 0.55 } }).widget.opacity).toBe(0.55);
  expect(mergePrefs({ prefsVersion: 3, widget: { ...old, opacity: 0.8 } }).widget.opacity).toBe(0.8);
  const w = { linked: true, accent: BRAND, card: null, opacity: 0 };
  const p = mergePrefs({ prefsVersion: 3, widget: w, mini: { ...w, opacity: 1 } });
  expect([p.widget.opacity, p.mini.opacity]).toEqual([0, 1]);
});

test('잠금화면 위젯 설정은 따로: 예전엔 홈 위젯 색 + 위젯 설정의 lockOpacity·lockCheckSide였다(처음 한 번 그대로 옮긴다)', () => {
  const home = { linked: false, accent: '#FF8A3D', card: '#2A2A2C', opacity: 0.6, checkSide: 'left' as const };
  // 예전 저장: 잠금화면은 홈 위젯 색, 투명도·체크 위치만 따로
  const p = mergePrefs({ prefsVersion: 3, widget: { ...home, lockOpacity: 0.2, lockCheckSide: 'right' } });
  expect(p.lockWidget).toEqual({ linked: false, accent: '#FF8A3D', card: '#2A2A2C', opacity: 0.2, checkSide: 'right' });
  // 잠금 투명도를 고친 적 없으면 기본(0.4), 체크 위치는 공통을 따른다(값 없음)
  const q = mergePrefs({ prefsVersion: 3, widget: home });
  expect([q.lockWidget.opacity, q.lockWidget.checkSide, q.lockWidget.accent]).toEqual([0.4, undefined, '#FF8A3D']);
  // 이미 따로 저장돼 있으면 그대로
  const r = mergePrefs({ prefsVersion: 3, widget: home, lockWidget: { linked: true, accent: BRAND, card: null, opacity: 0.9 } });
  expect([r.lockWidget.linked, r.lockWidget.opacity]).toEqual([true, 0.9]);
});
