#!/usr/bin/env bash
# Windows용 실행 폴더를 만든다(Electron 공식 win32 zip + 앱 파일). Wine 없이 Linux/WSL에서 가능.
#   scripts/stage-win.sh <electron-v44.7.2-win32-x64.zip> <출력 폴더>
# 출력 폴더의 'modo.exe'(electron.exe 이름 변경)를 실행하면 미니창이 뜬다.
set -euo pipefail
zip="$1"; out="$2"
here="$(cd "$(dirname "$0")/.." && pwd)"
[ -d "$here/renderer" ] || { echo "renderer 없음: npm run renderer 먼저" >&2; exit 1; }
rm -rf "$out"; mkdir -p "$out"
unzip -q "$zip" -d "$out"
mv "$out/electron.exe" "$out/modo.exe"
app="$out/resources/app"
mkdir -p "$app"
cp "$here"/{main.cjs,preload.cjs,db.cjs,window-state.cjs,package.json} "$app/"
cp -r "$here/renderer" "$here/assets" "$app/"
echo "staged: $out"
