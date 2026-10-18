import { Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

import type { Db } from '../db';

export const DB_NAME = 'naegirok.db';
/** iOS 위젯 확장과 DB를 같이 쓰는 App Group. app.json의 entitlements와 같아야 한다. */
export const APP_GROUP = 'group.com.yuntyu01.naegirok';

/**
 * Android: <filesDir>/SQLite/naegirok.db (Kotlin 위젯·빠른 추가·타일이 같은 경로를 연다)
 * iOS: App Group 컨테이너 (WidgetKit 확장이 같은 파일을 연다)
 */
function directory(): string | undefined {
  if (Platform.OS !== 'ios') return undefined;
  const c = Paths.appleSharedContainers?.[APP_GROUP];
  return c ? decodeURI(c.uri.replace(/^file:\/\//, '')) : undefined;
}

/**
 * JSI 동기 API를 쓴다. 비동기 API는 쿼리마다 스레드를 오가 에뮬레이터에서 삭제 한 번에 0.5초,
 * 다시 읽기에 1초가 걸렸다. 개인 메모 규모에선 동기 쿼리가 1ms 안쪽이다.
 * 트랜잭션은 Repo가 한 줄로 세우므로(Mutex) 직접 BEGIN/COMMIT 한다.
 */
export async function openDb(): Promise<Db> {
  // 개발 중 Fast Refresh로 모듈이 다시 돌아도 연결은 하나만(옛 연결이 잠금을 쥐고 있으면 동기 쿼리가 JS를 멈춘다).
  const g = globalThis as { __modoDb?: SQLite.SQLiteDatabase };
  const db = (g.__modoDb ??= SQLite.openDatabaseSync(DB_NAME, {}, directory()));
  db.execSync('PRAGMA busy_timeout = 3000;');
  return {
    all: async (sql, params = []) => db.getAllSync(sql, params),
    run: async (sql, params = []) => {
      db.runSync(sql, params);
    },
    exec: async (sql) => db.execSync(sql),
    transaction: async (fn) => {
      db.execSync('BEGIN IMMEDIATE');
      try {
        const out = await fn();
        db.execSync('COMMIT');
        return out;
      } catch (e) {
        db.execSync('ROLLBACK');
        throw e;
      }
    },
  };
}
