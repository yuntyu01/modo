// 데스크톱 SQLite: Electron에 들어 있는 Node의 node:sqlite를 쓴다(네이티브 모듈 빌드가 필요 없다).
// 스키마와 쿼리는 렌더러(app/src/core)와 메인 동기화(sync-host.cjs)가 보내고, 여기서는 실행만 한다.
const { DatabaseSync } = require('node:sqlite');

/** 준비해 둔 문장 수 상한. IN (?, ?, …) 처럼 값 개수마다 문장이 달라지는 쿼리가 있어 끝없이 쌓이지 않게 오래 안 쓴 것부터 버린다 */
const MAX_STATEMENTS = 200;

class DesktopDb {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA busy_timeout = 3000; PRAGMA journal_mode = WAL;');
    this.statements = new Map();
  }
  prepare(sql) {
    let st = this.statements.get(sql);
    if (st) {
      // 최근에 쓴 것으로 옮긴다(Map은 넣은 순서를 지킨다)
      this.statements.delete(sql);
    } else {
      st = this.db.prepare(sql);
      if (this.statements.size >= MAX_STATEMENTS) this.statements.delete(this.statements.keys().next().value);
    }
    this.statements.set(sql, st);
    return st;
  }
  all(sql, params = []) {
    return this.prepare(sql).all(...params);
  }
  run(sql, params = []) {
    this.prepare(sql).run(...params);
  }
  exec(sql) {
    // 표 구조가 바뀔 때만 준비해 둔 문장을 버린다(예전에는 BEGIN·COMMIT마다 버려서 트랜잭션마다 모든 문장을 다시 준비했다)
    if (/\b(?:ALTER|DROP|CREATE)\b/i.test(sql)) this.statements.clear();
    this.db.exec(sql);
  }
  close() {
    this.db.close();
  }
}

module.exports = { DesktopDb, MAX_STATEMENTS };
