// 검증용: 데스크톱 DB 파일을 만들고 계정으로 로그인·동기화해 둔다(창을 직접 조작할 수 없는 환경에서 Windows 앱에 넣기 위함).
//   SYNC_TEST_SERVER=... node(electron) login-db.cjs <db 파일> <email> <password>
import { randomUUID } from 'node:crypto';

import type { Db } from '../../app/src/core/db';
import { Repo } from '../../app/src/core/repo';
import { SyncEngine } from '../../app/src/core/sync';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DesktopDb } = require('../db.cjs');

async function main() {
  const [file, email, password] = process.argv.slice(2);
  const d = new DesktopDb(file);
  const db: Db = {
    all: async (s, p = []) => d.all(s, p),
    run: async (s, p = []) => d.run(s, p),
    exec: async (s) => d.exec(s),
    transaction: async (fn) => {
      d.exec('BEGIN IMMEDIATE');
      try {
        const r = await fn();
        d.exec('COMMIT');
        return r;
      } catch (e) {
        d.exec('ROLLBACK');
        throw e;
      }
    },
  };
  const repo = new Repo(db, randomUUID);
  await repo.init();
  const sync = new SyncEngine(repo, fetch, 'Windows');
  await sync.login(process.env.SYNC_TEST_SERVER ?? 'http://127.0.0.1:8080', email, password, false);
  console.log('logged in', sync.status.state, (await repo.snapshot()).todos.length, 'todos');
  d.close();
}
main();
