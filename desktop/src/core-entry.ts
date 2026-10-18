// Electron 메인 프로세스가 쓰는 앱 코어(저장소·동기화). npm run core 로 core.cjs 하나로 묶는다.
// 앱(휴대폰)과 같은 코드를 그대로 써서 동기화 규칙(오프라인 큐·중복 방지·충돌 사본·영구 삭제·공유 권한)이 갈라지지 않게 한다.
export { Repo, touchesData } from '../../app/src/core/repo';
export { SyncEngine, AuthCancelled } from '../../app/src/core/sync';
export { BRAND } from '../../app/src/brand';
export { SCHEMA_VERSION } from '../../app/src/core/schema';
