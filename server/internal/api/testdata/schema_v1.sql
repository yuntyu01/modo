-- 시각은 모두 epoch 밀리초(BIGINT). 클라이언트 로컬 DB와 같은 단위.
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY,
    email         TEXT        NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash   BYTEA PRIMARY KEY,
    user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device       TEXT        NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 모든 변경에 전역 순번을 붙여 pull 커서로 쓴다.
CREATE SEQUENCE IF NOT EXISTS change_seq;

CREATE TABLE IF NOT EXISTS folders (
    id         UUID PRIMARY KEY,
    owner_id   UUID   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT   NOT NULL,
    position   TEXT   NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT,
    version    BIGINT NOT NULL DEFAULT 1,
    seq        BIGINT NOT NULL DEFAULT nextval('change_seq')
);

-- folder_id는 FK를 걸지 않는다: 오프라인 큐에서 항목이 폴더보다 먼저 도착할 수 있다(op마다 따로 커밋).
-- owner_id: 기본 폴더(folder_id 없음) 항목의 주인을 알려면 꼭 필요하다. 폴더에 든 항목은 그 폴더의 주인과 같아야 해서
-- 아래 트리거(items_owner_from_folder, folders_owner_to_items)가 DB 안에서 직접 맞춘다(코드가 어긋나게 써도 갱신 이상이 생기지 않게).
CREATE TABLE IF NOT EXISTS todos (
    id          UUID PRIMARY KEY,
    owner_id    UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id   UUID,
    text        TEXT    NOT NULL,
    done_at     BIGINT, -- 완료 여부는 done_at IS NOT NULL (별도 boolean을 두지 않아 둘이 어긋날 수 없다)
    due_date    DATE, -- 로컬 날짜. 문자열이 아닌 날짜형이라 '2026-02-30' 같은 값은 들어올 수 없다(JSON에는 'YYYY-MM-DD'로 나간다)
    remind_at   BIGINT,
    repeat_freq TEXT CHECK (repeat_freq IN ('daily', 'weekly', 'monthly')), -- 반복이면 due_date = 다음 예정일
    repeat_days SMALLINT CHECK (repeat_days BETWEEN 1 AND 127), -- 매주 요일 비트(월=1 … 일=64), 매주가 아니면 NULL
    position    TEXT    NOT NULL,
    created_at  BIGINT  NOT NULL,
    updated_at  BIGINT  NOT NULL,
    deleted_at  BIGINT,
    purged      BOOLEAN NOT NULL DEFAULT false,
    conflict_of UUID,
    version     BIGINT  NOT NULL DEFAULT 1,
    seq         BIGINT  NOT NULL DEFAULT nextval('change_seq')
);

CREATE TABLE IF NOT EXISTS paragraphs (
    id          UUID PRIMARY KEY,
    owner_id    UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id   UUID,
    text        TEXT    NOT NULL,
    position    TEXT    NOT NULL,
    created_at  BIGINT  NOT NULL,
    updated_at  BIGINT  NOT NULL,
    deleted_at  BIGINT,
    purged      BOOLEAN NOT NULL DEFAULT false,
    conflict_of UUID,
    version     BIGINT  NOT NULL DEFAULT 1,
    seq         BIGINT  NOT NULL DEFAULT nextval('change_seq')
);

CREATE INDEX IF NOT EXISTS folders_owner_seq ON folders (owner_id, seq);
CREATE INDEX IF NOT EXISTS todos_owner_seq ON todos (owner_id, seq);
CREATE INDEX IF NOT EXISTS paragraphs_owner_seq ON paragraphs (owner_id, seq);
-- 공유 폴더 pull(folder_id = ANY(...) AND seq > 커서 ORDER BY seq)과 폴더별 조회를 한 인덱스로
DROP INDEX IF EXISTS todos_folder;
DROP INDEX IF EXISTS paragraphs_folder;
CREATE INDEX IF NOT EXISTS todos_folder_seq ON todos (folder_id, seq) WHERE folder_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS paragraphs_folder_seq ON paragraphs (folder_id, seq) WHERE folder_id IS NOT NULL;

-- 이전 버전 DB에 반복 열 추가(두 열 사이 조건은 걸지 않는다: 필드별로 동기화돼 잠깐 어긋날 수 있다)
ALTER TABLE todos ADD COLUMN IF NOT EXISTS repeat_freq TEXT CHECK (repeat_freq IN ('daily', 'weekly', 'monthly'));
ALTER TABLE todos ADD COLUMN IF NOT EXISTS repeat_days SMALLINT CHECK (repeat_days BETWEEN 1 AND 127);

-- 이전 버전 DB 고치기: due_date 문자열 → 날짜형(잘못된 값은 버린다)
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'todos' AND column_name = 'due_date') = 'text' THEN
    UPDATE todos SET due_date = NULL WHERE due_date !~ '^\d{4}-\d{2}-\d{2}$';
    ALTER TABLE todos ALTER COLUMN due_date TYPE DATE USING due_date::date;
  END IF;
END $$;

-- 폴더에 든 항목의 owner_id는 폴더 주인으로(파생 값을 DB가 맞춘다)
CREATE OR REPLACE FUNCTION items_owner_from_folder() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o UUID;
BEGIN
  IF NEW.folder_id IS NOT NULL THEN
    SELECT owner_id INTO o FROM folders WHERE id = NEW.folder_id;
    IF FOUND THEN NEW.owner_id := o; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS todos_owner ON todos;
CREATE TRIGGER todos_owner BEFORE INSERT OR UPDATE OF folder_id, owner_id ON todos
  FOR EACH ROW EXECUTE FUNCTION items_owner_from_folder();
DROP TRIGGER IF EXISTS paragraphs_owner ON paragraphs;
CREATE TRIGGER paragraphs_owner BEFORE INSERT OR UPDATE OF folder_id, owner_id ON paragraphs
  FOR EACH ROW EXECUTE FUNCTION items_owner_from_folder();

-- 항목이 폴더보다 먼저 올라왔다가 폴더가 나중에 생기면 그때 항목 주인을 맞춘다
CREATE OR REPLACE FUNCTION folders_owner_to_items() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE todos SET owner_id = NEW.owner_id WHERE folder_id = NEW.id AND owner_id <> NEW.owner_id;
  UPDATE paragraphs SET owner_id = NEW.owner_id WHERE folder_id = NEW.id AND owner_id <> NEW.owner_id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS folders_owner_items ON folders;
CREATE TRIGGER folders_owner_items AFTER INSERT ON folders
  FOR EACH ROW EXECUTE FUNCTION folders_owner_to_items();

-- 충돌 사본은 같은 표의 원본을 가리킨다(항목은 영구 삭제도 행을 남기므로 끊길 일이 없다)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'todos_conflict_of_fkey') THEN
    ALTER TABLE todos ADD CONSTRAINT todos_conflict_of_fkey FOREIGN KEY (conflict_of) REFERENCES todos(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paragraphs_conflict_of_fkey') THEN
    ALTER TABLE paragraphs ADD CONSTRAINT paragraphs_conflict_of_fkey FOREIGN KEY (conflict_of) REFERENCES paragraphs(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 같은 op_id 재전송(응답 유실 후 재시도)은 저장해 둔 결과를 그대로 돌려준다.
CREATE TABLE IF NOT EXISTS applied_ops (
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    op_id      TEXT        NOT NULL,
    result     JSONB       NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, op_id)
);
-- 재전송 기록은 오래 둘 필요가 없어 주기적으로 지운다(Cleanup)
CREATE INDEX IF NOT EXISTS applied_ops_created ON applied_ops (created_at);
CREATE INDEX IF NOT EXISTS sessions_last_used ON sessions (last_used_at);

-- 폴더 공유는 두 가지라 테이블을 나눈다.
-- 사람 초대: 폴더·사용자 한 쌍에 권한 하나.
CREATE TABLE IF NOT EXISTS folder_members (
    folder_id  UUID        NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT        NOT NULL CHECK (role IN ('view', 'edit')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (folder_id, user_id)
);
CREATE INDEX IF NOT EXISTS folder_members_user ON folder_members (user_id);

-- 보기 전용 링크: 토큰만으로 그 폴더 하나를 읽는다. 끊으면 행을 지운다.
CREATE TABLE IF NOT EXISTS share_links (
    token      TEXT PRIMARY KEY,
    folder_id  UUID        NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS share_links_folder ON share_links (folder_id);
