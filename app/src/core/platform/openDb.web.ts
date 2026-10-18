import type { Db, Params } from '../db';
import { CodedError } from '../errors';

/** Electron preload가 노출하는 SQLite 브리지(desktop/preload.cjs). */
type DesktopDb = {
  all(sql: string, params: Params): Promise<Record<string, unknown>[]>;
  run(sql: string, params: Params): Promise<void>;
  exec(sql: string): Promise<void>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  /** 메인 프로세스가 스키마 고치기를 끝내면 풀린다(desktop/main.cjs dbReady) */
  ready?(): Promise<boolean>;
};

declare global {
  interface Window {
    desktop?: { db: DesktopDb; [k: string]: unknown };
  }
}

export const DB_NAME = 'naegirok.db';
export const APP_GROUP = '';

export async function openDb(): Promise<Db> {
  const d = window.desktop?.db;
  if (!d) throw new CodedError('desktop_only', '데스크톱 앱(Electron)에서 실행해야 합니다');
  await d.ready?.();
  return {
    all: <T,>(sql: string, params: Params = []) => d.all(sql, params) as Promise<T[]>,
    run: (sql, params = []) => d.run(sql, params),
    exec: (sql) => d.exec(sql),
    transaction: async (fn) => {
      await d.begin();
      try {
        const r = await fn();
        await d.commit();
        return r;
      } catch (e) {
        await d.rollback();
        throw e;
      }
    },
  };
}
