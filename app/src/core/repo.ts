import type { Db, Params } from './db';
import { Mutex } from './db';
import { keyBetween } from './frac';
import { daysBetween, firstOnOrAfter, fmt, nextDue, ruleOf, shiftTime, type RepeatRule } from './repeat';
import { addDoneDay, removeDoneDay } from './doneLog';
import { MIGRATE_V2, MIGRATE_V3, MIGRATE_V5, SCHEMA, SCHEMA_SHARED, SCHEMA_VERSION } from './schema';
import type { EntityName, Folder, Paragraph, SharedFolder, Snapshot, Todo } from './types';

type Row = Record<string, unknown>;
type FieldChange = { old: unknown; new: unknown };
export type OutboxOp = {
  seq: number;
  op_id: string;
  entity: EntityName;
  entity_id: string;
  is_create: boolean;
  fields: Record<string, FieldChange>;
};

const TABLE: Record<EntityName, string> = { folder: 'folders', todo: 'todos', paragraph: 'paragraphs' };

// 서버와 주고받는 필드. 영구 삭제는 필드가 아니라 op에 purged: true로 보낸다(로컬 행은 바로 지운다).
export const SYNC_FIELDS: Record<EntityName, string[]> = {
  folder: ['name', 'position', 'created_at', 'updated_at', 'deleted_at'],
  todo: ['folder_id', 'text', 'done_at', 'due_date', 'remind_at', 'repeat_freq', 'repeat_days', 'done_log', 'position', 'created_at', 'updated_at', 'deleted_at'],
  paragraph: ['folder_id', 'text', 'position', 'created_at', 'updated_at', 'deleted_at'],
};
/** 서버가 정해 내려 주기만 하는 열 */
const SERVER_FIELDS: Record<EntityName, string[]> = { folder: [], todo: ['conflict_of'], paragraph: ['conflict_of'] };
// 이 필드가 바뀔 때만 '마지막 수정 시각'을 갱신한다(완료 체크, 순서, 분류, 삭제는 내용 변경이 아님).
const CONTENT_FIELDS = new Set(['name', 'text', 'due_date', 'remind_at', 'repeat_freq', 'repeat_days']);
/** 정렬 키가 이보다 길면 그 표의 키를 새로 매긴다. 서버는 200자까지 받는다(server keyRe). */
const LONG_KEY = 64;
const KEY_LIMIT = 200;
/** IN (?, ?, …) 한 번에 넣는 값 수(오래된 SQLite의 변수 999개 제한 아래로) */
const CHUNK = 500;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const toSql = (v: unknown): string | number | null => (v === undefined || v === null ? null : (v as string | number));
/** 글에 섞인 NUL(붙여 넣기 등)은 서버 DB가 받지 않아 저장 전에 뺀다 */
function clean(values: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(values)) out[k] = typeof v === 'string' && v.includes('\u0000') ? v.replace(/\u0000/g, '') : v;
  return out;
}

/** 현지 날짜 'YYYY-MM-DD' */
const localDay = (ms: number) => fmt(new Date(ms));

/**
 * 완료 여부. 반복 할 일은 체크하면 done_at을 남기고 다음 예정일로 넘어가, 그날이 오기 전까지만 완료(맨 아래에 체크된 채)이고
 * 그날이 되면 다시 할 일로 올라온다(done_at이 남아 있어도). 위젯(Kotlin·Swift)도 같은 규칙.
 */
export function isDoneNow(t: Pick<Todo, 'done_at' | 'repeat_freq' | 'due_date'>, today: string) {
  if (t.done_at == null) return false;
  return !(t.repeat_freq && t.due_date && t.due_date <= today);
}

function todoFrom(r: Row, today: string): Todo {
  const t = r as unknown as Todo;
  return { ...t, done: isDoneNow(t, today) };
}

function chunks<T>(list: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}
const marks = (n: number) => Array(n).fill('?').join(', ');

function shallowEqual(a: object, b: object) {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if ((a as Row)[k] !== (b as Row)[k]) return false;
  return true;
}

/**
 * 이전 스냅샷과 같은 행은 같은 객체를, 아무것도 안 바뀌었으면 같은 배열을 돌려준다.
 * 저장할 때마다 모든 행을 새 객체로 만들면 memo된 카드가 전부 다시 그려진다.
 */
function reuse<T extends { id: string }>(prev: T[], next: T[]): T[] {
  const byId = new Map(prev.map((x) => [x.id, x]));
  let changed = prev.length !== next.length;
  const out = next.map((n, i) => {
    const p = byId.get(n.id);
    if (p && shallowEqual(p, n)) {
      if (prev[i] !== p) changed = true;
      return p;
    }
    changed = true;
    return n;
  });
  return changed ? out : prev;
}

/** 화면이 쓰는 표(이 표가 바뀐 쓰기만 스냅샷을 다시 읽게 한다). kv·outbox만 바뀐 쓰기는 화면과 상관없다 */
export const DATA_TABLES = ['folders', 'todos', 'paragraphs', 'shared_folders', 'people'] as const;
export type Touched = ReadonlySet<string>;
/** tables: 이 쓰기가 바꾼 표 이름들. 'remote'는 서버에서 받은 변경 */
export type Listener = (source: 'local' | 'remote', tables: Touched) => void;

// UPDATE는 'UPDATE 표 SET'만(UPSERT의 'DO UPDATE SET'을 표로 잘못 읽지 않게)
const WRITE_RE = /\b(?:(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|DELETE\s+FROM)\s+(\w+)|UPDATE\s+(\w+)\s+SET\b)/gi;
const SCHEMA_RE = /\b(?:ALTER|DROP|CREATE)\s+TABLE\b/i;
/** 쓰기 문장이 바꾸는 표 이름(스키마를 바꾸면 '*' = 전부) */
export function tablesOf(sql: string, into: Set<string>) {
  if (SCHEMA_RE.test(sql)) into.add('*');
  for (const m of sql.matchAll(WRITE_RE)) into.add((m[1] ?? m[2]).toLowerCase());
}

/** 스냅샷의 어느 부분을 다시 읽을지 */
function partsOf(tables: Touched | undefined) {
  const all = !tables || tables.has('*');
  return {
    folders: all || tables.has('folders'),
    todos: all || tables.has('todos'),
    paragraphs: all || tables.has('paragraphs'),
    shared: all || tables.has('shared_folders') || tables.has('people'),
  };
}
/** 이 쓰기가 화면에 보이는 것을 바꿨는지(아니면 다시 읽기·위젯 갱신·다른 창 알림이 필요 없다) */
export function touchesData(tables: Touched) {
  return tables.has('*') || DATA_TABLES.some((t) => tables.has(t));
}

export class Repo {
  /** Called only after an authenticated account deletion was accepted by the server. */
  async eraseLocalData() {
    await this.write(async () => {
      for (const table of ['outbox', 'todos', 'paragraphs', 'folders', 'shared_folders', 'people']) {
        await this.db.run(`DELETE FROM ${table}`);
      }
      await this.db.run(`DELETE FROM kv WHERE key NOT IN ('schema_version', 'prefs')`);
    });
  }
  private mutex = new Mutex();
  private listeners = new Set<Listener>();
  private last: Snapshot = { folders: [], todos: [], paragraphs: [], shared: [] };
  /** 지금 도는 write가 바꾼 표 */
  private touched: Set<string> | null = null;
  /** 지난 스냅샷의 날짜(날이 바뀌면 반복 할 일의 완료 표시가 바뀐다) */
  private lastDay = '';
  /** 쓰기 문장을 지나가며 바꾼 표를 적어 두는 연결(읽기는 그대로) */
  readonly db: Db;

  constructor(
    raw: Db,
    private newId: () => string,
    private now: () => number = () => Date.now(),
  ) {
    const note = (sql: string) => this.touched && tablesOf(sql, this.touched);
    this.db = {
      all: (sql, params) => raw.all(sql, params),
      run: (sql, params) => {
        note(sql);
        return raw.run(sql, params);
      },
      exec: (sql) => {
        note(sql);
        return raw.exec(sql);
      },
      transaction: (fn) => raw.transaction(fn),
    };
  }

  /**
   * 스키마 만들기·고치기. owner=false: 이 연결은 동기화를 하지 않아 outbox를 건드리지 않는다(메인이 보내는 중인 op의 inflight를
   * 풀어 버리면 그 op에 새 변경이 합쳐져 사라질 수 있다). 실제 앱에서는 늘 owner=true다: PC 창은 init을 아예 부르지 않고
   * (AppContext, 메인이 db:ready 전에 마친다) 테스트만 owner=false를 쓴다.
   */
  async init({ owner = true }: { owner?: boolean } = {}) {
    await this.db.exec(SCHEMA);
    const cols = new Set((await this.db.all<{ name: string }>(`PRAGMA table_info(todos)`)).map((c) => c.name));
    if (cols.has('done')) await this.db.exec(MIGRATE_V2);
    // 열 추가는 문장마다 따로, 이미 있으면 넘어간다: 위젯(Kotlin/Swift)이 PRAGMA와 ALTER 사이에 같은 열을 먼저 더했을 수 있다
    // (그러면 'duplicate column'으로 앱이 켜지지 않았다)
    if (!cols.has('repeat_freq')) await this.addColumns(MIGRATE_V3);
    if (!cols.has('done_log')) await this.addColumns(MIGRATE_V5);
    await this.migrateV4();
    await this.db.exec(SCHEMA_SHARED);
    // 예전 버전이 받은 행에는 새 열(반복 등)이 비어 있다. 버전이 오르면 한 번 처음부터 다시 받아 채운다.
    // (위젯이 앱보다 먼저 열을 추가했을 수도 있어 열 유무가 아니라 저장된 버전으로 판단한다)
    const prev = await this.getKv<number>('schema_version', 0);
    if (prev && prev < SCHEMA_VERSION) await this.setKv('sync_cursor', 0);
    // 켤 때마다 쓰지 않고 바뀔 때만(파일 쓰기 잠금을 위젯과 다툰다)
    if (prev !== SCHEMA_VERSION) await this.setKv('schema_version', SCHEMA_VERSION);
    if (!owner) return;
    // 보내는 도중 앱이 죽었으면 다시 보낸다. op_id가 같아 서버가 중복 적용하지 않는다.
    // 서버는 이미 적용했을 수 있으니 '보낸 적 있음'(attempts)도 올린다: 안 올리면 새 편집이 이 op에 합쳐져 버려진다.
    await this.releaseInflight();
    await this.rekeyLongPositions();
  }

  /** 보내는 중이던 op를 다시 보낼 수 있게 되돌린다. 서버가 이미 적용했을 수 있으니 '보낸 적 있음'(attempts)도 올린다(새 편집이 합쳐져 버려지지 않게) */
  private releaseInflight() {
    return this.db.run(`UPDATE outbox SET inflight = 0, attempts = attempts + 1 WHERE inflight = 1`);
  }

  private async addColumns(sql: string) {
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
      try {
        await this.db.exec(stmt);
      } catch (e) {
        if (!/duplicate column/i.test(e instanceof Error ? e.message : String(e))) throw e;
      }
    }
  }

  /**
   * v3 → v4(정규화): 파생 값과 쓰이지 않는 열을 없앤다. 열이 있는 것만 지워 몇 번 돌려도 같다.
   * - owner_id: 폴더/항목마다 복사해 두던 주인. 공유받은 폴더 목록(shared_folders.owner_id)으로 알 수 있다.
   * - shared_folders.owner_email: 주인마다 한 번만(people) 둔다. 옛 owner_id가 남아 있을 때 먼저 옮긴다
   *   (다음 pull 전에도 남의 폴더를 알아보게).
   * - version: 아무도 읽지 않던 서버 수정 횟수.
   * - purged: 영구 삭제한 행(내용을 비운 묘비). 행을 지우고 outbox의 op만 남긴다.
   */
  private async migrateV4() {
    const colsOf = async (t: string) => new Set((await this.db.all<{ name: string }>(`PRAGMA table_info(${t})`)).map((c) => c.name));
    const folderCols = await colsOf('folders');
    const sharedCols = await colsOf('shared_folders');
    const steps: string[] = [];
    if (sharedCols.has('owner_email')) {
      steps.push(`ALTER TABLE shared_folders RENAME TO shared_folders_v3`, SCHEMA_SHARED);
      if (folderCols.has('owner_id')) {
        steps.push(
          `INSERT OR IGNORE INTO shared_folders (folder_id, role, owner_id)
             SELECT s.folder_id, s.role, f.owner_id FROM shared_folders_v3 s JOIN folders f ON f.id = s.folder_id WHERE f.owner_id IS NOT NULL`,
          `INSERT OR IGNORE INTO people (id, email)
             SELECT f.owner_id, s.owner_email FROM shared_folders_v3 s JOIN folders f ON f.id = s.folder_id WHERE f.owner_id IS NOT NULL`,
        );
      }
      steps.push(`DROP TABLE shared_folders_v3`);
    }
    for (const table of ['todos', 'paragraphs', 'folders']) {
      const cols = table === 'folders' ? folderCols : await colsOf(table);
      if (cols.has('purged')) steps.push(`DELETE FROM ${table} WHERE purged = 1`);
      for (const c of ['purged', 'owner_id', 'version']) if (cols.has(c)) steps.push(`ALTER TABLE ${table} DROP COLUMN ${c}`);
    }
    if (!steps.length) return;
    await this.db.transaction(async () => {
      for (const sql of steps) await this.db.exec(sql);
    });
  }

  /**
   * 예전 정렬 키는 맨 뒤(앞)에 붙일 때마다 길어져 1200개쯤이면 서버 한도(200자)를 넘었고, 그 항목들은 서버가 거절했다.
   * 긴 키가 있는 표는 지금 순서 그대로 짧은 키를 새로 매긴다. 200자를 넘던 항목(서버에 없음)은 지금 내용으로 다시 만든다.
   * 공유받은 폴더의 항목은 주인 것이라 건드리지 않는다(폴더 안 순서는 그대로 유지된다).
   */
  private async rekeyLongPositions() {
    for (const entity of ['folder', 'todo', 'paragraph'] as const) {
      const table = TABLE[entity];
      const [{ n }] = await this.db.all<{ n: number | null }>(`SELECT MAX(LENGTH(position)) AS n FROM ${table}`);
      if (!n || n <= LONG_KEY) continue;
      const col = entity === 'folder' ? 'id' : 'folder_id';
      await this.db.transaction(async () => {
        const rows = await this.db.all<Row>(
          `SELECT * FROM ${table} WHERE ${col} IS NULL OR ${col} NOT IN (SELECT folder_id FROM shared_folders) ORDER BY position, id`,
        );
        let key: string | null = null;
        for (const r of rows) {
          key = keyBetween(key, null);
          if ((r.position as string).length <= KEY_LIMIT) {
            await this.patch(entity, r.id as string, { position: key });
            continue;
          }
          await this.db.run(`DELETE FROM outbox WHERE entity_id = ?`, [r.id as string]);
          await this.db.run(`UPDATE ${table} SET position = ? WHERE id = ?`, [key, r.id as string]);
          const fields: Record<string, FieldChange> = {};
          for (const f of SYNC_FIELDS[entity]) fields[f] = { old: null, new: f === 'position' ? key : (r[f] ?? null) };
          await this.enqueue(entity, r.id as string, fields, true);
        }
      });
    }
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  /** tables가 없으면 전부 바뀐 것으로 본다(다른 프로세스·창이 바꿨을 때) */
  private emit(source: 'local' | 'remote', tables: Touched = new Set(['*'])) {
    for (const fn of this.listeners) fn(source, tables);
  }

  /** 모든 쓰기는 이 줄을 탄다. 실제로 바꾼 표가 없으면(같은 값) 알리지 않는다. */
  write<T>(fn: () => Promise<T>, source: 'local' | 'remote' = 'local'): Promise<T> {
    return this.mutex.run(async () => {
      const touched = (this.touched = new Set<string>());
      try {
        const out = await this.db.transaction(fn);
        if (touched.size) this.emit(source, touched);
        return out;
      } finally {
        this.touched = null;
      }
    });
  }
  /** 트랜잭션 없이 같은 줄에서 읽기(쓰기와 엇갈리지 않게). */
  read<T>(fn: () => Promise<T>): Promise<T> {
    return this.mutex.run(fn);
  }

  /**
   * 화면에 쓰는 전체 상태. tables를 주면 그 표만 다시 읽고 나머지는 지난 것을 그대로 쓴다
   * (메모 한 글자 저장에 할 일 2000개까지 다시 읽지 않게). 날이 바뀌면(완료 표시가 바뀐다) 할 일도 다시 읽는다.
   */
  async snapshot(tables?: Touched): Promise<Snapshot> {
    return this.read(async () => {
      const today = localDay(this.now());
      const part = partsOf(tables);
      if (today !== this.lastDay) part.todos = true;
      const prev = this.last;
      // 정렬은 SQLite가(position, id: 둘 다 ASCII라 JS 문자열 비교와 같은 순서)
      const folders = part.folders ? reuse(prev.folders, await this.db.all<Folder>(`SELECT * FROM folders ORDER BY position, id`)) : prev.folders;
      const todos = part.todos
        ? reuse(prev.todos, (await this.db.all(`SELECT * FROM todos ORDER BY position, id`)).map((r) => todoFrom(r, today)))
        : prev.todos;
      const paragraphs = part.paragraphs ? reuse(prev.paragraphs, await this.db.all<Paragraph>(`SELECT * FROM paragraphs ORDER BY position, id`)) : prev.paragraphs;
      let shared = prev.shared;
      if (part.shared) {
        const next: SharedFolder[] = (
          await this.db.all<Row>(
            `SELECT s.folder_id, s.role, s.owner_id, p.email, p.name FROM shared_folders s LEFT JOIN people p ON p.id = s.owner_id ORDER BY s.folder_id`,
          )
        ).map((r) => ({
          folder_id: r.folder_id as string,
          role: r.role as SharedFolder['role'],
          owner: { id: r.owner_id as string, email: (r.email as string) ?? '', name: (r.name as string) ?? '' },
        }));
        if (!same(prev.shared, next)) shared = next;
      }
      this.lastDay = today;
      if (folders === prev.folders && todos === prev.todos && paragraphs === prev.paragraphs && shared === prev.shared) return prev;
      this.last = { folders, todos, paragraphs, shared };
      return this.last;
    });
  }

  // ---------- 설정(kv) ----------
  async getKv<T>(key: string, fallback: T): Promise<T> {
    const rows = await this.db.all<{ value: string }>(`SELECT value FROM kv WHERE key = ?`, [key]);
    if (!rows.length) return fallback;
    try {
      return JSON.parse(rows[0].value) as T;
    } catch {
      return fallback;
    }
  }
  async setKv(key: string, value: unknown) {
    await this.db.run(`INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [
      key,
      JSON.stringify(value),
    ]);
  }

  // ---------- 공통 쓰기 ----------
  private async row(entity: EntityName, id: string): Promise<Row | undefined> {
    return (await this.db.all(`SELECT * FROM ${TABLE[entity]} WHERE id = ?`, [id]))[0];
  }

  private async insert(entity: EntityName, raw: Row) {
    const values = clean(raw);
    const cols = Object.keys(values);
    await this.db.run(
      `INSERT INTO ${TABLE[entity]} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((c) => toSql(values[c])),
    );
    const fields: Record<string, FieldChange> = {};
    for (const f of SYNC_FIELDS[entity]) if (f in values) fields[f] = { old: null, new: values[f] ?? null };
    await this.enqueue(entity, values.id as string, fields, true);
  }

  /** 실제로 바뀐 필드만 쓰고 큐에 넣는다. 바뀐 게 없으면 false. */
  private async patch(entity: EntityName, id: string, raw: Row): Promise<boolean> {
    const values = clean(raw);
    const cur = await this.row(entity, id);
    if (!cur) return false;
    const changed: Row = {};
    for (const [k, v] of Object.entries(values)) {
      if (!same(cur[k], v)) changed[k] = v;
    }
    if (!Object.keys(changed).length) return false;
    if (!('updated_at' in values) && Object.keys(changed).some((k) => CONTENT_FIELDS.has(k))) changed.updated_at = this.now();
    const cols = Object.keys(changed);
    await this.db.run(
      `UPDATE ${TABLE[entity]} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...cols.map((c) => toSql(changed[c])), id] as Params,
    );
    const fields: Record<string, FieldChange> = {};
    for (const c of cols) {
      if (SYNC_FIELDS[entity].includes(c)) fields[c] = { old: cur[c] ?? null, new: changed[c] ?? null };
    }
    await this.enqueue(entity, id, fields, false);
    return true;
  }

  /** 영구 삭제: 행은 바로 지우고, 다른 기기도 지우도록 op만 남긴다. */
  private async purgeRow(entity: 'todo' | 'paragraph', id: string) {
    if (!(await this.row(entity, id))) return;
    await this.db.run(`DELETE FROM ${TABLE[entity]} WHERE id = ?`, [id]);
    await this.enqueue(entity, id, { purged: { old: false, new: true } }, false);
  }

  /**
   * 아직 안 보낸 같은 항목의 op가 있으면 합친다(처음 old는 유지, new만 갱신).
   * - 한 번이라도 보낸 op에는 합치지 않는다(아래 쿼리 설명).
   * - 아직 서버에 안 간 '만들기'를 영구 삭제하면 op째 버린다(서버는 몰라도 된다).
   * - 폴더로 옮기는 변경은 그 뒤에 다른 op가 있으면 합치지 않는다: 그 사이 만든 폴더의 op보다 먼저 서버에 가면
   *   서버에 없는 폴더를 가리키게 된다(서버는 폴더 FK를 건다).
   */
  private async enqueue(entity: EntityName, id: string, fields: Record<string, FieldChange>, isCreate: boolean) {
    if (!Object.keys(fields).length) return;
    const prev = (
      await this.db.all<{ seq: number; fields: string; is_create: number }>(
        // 한 번이라도 보낸 op(attempts > 0)에는 합치지 않는다: 응답만 잃었고 서버는 이미 적용했을 수 있어,
        // 같은 op_id로 다시 보내면 서버가 저장해 둔 결과만 돌려주고 합친 변경은 버려진다.
        `SELECT seq, fields, is_create FROM outbox WHERE entity_id = ? AND inflight = 0 AND attempts = 0 ORDER BY seq DESC LIMIT 1`,
        [id],
      )
    )[0];
    let mergeable = !!prev;
    if (prev && fields.folder_id?.new != null) {
      // 그 뒤에 '그 폴더 만들기' op가 있을 때만 합치지 않는다(예전엔 어떤 op든 뒤에 있으면 안 합쳐, 폴더 삭제 + 되돌리기가
      // 항목마다 상쇄되는 op 둘을 남겼다)
      mergeable = !(
        await this.db.all(`SELECT 1 FROM outbox WHERE entity = 'folder' AND entity_id = ? AND is_create = 1 AND seq > ? LIMIT 1`, [
          fields.folder_id.new as string,
          prev.seq,
        ])
      ).length;
    }
    if (prev && mergeable) {
      if (prev.is_create && fields.purged) {
        await this.db.run(`DELETE FROM outbox WHERE seq = ?`, [prev.seq]);
        return;
      }
      const merged: Record<string, FieldChange> = JSON.parse(prev.fields);
      for (const [k, ch] of Object.entries(fields)) {
        merged[k] = merged[k] ? { old: merged[k].old, new: ch.new } : ch;
      }
      if (!prev.is_create) for (const k of Object.keys(merged)) if (same(merged[k].old, merged[k].new)) delete merged[k];
      if (!Object.keys(merged).length) await this.db.run(`DELETE FROM outbox WHERE seq = ?`, [prev.seq]);
      else await this.db.run(`UPDATE outbox SET fields = ? WHERE seq = ?`, [JSON.stringify(merged), prev.seq]);
      return;
    }
    await this.db.run(
      `INSERT INTO outbox (op_id, entity, entity_id, is_create, fields, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [this.newId(), entity, id, isCreate ? 1 : 0, JSON.stringify(fields), this.now()],
    );
  }

  private async edgeKey(table: string, where: string, params: Params, end: 'first' | 'last') {
    const agg = end === 'first' ? 'MIN' : 'MAX';
    const r = await this.db.all<{ k: string | null }>(`SELECT ${agg}(position) AS k FROM ${table} WHERE ${where}`, params);
    return r[0]?.k ?? null;
  }

  // ---------- 폴더 ----------
  createFolder(name: string) {
    return this.write(async () => {
      const id = this.newId();
      const t = this.now();
      const last = await this.edgeKey('folders', '1 = 1', [], 'last');
      await this.insert('folder', { id, name: name.trim(), position: keyBetween(last, null), created_at: t, updated_at: t });
      return id;
    });
  }
  renameFolder(id: string, name: string) {
    return this.write(() => this.patch('folder', id, { name: name.trim() }));
  }
  /** 폴더만 지우고 내용은 기본 폴더(폴더 없음)로 옮긴다. 실행 취소용으로 옮긴 항목을 돌려준다. */
  deleteFolder(id: string) {
    return this.write(async () => {
      const moved: { todo: string[]; paragraph: string[] } = { todo: [], paragraph: [] };
      for (const entity of ['todo', 'paragraph'] as const) {
        const rows = await this.db.all<{ id: string }>(`SELECT id FROM ${TABLE[entity]} WHERE folder_id = ?`, [id]);
        for (const r of rows) {
          await this.patch(entity, r.id, { folder_id: null });
          moved[entity].push(r.id);
        }
      }
      await this.patch('folder', id, { deleted_at: this.now() });
      return moved;
    });
  }
  undoDeleteFolder(id: string, moved: { todo: string[]; paragraph: string[] }) {
    return this.write(async () => {
      await this.patch('folder', id, { deleted_at: null });
      for (const entity of ['todo', 'paragraph'] as const) {
        for (const itemId of moved[entity]) await this.patch(entity, itemId, { folder_id: id });
      }
    });
  }

  // ---------- 할 일 ----------
  /** due: 캘린더에서 날짜를 고른 채 추가하면 그 날짜(YYYY-MM-DD)를 바로 붙인다 */
  addTodo(text: string, folderId: string | null, where: 'top' | 'bottom', due: string | null = null) {
    return this.write(async () => {
      const id = this.newId();
      const t = this.now();
      const edge = await this.edgeKey('todos', '1 = 1', [], where === 'top' ? 'first' : 'last');
      const position = where === 'top' ? keyBetween(null, edge) : keyBetween(edge, null);
      await this.insert('todo', { id, folder_id: folderId, text, position, ...(due ? { due_date: due } : null), created_at: t, updated_at: t });
      return id;
    });
  }
  setTodoText(id: string, text: string) {
    return this.write(() => this.patch('todo', id, { text }));
  }
  setDone(id: string, done: boolean) {
    return this.write(() => this.patch('todo', id, { done_at: done ? this.now() : null }));
  }
  setDue(id: string, due: string | null) {
    return this.write(() => this.patch('todo', id, { due_date: due }));
  }
  setRemind(id: string, at: number | null) {
    return this.write(() => this.patch('todo', id, { remind_at: at }));
  }
  /**
   * 반복 정하기/없애기. 정하면 시작일 당일이나 그 뒤 규칙에 맞는 첫날을 예정일로 두고(그날부터 보이고, 체크하면 다음 날로 넘어간다)
   * (시작일을 그대로 두면 일요일에 '매주 금요일'로 정한 할 일이 그날 '오늘', 다음 날 '1일 지남'으로 보였다)
   * 알림도 같은 날만큼 옮기고 완료 표시를 푼다. 없애면 반복만 지우고 예정일은 그대로 둔다.
   */
  setRepeat(id: string, rule: RepeatRule | null, start: string) {
    return this.write(async () => {
      if (!rule) return void (await this.patch('todo', id, { repeat_freq: null, repeat_days: null }));
      const cur = await this.row('todo', id);
      if (!cur) return;
      const due = firstOnOrAfter(rule, start);
      const remind = cur.remind_at as number | null;
      const from = (cur.due_date as string | null) ?? (remind != null ? localDay(remind) : due);
      await this.patch('todo', id, {
        repeat_freq: rule.freq,
        repeat_days: rule.freq === 'weekly' ? rule.days : null,
        due_date: due,
        remind_at: remind != null ? shiftTime(remind, daysBetween(from, due)) : null,
        done_at: null,
      });
    });
  }
  /**
   * 체크. 반복이 아니면 완료로 두고 null, 반복이면 다음 예정일로 넘기고(알림도 함께) 실행 취소용 이전 값을 돌려준다.
   */
  complete(id: string) {
    return this.write(async () => {
      const cur = await this.row('todo', id);
      if (!cur) return null;
      const rule = ruleOf(cur as unknown as Todo);
      if (!rule) {
        await this.patch('todo', id, { done_at: this.now() });
        return null;
      }
      const prev = { due_date: cur.due_date as string | null, remind_at: cur.remind_at as number | null, done_log: (cur.done_log as string | null) ?? null };
      const today = localDay(this.now());
      const next = nextDue(rule, prev.due_date, today);
      const remind = prev.remind_at != null ? shiftTime(prev.remind_at, daysBetween(prev.due_date ?? localDay(prev.remind_at), next)) : null;
      // 이번 회차 완료: 다음 예정일까지는 완료로 맨 아래에 남고(isDoneNow), 오늘을 '한 날'로 남긴다(달력·홈의 이번 주 기록)
      await this.patch('todo', id, { due_date: next, remind_at: remind, done_at: this.now(), done_log: addDoneDay(prev.done_log, today) });
      return { next, prev };
    });
  }
  undoComplete(id: string, prev: { due_date: string | null; remind_at: number | null; done_at?: number | null; done_log?: string | null }) {
    return this.write(() => this.patch('todo', id, { done_at: null, ...prev }));
  }
  /** 완료해 둔 반복 할 일의 체크를 풀면 오늘 할 일로 되돌린다(알림도 같은 날만큼 당긴다). */
  reopenRepeat(id: string) {
    return this.write(async () => {
      const cur = await this.row('todo', id);
      if (!cur) return;
      const today = localDay(this.now());
      const due = (cur.due_date as string | null) ?? today;
      const remind = cur.remind_at as number | null;
      await this.patch('todo', id, {
        done_at: null,
        due_date: today,
        remind_at: remind != null ? shiftTime(remind, daysBetween(due, today)) : null,
        done_log: removeDoneDay(cur.done_log as string | null, today),
      });
    });
  }
  /** 끌어서 놓은 자리의 앞뒤 키 사이로 옮긴다. */
  moveTo(entity: 'todo' | 'paragraph', id: string, prevKey: string | null, nextKey: string | null) {
    return this.write(() => this.patch(entity, id, { position: keyBetween(prevKey, nextKey) }));
  }

  // ---------- 메모 문단 ----------
  /** 메모 끝에 이어 쓴다. 줄마다 문단 하나. */
  appendParagraphs(text: string, folderId: string | null) {
    return this.write(async () => {
      let last = await this.edgeKey('paragraphs', '1 = 1', [], 'last');
      const ids: string[] = [];
      for (const line of text.split('\n')) {
        const id = this.newId();
        const t = this.now();
        last = keyBetween(last, null);
        await this.insert('paragraph', { id, folder_id: folderId, text: line, position: last, created_at: t, updated_at: t });
        ids.push(id);
      }
      return ids;
    });
  }
  setParagraphText(id: string, text: string) {
    return this.write(() => this.patch('paragraph', id, { text }));
  }
  /** 문단 편집 중 줄바꿈: 앞부분은 그대로, 뒷부분은 바로 뒤 새 문단으로. */
  splitParagraph(id: string, before: string, after: string[]) {
    return this.write(async () => {
      const cur = await this.row('paragraph', id);
      if (!cur) return [];
      await this.patch('paragraph', id, { text: before });
      let prev = cur.position as string;
      const next = await this.edgeKey('paragraphs', 'position > ?', [prev], 'first');
      const ids: string[] = [];
      for (const line of after) {
        const nid = this.newId();
        const t = this.now();
        prev = keyBetween(prev, next);
        await this.insert('paragraph', {
          id: nid,
          folder_id: cur.folder_id,
          text: line,
          position: prev,
          created_at: t,
          updated_at: t,
        });
        ids.push(nid);
      }
      return ids;
    });
  }
  /** 문단 맨 앞에서 지우기: 앞 문단 끝에 붙이고 이 문단은 없앤다. */
  mergeParagraphInto(prevId: string, id: string) {
    return this.write(async () => {
      const [a, b] = [await this.row('paragraph', prevId), await this.row('paragraph', id)];
      if (!a || !b) return;
      await this.patch('paragraph', prevId, { text: `${a.text}${b.text}` });
      await this.purgeRow('paragraph', id);
    });
  }

  // ---------- 분류·삭제 공통 ----------
  setFolder(entity: 'todo' | 'paragraph', id: string, folderId: string | null) {
    return this.write(() => this.patch(entity, id, { folder_id: folderId }));
  }
  trash(entity: 'todo' | 'paragraph', ids: string[]) {
    return this.write(async () => {
      const t = this.now();
      for (const id of ids) await this.patch(entity, id, { deleted_at: t });
    });
  }
  restore(entity: 'todo' | 'paragraph' | 'folder', ids: string[]) {
    return this.write(async () => {
      for (const id of ids) await this.patch(entity, id, { deleted_at: null });
    });
  }
  /** 휴지통에서 영구 삭제. */
  purge(entity: 'todo' | 'paragraph', ids: string[]) {
    return this.write(async () => {
      for (const id of ids) await this.purgeRow(entity, id);
    });
  }
  /** 한 폴더의 완료한 할 일을 휴지통으로. null = 기본 폴더(폴더 없음, 또는 없어진 폴더를 가리키는 항목). */
  clearDone(folderId: string | null) {
    return this.write(async () => {
      const where = folderId
        ? `AND folder_id = ?`
        : `AND (folder_id IS NULL OR folder_id NOT IN (SELECT id FROM folders WHERE deleted_at IS NULL))`;
      const rows = await this.db.all<{ id: string }>(
        // 반복 할 일은 완료해도 다음 회차가 있어 지우지 않는다
        `SELECT id FROM todos WHERE done_at IS NOT NULL AND repeat_freq IS NULL AND deleted_at IS NULL ${where}`,
        folderId ? [folderId] : [],
      );
      const t = this.now();
      for (const r of rows) await this.patch('todo', r.id, { deleted_at: t });
      return rows.map((r) => r.id);
    });
  }

  // ---------- 동기화 지원 ----------
  async takeOutbox(limit: number): Promise<OutboxOp[]> {
    return this.mutex.run(async () => {
      // 비어 있으면 쓰기 트랜잭션을 열지 않는다(30초마다 도는 빈 동기화가 매번 파일 쓰기 잠금을 잡아, 그 사이 위젯·빠른 추가의 쓰기가 기다렸다)
      if (!(await this.db.all(`SELECT 1 FROM outbox LIMIT 1`)).length) return [];
      return this.db.transaction(async () => {
        const rows = await this.db.all<Row>(`SELECT * FROM outbox ORDER BY seq LIMIT ?`, [limit]);
        if (rows.length) {
          await this.db.run(`UPDATE outbox SET inflight = 1 WHERE seq <= ?`, [rows[rows.length - 1].seq as number]);
        }
        return rows.map((r) => ({
          seq: r.seq as number,
          op_id: r.op_id as string,
          entity: r.entity as EntityName,
          entity_id: r.entity_id as string,
          is_create: !!r.is_create,
          fields: JSON.parse(r.fields as string),
        }));
      });
    });
  }
  releaseOutbox() {
    return this.mutex.run(() => this.releaseInflight());
  }
  ackOutbox(opIds: string[]) {
    return this.mutex.run(() =>
      this.db.transaction(async () => {
        for (const ids of chunks(opIds)) await this.db.run(`DELETE FROM outbox WHERE op_id IN (${marks(ids.length)})`, ids);
      }),
    );
  }
  async outboxCount() {
    const r = await this.db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM outbox`);
    return r[0].n;
  }

  /** 이 id들 중 아직 안 보낸 로컬 변경이 있는 것과 그 필드 */
  private async pendingFields(ids: string[]) {
    const pending = new Map<string, Set<string>>();
    for (const part of chunks(ids)) {
      const rows = await this.db.all<{ entity_id: string; fields: string }>(
        `SELECT entity_id, fields FROM outbox WHERE entity_id IN (${marks(part.length)})`,
        part,
      );
      for (const r of rows) {
        const set = pending.get(r.entity_id) ?? new Set<string>();
        for (const k of Object.keys(JSON.parse(r.fields))) set.add(k);
        pending.set(r.entity_id, set);
      }
    }
    return pending;
  }

  /** 이미 있는 행의 지금 값(받은 값과 같은 칸은 다시 쓰지 않으려고) */
  private async existingRows(table: string, ids: string[], columns: string[]) {
    const out = new Map<string, Row>();
    for (const part of chunks(ids)) {
      const rows = await this.db.all<Row>(`SELECT id, ${columns.join(', ')} FROM ${table} WHERE id IN (${marks(part.length)})`, part);
      for (const r of rows) out.set(r.id as string, r);
    }
    return out;
  }

  /**
   * 서버에서 받은 행을 반영한다(한 페이지의 outbox·기존 행을 먼저 한꺼번에 읽는다).
   * - 아직 안 보낸 로컬 변경이 있는 필드는 건드리지 않는다(push에서 서버가 판정).
   * - 지금 편집 중인 항목의 text는 미뤄서 커서와 작성 중인 글이 바뀌지 않게 한다.
   * - deleted: 다른 기기가 영구 삭제한 항목.
   * - 이미 같은 값인 칸은 다시 쓰지 않는다: 서버는 이 기기가 보낸 변경도 돌려주고, 처음부터 다시 받을 때(로그인·거절 뒤)는
   *   모든 행이 온다. 예전엔 바뀐 것이 없어도 행마다 UPDATE해 화면·위젯을 다시 읽고 그렸다.
   */
  async applyRemote(
    page: { folders: Row[]; todos: Row[]; paragraphs: Row[]; deleted?: { id: string; entity: EntityName }[] },
    editing: Set<string>,
    deferred: Map<string, { entity: EntityName; text: string }>,
  ) {
    await this.write(async () => {
      const all = [...page.folders, ...page.todos, ...page.paragraphs].map((r) => r.id as string);
      const pending = await this.pendingFields(all);
      for (const [entity, rows] of [
        ['folder', page.folders],
        ['todo', page.todos],
        ['paragraph', page.paragraphs],
      ] as [EntityName, Row[]][]) {
        if (!rows.length) continue;
        const table = TABLE[entity];
        const columns = [...SYNC_FIELDS[entity], ...SERVER_FIELDS[entity]];
        const existing = await this.existingRows(table, rows.map((r) => r.id as string), columns);
        for (const remote of rows) {
          const id = remote.id as string;
          const mine = pending.get(id);
          const local = existing.get(id);
          if (!local) {
            // 여기서 영구 삭제하고 아직 못 보낸 항목은 되살리지 않는다.
            if (mine?.has('purged')) continue;
            await this.db.run(
              `INSERT INTO ${table} (id, ${columns.join(', ')}) VALUES (?, ${marks(columns.length)})`,
              [id, ...columns.map((k) => toSql(remote[k]))],
            );
            continue;
          }
          const values: Row = {};
          for (const f of columns) {
            if (mine?.has(f)) continue;
            if (toSql(remote[f]) === local[f]) continue;
            if (f === 'text' && editing.has(id)) {
              deferred.set(id, { entity, text: remote.text as string });
              continue;
            }
            values[f] = remote[f];
          }
          const cols = Object.keys(values);
          if (!cols.length) continue;
          await this.db.run(
            `UPDATE ${table} SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
            [...cols.map((k) => toSql(values[k])), id],
          );
        }
      }
      for (const d of page.deleted ?? []) {
        const table = TABLE[d.entity];
        if (!table || d.entity === 'folder') continue;
        await this.db.run(`DELETE FROM ${table} WHERE id = ?`, [d.id]);
        // 지워진 항목에 대한 내 변경은 보낼 곳이 없다
        await this.db.run(`DELETE FROM outbox WHERE entity_id = ? AND inflight = 0`, [d.id]);
      }
    }, 'remote');
  }

  /** 편집이 끝난 항목에 미뤄 둔 원격 text를 반영(그 사이 내가 고쳤으면 push 결과로 정리되므로 건너뜀). */
  async applyDeferred(id: string, deferred: Map<string, { entity: EntityName; text: string }>) {
    const d = deferred.get(id);
    if (!d) return;
    deferred.delete(id);
    await this.write(async () => {
      const pending = await this.db.all(`SELECT 1 FROM outbox WHERE entity_id = ? AND fields LIKE '%"text"%'`, [id]);
      if (!pending.length) await this.db.run(`UPDATE ${TABLE[d.entity]} SET text = ? WHERE id = ?`, [d.text, id]);
    }, 'remote');
  }

  /** 남의 폴더(이번 또는 지난번 공유 목록)와 그 안의 항목 id */
  private async foreignRows(folderIds: string[]) {
    const out: { table: string; id: string }[] = [];
    for (const part of chunks(folderIds)) {
      const q = marks(part.length);
      for (const r of await this.db.all<{ id: string }>(`SELECT id FROM folders WHERE id IN (${q})`, part)) out.push({ table: 'folders', id: r.id });
      for (const table of ['todos', 'paragraphs']) {
        for (const r of await this.db.all<{ id: string }>(`SELECT id FROM ${table} WHERE folder_id IN (${q})`, part)) out.push({ table, id: r.id });
      }
    }
    return out;
  }

  /**
   * 공유가 끊기거나 공유 폴더에서 빠진 남의 항목을 지우고, 공유 목록(과 주인)을 서버 것으로 바꾼다.
   * 방금 만들어 아직 못 보낸 항목은 남긴다(다음 push 결과를 보고 판단).
   */
  /**
   * visibleForeign: 서버가 알려 준 남의 항목 전체(null = 지난번과 같다고 서버가 알려 줌: 지울 것은 보지 않고 공유 목록만 맞춘다).
   * 돌려주는 값: 못 보낸 변경 때문에 남겨 둔 남의 항목이 없으면 true(다음에 서버 요약과 비교해도 된다).
   */
  async sweepForeign(visibleForeign: string[] | null, shared: SharedFolder[]): Promise<boolean> {
    // 먼저 읽기만 해서 지울 것도 바뀐 공유도 없으면 쓰지 않는다. 30초마다 도는 빈 동기화가 매번 공유 표를 지우고 다시 넣어
    // 화면 다시 읽기·위젯 갱신·다른 창 알림을 일으켰다(2026-10-18 측정). 실제로 바뀔 때만 아래 쓰기를 탄다.
    const changed = await this.read(async () => {
      const keep = new Set(visibleForeign ?? []);
      const before = await this.db.all<{ folder_id: string; role: string; owner_id: string }>(`SELECT folder_id, role, owner_id FROM shared_folders ORDER BY folder_id`);
      const people = await this.db.all<{ id: string; email: string; name: string }>(`SELECT id, email, name FROM people ORDER BY id`);
      const past = await this.getKv<string[]>('past_shared', []);
      const folders = [...new Set([...past, ...before.map((r) => r.folder_id), ...shared.map((x) => x.folder_id)])];
      if (past.length) return true;
      if (visibleForeign) {
        const rows = folders.length ? await this.foreignRows(folders) : [];
        if (rows.some((r) => !keep.has(r.id))) return true;
      }
      const want = [...shared].sort((a, b) => (a.folder_id < b.folder_id ? -1 : 1));
      const wantPeople = [...new Map(shared.map((x) => [x.owner.id, { id: x.owner.id, email: x.owner.email ?? '', name: x.owner.name ?? '' }])).values()].sort((a, b) =>
        a.id < b.id ? -1 : 1,
      );
      return (
        !same(
          before.map((r) => [r.folder_id, r.role, r.owner_id]),
          want.map((x) => [x.folder_id, x.role, x.owner.id]),
        ) || !same(people.map((r) => [r.id, r.email, r.name]), wantPeople.map((r) => [r.id, r.email, r.name]))
      );
    });
    if (!changed) return true;
    let clean = true;
    await this.write(async () => {
      const keep = new Set(visibleForeign ?? []);
      const before = (await this.db.all<{ folder_id: string }>(`SELECT folder_id FROM shared_folders`)).map((r) => r.folder_id);
      // 공유가 끊긴 뒤에도 못 보낸 변경 때문에 남겨 둔 항목이 있으면 그 폴더를 기억해 다음에 다시 본다
      const past = await this.getKv<string[]>('past_shared', []);
      const folders = [...new Set([...past, ...before, ...shared.map((s) => s.folder_id)])];
      // 서버가 '같다'고 했으면 남의 항목은 지우지 않는다(공유 목록만 바꾼다)
      const rows = visibleForeign ? await this.foreignRows(folders) : [];
      const pending = await this.pendingFields(rows.map((r) => r.id));
      const left = new Set<string>();
      for (const r of rows) {
        if (keep.has(r.id)) continue;
        if (pending.has(r.id)) {
          left.add(r.table === 'folders' ? r.id : ((await this.db.all<{ f: string }>(`SELECT folder_id AS f FROM ${r.table} WHERE id = ?`, [r.id]))[0]?.f ?? ''));
          continue;
        }
        await this.db.run(`DELETE FROM ${r.table} WHERE id = ?`, [r.id]);
      }
      const nowShared = new Set(shared.map((s) => s.folder_id));
      const stillLeft = [...left].filter((f) => f && !nowShared.has(f));
      clean = left.size === 0;
      await this.setKv('past_shared', stillLeft);
      await this.db.run(`DELETE FROM shared_folders`);
      await this.db.run(`DELETE FROM people`);
      for (const s of shared) {
        await this.db.run(`INSERT INTO shared_folders (folder_id, role, owner_id) VALUES (?, ?, ?)`, [s.folder_id, s.role, s.owner.id]);
        await this.db.run(`INSERT OR REPLACE INTO people (id, email, name) VALUES (?, ?, ?)`, [s.owner.id, s.owner.email ?? '', s.owner.name ?? '']);
      }
    }, 'remote');
    return clean;
  }

  /**
   * 로그아웃: 남의 공유 내용은 지우고, 내 기록은 이 기기에 남긴 채 '로그인 전' 상태로 되돌린다.
   * 보내지 못한 변경(outbox)은 그대로 둔다: 로그아웃한 동안 고친 것도 계속 쌓이고(이전값 포함),
   * 같은 계정으로 다시 로그인하면 그대로 보내 다른 기기가 그 사이 고친 것과 정상적으로 비교된다.
   * 다른 계정으로 로그인하면 reuploadAll로 전부 다시 올린다.
   */
  async detachFromAccount() {
    await this.write(async () => {
      const shared = (await this.db.all<{ folder_id: string }>(`SELECT folder_id FROM shared_folders`)).map((r) => r.folder_id);
      // 공유가 끊긴 뒤 못 보낸 변경 때문에 남겨 둔 남의 항목(past_shared)도 함께 지운다. 안 지우면 로그아웃 뒤에도 남의 항목이
      // 남아, 다음 로그인에서 고칠 때마다 서버가 거절하고(forbidden) 처음부터 다시 받았다
      const past = await this.getKv<string[]>('past_shared', []);
      const foreign = await this.foreignRows([...new Set([...shared, ...past])]);
      for (const r of foreign) {
        await this.db.run(`DELETE FROM ${r.table} WHERE id = ?`, [r.id]);
        await this.db.run(`DELETE FROM outbox WHERE entity_id = ?`, [r.id]);
      }
      await this.db.run(`DELETE FROM shared_folders`);
      await this.db.run(`DELETE FROM people`);
      await this.releaseInflight();
      await this.db.run(`DELETE FROM kv WHERE key IN ('sync_cursor', 'past_shared', 'foreign_digest')`);
    });
  }

  /** 처음 로그인하거나 다른 계정으로 바꿀 때: 이 기기의 기록을 전부 그 계정에 올린다(같은 id라 같은 계정이면 중복 없음). */
  async reuploadAll() {
    await this.write(async () => {
      await this.db.run(`DELETE FROM outbox`);
      for (const [entity, table] of Object.entries(TABLE) as [EntityName, string][]) {
        for (const r of await this.db.all<Row>(`SELECT * FROM ${table}`)) {
          const fields: Record<string, FieldChange> = {};
          for (const f of SYNC_FIELDS[entity]) fields[f] = { old: null, new: r[f] ?? null };
          await this.enqueue(entity, r.id as string, fields, true);
        }
      }
    });
  }

  // ---------- 백업 ----------
  /** 남이 공유해 준 폴더와 그 항목은 뺀다(내 것이 아니다. 가져오기에서 '내가 만든 것'으로 올라가 서버가 거절하고 처음부터 다시 받았다) */
  async exportAll() {
    return this.read(async () => ({
      app: 'modo',
      version: 2,
      exported_at: this.now(),
      folders: await this.db.all(`SELECT * FROM folders WHERE id NOT IN (SELECT folder_id FROM shared_folders)`),
      todos: await this.db.all(`SELECT * FROM todos WHERE folder_id IS NULL OR folder_id NOT IN (SELECT folder_id FROM shared_folders)`),
      paragraphs: await this.db.all(`SELECT * FROM paragraphs WHERE folder_id IS NULL OR folder_id NOT IN (SELECT folder_id FROM shared_folders)`),
    }));
  }

  /** 가져오기: 같은 id는 더 늦게 수정된 쪽, 없는 id는 새로 추가. 결과는 동기화 큐에도 들어간다. */
  importAll(data: { folders?: Row[]; todos?: Row[]; paragraphs?: Row[] }) {
    return this.write(async () => {
      let added = 0;
      let updated = 0;
      // 남이 공유해 준 폴더(예전 백업에 섞여 있을 수 있다)는 건너뛴다. 보기 전용이면 그 항목도
      const sharedRole = new Map((await this.db.all<{ folder_id: string; role: string }>(`SELECT folder_id, role FROM shared_folders`)).map((r) => [r.folder_id, r.role]));
      for (const [entity, rows] of [
        ['folder', data.folders ?? []],
        ['todo', data.todos ?? []],
        ['paragraph', data.paragraphs ?? []],
      ] as [EntityName, Row[]][]) {
        for (const r of rows) {
          // 예전 백업(v1)에는 영구 삭제 표시 행이 있을 수 있다
          if (typeof r.id !== 'string' || r.purged) continue;
          if (entity === 'folder' ? sharedRole.has(r.id) : typeof r.folder_id === 'string' && sharedRole.get(r.folder_id) === 'view') continue;
          const values: Row = { id: r.id };
          for (const f of SYNC_FIELDS[entity]) if (f in r) values[f] = r[f];
          const cur = await this.row(entity, r.id);
          if (!cur) {
            await this.insert(entity, values);
            added++;
          } else if (Number(r.updated_at) > Number(cur.updated_at)) {
            const { id: _id, ...rest } = values;
            await this.patch(entity, r.id, rest);
            updated++;
          }
        }
      }
      return { added, updated };
    });
  }
}
