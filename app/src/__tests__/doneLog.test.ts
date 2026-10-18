import { addDoneDay, parseDoneLog, removeDoneDay } from '../core/doneLog';

test('한 날 기록: 정렬·중복 없이 더하고 빼기', () => {
  expect(addDoneDay(null, '2026-10-19')).toBe('2026-10-19');
  expect(addDoneDay('2026-10-19', '2026-10-17')).toBe('2026-10-17,2026-10-19');
  expect(addDoneDay('2026-10-19', '2026-10-19')).toBe('2026-10-19');
  expect(removeDoneDay('2026-10-17,2026-10-19', '2026-10-17')).toBe('2026-10-19');
  expect(removeDoneDay('2026-10-19', '2026-10-19')).toBeNull();
  expect(parseDoneLog('2026-10-19,bad,2026-10-20')).toEqual(['2026-10-19', '2026-10-20']);
});
