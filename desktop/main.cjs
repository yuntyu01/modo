// modo 데스크톱: 바탕화면 한쪽에 두는 작은 메모창 + 그 아래 붙은 할 일 카드(한 창 안의 묶음).
// 큰 관리 화면(설정·로그인·휴지통 등)은 '더보기 → 설정 열기'로 여는 별도 창이다.
const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, dialog, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { DesktopDb } = require('./db.cjs');
const winState = require('./window-state.cjs');
const { adoptOldUserData } = require('./userdata.cjs');
const { createSyncHost } = require('./sync-host.cjs');

const RENDERER = path.join(__dirname, 'renderer');
// 미니창 최소 높이: ⋯ → 최소화로 접으면 머리 한 줄(46)만
const MIN_HEIGHT = 46;

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// 패키지 이름이 naegirok-desktop → modo-desktop으로 바뀌어 데이터 폴더(userData)도 바뀌었다(userdata.cjs). 단일 실행 잠금보다 먼저.
if (
  adoptOldUserData({
    next: app.getPath('userData'),
    old: path.join(app.getPath('appData'), 'naegirok-desktop'),
    explicit: app.commandLine.hasSwitch('user-data-dir'),
  }) === 'use-old'
) {
  app.setPath('userData', path.join(app.getPath('appData'), 'naegirok-desktop'));
}

// 하나만 실행: 로그인 자동 실행과 사용자가 직접 켠 것이 겹쳐도 두 번째는 첫 번째 창만 띄우고 바로 끝난다(아래 second-instance)
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

// 로그인 자동 실행: 이 인자를 붙여 등록해 두고, 이 인자로 켜졌으면 '자동 실행'으로 본다
const AUTOSTART_ARGS = ['--autostart'];
const launchedAtLogin = process.argv.includes('--autostart');

let db;
/** 동기화·서버 확인·테마 동기화(메인 프로세스 한 곳, sync-host.cjs) */
let host;
/** 스키마 고치기가 끝나면 풀리는 약속. 창은 이걸 기다린 뒤 DB를 읽는다(그 사이 창은 화면 코드를 불러온다) */
let dbReady = Promise.resolve();
/** 시작 단계 시각(ms, 측정용) */
const startup = [];
const stamp = (name) => startup.push([name, Math.round(performance.now())]);
let mini;
let settings;
let tray;
let state;
let quitting = false;

function serveRenderer() {
  // SPA: 파일이 없으면 index.html (expo-router 경로를 새로고침해도 열리게)
  protocol.handle('app', (req) => {
    const url = new URL(req.url);
    let file = path.normalize(path.join(RENDERER, decodeURIComponent(url.pathname)));
    if (!file.startsWith(RENDERER) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(RENDERER, 'index.html');
    }
    return net.fetch(pathToFileURL(file).toString());
  });
}

// 창이 보이거나 숨으면: 미니창 보임 여부를 기억하고(다음 자동 실행 모양), 동기화 간격을 바꾼다
function visibilityChanged(becameVisible) {
  if (mini && !mini.isDestroyed() && state) {
    const v = mini.isVisible();
    if (state.visible !== v) {
      state.visible = v;
      saveState();
    }
  }
  host?.windowsChanged(becameVisible);
}
function hasVisibleWindow() {
  return BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isVisible() && !w.isMinimized() && (w === mini || w === settings));
}

// 창을 닫거나 앱을 끝내기 전에 그 창의 '쓰던 글'을 저장하게 한다(입력은 0.5초 뒤에 저장되므로 그 사이에 닫으면 사라질 수 있다)
function flushWindow(win, timeout = 800) {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) return resolve();
    const id = win.webContents.id;
    const done = () => {
      clearTimeout(timer);
      ipcMain.removeListener('app:flushed', on);
      resolve();
    };
    const on = (e) => e.sender.id === id && done();
    const timer = setTimeout(done, timeout);
    ipcMain.on('app:flushed', on);
    win.webContents.send('app:flush');
  });
}

// 폭은 사용자가 직접 바꿨을 때만 state.width에 담는다(높이를 맞추며 창 크기를 다시 넣을 때 생기는 오차가 쌓이지 않게)
function saveState() {
  if (!mini || mini.isDestroyed()) return;
  const b = mini.getBounds();
  state = { ...state, x: b.x, y: b.y };
  winState.save(app.getPath('userData'), state);
}

function createMini() {
  state = winState.load(app.getPath('userData'));
  const b = winState.fitOnScreen({ x: state.x, y: state.y, width: state.width, height: 320 });
  mini = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    minWidth: 260,
    minHeight: MIN_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    alwaysOnTop: state.pinned,
    skipTaskbar: false,
    title: 'modo',
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: false },
  });
  mini.setOpacity(state.opacity ?? 1);
  mini.loadURL('app://local/mini');
  // 로그인 자동 실행인데 지난번에 미니창을 숨겨 두고(트레이만) 끝냈으면 그대로 트레이에만. 직접 켰으면 늘 보인다
  mini.once('ready-to-show', () => {
    stamp('mini-ready-to-show');
    if (!(launchedAtLogin && state.visible === false)) mini.show();
  });
  mini.on('show', () => visibilityChanged(true));
  mini.on('hide', () => visibilityChanged(false));
  if (process.env.MODO_SNAPSHOT) {
    if (process.env.MODO_SNAPSHOT_CONSOLE) mini.webContents.on('console-message', (e) => console.log('renderer:', e.message));
    snapshotLater();
  }
  mini.on('moved', saveState);
  // 사용자가 창 가장자리를 끌어 바꾼 크기만 기억한다. will-resize는 사용자가 끌 때만 온다(Windows·macOS).
  // 리눅스는 이 이벤트가 없어 내가 맞춘 크기가 아닐 때를 사용자 조절로 본다.
  // - 폭: 그대로 쓴다.
  // - 높이: 맨 아래 '+'까지 거의 다(SNAP 안쪽) 늘렸거나 그보다 크게 늘리면 '최대' — 끝까지 부드럽게 늘어나고, 그 뒤로는
  //   메모·할 일을 더하면 창도 그만큼 늘어난다. 그보다 작게 줄이면 그 높이에서 멈추고 목록을 스크롤한다.
  mini.on('will-resize', () => {
    userResizing = true;
    stopAnim();
  });
  mini.on('resized', () => {
    if (userResizing || (process.platform === 'linux' && !autoResizing)) {
      const [w, h] = mini.getSize();
      state.width = w;
      state.maxHeight = contentH && h >= contentH - SNAP ? null : Math.max(MIN_HEIGHT, h);
      userResizing = false;
      animateHeight(fitHeight());
    }
    saveState();
  });
  mini.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      mini.hide();
    }
  });
}

let autoResizing = false;
let userResizing = false;
/** 화면이 알려 준 내용 높이(머리부터 맨 아래 '+'까지) */
let contentH = 0;
/** 미니창에서 시트를 여는 동안 필요한 높이(0 = 시트 없음)와, 그 때문에 위로 올리기 전 자리 */
let sheetH = 0;
let sheetY = null;
/** 끌어서 늘린 높이가 내용 높이에서 이만큼 안쪽이면 '최대'로 본다 */
const SNAP = 48;
let anim = null;
let animDone = null;
function stopAnim() {
  if (anim) clearInterval(anim);
  if (animDone) clearTimeout(animDone);
  anim = animDone = null;
}

/** 창이 가질 높이: 내용 높이(최대) 또는 사용자가 줄여 둔 높이, 화면 높이 안에서 */
function fitHeight() {
  const display = screen.getDisplayMatching(mini.getBounds());
  const cap = display.workArea.height - 24;
  const max = state.maxHeight ? Math.min(state.maxHeight, cap) : cap;
  const fit = Math.max(MIN_HEIGHT, Math.min(Math.ceil(contentH || MIN_HEIGHT), max));
  // 시트가 열려 있으면 시트가 들어가는 높이까지(사용자가 줄여 둔 높이보다도). 닫으면 원래대로
  return sheetH ? Math.max(fit, Math.min(sheetH, cap)) : fit;
}

/**
 * 창 높이를 부드럽게(0.18초, 끝으로 갈수록 느리게) 바꾼다.
 * 폭은 지금 창에서 읽지 않고 기억한 값으로 넣는다. Windows 125·150% 배율에서 투명 창은 읽은 크기를 다시 넣을 때마다
 * 몇 px씩 커져서, 폴더를 바꿀 때마다(높이가 바뀔 때마다) 창이 오른쪽으로 계속 넓어졌다.
 */
function animateHeight(target, toY) {
  if (!mini || mini.isDestroyed()) return;
  stopAnim();
  const { height: from, y: fromY } = mini.getBounds();
  // toY: 높이와 함께 위아래 자리도 옮긴다(시트를 열 때 화면 아래를 넘지 않게). 없으면 자리는 그대로
  if (Math.abs(from - target) < 2 && (toY == null || Math.abs(fromY - toY) < 1) && Math.abs(mini.getBounds().width - state.width) <= 1) return;
  autoResizing = true;
  const start = Date.now();
  const step = () => {
    if (!mini || mini.isDestroyed()) return stopAnim();
    const t = Math.min(1, (Date.now() - start) / 180);
    const e = 1 - Math.pow(1 - t, 3);
    const b = mini.getBounds();
    const y = toY == null ? b.y : Math.round(fromY + (toY - fromY) * e);
    mini.setBounds({ x: b.x, y, width: state.width, height: Math.round(from + (target - from) * e) });
    if (t >= 1) {
      clearInterval(anim);
      anim = null;
      // resized 이벤트가 뒤늦게 와도 내가 맞춘 크기로 알게 조금 기다렸다 내린다
      animDone = setTimeout(() => (autoResizing = false), 300);
    }
  };
  anim = setInterval(step, 16);
  step();
}

function setContentHeight(h) {
  contentH = h;
  if (!mini || userResizing) return;
  animateHeight(fitHeight());
}

/**
 * 미니창에서 시트(항목 정보·날짜·알림·반복·폴더 고르기)를 여는 동안: 창이 짧아 시트가 눌려 보이지 않게 h까지 잠깐 키운다.
 * 화면 아래를 넘으면 그만큼 위로 올렸다가, 닫으면(h = 0) 내용 높이와 원래 자리로 돌아간다.
 */
function setSheetHeight(h) {
  if (!mini || mini.isDestroyed() || userResizing) return;
  const area = screen.getDisplayMatching(mini.getBounds()).workArea;
  sheetH = h > 0 ? Math.min(Math.ceil(h), area.height - 24) : 0;
  const b = mini.getBounds();
  const target = fitHeight();
  if (sheetH) {
    // 리눅스는 setBounds가 늦게 반영돼 자리를 따로 옮기면 뒤따르는 높이 움직임이 덮어쓴다. 높이와 함께 옮긴다
    const over = b.y + target - (area.y + area.height);
    if (over <= 0) return animateHeight(target);
    if (sheetY == null) sheetY = b.y;
    return animateHeight(target, Math.max(area.y, b.y - over));
  }
  const y = sheetY;
  sheetY = null;
  animateHeight(target, y ?? undefined);
}

// 검증용: MODO_SNAPSHOT=<폴더> 이면 미니창(과 설정 창)을 PNG로 저장한다. 평소엔 꺼져 있다.
function snapshotLater() {
  const dir = process.env.MODO_SNAPSHOT;
  const shoot = async (win, name) => {
    if (!win || win.isDestroyed()) return;
    // 검증용: MODO_SNAPSHOT_BG=<CSS background> 이면 투명한 창 뒤에 바탕화면 대신 그 배경을 깔고 찍는다(캡처는 투명도를 담지 않는다)
    if (process.env.MODO_SNAPSHOT_BG) {
      await win.webContents.executeJavaScript(`(() => {
        document.documentElement.style.background = ${JSON.stringify(process.env.MODO_SNAPSHOT_BG)};
        for (const el of [document.body, document.getElementById('root')]) if (el) el.style.background = 'transparent';
        return [getComputedStyle(document.body).backgroundColor, document.getElementById('root') && getComputedStyle(document.getElementById('root').firstElementChild || document.body).backgroundColor].join(' | ');
      })()`).then((r) => console.log('snapshot bg', name, r));
      await new Promise((r) => setTimeout(r, 300));
    }
    // 검증용: MODO_SNAPSHOT_CLICK='라벨1|라벨2' 이면 그 이름(접근성 이름 또는 글자)의 버튼을 차례로 누른 뒤 찍는다
    // (MODO_SNAPSHOT_THEN은 같은 방식으로 아래 누르기·끌기 뒤에 — 꾹 눌러 연 시트 안의 버튼 확인)
    const clickAll = async (labels) => {
      for (const label of (labels || '').split('|').filter(Boolean)) {
        await win.webContents.executeJavaScript(`(() => {
          const want = ${JSON.stringify(label)};
          const els = [...document.querySelectorAll('[aria-label], [role="button"], [tabindex]')];
          const el = els.find((e) => e.getAttribute('aria-label') === want) || els.find((e) => e.textContent.trim() === want);
          if (el) el.click();
          return !!el;
        })()`).then((ok) => console.log('snapshot click', label, ok));
        await new Promise((r) => setTimeout(r, 1500));
        // 누른 뒤 미니창이 보이는지·크기(미니 메모 열기, 작게 보기·원래 크기로 확인)
        if (mini && !mini.isDestroyed()) console.log('snapshot mini', name, label, mini.isVisible() ? 'visible' : 'hidden', JSON.stringify(mini.getBounds()));
      }
    };
    await clickAll(process.env.MODO_SNAPSHOT_CLICK);
    // 검증용: MODO_SNAPSHOT_DRAG='x,y,dy' 이면 (x,y)를 0.7초 꾹 누른 뒤 dy만큼 끌어 놓고 찍는다(끌어서 순서 바꾸기 확인)
    // 검증용: MODO_SNAPSHOT_HOVER='x,y' 이면 큰 창(MODO_SNAPSHOT_HOVER_WIN=mini 이면 미니창)에서 그 자리에 마우스를 올린 채 찍는다(말풍선·스크롤 막대 확인)
    if (process.env.MODO_SNAPSHOT_HOVER && name === (process.env.MODO_SNAPSHOT_HOVER_WIN || 'settings')) {
      const [x, y] = process.env.MODO_SNAPSHOT_HOVER.split(',').map(Number);
      win.webContents.sendInputEvent({ type: 'mouseEnter', x, y });
      win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
      await new Promise((r) => setTimeout(r, 600));
    }
    // 검증용: MODO_SNAPSHOT_TAP='x,y' 이면 미니창 그 자리를 한 번 누르고, 입력칸의 커서 위치를 로그로 남긴다
    if (process.env.MODO_SNAPSHOT_TAP && name === 'mini') {
      const [x, y] = process.env.MODO_SNAPSHOT_TAP.split(',').map(Number);
      win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
      win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      await new Promise((r) => setTimeout(r, 80));
      win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
      await new Promise((r) => setTimeout(r, 800));
      const r = await win.webContents.executeJavaScript(`(() => { const a = document.activeElement; return [a && a.tagName, a && a.selectionStart, a && a.value && a.value.length, a && a.value].join(' | '); })()`);
      console.log('snapshot tap', r);
    }
    if (process.env.MODO_SNAPSHOT_DRAG && name === 'mini') {
      const [x, y, dy] = process.env.MODO_SNAPSHOT_DRAG.split(',').map(Number);
      const send = (type, yy) => win.webContents.sendInputEvent({ type, x, y: Math.round(yy), button: 'left', clickCount: 1 });
      send('mouseMove', y);
      send('mouseDown', y);
      await new Promise((r) => setTimeout(r, 700));
      for (let i = 1; i <= 12; i++) {
        send('mouseMove', y + (dy * i) / 12);
        await new Promise((r) => setTimeout(r, 30));
      }
      if (process.env.MODO_SNAPSHOT_DRAG_HOLD) {
        const held = await win.webContents.capturePage();
        fs.writeFileSync(path.join(dir, `${name}-dragging.png`), held.toPNG());
      }
      send('mouseUp', y + dy);
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (name === 'mini') await clickAll(process.env.MODO_SNAPSHOT_THEN);
    // 검증용: MODO_SNAPSHOT_EVAL='식' 이면 찍기 전에 그 창에서 계산한 값을 로그로 남긴다
    if (process.env.MODO_SNAPSHOT_EVAL) {
      const r = await win.webContents.executeJavaScript(`(() => { try { return String(${process.env.MODO_SNAPSHOT_EVAL}); } catch (e) { return 'error ' + e.message; } })()`);
      console.log('snapshot eval', name, r);
    }
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
    const [w, h] = win.getSize();
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ bounds: win.getBounds(), size: [w, h], scale: screen.getDisplayMatching(win.getBounds()).scaleFactor }));
  };
  setTimeout(async () => {
    await shoot(mini, 'mini');
    if (process.env.MODO_SNAPSHOT_SETTINGS) {
      // 검증용: MODO_SNAPSHOT_HIDE_MINI=1 이면 큰 창을 열기 전에 미니창을 숨긴다(큰 창의 '미니 메모 열기' 확인)
      if (process.env.MODO_SNAPSHOT_HIDE_MINI) mini.hide();
      // 검증용: MODO_SNAPSHOT_ROUTE=/calendar 처럼 주면 큰 창을 그 화면으로 열어 찍는다
      openSettings(process.env.MODO_SNAPSHOT_ROUTE);
      setTimeout(async () => {
        await shoot(settings, 'settings');
        if (process.env.MODO_SNAPSHOT_EXIT) app.exit(0);
      }, 5000);
    } else if (process.env.MODO_SNAPSHOT_EXIT) app.exit(0);
  }, Number(process.env.MODO_SNAPSHOT_DELAY || 5000));
}

// route: 큰 창에서 바로 열 화면(예: 미니창 ⋯ → 휴지통이면 '/settings/trash'). 앱 안 경로만 받는다.
function openSettings(route) {
  // (이름을 path로 하면 node:path 모듈을 가려 아래 path.join이 깨진다)
  const target = typeof route === 'string' && /^\/[a-z0-9/_-]*$/i.test(route) ? route : null;
  if (settings && !settings.isDestroyed()) {
    if (target) settings.loadURL(`app://local${target}`);
    settings.show();
    settings.focus();
    return;
  }
  // 검증용: MODO_SETTINGS_SIZE=1200x800 처럼 주면 그 크기로 연다(넓은 화면 레이아웃 확인).
  const [sw, sh] = (process.env.MODO_SETTINGS_SIZE || '1000x700').split('x').map(Number);
  settings = new BrowserWindow({
    width: sw || 1000,
    height: sh || 700,
    minWidth: 380,
    minHeight: 520,
    title: 'modo',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    // 제목줄 없이 창 버튼(최소화·최대화·닫기)만 위쪽 그라데이션 위에 겹친다(시안)
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#E6E7EA', height: 40 },
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: false },
  });
  settings.loadURL(`app://local${target ?? '/'}`);
  const win = settings;
  for (const ev of ['show', 'restore', 'focus']) win.on(ev, () => visibilityChanged(true));
  for (const ev of ['hide', 'minimize']) win.on(ev, () => visibilityChanged(false));
  // 닫기: 쓰던 글을 먼저 저장하고 닫는다. 닫힌 창은 렌더러 프로세스째 없어진다(다시 열면 새로 만든다)
  let flushed = false;
  win.on('close', (e) => {
    if (flushed || quitting) return;
    e.preventDefault();
    flushWindow(win).then(() => {
      flushed = true;
      if (!win.isDestroyed()) win.close();
    });
  });
  win.on('closed', () => {
    if (settings === win) settings = null;
    visibilityChanged(false);
  });
}

function toggleMini() {
  if (!mini) return;
  if (mini.isVisible()) mini.hide();
  else {
    const b = winState.fitOnScreen(mini.getBounds());
    mini.setBounds(b);
    mini.show();
    mini.focus();
  }
}

// 트레이 메뉴·로그인 창 문구. 앱의 언어 설정(kv prefs.language) → 시스템 언어 → 영어(앱 src/i18n.ts resolveLang과 같은 순서).
const TRAY_TEXT = {
  ko: { tip: 'modo · 메모와 할 일, 한곳에.', toggle: '미니창 보이기/숨기기', open: 'modo 열기', pin: '항상 위에 표시', login: '로그인 시 실행', quit: '종료', auth: 'modo 로그인' },
  en: { tip: 'modo · Simple, modern Memo & ToDo.', toggle: 'Show/hide mini window', open: 'Open modo', pin: 'Always on top', login: 'Launch at login', quit: 'Quit', auth: 'Sign in to modo' },
  ja: { tip: 'modo · メモとToDoを、ひとつに。', toggle: 'ミニウィンドウの表示/非表示', open: 'modo を開く', pin: '常に手前に表示', login: 'ログイン時に起動', quit: '終了', auth: 'modo にログイン' },
  zh: { tip: 'modo · 备忘与待办，尽在一处。', toggle: '显示/隐藏迷你窗口', open: '打开 modo', pin: '始终置顶', login: '登录时启动', quit: '退出', auth: '登录 modo' },
};
function uiText() {
  let pref = 'system';
  try {
    const row = db?.all(`SELECT value FROM kv WHERE key = 'prefs'`)[0];
    pref = (row && JSON.parse(row.value).language) || 'system';
  } catch {
    // DB가 아직 없거나 설정이 깨졌으면 시스템 언어
  }
  if (TRAY_TEXT[pref]) return TRAY_TEXT[pref];
  for (const l of app.getPreferredSystemLanguages?.() ?? [app.getLocale()]) {
    const code = String(l).slice(0, 2).toLowerCase();
    if (TRAY_TEXT[code]) return TRAY_TEXT[code];
  }
  return TRAY_TEXT.en;
}

function buildTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  const refresh = () => {
    const t = uiText();
    tray.setToolTip(t.tip);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: t.toggle, click: toggleMini },
        { label: t.open, click: openSettings },
        {
          label: t.pin,
          type: 'checkbox',
          checked: !!state.pinned,
          click: (i) => setPinned(i.checked),
        },
        {
          label: t.login,
          type: 'checkbox',
          checked: loginItem(),
          click: (i) => setLoginItem(i.checked),
        },
        { type: 'separator' },
        {
          label: t.quit,
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ]),
    );
  };
  refresh();
  tray.on('click', toggleMini);
  return refresh;
}

let refreshTray = () => {};

// 로그인 시 실행: 사용자가 고른 대로만. 켜 둔 것은 '--autostart' 인자를 붙여 등록해 자동 실행인지 알 수 있게 한다
function loginItem() {
  return app.getLoginItemSettings({ args: AUTOSTART_ARGS }).openAtLogin;
}
function setLoginItem(on) {
  app.setLoginItemSettings({ openAtLogin: !!on, args: AUTOSTART_ARGS });
  refreshTray();
}
/** 예전 버전은 인자 없이 등록했다. 켜 둔 사람만 같은 설정으로 다시 등록하고, 꺼 둔 사람은 그대로 둔다(업데이트로 다시 켜지 않는다) */
function migrateLoginItem() {
  if (process.platform !== 'win32') return;
  if (app.getLoginItemSettings().openAtLogin && !loginItem()) setLoginItem(true);
}
function setPinned(on) {
  state.pinned = on;
  mini?.setAlwaysOnTop(on);
  saveState();
  refreshTray();
}

// 측정(bench.cjs)이 켜졌을 때만 세는 곳
let countDb = null;
let countBroadcast = null;

/** 한 창이 바꾼 것을 다른 창들에 알린다. tables: 그 창이 바꾼 표(다른 창은 그 표만 다시 읽는다) */
function broadcastChanged(sender, tables) {
  countBroadcast?.();
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.webContents !== sender) w.webContents.send('data-changed', Array.isArray(tables) ? tables : undefined);
  }
}

// 연결은 하나라서, 한 창이 트랜잭션을 연 동안 다른 창의 쿼리는 커밋/롤백까지 기다리게 한다.
let txOwner = null;
let txWaiters = [];
function waitTurn(id) {
  if (txOwner === null || txOwner === id) return Promise.resolve();
  return new Promise((resolve) => txWaiters.push({ id, resolve })).then(() => waitTurn(id));
}
function releaseTx() {
  txOwner = null;
  const w = txWaiters;
  txWaiters = [];
  w.forEach((x) => x.resolve());
}

// 카카오 로그인: 서버의 시작 주소를 작은 창으로 열고, 서버가 modo://auth?… 로 돌려보내는 순간 그 주소를 렌더러에 준다.
// (데스크톱은 modo:// 를 OS에 등록하지 않는다. 창 안의 이동만 가로챈다)
function openAuth(parent, url, redirect) {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      parent: parent ?? undefined,
      modal: !!parent,
      width: 480,
      height: 720,
      title: uiText().auth,
      autoHideMenuBar: true,
      webPreferences: { partition: 'auth', sandbox: true },
    });
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
      if (!win.isDestroyed()) win.close();
    };
    const catchRedirect = (e, target) => {
      if (!target.startsWith(redirect)) return;
      e.preventDefault();
      finish(target);
    };
    win.webContents.on('will-redirect', catchRedirect);
    win.webContents.on('will-navigate', catchRedirect);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.on('closed', () => finish(null));
    win.loadURL(url).catch(() => {});
  });
}

function registerIpc() {
  const guarded = (fn) => async (e, ...args) => {
    countDb?.(args[0]);
    await waitTurn(e.sender.id);
    return fn(e, ...args);
  };
  // 창이 할 일·메모를 고쳐 outbox에 넣었거나 테마색(prefs)을 바꿨으면, 커밋한 뒤 메인 동기화에 알린다
  const pending = new Map(); // 창 id → { outbox, prefs }
  const noteWrite = (e, sql, params) => {
    const outbox = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+outbox\b/i.test(sql);
    const prefs = /\bINTO\s+kv\b/i.test(sql) && Array.isArray(params) && params[0] === 'prefs';
    if (!outbox && !prefs) return;
    if (txOwner === e.sender.id) {
      const p = pending.get(e.sender.id) ?? { outbox: false, prefs: false };
      pending.set(e.sender.id, { outbox: p.outbox || outbox, prefs: p.prefs || prefs });
    } else {
      if (outbox) host.localChange();
      if (prefs) host.prefsChanged();
    }
  };
  ipcMain.handle('db:all', guarded((_e, sql, params) => db.all(sql, params)));
  ipcMain.handle('db:run', guarded((e, sql, params) => {
    db.run(sql, params);
    noteWrite(e, sql, params);
  }));
  ipcMain.handle('db:exec', guarded((_e, sql) => db.exec(sql)));
  ipcMain.handle('db:begin', guarded((e) => {
    db.exec('BEGIN IMMEDIATE');
    txOwner = e.sender.id;
  }));
  ipcMain.handle('db:commit', guarded((e) => {
    try {
      db.exec('COMMIT');
    } finally {
      releaseTx();
    }
    const p = pending.get(e.sender.id);
    pending.delete(e.sender.id);
    if (p?.outbox) host.localChange();
    if (p?.prefs) host.prefsChanged();
  }));
  // 창이 트랜잭션을 연 채 닫히거나 렌더러가 죽으면 되돌리고 차례를 푼다(안 그러면 다른 창과 메인 동기화가 끝없이 기다린다)
  app.on('web-contents-created', (_e, wc) => {
    const id = wc.id;
    wc.on('destroyed', () => {
      pending.delete(id);
      if (txOwner !== id) return;
      try {
        db.exec('ROLLBACK');
      } catch {}
      releaseTx();
    });
  });
  ipcMain.handle('db:rollback', guarded((e) => {
    pending.delete(e.sender.id);
    try {
      db.exec('ROLLBACK');
    } finally {
      releaseTx();
    }
  }));
  ipcMain.on('data-changed', (e, tables) => {
    broadcastChanged(e.sender, tables);
    refreshTray(); // 언어 설정이 바뀌었을 수 있다
  });

  ipcMain.handle('win:setPinned', (_e, on) => setPinned(!!on));
  ipcMain.handle('win:isPinned', () => !!state.pinned);
  ipcMain.handle('win:hide', (e) => BrowserWindow.fromWebContents(e.sender)?.hide());
  ipcMain.handle('win:setContentHeight', (e, h) => {
    if (BrowserWindow.fromWebContents(e.sender) === mini) setContentHeight(h);
  });
  ipcMain.handle('win:setSheetHeight', (e, h) => {
    if (BrowserWindow.fromWebContents(e.sender) === mini) setSheetHeight(Number(h) || 0);
  });
  ipcMain.handle('win:setOpacity', (_e, o) => {
    state.opacity = Math.max(0.3, Math.min(1, Number(o) || 1));
    mini?.setOpacity(state.opacity);
    saveState();
  });
  ipcMain.handle('win:getLoginItem', () => loginItem());
  ipcMain.handle('win:setLoginItem', (_e, on) => setLoginItem(on));
  ipcMain.handle('db:ready', () => dbReady.then(() => true));
  ipcMain.handle('sync:call', (e, method, args) => host.call(BrowserWindow.fromWebContents(e.sender), String(method), Array.isArray(args) ? args : []));
  ipcMain.handle('sync:serverState', () => host.serverState());
  ipcMain.handle('win:openSettings', (_e, route) => openSettings(route));
  // 큰 창의 창 버튼 색: 다크는 밝게, 라이트는 진하게(제목줄 없이 그라데이션 위에 겹쳐 그린다)
  ipcMain.handle('win:titleBarDark', (e, dark) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win !== settings || !win.setTitleBarOverlay) return;
    try {
      win.setTitleBarOverlay({ color: '#00000000', symbolColor: dark ? '#E6E7EA' : '#3A3F47', height: 40 });
    } catch {
      // 제목줄 겹치기를 지원하지 않는 OS(리눅스 일부)
    }
  });
  ipcMain.handle('win:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
  ipcMain.handle('win:toggleMini', toggleMini);
  ipcMain.handle('win:isMini', (e) => !!mini && BrowserWindow.fromWebContents(e.sender) === mini);
  ipcMain.handle('file:save', async (e, name, text) => {
    const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
      defaultPath: name,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, text, 'utf8');
    return true;
  });
  ipcMain.handle('auth:open', (e, url, redirect) => {
    if (!/^https?:\/\//.test(url) || !/^modo:\/\//.test(redirect)) return null;
    return openAuth(BrowserWindow.fromWebContents(e.sender), url, redirect);
  });
  ipcMain.handle('file:open', async (e) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return fs.readFileSync(r.filePaths[0], 'utf8');
  });
}

// 두 번째 실행(직접 켬·바로 가기·자동 실행이 겹침): 새 창을 만들지 않고 이미 있는 미니창을 보인다
app.on('second-instance', (_e, argv) => {
  if (argv.includes('--autostart')) return;
  if (!mini || mini.isDestroyed()) return;
  if (!mini.isVisible()) mini.setBounds(winState.fitOnScreen(mini.getBounds()));
  mini.show();
  mini.focus();
});

/** 메인 프로세스 쪽 DB 연결: 창들의 쿼리와 같은 연결이라, 창이 트랜잭션을 연 동안은 기다리고 내 트랜잭션 동안은 창을 기다리게 한다 */
const MAIN_TX = 'main';
function mainDb() {
  // 측정(bench.cjs)이 켜졌으면 메인 쪽 쿼리도 창의 쿼리와 같이 센다
  const turn = (sql) => (countDb?.(sql), waitTurn(MAIN_TX));
  return {
    all: async (sql, params = []) => (await turn(sql), db.all(sql, params)),
    run: async (sql, params = []) => {
      await turn(sql);
      db.run(sql, params);
    },
    exec: async (sql) => {
      await turn(sql);
      db.exec(sql);
    },
    transaction: async (fn) => {
      await turn('BEGIN');
      db.exec('BEGIN IMMEDIATE');
      txOwner = MAIN_TX;
      try {
        const r = await fn();
        db.exec('COMMIT');
        return r;
      } catch (e) {
        try {
          db.exec('ROLLBACK');
        } catch {}
        throw e;
      } finally {
        releaseTx();
      }
    },
  };
}
function broadcastAll(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
}

// 검증용 성능 측정: MODO_BENCH=<시나리오>(desktop/bench.cjs). 평소엔 불러오지 않는다
if (process.env.MODO_BENCH) {
  require('./bench.cjs')({
    mini: () => mini,
    settings: () => settings,
    openSettings: (route) => openSettings(route),
    toggleMini: () => toggleMini(),
    quit: () => {
      quitting = true;
      app.quit();
    },
    onRendererMark: (fn) => ipcMain.on('perf:mark', (e, name) => fn(e.sender, String(name))),
    countDb: (fn) => (countDb = fn),
    countBroadcast: (fn) => (countBroadcast = fn),
    loginItem: () => loginItem(),
    setLoginItem: (on) => setLoginItem(on),
    migrateLoginItem: () => migrateLoginItem(),
    launchedAtLogin,
    miniState: () => ({ visible: !!mini && !mini.isDestroyed() && mini.isVisible(), saved: state?.visible }),
    startupMarks: () => startup,
  });
}

app.whenReady().then(async () => {
  stamp('app-ready');
  db = new DesktopDb(path.join(app.getPath('userData'), 'naegirok.db'));
  stamp('db-open');
  serveRenderer();
  host = createSyncHost({
    db: mainDb(),
    fetch: (url, init) => net.fetch(url, init),
    device: process.platform === 'win32' ? 'Windows' : 'Desktop',
    broadcast: broadcastAll,
    hasVisibleWindow,
    openAuth: (win, url, redirect) => openAuth(win, url, redirect),
    backupBeforeMigrate: async (from) => {
      // 스키마를 고치기 전 DB 사본: <데이터 폴더>/backups/naegirok-v<예전 버전>-<시각>.db. 최근 3개만 남긴다
      const dir = path.join(app.getPath('userData'), 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `naegirok-v${from}-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
      db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
      const old = fs.readdirSync(dir).filter((f) => /^naegirok-v\d+-.*\.db$/.test(f)).sort();
      for (const f of old.slice(0, Math.max(0, old.length - 3))) fs.rmSync(path.join(dir, f));
    },
  });
  registerIpc();
  // 스키마 고치기는 메인이 한 번만(창들은 outbox를 건드리지 않는다). 창은 그동안 화면 코드를 불러오고, DB는 이게 끝난 뒤에 읽는다
  dbReady = host.init().then(
    () => stamp('db-init-done'),
    (e) => console.error('db init', e),
  );
  createMini();
  stamp('mini-created');
  migrateLoginItem();
  refreshTray = buildTray();
  stamp('tray-built');
  // 첫 동기화·서버 확인은 미니창이 뜬 뒤로(자동 실행 직후엔 더 늦게: 로그인 직후 다른 프로그램과 겹치지 않게)
  host.begin(launchedAtLogin ? 8000 : 1500);
  // 모니터를 떼거나 배율이 바뀌면 창을 화면 안으로 다시 넣는다.
  const refit = () => mini && mini.setBounds(winState.fitOnScreen(mini.getBounds()));
  screen.on('display-removed', refit);
  screen.on('display-metrics-changed', refit);
});

// 끝내기: 열린 창들의 쓰던 글을 먼저 저장하게 하고 끝낸다(보내지 못한 변경은 outbox에 남아 다음에 보낸다)
let flushedAll = false;
app.on('before-quit', (e) => {
  quitting = true;
  saveState();
  if (flushedAll) return host?.stop();
  e.preventDefault();
  Promise.all(BrowserWindow.getAllWindows().map((w) => flushWindow(w))).then(() => {
    flushedAll = true;
    app.quit();
  });
});
app.on('window-all-closed', () => {});
app.on('will-quit', () => db?.close());
