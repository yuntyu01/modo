import initSqlJs, { type Database } from 'sql.js';

import type { Db, Params } from '../db';

let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;

/** 테스트용 메모리 SQLite. 실제 앱과 같은 SQL을 그대로 돌린다. */
export async function memoryDb(): Promise<Db & { raw: Database }> {
  SQL ??= await initSqlJs();
  const raw = new SQL.Database();
  const all = async <T,>(sql: string, params: Params = []) => {
    const st = raw.prepare(sql);
    st.bind(params);
    const out: T[] = [];
    while (st.step()) out.push(st.getAsObject() as T);
    st.free();
    return out;
  };
  return {
    raw,
    all,
    run: async (sql, params = []) => {
      raw.run(sql, params);
    },
    exec: async (sql) => {
      // sql.js 메모리 DB는 WAL을 지원하지 않는다.
      raw.exec(sql.replace(/PRAGMA journal_mode = WAL;/, ''));
    },
    transaction: async (fn) => {
      raw.run('BEGIN');
      try {
        const r = await fn();
        raw.run('COMMIT');
        return r;
      } catch (e) {
        raw.run('ROLLBACK');
        throw e;
      }
    },
  };
}
