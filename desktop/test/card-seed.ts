// 카드 디자인 확인용 데이터(검증용): 날짜 없음·날짜만·날짜+시간·매일·요일 반복·긴 제목·기한 지남·다른 해
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

import { keyBetween } from '../../app/src/core/frac';

const [file] = process.argv.slice(2);
const db = new DatabaseSync(file);
const now = Date.now();
const day = (off: number) => {
  const d = new Date();
  d.setDate(d.getDate() + off);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const at = (off: number, h: number, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + off);
  d.setHours(h, m, 0, 0);
  return d.getTime();
};
const folder = randomUUID();
db.exec('BEGIN');
db.prepare('INSERT INTO folders (id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(folder, '개인', 'a0', now, now);
db.prepare('INSERT INTO paragraphs (id, folder_id, text, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), folder, '오늘은 중요한 것부터 천천히.', 'a0', now, now);
const rows: [string, string | null, number | null, string | null, number | null, string | null][] = [
  // text, due, remind, repeat, days, done_log
  ['영양제 먹기', day(0), null, 'daily', null, [day(-2), day(-1)].join(',')],
  // 아직 날이 안 된 반복은 목록에 안 보여서 오늘로 둔다(카드에 '월·수·금 · 오늘 오후 8:00')
  ['책 20분 읽기', day(0), at(0, 20), 'weekly', 21, null],
  ['장보기', day(1), at(1, 17), null, null, null],
  ['회의 자료 정리', null, null, null, null, null],
  ['병원 예약 확인', day(3), null, null, null, null],
  ['세금 납부', day(-2), null, null, null, null],
  ['여권 갱신 서류 챙기기', '2027-01-03', null, null, null, null],
  ['분기 보고서 초안을 작성하고 팀장님께 검토 요청 메일을 보낸 뒤 회의실 예약까지 마무리하기', day(0), at(0, 15, 30), null, null, null],
  // 날짜 없는 긴 제목(두 줄 넘김 → …)
  ['다음 주 워크숍 준비물 목록을 정리해서 참석자 모두에게 공유하고 장소 예약 확인 전화까지 끝내기', null, null, null, null, null],
];
let k: string | null = null;
for (const [text, due, remind, rep, days, log] of rows) {
  k = keyBetween(k, null);
  db.prepare(
    'INSERT INTO todos (id, folder_id, text, position, created_at, updated_at, due_date, remind_at, repeat_freq, repeat_days, done_log) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(randomUUID(), folder, text, k, now, now, due, remind, rep, days, log);
}
const set = (key: string, v: unknown) => db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(v));
set('prefs', { themeMode: 'dark', hintSeen: true, language: 'ko' });
set('session', { lastFolder: folder, drafts: {} });
db.exec('COMMIT');
console.log('card seed ok');
