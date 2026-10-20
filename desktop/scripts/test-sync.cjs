// PC 동기화 E2E: 묶어서 Electron(Node 모드)으로 실행. npm 스크립트의 `VAR=1 cmd`는 Windows cmd.exe에서 안 돼 여기서 env로 준다
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildSync } = require('esbuild');

const root = path.join(__dirname, '..');
const out = path.join(root, 'test/.out/desktop-sync.cjs');
buildSync({ entryPoints: [path.join(root, 'test/desktop-sync.e2e.ts')], outfile: out, bundle: true, platform: 'node', format: 'cjs', external: ['node:sqlite'] });
const r = spawnSync(require('electron'), [out], { cwd: root, stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
if (r.error) throw r.error;
process.exit(r.status ?? 1);
