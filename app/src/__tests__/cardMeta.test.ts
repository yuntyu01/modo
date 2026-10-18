import { cardDate, cardLate, cardTime, cardWhen, daysLate, repeatShort } from '../ui/format';

const now = new Date(2026, 9, 18, 9, 0); // 2026-10-18(일) 오전 9시
const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).getTime();

test('반복 주기는 아이콘 옆이라 짧게(의미가 분명한 데까지)', () => {
  expect(repeatShort({ freq: 'daily', days: null }, 'ko', null)).toBe('매일');
  expect(repeatShort({ freq: 'weekly', days: 1 | 4 | 16 }, 'ko', null)).toBe('월·수·금');
  expect(repeatShort({ freq: 'weekly', days: 31 }, 'ko', null)).toBe('평일');
  expect(repeatShort({ freq: 'weekly', days: 96 }, 'ko', null)).toBe('주말');
  expect(repeatShort({ freq: 'weekly', days: 127 }, 'ko', null)).toBe('매일');
  // 하루만이면 날짜로 읽히지 않게 '매주'를 남긴다
  expect(repeatShort({ freq: 'weekly', days: 8 }, 'ko', null)).toBe('매주 목요일');
  expect(repeatShort({ freq: 'monthly', days: null }, 'ko', '2026-10-16')).toBe('매월 16일');
  expect(repeatShort({ freq: 'weekly', days: 1 | 4 | 16 }, 'en', null)).toBe('Mon·Wed·Fri');
});

test('날짜: 오늘·내일은 말로, 올해는 월·일, 다른 해는 연도까지(요일 없이)', () => {
  expect(cardDate('2026-10-18', 'ko', now)).toBe('오늘');
  expect(cardDate('2026-10-19', 'ko', now)).toBe('내일');
  expect(cardDate('2026-10-21', 'ko', now)).toBe('10월 21일');
  expect(cardDate('2026-10-17', 'ko', now)).toBe('10월 17일');
  expect(cardDate('2027-01-03', 'ko', now)).toBe('2027년 1월 3일');
  expect(cardDate('2026-10-19', 'en', now)).toBe('Tomorrow');
  expect(cardDate('2026-10-21', 'en', now)).toBe('Oct 21');
});

test('시간: 오전·오후 12시간제', () => {
  expect(cardTime(at(2026, 10, 19, 20), 'ko')).toBe('오후 8:00');
  expect(cardTime(at(2026, 10, 19, 9, 5), 'ko')).toBe('오전 9:05');
  expect(cardTime(at(2026, 10, 19, 12), 'ko')).toBe('오후 12:00');
  expect(cardTime(at(2026, 10, 19, 0, 30), 'ko')).toBe('오전 12:30');
  expect(cardTime(at(2026, 10, 19, 17), 'en')).toBe('5:00 PM');
});

test('날짜·시간 한 덩어리: 없는 것은 빼고, 시간은 정했을 때만', () => {
  expect(cardWhen({ due_date: null, remind_at: null }, 'ko', { now })).toBeNull();
  expect(cardWhen({ due_date: '2026-10-18', remind_at: null }, 'ko', { now })).toBe('오늘');
  expect(cardWhen({ due_date: '2026-10-19', remind_at: at(2026, 10, 19, 17) }, 'ko', { now })).toBe('내일 오후 5:00');
  // 날짜 없이 알림만: 알림 날짜로
  expect(cardWhen({ due_date: null, remind_at: at(2026, 10, 19, 17) }, 'ko', { now })).toBe('내일 오후 5:00');
  // 알림이 다른 날: 예정일 · 알림 날짜와 시간
  expect(cardWhen({ due_date: '2026-10-19', remind_at: at(2026, 10, 20, 8) }, 'ko', { now })).toBe('내일 · 10월 20일 오전 8:00');
  // 캘린더(날짜는 고른 날이라 뺀다): 시간만, 없으면 아무것도
  expect(cardWhen({ due_date: '2026-10-19', remind_at: at(2026, 10, 19, 20) }, 'ko', { now, hideDate: true })).toBe('오후 8:00');
  expect(cardWhen({ due_date: '2026-10-19', remind_at: null }, 'ko', { now, hideDate: true })).toBeNull();
});

test('기한이 지난 날 수: 오늘·앞날은 없고, 어제부터 1일 지남', () => {
  expect(cardLate('2026-10-18', 'ko', now)).toBeNull();
  expect(cardLate('2026-10-19', 'ko', now)).toBeNull();
  expect(cardLate('2026-10-17', 'ko', now)).toBe('1일 지남');
  expect(cardLate('2026-10-16', 'ko', now)).toBe('2일 지남');
  // 달·해를 넘어도 달력 날짜 차이
  expect(daysLate('2026-09-30', now)).toBe(18);
  expect(daysLate('2025-10-18', now)).toBe(365);
  // 밤 늦게(23:59)도 같은 날로 센다
  expect(daysLate('2026-10-17', new Date(2026, 9, 18, 23, 59))).toBe(1);
  expect(cardLate('2026-10-17', 'en', now)).toBe('1 day overdue');
  expect(cardLate('2026-10-16', 'en', now)).toBe('2 days overdue');
  expect(cardLate('2026-10-16', 'ja', now)).toBe('2日経過');
  expect(cardLate('2026-10-16', 'zh', now)).toBe('逾期2天');
});
