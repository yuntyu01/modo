import { daysBetween, firstOnOrAfter, matchesRule, nextDue, shiftTime } from '../repeat';

// 2026-10-16은 금요일
const MON = 1, WED = 4, FRI = 16, THU = 8;

test('매일: 오늘 한 것은 내일, 밀린 것은 오늘 뒤로', () => {
  const r = { freq: 'daily' as const, days: null };
  expect(nextDue(r, '2026-10-16', '2026-10-16')).toBe('2026-10-17');
  expect(nextDue(r, '2026-10-10', '2026-10-16')).toBe('2026-10-17');
  // 미리 한 것은 그 예정일 다음 날
  expect(nextDue(r, '2026-10-20', '2026-10-16')).toBe('2026-10-21');
});

test('매주 월·수·금: 금요일에 하면 다음 월요일', () => {
  const r = { freq: 'weekly' as const, days: MON | WED | FRI };
  expect(nextDue(r, '2026-10-16', '2026-10-16')).toBe('2026-10-19');
  expect(nextDue(r, '2026-10-19', '2026-10-19')).toBe('2026-10-21');
  expect(firstOnOrAfter(r, '2026-10-17')).toBe('2026-10-19');
  expect(firstOnOrAfter(r, '2026-10-16')).toBe('2026-10-16');
});

test('매주 목요일 하나', () => {
  const r = { freq: 'weekly' as const, days: THU };
  expect(firstOnOrAfter(r, '2026-10-16')).toBe('2026-10-22');
  expect(nextDue(r, '2026-10-22', '2026-10-22')).toBe('2026-10-29');
});

test('매월: 같은 날, 없는 날은 그 달 마지막 날', () => {
  const r = { freq: 'monthly' as const, days: null };
  expect(nextDue(r, '2026-10-16', '2026-10-16')).toBe('2026-11-16');
  expect(nextDue(r, '2026-01-31', '2026-01-31')).toBe('2026-02-28');
  expect(matchesRule(r, '2026-02-28', '2026-01-31')).toBe(true);
  expect(matchesRule(r, '2026-02-27', '2026-01-31')).toBe(false);
});

test('날 수와 알림 옮기기(현지 시각 유지)', () => {
  expect(daysBetween('2026-10-16', '2026-10-19')).toBe(3);
  expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  const at = new Date(2026, 9, 16, 21, 30).getTime();
  const moved = new Date(shiftTime(at, 3));
  expect([moved.getDate(), moved.getHours(), moved.getMinutes()]).toEqual([19, 21, 30]);
});
