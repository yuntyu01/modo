// 데이터 폴더(userData) 정하기. 패키지 이름이 naegirok-desktop → modo-desktop으로 바뀌어 기본 폴더도 바뀌었다.
// 예전 기본 폴더에만 DB가 있으면 새 이름으로 옮겨 그대로 이어 쓴다. 지우는 일은 하지 않는다.
// - --user-data-dir로 폴더를 직접 정해 켰으면(측정·테스트 프로필) 예전 기본 폴더는 건드리지 않는다
//   (예전 코드는 이 경우에도 예전 폴더를 측정 프로필 자리로 옮겨 버렸다: 2026-10-18 사고, README '데이터 폴더' 참고)
// - 새 폴더가 이미 있으면(빈 폴더라도) 지우지 않고 예전 폴더를 그 자리에서 쓴다
const fs = require('node:fs');
const path = require('node:path');

/** 반환: 옮겼으면 'moved', 예전 폴더를 그대로 쓰면 'use-old', 아무것도 안 했으면 null */
function adoptOldUserData({ next, old, explicit }) {
  if (explicit || old === next) return null;
  if (!fs.existsSync(path.join(old, 'naegirok.db')) || fs.existsSync(path.join(next, 'naegirok.db'))) return null;
  if (!fs.existsSync(next)) {
    try {
      fs.renameSync(old, next);
      return 'moved';
    } catch {}
  }
  return 'use-old';
}

module.exports = { adoptOldUserData };
