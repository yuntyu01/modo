// Windows 실행 파일(modo.exe)의 아이콘·이름을 modo로 바꾼다. 바꾸지 않으면 Electron 기본 아이콘(원자 모양)과
// 'Electron'이라는 이름이 탐색기·작업 표시줄·작업 관리자에 보인다.
// electron-builder의 signAndEditExecutable(rcedit)은 Linux에서 wine이 있어야 해서 꺼 두고, 순수 JS(resedit)로 바꾼다.
// - electron-builder afterPack 훅(package.json build.afterPack)
// - 직접: node scripts/win-exe.cjs <modo.exe 경로>  (이미 풀어 둔 앱에 적용, 앱을 끈 상태에서)
const fs = require('node:fs');
const path = require('node:path');

async function patchExe(exePath, { version = require('../package.json').version } = {}) {
  const ResEdit = await require('resedit/cjs').load();
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const icon = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, '..', 'assets', 'icon.ico')));
  // Electron 실행 파일에 들어 있는 아이콘 묶음(첫 번째)을 같은 번호·언어로 바꾼다
  const group = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)[0];
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    group ? group.id : 1,
    group ? group.lang : 1033,
    icon.icons.map((x) => x.data),
  );
  const [major, minor, micro] = version.split('.').map(Number);
  for (const info of ResEdit.Resource.VersionInfo.fromEntries(res.entries)) {
    for (const lang of info.getAllLanguagesForStringValues()) {
      info.setStringValues(lang, {
        FileDescription: 'modo',
        ProductName: 'modo',
        InternalName: 'modo',
        OriginalFilename: 'modo.exe',
        CompanyName: 'modo',
        FileVersion: version,
        ProductVersion: version,
      });
    }
    info.setFileVersion(major, minor, micro || 0, 0);
    info.setProductVersion(major, minor, micro || 0, 0);
    info.outputToResourceEntries(res.entries);
  }
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
}

/** electron-builder afterPack 훅 */
async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  await patchExe(path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.exe`), { version: ctx.packager.appInfo.version });
}

module.exports = afterPack;
module.exports.default = afterPack;
module.exports.patchExe = patchExe;

if (require.main === module) {
  const target = process.argv[2];
  if (!target) {
    console.error('사용: node scripts/win-exe.cjs <modo.exe 경로>');
    process.exit(1);
  }
  patchExe(target).then(
    () => console.log('바꿈:', target),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
