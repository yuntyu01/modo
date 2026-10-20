// 홈 위젯 확인용 시험 데이터(검증용): 기존 데이터는 건드리지 않고 '위젯 테스트' 폴더 하나에 긴 메모와 할 일 9개를 더한다.
// 사용: esbuild로 묶어(--platform=node --external:node:sqlite) TZ=<기기 시간대> ELECTRON_RUN_AS_NODE=1 electron <묶은 파일> <naegirok.db 사본>
// (node:sqlite가 필요해 desktop의 Electron을 node로 돌린다. 기기 DB는 디버그 빌드의 run-as로 꺼내고 넣는다)
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

import { keyBetween } from '../../app/src/core/frac';
import { addDays, fmt, parse } from '../../app/src/core/repeat';

const [file] = process.argv.slice(2);
const db = new DatabaseSync(file);
const now = Date.now();
const day = (off: number) => addDays(fmt(new Date()), off);
const at = (off: number, h: number, m = 0) => {
  const d = parse(day(off));
  d.setHours(h, m, 0, 0);
  return d.getTime();
};
// 정렬 키(앱과 같은 규칙): 차례로 뒤에 붙인다
const keys = (n: number) => {
  const out: string[] = [];
  let k: string | null = null;
  for (let i = 0; i < n; i++) out.push((k = keyBetween(k, null)));
  return out;
};

const folder = randomUUID();
db.exec('BEGIN');
const last = (db.prepare('SELECT MAX(position) AS p FROM folders WHERE deleted_at IS NULL').get() as { p: string | null }).p;
db.prepare('INSERT INTO folders (id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(folder, '위젯 테스트', keyBetween(last, null), now, now);
const memo = [
  '오늘은 중요한 것부터 천천히.',
  '떠오른 생각은 여기에 적어두고 하나씩 정리하기.',
  '',
  '주말에는 책상 주변을 정리하고, 읽고 싶은 책을 골라두기.',
  '',
  '다음 주에는 운동하는 시간을 저녁 8시로 맞춰보기.',
  '',
  '장보기 목록: 우유, 달걀, 사과, 두부, 시금치, 현미, 올리브유, 휴지, 세제, 커피 원두.',
  '월말까지 여행 일정표 초안을 만들고 숙소 후보 세 곳을 비교해 보기. 기차표는 2주 전에 예매하기.',
  '마지막 문장: 여기까지 보이면 메모를 빠짐없이 다 본 것.',
];
const memoKeys = keys(memo.length);
memo.forEach((text, i) =>
  db.prepare('INSERT INTO paragraphs (id, folder_id, text, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), folder, text, memoKeys[i], now, now),
);
// text, due, remind, repeat, days
const todos: [string, string | null, number | null, string | null, number | null][] = [
  ['회의 자료 정리', day(0), at(0, 15), null, null],
  ['영양제 먹기', day(0), null, 'daily', null],
  ['책 20분 읽기', day(0), null, 'weekly', 1 | 4 | 16],
  ['세탁기 돌리기', day(0), at(0, 18), null, null],
  ['장보기', null, null, null, null],
  ['운동 30분', day(0), null, 'weekly', 31],
  ['세금 납부', day(-2), null, null, null],
  ['분기 보고서 초안을 작성하고 팀장님께 검토 요청 메일을 보낸 뒤 회의실 예약까지 마무리하기', null, null, null, null],
  ['병원 예약 확인', day(3), null, null, null],
];
const todoKeys = keys(todos.length);
todos.forEach(([text, due, remind, rep, days], i) =>
  db
    .prepare('INSERT INTO todos (id, folder_id, text, position, created_at, updated_at, due_date, remind_at, repeat_freq, repeat_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), folder, text, todoKeys[i], now, now, due, remind, rep, days),
);
db.exec('COMMIT');
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
db.exec('PRAGMA journal_mode=DELETE');
console.log('widget seed ok', folder);
db.close();
