// 반복 할 일의 날짜 규칙. Android(NotesDb.kt)·iOS(NotesStore.swift)도 같은 규칙으로 계산한다(바꾸면 함께 바꿀 것).
// 반복 할 일은 due_date가 '다음 예정일'이다(처음엔 시작일). 그날부터 보이고, 완료하면 done_at을 남기지 않고
// due_date를 규칙에 맞는 다음 날로 넘긴다(그날 다시 보인다).
// - 매일: 하루 뒤
// - 매주: repeat_days 비트(월=1, 화=2, 수=4, 목=8, 금=16, 토=32, 일=64)의 다음 요일. 비어 있으면 기준일의 요일
// - 매월: 기준일(지금 예정일)과 같은 날. 그 달에 없는 날(31일 등)은 그 달 마지막 날

export type RepeatFreq = 'daily' | 'weekly' | 'monthly';
export type RepeatRule = { freq: RepeatFreq; days: number | null };

export const ALL_DAYS = 127;

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export function addDays(date: string, n: number) {
  const d = parse(date);
  d.setDate(d.getDate() + n);
  return fmt(d);
}

/** 두 날짜 사이 날 수(b - a). 서머타임이 있어도 맞게 정오 기준으로 센다. */
export function daysBetween(a: string, b: string) {
  const x = parse(a);
  const y = parse(b);
  x.setHours(12);
  y.setHours(12);
  return Math.round((y.getTime() - x.getTime()) / 86400000);
}

/** 월=0 … 일=6 */
export function weekdayIndex(date: string) {
  return (parse(date).getDay() + 6) % 7;
}

export const dayBit = (date: string) => 1 << weekdayIndex(date);

/** anchor: 매월의 날짜, 매주 요일이 비었을 때의 요일을 정하는 기준일 */
export function matchesRule(rule: RepeatRule, date: string, anchor: string) {
  if (rule.freq === 'daily') return true;
  if (rule.freq === 'weekly') return ((rule.days || dayBit(anchor)) & dayBit(date)) !== 0;
  const d = parse(date);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return d.getDate() === Math.min(parse(anchor).getDate(), last);
}

/** start 당일 또는 그 뒤 첫 예정일(반복을 처음 정할 때) */
export function firstOnOrAfter(rule: RepeatRule, start: string) {
  for (let i = 0; i < 400; i++) {
    const d = addDays(start, i);
    if (matchesRule(rule, d, start)) return d;
  }
  return start;
}

/** after 다음 날부터 찾은 첫 예정일 */
export function nextAfter(rule: RepeatRule, after: string, anchor: string) {
  for (let i = 1; i < 400; i++) {
    const d = addDays(after, i);
    if (matchesRule(rule, d, anchor)) return d;
  }
  return addDays(after, 1);
}

/**
 * 완료했을 때의 다음 예정일. 밀린 날은 건너뛰고(오늘 뒤), 미리 한 것이면 그 예정일 뒤로.
 * due가 없으면(동기화 중 어긋난 경우) 오늘을 기준으로 한다.
 */
export function nextDue(rule: RepeatRule, due: string | null, today: string) {
  const anchor = due ?? today;
  return nextAfter(rule, due && due > today ? due : today, anchor);
}

/** 알림 시각을 같은 현지 시각 그대로 n일 옮긴다 */
export function shiftTime(ms: number, days: number) {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

export function ruleOf(t: { repeat_freq: RepeatFreq | null; repeat_days: number | null }): RepeatRule | null {
  return t.repeat_freq ? { freq: t.repeat_freq, days: t.repeat_freq === 'weekly' ? t.repeat_days : null } : null;
}
