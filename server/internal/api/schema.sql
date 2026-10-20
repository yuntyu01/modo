-- 시각은 epoch 밀리초(BIGINT). 클라이언트 로컬 DB와 같은 단위.
-- 서버가 켜질 때마다 통째로 실행한다: 새 DB는 만들고, 예전 구조의 DB는 아래 '이전 버전 고치기'에서 새 구조로 옮긴다.

-- ---------- 계정 ----------
-- 사용자 한 명에 로그인 수단이 여럿일 수 있어(비밀번호, 카카오) 수단마다 표를 나눈다.
CREATE TABLE IF NOT EXISTS users (
    id         UUID PRIMARY KEY,
    email      TEXT UNIQUE,                -- 초대·표시용. 카카오에서 이메일 동의를 안 하면 없다
    name       TEXT        NOT NULL DEFAULT '', -- 표시 이름(카카오 닉네임 등)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 테마(테마색 '#RRGGBB'): PC·휴대폰이 이어 쓰고, 인기 색 집계(지금 그 색을 쓰는 계정 수)에 쓴다. 늦게 바꾼 기기가 이긴다(theme.go).
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_id TEXT CHECK (theme_id ~ '^#[0-9A-F]{6}$');
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_updated_at BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS password_logins (
    user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL
);

-- 외부 계정(카카오): 공급자 안에서의 사용자 번호 하나가 우리 사용자 한 명.
CREATE TABLE IF NOT EXISTS oauth_identities (
    provider   TEXT        NOT NULL CHECK (provider IN ('kakao', 'google')),
    subject    TEXT        NOT NULL,
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, subject),
    UNIQUE (user_id, provider)
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash   BYTEA PRIMARY KEY,
    user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device       TEXT        NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_last_used ON sessions (last_used_at);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

-- 외부 로그인 진행 중 상태(브라우저로 나갔다 돌아올 때까지, 10분). 앱이 준 PKCE challenge를 같이 둔다.
CREATE TABLE IF NOT EXISTS oauth_states (
    state_hash   BYTEA PRIMARY KEY,
    redirect_uri TEXT        NOT NULL,
    client_state TEXT        NOT NULL,
    challenge    TEXT        NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL
);
-- Preserve existing Kakao identities and pending sessions during upgrades.
ALTER TABLE oauth_identities DROP CONSTRAINT IF EXISTS oauth_identities_provider_check;
ALTER TABLE oauth_identities ADD CONSTRAINT oauth_identities_provider_check CHECK (provider IN ('kakao', 'google'));
ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'kakao';
ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS nonce_hash BYTEA;
ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS upstream_verifier TEXT;
-- 외부 로그인이 끝나 앱에 넘긴 일회용 코드(2분). 앱은 code_verifier와 함께 세션 토큰으로 바꾼다.
CREATE TABLE IF NOT EXISTS login_codes (
    code_hash  BYTEA PRIMARY KEY,
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    challenge  TEXT        NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

-- ---------- 내용 ----------
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
    seq        BIGINT NOT NULL DEFAULT nextval('change_seq')
);

-- 항목의 주인은 한 곳에서만 정한다: 폴더에 든 항목은 그 폴더의 주인(folders.owner_id),
-- 기본 폴더(folder_id 없음) 항목만 owner_id를 직접 가진다. CHECK로 둘 중 하나만 있게 막는다.
-- (폴더 주인을 항목마다 복사해 두지 않으므로 둘이 어긋날 수 없다)
CREATE TABLE IF NOT EXISTS todos (
    id          UUID PRIMARY KEY,
    folder_id   UUID REFERENCES folders(id) ON DELETE CASCADE,
    owner_id    UUID REFERENCES users(id) ON DELETE CASCADE,
    text        TEXT    NOT NULL,
    done_at     BIGINT, -- 완료 여부는 done_at IS NOT NULL (별도 boolean을 두지 않아 둘이 어긋날 수 없다)
    due_date    DATE, -- 로컬 날짜. 날짜형이라 '2026-02-30' 같은 값은 들어올 수 없다(JSON에는 'YYYY-MM-DD'로 나간다)
    remind_at   BIGINT,
    repeat_freq TEXT CHECK (repeat_freq IN ('daily', 'weekly', 'monthly')), -- 반복이면 due_date = 다음 예정일
    repeat_days SMALLINT CHECK (repeat_days BETWEEN 1 AND 127), -- 매주 요일 비트(월=1 … 일=64), 매주가 아니면 NULL
    position    TEXT    NOT NULL,
    created_at  BIGINT  NOT NULL,
    updated_at  BIGINT  NOT NULL,
    deleted_at  BIGINT, -- 휴지통
    conflict_of UUID REFERENCES todos(id) ON DELETE SET NULL, -- 충돌 사본이면 원본
    seq         BIGINT  NOT NULL DEFAULT nextval('change_seq'),
    CONSTRAINT todos_one_owner CHECK ((folder_id IS NULL) <> (owner_id IS NULL))
);

CREATE TABLE IF NOT EXISTS paragraphs (
    id          UUID PRIMARY KEY,
    folder_id   UUID REFERENCES folders(id) ON DELETE CASCADE,
    owner_id    UUID REFERENCES users(id) ON DELETE CASCADE,
    text        TEXT    NOT NULL,
    position    TEXT    NOT NULL,
    created_at  BIGINT  NOT NULL,
    updated_at  BIGINT  NOT NULL,
    deleted_at  BIGINT,
    conflict_of UUID REFERENCES paragraphs(id) ON DELETE SET NULL,
    seq         BIGINT  NOT NULL DEFAULT nextval('change_seq'),
    CONSTRAINT paragraphs_one_owner CHECK ((folder_id IS NULL) <> (owner_id IS NULL))
);

-- 영구 삭제한 항목: 내용 행은 지우고 '지웠다'는 사실만 남겨 다른 기기가 pull로 받아 지운다.
-- (예전에는 내용을 비운 행에 purged 표시를 달아 두어 모든 열이 의미 없는 값으로 남았다)
CREATE TABLE IF NOT EXISTS tombstones (
    id        UUID PRIMARY KEY,
    entity    TEXT   NOT NULL CHECK (entity IN ('todo', 'paragraph')),
    folder_id UUID REFERENCES folders(id) ON DELETE CASCADE,
    owner_id  UUID REFERENCES users(id) ON DELETE CASCADE,
    seq       BIGINT NOT NULL DEFAULT nextval('change_seq'),
    CONSTRAINT tombstones_one_owner CHECK ((folder_id IS NULL) <> (owner_id IS NULL))
);

-- ---------- 이전 버전 고치기 ----------
DO $$ BEGIN
  -- 비밀번호를 users에서 password_logins로
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'password_hash') THEN
    INSERT INTO password_logins (user_id, password_hash) SELECT id, password_hash FROM users ON CONFLICT DO NOTHING;
    ALTER TABLE users DROP COLUMN password_hash;
    ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'name') THEN
    ALTER TABLE users ADD COLUMN name TEXT NOT NULL DEFAULT '';
  END IF;

  -- due_date 문자열 → 날짜형(잘못된 값은 버린다)
  IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'todos' AND column_name = 'due_date') = 'text' THEN
    UPDATE todos SET due_date = NULL WHERE due_date !~ '^\d{4}-\d{2}-\d{2}$';
    ALTER TABLE todos ALTER COLUMN due_date TYPE DATE USING due_date::date;
  END IF;
  -- 루틴을 한 날 기록('YYYY-MM-DD,…', sync.go kDateSet)
  ALTER TABLE todos ADD COLUMN IF NOT EXISTS done_log TEXT;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'todos' AND column_name = 'repeat_freq') THEN
    ALTER TABLE todos ADD COLUMN repeat_freq TEXT CHECK (repeat_freq IN ('daily', 'weekly', 'monthly'));
    ALTER TABLE todos ADD COLUMN repeat_days SMALLINT CHECK (repeat_days BETWEEN 1 AND 127);
  END IF;

  -- 항목 주인: 폴더에서 복사해 두던 owner_id(트리거로 맞추던 파생 값)를 없애고 폴더 FK로
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'todos_one_owner') THEN
    DROP TRIGGER IF EXISTS todos_owner ON todos;
    DROP TRIGGER IF EXISTS paragraphs_owner ON paragraphs;
    DROP TRIGGER IF EXISTS folders_owner_items ON folders;
    DROP FUNCTION IF EXISTS items_owner_from_folder();
    DROP FUNCTION IF EXISTS folders_owner_to_items();
    ALTER TABLE todos ALTER COLUMN owner_id DROP NOT NULL;
    ALTER TABLE paragraphs ALTER COLUMN owner_id DROP NOT NULL;
    -- 없는 폴더를 가리키던 항목은 기본 폴더로(앱도 이미 기본 폴더에 보여 주던 항목이다)
    UPDATE todos t SET folder_id = NULL, seq = nextval('change_seq')
      WHERE folder_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM folders f WHERE f.id = t.folder_id);
    UPDATE paragraphs p SET folder_id = NULL, seq = nextval('change_seq')
      WHERE folder_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM folders f WHERE f.id = p.folder_id);
    UPDATE todos SET owner_id = NULL WHERE folder_id IS NOT NULL;
    UPDATE paragraphs SET owner_id = NULL WHERE folder_id IS NOT NULL;
    ALTER TABLE todos ADD CONSTRAINT todos_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE;
    ALTER TABLE paragraphs ADD CONSTRAINT paragraphs_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE;
    ALTER TABLE todos ADD CONSTRAINT todos_one_owner CHECK ((folder_id IS NULL) <> (owner_id IS NULL));
    ALTER TABLE paragraphs ADD CONSTRAINT paragraphs_one_owner CHECK ((folder_id IS NULL) <> (owner_id IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'todos_conflict_of_fkey') THEN
    ALTER TABLE todos ADD CONSTRAINT todos_conflict_of_fkey FOREIGN KEY (conflict_of) REFERENCES todos(id) ON DELETE SET NULL;
    ALTER TABLE paragraphs ADD CONSTRAINT paragraphs_conflict_of_fkey FOREIGN KEY (conflict_of) REFERENCES paragraphs(id) ON DELETE SET NULL;
  END IF;

  -- 영구 삭제 표시(purged) 행 → tombstones
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'todos' AND column_name = 'purged') THEN
    INSERT INTO tombstones (id, entity, folder_id, owner_id) SELECT id, 'todo', folder_id, owner_id FROM todos WHERE purged;
    INSERT INTO tombstones (id, entity, folder_id, owner_id) SELECT id, 'paragraph', folder_id, owner_id FROM paragraphs WHERE purged;
    DELETE FROM todos WHERE purged;
    DELETE FROM paragraphs WHERE purged;
    ALTER TABLE todos DROP COLUMN purged;
    ALTER TABLE paragraphs DROP COLUMN purged;
  END IF;

  -- version: 아무도 읽지 않는 수정 횟수(변경 추적은 seq가 한다)
  ALTER TABLE folders DROP COLUMN IF EXISTS version;
  ALTER TABLE todos DROP COLUMN IF EXISTS version;
  ALTER TABLE paragraphs DROP COLUMN IF EXISTS version;
END $$;

-- pull: '내 기본 폴더 항목'(owner_id)과 '볼 수 있는 폴더의 항목'(folder_id) 두 갈래를 각각 인덱스로
CREATE INDEX IF NOT EXISTS folders_owner_seq ON folders (owner_id, seq);
DROP INDEX IF EXISTS todos_owner_seq;
DROP INDEX IF EXISTS paragraphs_owner_seq;
CREATE INDEX IF NOT EXISTS todos_owner_seq2 ON todos (owner_id, seq) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS paragraphs_owner_seq2 ON paragraphs (owner_id, seq) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS todos_folder_seq ON todos (folder_id, seq) WHERE folder_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS paragraphs_folder_seq ON paragraphs (folder_id, seq) WHERE folder_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tombstones_owner_seq ON tombstones (owner_id, seq) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tombstones_folder_seq ON tombstones (folder_id, seq) WHERE folder_id IS NOT NULL;
-- 원본을 영구 삭제할 때 사본의 conflict_of를 비우는 FK 동작이 표 전체를 훑지 않게
CREATE INDEX IF NOT EXISTS todos_conflict_of ON todos (conflict_of) WHERE conflict_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS paragraphs_conflict_of ON paragraphs (conflict_of) WHERE conflict_of IS NOT NULL;

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

-- ---------- 공유 ----------
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
-- 공유받은 폴더를 내 홈(목록 탭)에도 보일지: 참여자 각자의 설정. 숨겨도 공유는 그대로(함께 탭에는 보인다)
ALTER TABLE folder_members ADD COLUMN IF NOT EXISTS home BOOLEAN NOT NULL DEFAULT true;

-- ---------- 친구 ----------
-- 친구는 폴더 공유(folder_members)와 따로다: 친구가 되어도 공유한 폴더만 보이고, 친구를 끊어도 공유는 그대로다.
-- 요청: 보낸 사람 → 받는 사람 한 쌍에 하나. 수락하면 지우고 friendships에 한 줄. 거절·취소는 지우기만(알리지 않는다).
-- 요청은 상태와 처리 시각을 남긴다(수락·거절·취소). 닫힌 요청은 30일 뒤 지운다(Cleanup).
CREATE TABLE IF NOT EXISTS friend_requests (
    id           UUID PRIMARY KEY,
    from_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status       TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    responded_at TIMESTAMPTZ,
    CHECK (from_id <> to_id)
);
ALTER TABLE friend_requests ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE friend_requests ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ;
ALTER TABLE friend_requests DROP CONSTRAINT IF EXISTS friend_requests_from_id_to_id_key;
-- 한 쌍(방향과 상관없이)에 대기 중인 요청은 하나: 서로 동시에 보내도 하나만 남는다
CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_pending_pair ON friend_requests (LEAST(from_id, to_id), GREATEST(from_id, to_id)) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS friend_requests_to_pending ON friend_requests (to_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS friend_requests_from_created ON friend_requests (from_id, created_at);
-- 친구 한 쌍은 한 줄(작은 id가 a). 계정을 지우면 함께 지워진다.
CREATE TABLE IF NOT EXISTS friendships (
    a          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    b          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (a, b),
    CHECK (a < b)
);
CREATE INDEX IF NOT EXISTS friendships_b ON friendships (b);

-- Independent of users: retry revoking a deleted account's Kakao connection.
-- Contains only the provider subject and account UUID; expire within 7 days.
CREATE TABLE IF NOT EXISTS kakao_unlink_jobs (
    subject TEXT PRIMARY KEY,
    account_id UUID NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ
);
