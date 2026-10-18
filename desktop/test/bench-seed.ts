// 측정용 데이터 넣기(검증용): ELECTRON_RUN_AS_NODE=1 modo.exe bench-seed.cjs <naegirok.db> small|large
// 앱이 한 번 켜져 스키마를 만든 DB에 넣는다. 정렬 키는 앱과 같은 frac로 만든다.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

import { keyBetween } from '../../app/src/core/frac';

const [file, size] = process.argv.slice(2);
const db = new DatabaseSync(file);
const large = size === 'large';
const now = Date.now();
const day = (off: number) => {
  const d = new Date();
  d.setDate(d.getDate() + off);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const FOLDERS = large ? 10 : 3;
const TODOS = large ? 2000 : 12;
const PARAS = large ? 2000 : 6;
db.exec('BEGIN');
const folders: string[] = [];
let fk: string | null = null;
for (let i = 0; i < FOLDERS; i++) {
  const id = randomUUID();
  fk = keyBetween(fk, null);
  db.prepare('INSERT INTO folders (id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, ['업무', '개인', '공부', '운동', '장보기', '여행', '독서', '집', '돈', '아이디어'][i], fk, now, now);
  folders.push(id);
}
let tk: string | null = null;
const ins = db.prepare(
  'INSERT INTO todos (id, folder_id, text, position, created_at, updated_at, done_at, due_date, repeat_freq, repeat_days, done_log) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
);
for (let i = 0; i < TODOS; i++) {
  tk = keyBetween(tk, null);
  const folder = i % (FOLDERS + 1) === FOLDERS ? null : folders[i % (FOLDERS + 1)];
  const repeat = i % 40 === 0 ? 'daily' : i % 40 === 1 ? 'weekly' : null;
  const done = !repeat && i % 7 === 0 ? now - (i % 30) * 86400000 : null;
  const due = repeat ? day(0) : i % 5 === 0 ? day((i % 21) - 7) : null;
  const log = repeat ? [day(-6), day(-4), day(-2), day(-1)].join(',') : null;
  ins.run(randomUUID(), folder, `할 일 ${i} 내용을 조금 길게 적어 둔다`, tk, now - 40 * 86400000, now, done, due, repeat, repeat === 'weekly' ? 21 : null, log);
}
let pk: string | null = null;
const insP = db.prepare('INSERT INTO paragraphs (id, folder_id, text, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
for (let i = 0; i < PARAS; i++) {
  pk = keyBetween(pk, null);
  const folder = i % (FOLDERS + 1) === FOLDERS ? null : folders[i % (FOLDERS + 1)];
  insP.run(randomUUID(), folder, `메모 ${i} 문단: 오늘 떠오른 생각을 적어 둔다`, pk, now, now);
}
const set = (k: string, v: unknown) => db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, JSON.stringify(v));
set('prefs', { themeMode: 'dark', hintSeen: true, language: 'ko' });
set('session', { lastFolder: folders[1], drafts: {} });
db.exec('COMMIT');
console.log('seeded', size, { folders: FOLDERS, todos: TODOS, paragraphs: PARAS });
