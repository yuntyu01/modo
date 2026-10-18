// 시안과 같은 예시 데이터를 가진 데모 계정을 서버에 만든다(스크린샷·실기기 동기화 확인용).
//   npx esbuild scripts/seed-demo.ts --bundle --platform=node --outfile=/tmp/seed.cjs && node /tmp/seed.cjs <server> <email> <password>
import { randomUUID } from 'node:crypto';

import { memoryDb } from '../src/core/__tests__/sqljsDb';
import { Repo } from '../src/core/repo';
import { SyncEngine } from '../src/core/sync';

async function main() {
  const [server = 'http://127.0.0.1:8080', email = 'demo@modo.app', password = 'demo1234'] = process.argv.slice(2);
  const repo = new Repo(await memoryDb(), randomUUID);
  await repo.init();
  const work = await repo.createFolder('업무');
  const personal = await repo.createFolder('개인');
  await repo.addTodo('회의 자료 정리', work, 'bottom');
  await repo.appendParagraphs('회의 때 배포 일정 확인하기\n담당자도 함께 정해두기', work);
  await repo.addTodo('책 20쪽 읽기', personal, 'bottom');
  const sync = new SyncEngine(repo, fetch, 'seed');
  try {
    await sync.login(server, email, password, true);
  } catch {
    console.log('이미 있는 계정이라 그대로 둠');
    return;
  }
  console.log('seeded', email, sync.status.state);
}
main();
