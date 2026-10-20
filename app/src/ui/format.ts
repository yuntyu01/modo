import { ALL_DAYS, dayBit, fmt, parse, type RepeatRule } from '../core/repeat';
import type { Lang } from '../i18n';

const pad = (n: number) => String(n).padStart(2, '0');

/** 현지 날짜 'YYYY-MM-DD'(코어 repeat.ts와 같은 것) */
export const localDate = fmt;
/** 'YYYY-MM-DD' → 그날 0시(현지) */
export const parseLocalDate = parse;

// 날짜 표기는 언어마다 직접 정한다(Hermes의 Intl은 기기·버전마다 지원이 달라 기대지 않는다).
type DateWords = {
  week: string[]; // 일요일부터, 짧게
  weekLong: string[];
  today: string;
  tomorrow: string;
  /** 2026년 10월 17일 */
  full: (y: number, m: number, d: number) => string;
  /** 10월 17일 (토) */
  mdw: (m: number, d: number, w: number) => string;
  /** 10월 17일 토요일 */
  mdwLong: (m: number, d: number, w: number) => string;
  month: (y: number, m: number) => string;
  daily: string;
  monthly: (day: number) => string;
  weeklyOne: (w: number) => string; // w: 일요일 = 0
  weeklyMany: (names: string[]) => string;
  /** 카드 보조 줄(반복 아이콘 옆이라 '매주'를 뺀다): 월·수·금 / 평일 / 주말 */
  daysShort: (names: string[]) => string;
  weekdays: string;
  weekends: string;
  /** 10월 19일(올해) */
  md: (m: number, d: number) => string;
  /** 오후 8:00 */
  time: (h: number, min: number) => string;
  /** 기한이 지난 날 수: 2일 지남 */
  late: (n: number) => string;
};
const h12 = (h: number) => (h % 12 === 0 ? 12 : h % 12);

const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ko = {
  week: ['일', '월', '화', '수', '목', '금', '토'],
  weekLong: ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'],
};
const en = {
  week: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  weekLong: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};
const ja = {
  week: ['日', '月', '火', '水', '木', '金', '土'],
  weekLong: ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'],
};
const zh = {
  week: ['日', '一', '二', '三', '四', '五', '六'],
  weekLong: ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'],
};

const WORDS: Record<Lang, DateWords> = {
  ko: {
    ...ko,
    today: '오늘',
    tomorrow: '내일',
    full: (y, m, d) => `${y}년 ${m}월 ${d}일`,
    mdw: (m, d, w) => `${m}월 ${d}일 (${ko.week[w]})`,
    mdwLong: (m, d, w) => `${m}월 ${d}일 ${ko.weekLong[w]}`,
    month: (y, m) => `${y}년 ${m}월`,
    daily: '매일',
    monthly: (day) => `매월 ${day}일`,
    weeklyOne: (w) => `매주 ${ko.weekLong[w]}`,
    weeklyMany: (names) => `매주 ${names.join('·')}`,
    daysShort: (names) => names.join('·'),
    weekdays: '평일',
    weekends: '주말',
    md: (m, d) => `${m}월 ${d}일`,
    time: (h, min) => `${h < 12 ? '오전' : '오후'} ${h12(h)}:${pad(min)}`,
    late: (n) => `${n}일 지남`,
  },
  en: {
    ...en,
    today: 'Today',
    tomorrow: 'Tomorrow',
    full: (y, m, d) => `${MONTH_EN[m - 1]} ${d}, ${y}`,
    mdw: (m, d, w) => `${en.week[w]}, ${MONTH_EN[m - 1]} ${d}`,
    mdwLong: (m, d, w) => `${en.weekLong[w]}, ${MONTH_EN[m - 1]} ${d}`,
    month: (y, m) => `${MONTH_EN[m - 1]} ${y}`,
    daily: 'Daily',
    monthly: (day) => `Monthly on day ${day}`,
    weeklyOne: (w) => `Every ${en.weekLong[w]}`,
    weeklyMany: (names) => `Weekly ${names.join('·')}`,
    daysShort: (names) => names.join('·'),
    weekdays: 'Weekdays',
    weekends: 'Weekends',
    md: (m, d) => `${MONTH_EN[m - 1]} ${d}`,
    time: (h, min) => `${h12(h)}:${pad(min)} ${h < 12 ? 'AM' : 'PM'}`,
    late: (n) => (n === 1 ? '1 day overdue' : `${n} days overdue`),
  },
  ja: {
    ...ja,
    today: '今日',
    tomorrow: '明日',
    full: (y, m, d) => `${y}年${m}月${d}日`,
    mdw: (m, d, w) => `${m}月${d}日(${ja.week[w]})`,
    mdwLong: (m, d, w) => `${m}月${d}日 ${ja.weekLong[w]}`,
    month: (y, m) => `${y}年${m}月`,
    daily: '毎日',
    monthly: (day) => `毎月${day}日`,
    weeklyOne: (w) => `毎週${ja.weekLong[w]}`,
    weeklyMany: (names) => `毎週 ${names.join('·')}`,
    daysShort: (names) => names.join('·'),
    weekdays: '平日',
    weekends: '週末',
    md: (m, d) => `${m}月${d}日`,
    time: (h, min) => `${h < 12 ? '午前' : '午後'}${h12(h)}:${pad(min)}`,
    late: (n) => `${n}日経過`,
  },
  zh: {
    ...zh,
    today: '今天',
    tomorrow: '明天',
    full: (y, m, d) => `${y}年${m}月${d}日`,
    mdw: (m, d, w) => `${m}月${d}日（周${zh.week[w]}）`,
    mdwLong: (m, d, w) => `${m}月${d}日 ${zh.weekLong[w]}`,
    month: (y, m) => `${y}年${m}月`,
    daily: '每天',
    monthly: (day) => `每月${day}日`,
    weeklyOne: (w) => `每${zh.weekLong[w]}`,
    weeklyMany: (names) => `每周${names.join('、')}`,
    daysShort: (names) => `周${names.join('、')}`,
    weekdays: '工作日',
    weekends: '周末',
    md: (m, d) => `${m}月${d}日`,
    time: (h, min) => `${h < 12 ? '上午' : '下午'}${h12(h)}:${pad(min)}`,
    late: (n) => `逾期${n}天`,
  },
};
const words = (lang: Lang) => WORDS[lang] ?? WORDS.en;

export function formatDateTime(ms: number, lang: Lang) {
  const d = new Date(ms);
  return `${words(lang).full(d.getFullYear(), d.getMonth() + 1, d.getDate())} ${formatTime(ms)}`;
}

/** 오늘·내일은 말로, 그 밖에는 '10월 16일 (금)' */
export function formatDue(date: string, lang: Lang, now = new Date()) {
  const w = words(lang);
  if (date === localDate(now)) return w.today;
  // 내일은 달력으로 하루 뒤(예전엔 24시간 뒤라 서머타임이 바뀌는 날 자정 무렵엔 모레·오늘이 되었다)
  if (date === localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))) return w.tomorrow;
  return formatDate(date, lang);
}

function formatTime(ms: number) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 일요일부터의 짧은 요일 이름 */
export const weekNames = (lang: Lang) => words(lang).week;

export function monthTitle(d: Date, lang: Lang) {
  return words(lang).month(d.getFullYear(), d.getMonth() + 1);
}

/** 달 이름만(달 고르기 칸): 10월 / Oct / 10月 */
export function monthName(m: number, lang: Lang) {
  return lang === 'en' ? MONTH_EN[m - 1] : lang === 'ko' ? `${m}월` : `${m}月`;
}

/** '10월 17일 토요일' / 'Saturday, Oct 17' (캘린더의 날짜 제목) */
export function dayTitle(date: string, lang: Lang) {
  const d = parseLocalDate(date);
  return words(lang).mdwLong(d.getMonth() + 1, d.getDate(), d.getDay());
}

/** '10월 16일 (금)' / 'Fri, Oct 16' (오늘·내일로 바꾸지 않는 날짜) */
export function formatDate(date: string, lang: Lang) {
  const d = parseLocalDate(date);
  return words(lang).mdw(d.getMonth() + 1, d.getDate(), d.getDay());
}

/** 월요일부터의 요일 이름(반복 요일 고르기·표시) */
export const weekNamesMonFirst = (lang: Lang) => {
  const w = weekNames(lang);
  return [...w.slice(1), w[0]];
};

/**
 * 할 일 카드 보조 줄(휴대폰·PC 큰 창·미니창이 모두 이것만 쓴다): 반복 아이콘 옆 짧은 반복 주기와 날짜·시간.
 * - 반복: '매일' · '월·수·금'(아이콘이 반복을 알려 '매주'는 뺀다) · '평일' · '주말' · '매주 목요일'(하루면 날짜로 읽히지 않게) · '매월 16일'
 * - 날짜: 오늘·내일은 말로, 올해는 '10월 19일', 다른 해는 '2027년 1월 3일'. 반복은 이번 회차 예정일(due_date)
 * - 시간: 알림을 정해 둔 때만 '오후 8:00'(알림이 다른 날이면 그 날짜와 함께)
 * - 없는 정보는 빼서 빈 구분점이 남지 않는다
 */
export function repeatShort(rule: RepeatRule, lang: Lang, anchor: string | null) {
  return repeatText(rule, lang, anchor, true);
}

/** 반복 표시의 공통 부분(짧은 꼴: '평일'·'주말'·'월·수·금', 긴 꼴: '매주 월·수·금') */
function repeatText(rule: RepeatRule, lang: Lang, anchor: string | null, short: boolean) {
  const w = words(lang);
  if (rule.freq === 'daily' || (rule.freq === 'weekly' && rule.days === ALL_DAYS)) return w.daily;
  if (rule.freq === 'monthly') return w.monthly(anchor ? parseLocalDate(anchor).getDate() : 1);
  const mask = rule.days || (anchor ? dayBit(anchor) : 1);
  if (short && mask === 31) return w.weekdays; // 월~금
  if (short && mask === 96) return w.weekends; // 토·일
  const names = weekNamesMonFirst(lang);
  const picked = names.map((_, i) => i).filter((i) => mask & (1 << i)); // 월요일 = 0
  if (picked.length === 1) return w.weeklyOne((picked[0] + 1) % 7);
  return short ? w.daysShort(picked.map((i) => names[i])) : w.weeklyMany(picked.map((i) => names[i]));
}

/** 카드 날짜: 오늘·내일 / 10월 19일 / 2027년 1월 3일(요일은 빼고) */
export function cardDate(date: string, lang: Lang, now = new Date()) {
  const w = words(lang);
  if (date === localDate(now)) return w.today;
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (date === localDate(next)) return w.tomorrow;
  const d = parseLocalDate(date);
  return d.getFullYear() === now.getFullYear() ? w.md(d.getMonth() + 1, d.getDate()) : w.full(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** 기한이 지난 날 수(오늘 기준 달력 날짜 차이, 지나지 않았으면 0). 서머타임으로 하루가 23·25시간인 날도 반올림으로 맞다 */
export function daysLate(date: string, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today.getTime() - parseLocalDate(date).getTime()) / 86400000));
}

/** 카드 보조 줄: 기한이 지났으면 '2일 지남', 아니면 null */
export function cardLate(date: string, lang: Lang, now = new Date()) {
  const n = daysLate(date, now);
  return n > 0 ? words(lang).late(n) : null;
}

/** 카드 시간: 오후 8:00 / 8:00 PM */
export function cardTime(ms: number, lang: Lang) {
  const d = new Date(ms);
  return words(lang).time(d.getHours(), d.getMinutes());
}

/**
 * 카드 보조 줄의 날짜·시간 한 덩어리. 날짜를 빼는 화면(캘린더: 고른 날짜가 곧 그날)에서는 시간만.
 * 알림 날짜가 예정일과 같거나 예정일이 없으면 '내일 오후 5:00'처럼 붙이고, 다른 날이면 '10월 19일 · 10월 20일 오후 8:00'.
 */
export function cardWhen(t: { due_date: string | null; remind_at: number | null }, lang: Lang, opts: { hideDate?: boolean; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const remindDay = t.remind_at != null ? localDate(new Date(t.remind_at)) : null;
  const time = t.remind_at != null ? cardTime(t.remind_at, lang) : null;
  if (opts.hideDate) return time;
  const due = t.due_date ? cardDate(t.due_date, lang, now) : null;
  if (!time) return due;
  if (!t.due_date || remindDay === t.due_date) return `${t.due_date ? due : cardDate(remindDay!, lang, now)} ${time}`;
  return `${due} · ${cardDate(remindDay!, lang, now)} ${time}`;
}

/** 반복 표시(정보 시트 등 긴 꼴): '매일' · '매주 월·수·금' · '매주 목요일' · '매월 16일' */
export function describeRepeat(rule: RepeatRule, lang: Lang, anchor: string | null) {
  return repeatText(rule, lang, anchor, false);
}
