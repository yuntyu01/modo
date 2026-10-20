// 로컬 SQLite 스키마. Android Kotlin 모듈(빠른 추가·위젯·타일)과 iOS 위젯도 같은 파일을 직접 읽고 쓴다.
// 컬럼을 바꾸면 modules/modo-native 의 Kotlin/Swift 쪽 SQL도 같이 바꿀 것.
// 시각은 epoch 밀리초 정수, due_date는 'YYYY-MM-DD'(로컬 날짜).
// folder_id는 외래키를 걸지 않는다: 동기화로 항목이 폴더보다 먼저 들어올 수 있고, 폴더는 지워도(soft delete) 행이 남는다.
// 항목·폴더가 '남의 것'인지는 따로 적지 않는다: 공유받은 폴더(shared_folders)와 그 안의 항목이 남의 것이다.
// 영구 삭제한 항목은 행을 바로 지운다(다른 기기에 알릴 op는 outbox에 남는다).
export const SCHEMA_VERSION = 5;

export const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  folder_id TEXT,
  text TEXT NOT NULL,
  done_at INTEGER, -- 완료 여부는 done_at IS NOT NULL
  due_date TEXT,
  remind_at INTEGER,
  repeat_freq TEXT CHECK (repeat_freq IN ('daily', 'weekly', 'monthly')), -- 반복이면 due_date = 다음 예정일
  repeat_days INTEGER CHECK (repeat_days BETWEEN 1 AND 127), -- 매주 요일 비트(월=1 … 일=64)
  done_log TEXT, -- 루틴을 한 날들 'YYYY-MM-DD,…'(core/doneLog.ts)
  position TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  conflict_of TEXT
);
CREATE TABLE IF NOT EXISTS paragraphs (
  id TEXT PRIMARY KEY,
  folder_id TEXT,
  text TEXT NOT NULL,
  position TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  conflict_of TEXT
);
CREATE TABLE IF NOT EXISTS outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  op_id TEXT NOT NULL UNIQUE,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  is_create INTEGER NOT NULL DEFAULT 0,
  fields TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  inflight INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS outbox_entity ON outbox (entity_id);
CREATE INDEX IF NOT EXISTS todos_folder ON todos (folder_id);
-- due_date 인덱스는 어느 쿼리도 쓰지 않아(캘린더는 화면에서 거른다, EXPLAIN 확인 2026-10-18) 쓰기마다 고치는 비용만 있었다
DROP INDEX IF EXISTS todos_due;
CREATE INDEX IF NOT EXISTS paragraphs_folder ON paragraphs (folder_id);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** 공유 캐시: 서버가 pull 때마다 알려 주는 '내가 공유받은 폴더'와 그 주인. 통째로 바뀐다(v4). */
export const SCHEMA_SHARED = `
CREATE TABLE IF NOT EXISTS shared_folders (
  folder_id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('view', 'edit')),
  owner_id TEXT NOT NULL,
  home INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT ''
);
`;

/** v1 → v2: todos.done 제거(done_at만으로 완료를 나타낸다). */
export const MIGRATE_V2 = `
UPDATE todos SET done_at = COALESCE(done_at, updated_at) WHERE done = 1;
UPDATE todos SET done_at = NULL WHERE done = 0;
ALTER TABLE todos DROP COLUMN done;
`;

/** v4 → v5: 루틴을 한 날 기록. 위젯(Kotlin/Swift)도 같은 문장을 쓴다. */
export const MIGRATE_V5 = `ALTER TABLE todos ADD COLUMN done_log TEXT;`;

/** v2 → v3: 반복 할 일. 위젯(Kotlin/Swift)도 앱보다 먼저 열 수 있어 같은 문장을 쓴다. */
export const MIGRATE_V3 = `
ALTER TABLE todos ADD COLUMN repeat_freq TEXT CHECK (repeat_freq IN ('daily', 'weekly', 'monthly'));
ALTER TABLE todos ADD COLUMN repeat_days INTEGER CHECK (repeat_days BETWEEN 1 AND 127);
`;
