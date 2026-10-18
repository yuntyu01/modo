const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.join(__dirname, '..');
function run(command, args, env = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
run(process.execPath, ['test/userdata.test.cjs']);
run(process.execPath, ['test/navigation.test.cjs']);
run(process.execPath, ['test/local-erasure.test.cjs']);
run(process.execPath, ['scripts/build-core.cjs']);
run(require('electron'), ['test/host.test.cjs'], { ELECTRON_RUN_AS_NODE: '1' });
