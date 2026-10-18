
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  owner_id TEXT,
  version INTEGER NOT NULL DEFAULT 0
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
  position TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  purged INTEGER NOT NULL DEFAULT 0,
  owner_id TEXT,
  conflict_of TEXT,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS paragraphs (
  id TEXT PRIMARY KEY,
  folder_id TEXT,
  text TEXT NOT NULL,
  position TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  purged INTEGER NOT NULL DEFAULT 0,
  owner_id TEXT,
  conflict_of TEXT,
  version INTEGER NOT NULL DEFAULT 0
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
CREATE INDEX IF NOT EXISTS todos_due ON todos (due_date);
CREATE INDEX IF NOT EXISTS paragraphs_folder ON paragraphs (folder_id);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- 서버가 알려준 '내가 공유받은 폴더' 캐시(서버의 folder_members + 소유자 이메일). pull 때마다 통째로 바뀐다.
CREATE TABLE IF NOT EXISTS shared_folders (
  folder_id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('view', 'edit')),
  owner_email TEXT NOT NULL
);
