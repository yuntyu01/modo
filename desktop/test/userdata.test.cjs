// node test/userdata.test.cjs: 예전 데이터 폴더 옮기기가 지정한 프로필·이미 있는 폴더를 건드리지 않는지
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { adoptOldUserData } = require('../userdata.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'modo-userdata-'));
const mk = (dir, db) => {
  fs.mkdirSync(dir, { recursive: true });
  if (db) fs.writeFileSync(path.join(dir, 'naegirok.db'), 'x');
};
const old = path.join(tmp, 'naegirok-desktop');
const next = path.join(tmp, 'modo-desktop');
const bench = path.join(tmp, 'bench-profile');

// 1) --user-data-dir로 켠 측정 프로필: 예전 폴더는 그대로
mk(old, true);
assert.strictEqual(adoptOldUserData({ next: bench, old, explicit: true }), null);
assert.ok(fs.existsSync(path.join(old, 'naegirok.db')), '예전 폴더가 남아 있어야 한다');
assert.ok(!fs.existsSync(bench));

// 2) 새 폴더가 이미 있으면(빈 폴더라도) 지우지 않고 예전 폴더를 그 자리에서 쓴다
mk(next, false);
fs.writeFileSync(path.join(next, 'keep.txt'), 'keep');
assert.strictEqual(adoptOldUserData({ next, old, explicit: false }), 'use-old');
assert.ok(fs.existsSync(path.join(next, 'keep.txt')), '새 폴더 안의 파일을 지우면 안 된다');
assert.ok(fs.existsSync(path.join(old, 'naegirok.db')));
fs.rmSync(next, { recursive: true });

// 3) 새 폴더가 없을 때만 통째로 옮긴다
assert.strictEqual(adoptOldUserData({ next, old, explicit: false }), 'moved');
assert.ok(fs.existsSync(path.join(next, 'naegirok.db')) && !fs.existsSync(old));

// 4) 새 폴더에 이미 DB가 있으면 아무것도 하지 않는다
mk(old, true);
assert.strictEqual(adoptOldUserData({ next, old, explicit: false }), null);
assert.ok(fs.existsSync(path.join(old, 'naegirok.db')));

fs.rmSync(tmp, { recursive: true });
console.log('userdata: 4 cases ok');
