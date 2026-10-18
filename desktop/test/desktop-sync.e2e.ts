// 데스크톱 저장소(Electron의 node:sqlite, desktop/db.cjs)로 만든 '기기'가 실서버를 거쳐 다른 기기와 동기화되는지 확인.
// 실행: npm run test:sync (SYNC_TEST_SERVER 필요). Electron의 Node로 돌아야 node:sqlite가 있다.
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Repo } from '../../app/src/core/repo';
import { SyncEngine } from '../../app/src/core/sync';
import type { Db } from '../../app/src/core/db';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DesktopDb } = require('../db.cjs');

const SERVER = process.env.SYNC_TEST_SERVER ?? 'http://localhost:8080';

/** openDb.web.ts와 같은 모양(IPC 대신 직접 호출) */
function desktopDevice(file: string): Db {
  const d = new DesktopDb(file);
  return {
    all: async (sql, params = []) => d.all(sql, params),
    run: async (sql, params = []) => d.run(sql, params),
    exec: async (sql) => d.exec(sql),
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
}

function check(cond: unknown, msg: string) {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('ok -', msg);
}

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), 'modo-'));
  const mk = async (name: string) => {
    const repo = new Repo(desktopDevice(path.join(dir, `${name}.db`)), randomUUID);
    await repo.init();
    return { repo, sync: new SyncEngine(repo, fetch, name) };
  };
  const pc1 = await mk('pc1');
  const pc2 = await mk('pc2');
  const email = `pc${randomUUID().slice(0, 8)}@example.com`;

  // PC1: 로그인 전 로컬로 쓰고 → 가입(로컬 데이터 그대로 올라감)
  const work = await pc1.repo.createFolder('업무');
  await pc1.repo.appendParagraphs('회의 때 배포 일정 확인하기\n담당자도 함께 정해두기', work);
  await pc1.repo.addTodo('회의 자료 정리', work, 'bottom');
  await pc1.sync.login(SERVER, email, 'password123', true);
  check(pc1.sync.status.state === 'idle', 'PC1 가입 후 동기화 완료');

  // PC2(다른 Windows PC)로 로그인하면 그대로 내려온다
  await pc2.sync.login(SERVER, email, 'password123', false);
  const s2 = await pc2.repo.snapshot();
  check(s2.paragraphs.map((p) => p.text).join('|') === '회의 때 배포 일정 확인하기|담당자도 함께 정해두기', 'PC2에 메모 문단 2개');
  check(s2.todos[0]?.text === '회의 자료 정리' && s2.todos[0].folder_id === work, 'PC2에 할 일 + 폴더 연결');

  // PC2에서 완료 → PC1 반영
  await pc2.repo.setDone(s2.todos[0].id, true);
  await pc2.sync.syncNow();
  await pc1.sync.syncNow();
  check((await pc1.repo.snapshot()).todos[0].done, 'PC2 완료가 PC1에 반영');

  // 재시작(파일 다시 열기) 후에도 남아 있음
  const again = new Repo(desktopDevice(path.join(dir, 'pc1.db')), randomUUID);
  await again.init();
  check((await again.snapshot()).todos.length === 1, '재시작 후 데이터 유지(중복 없음)');
  console.log('ALL PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
