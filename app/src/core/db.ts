export type Params = (string | number | null)[];

/** 플랫폼별 SQLite 구현(Android/iOS: expo-sqlite, 데스크톱: Electron 메인 프로세스, 테스트: sql.js)이 따르는 최소 인터페이스. */
export interface Db {
  all<T = Record<string, unknown>>(sql: string, params?: Params): Promise<T[]>;
  run(sql: string, params?: Params): Promise<void>;
  exec(sql: string): Promise<void>;
  /** fn 안의 쿼리를 한 트랜잭션으로 묶는다. 호출자는 동시에 두 트랜잭션을 열지 않는다(Repo가 직렬화). */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

/** 비동기 작업을 한 줄로 세운다. 쓰기와 동기화가 섞여 트랜잭션이 겹치지 않게 한다. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => {});
    return next;
  }
}
