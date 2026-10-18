import { BRAND } from '../brand';
import { MAIN_ACCENTS } from '../state/prefs';
import { recommendedAccents, withCurrent } from '../state/popularThemes';

const picks = MAIN_ACCENTS.slice(1, 4);

test('데이터가 모이기 전에는 기본 하늘색 + 정해 둔 추천색', () => {
  expect(recommendedAccents(null)).toEqual([BRAND, ...picks]);
  // 총 계정 수가 적으면 인기색을 쓰지 않는다
  expect(recommendedAccents({ day: 'x', total: 10, themes: [{ id: '#FF7F6B', users: 8 }] })).toEqual([BRAND, ...picks]);
});

test('충분히 모이면 기본 하늘색은 그대로, 나머지 셋을 인기색으로(앱 색 목록에 있는 것만, 모자라면 추천색으로 채움)', () => {
  const pop = {
    day: 'x',
    total: 100,
    themes: [
      { id: BRAND, users: 40 }, // 기본 하늘색은 맨 앞에 이미 있다
      { id: '#123456', users: 30 }, // 직접 고른 색은 추천하지 않는다
      { id: '#FF7F6B', users: 20 },
      { id: '#5FD38D', users: 6 },
      { id: '#B79CFF', users: 2 }, // 너무 적게 쓰인 색은 빼고
    ],
  };
  expect(recommendedAccents(pop)).toEqual([BRAND, '#FF7F6B', '#5FD38D', picks[0]]);
});

test('지금 쓰는 색은 추천에 없어도 마지막 자리에 보인다', () => {
  const base = [BRAND, ...picks];
  expect(withCurrent(base, picks[1])).toEqual(base);
  expect(withCurrent(base, '#ff7f6b')).toEqual([BRAND, picks[0], picks[1], '#FF7F6B']);
});
