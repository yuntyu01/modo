// 미니창 위치·크기·고정 상태를 저장하고, 모니터가 바뀌거나 DPI 배율이 바뀌어도 화면 안에 들어오게 맞춘다.
const fs = require('node:fs');
const path = require('node:path');
const { screen } = require('electron');

// 창 = 보이는 바탕 그대로(둘레 투명 여백 없음, framePad 0). 폭 280(시안 320은 작은 메모 창으로 쓰기엔 넓어 12% 줄임, 사용자 요청)
// maxHeight: null = 내용(맨 아래 '+'까지)을 따라 늘어난다(화면 높이까지). 숫자 = 사용자가 그 높이로 줄여 둔 것(목록 스크롤)
const DEFAULTS = { width: 280, maxHeight: null, x: undefined, y: undefined, pinned: true, opacity: 1, framePad: 0, heightMode: 2 };
// 예전에는 그림자 자리로 바탕 둘레에 14씩 투명 여백이 있었다(창 가장자리, 곧 크기 조절 손잡이가 투명한 곳에 있었다).
const OLD_PAD = 14;

function load(dir) {
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(path.join(dir, 'window-state.json'), 'utf8'));
  } catch {
    return { ...DEFAULTS };
  }
  const s = { ...DEFAULTS, ...saved };
  // 여백이 있던 때 저장한 크기·위치는 보이는 바탕이 그 자리에 그대로 있게 옮긴다
  if (saved.framePad === undefined) {
    // 예전 기본 폭(348 = 바탕 320 + 여백)을 그대로 쓰던 창은 새 기본 폭으로
    s.width = saved.width === 348 || saved.width === undefined ? DEFAULTS.width : Math.max(260, s.width - OLD_PAD * 2);
    if (Number.isFinite(s.x)) s.x += OLD_PAD;
    if (Number.isFinite(s.y)) s.y += OLD_PAD;
    s.maxHeight = Math.max(46, s.maxHeight - OLD_PAD * 2);
  }
  // 예전에는 앱이 높이를 맞출 때도 '사용자가 줄인 높이'로 잘못 기억해, 메모를 더해도 창이 늘지 않았다. 한 번 내용 따라가기로 되돌린다
  if (saved.heightMode !== 2) {
    s.maxHeight = null;
    s.heightMode = 2;
  }
  return s;
}

function save(dir, state) {
  try {
    fs.writeFileSync(path.join(dir, 'window-state.json'), JSON.stringify(state));
  } catch {}
}

/** 창 사각형이 어떤 모니터 작업 영역과도 충분히 겹치지 않으면 가장 가까운 모니터 안으로 옮긴다. */
function fitOnScreen(bounds) {
  const displays = screen.getAllDisplays();
  const visible = displays.some((d) => {
    const a = d.workArea;
    const w = Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x);
    const h = Math.min(bounds.y + 60, a.y + a.height) - Math.max(bounds.y, a.y);
    return w >= 80 && h >= 40; // 제목줄 일부라도 잡을 수 있으면 둔다
  });
  if (visible && Number.isFinite(bounds.x)) return bounds;
  const d = Number.isFinite(bounds.x) ? screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }) : screen.getPrimaryDisplay();
  const a = d.workArea;
  const width = Math.min(bounds.width, a.width - 24);
  return {
    x: a.x + a.width - width - 24,
    y: a.y + 24,
    width,
    height: Math.min(bounds.height, a.height - 48),
  };
}

module.exports = { load, save, fitOnScreen };
