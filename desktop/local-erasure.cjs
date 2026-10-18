const fs = require('node:fs');
const path = require('node:path');

function createLocalErasure(userData, db) {
  const pending = path.join(userData, 'account-erasure.pending');
  function finish() {
    const dir = path.join(userData, 'backups');
    if (fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir)) {
        if (/^naegirok-v\d+-.*\.db$/.test(name)) fs.rmSync(path.join(dir, name));
      }
    }
    const [checkpoint] = db.all('PRAGMA wal_checkpoint(TRUNCATE);');
    if (checkpoint?.busy) throw new Error('Local erasure checkpoint is busy; retry on next launch.');
    fs.unlinkSync(pending);
  }
  return {
    accepted() {
      fs.writeFileSync(pending, 'pending\n', { mode: 0o600 });
      finish();
    },
    retry() { if (fs.existsSync(pending)) finish(); },
  };
}
module.exports = { createLocalErasure };
