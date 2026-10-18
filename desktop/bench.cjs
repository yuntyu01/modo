// 성능 측정(검증용): MODO_BENCH=<시나리오> MODO_BENCH_OUT=<결과 JSON 경로> 일 때만 main.cjs가 불러온다. 평소 실행에는 없다.
// 메모리 기준: 프로세스마다 privateBytes(Windows, 다른 프로세스와 나눠 쓰지 않는 메모리)를 더한 값을 '앱 전체'로 본다.
//   workingSetSize는 공유 페이지(Chromium DLL 등)를 프로세스마다 다시 세므로 합산하지 않고 프로세스별로만 적는다.
// CPU: getAppMetrics의 cpu.percentUsage(직전 측정 이후 한 코어 기준 %)를 1초마다 모아 평균, idleWakeupsPerSecond도 함께.
const { app, session, webContents } = require('electron');
const fs = require('node:fs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = function startBench(ctx) {
  const scenario = process.env.MODO_BENCH;
  const out = process.env.MODO_BENCH_OUT;
  const marks = [];
  const counters = { dbCalls: 0, requests: 0, broadcasts: 0 };
  // 무엇이 도는지: 쿼리 문장별 횟수와 요청 주소(측정 구간마다 비운다)
  let sqlCounts = new Map();
  let urls = [];
  const mark = (name, extra) => marks.push({ name, t: Math.round(performance.now()), ...extra });
  mark('bench-start');

  // 렌더러가 알려 주는 '입력 가능'(첫 데이터가 그려진 뒤 다음 프레임)
  ctx.onRendererMark((wc, name) => mark(`${windowName(wc)}:${name}`));
  ctx.countDb((sql) => {
    counters.dbCalls++;
    const k = String(sql ?? '').replace(/\s+/g, ' ').slice(0, 90);
    sqlCounts.set(k, (sqlCounts.get(k) ?? 0) + 1);
  });
  ctx.countBroadcast(() => counters.broadcasts++);
  app.whenReady().then(() => {
    const count = (d) => {
      counters.requests++;
      if (urls.length < 40) urls.push(`${d.method} ${d.url.replace(/\?.*/, '')} ${d.statusCode ?? d.error ?? ''}`);
    };
    session.defaultSession.webRequest.onCompleted({ urls: ['http://*/*', 'https://*/*'] }, count);
    session.defaultSession.webRequest.onErrorOccurred({ urls: ['http://*/*', 'https://*/*'] }, count);
  });

  function windowName(wc) {
    const mini = ctx.mini();
    const settings = ctx.settings();
    if (mini && !mini.isDestroyed() && mini.webContents === wc) return 'mini';
    if (settings && !settings.isDestroyed() && settings.webContents === wc) return 'main';
    return 'other';
  }
  function procName(m) {
    for (const wc of webContents.getAllWebContents()) {
      try {
        if (wc.getOSProcessId() === m.pid) return `renderer:${windowName(wc)}`;
      } catch {}
    }
    return m.type === 'Browser' ? 'main-process' : m.type === 'GPU' ? 'gpu' : m.type === 'Utility' ? `utility:${m.serviceName ?? ''}` : m.type;
  }
  /** 창별 JS 힙(MB): 쓰는 중 / 잡아 둔 전체(가비지 수거 전 임시 메모리와 계속 남는 메모리를 가르려고) */
  async function heaps() {
    const out = {};
    for (const [name, win] of [['mini', ctx.mini()], ['main', ctx.settings()]]) {
      if (!win || win.isDestroyed()) continue;
      try {
        out[name] = await win.webContents.executeJavaScript(
          `(() => { const m = performance.memory; return m ? { usedMB: +(m.usedJSHeapSize / 1048576).toFixed(1), totalMB: +(m.totalJSHeapSize / 1048576).toFixed(1), domNodes: document.getElementsByTagName('*').length } : null; })()`,
        );
      } catch {}
    }
    return out;
  }
  /** 지금 프로세스별 메모리(MB) */
  function memory() {
    const procs = app.getAppMetrics().map((m) => ({
      name: procName(m),
      pid: m.pid,
      privateMB: m.memory.privateBytes != null ? +(m.memory.privateBytes / 1024).toFixed(1) : null,
      workingSetMB: +(m.memory.workingSetSize / 1024).toFixed(1),
    }));
    const total = procs.reduce((s, p) => s + (p.privateMB ?? 0), 0);
    return { totalPrivateMB: +total.toFixed(1), procs };
  }
  /** ms 동안 1초마다 CPU를 모은다(프로세스 종류별 평균 %·깨어남/초, 전체 합) */
  async function cpu(ms) {
    // CPU: 프로세스마다 누적 CPU 시간(cumulativeCPUUsage, 초)의 차이 ÷ 측정 시간 = 한 코어 기준 평균 %
    const start = new Map(app.getAppMetrics().map((m) => [m.pid, { name: procName(m), cum: m.cpu.cumulativeCPUUsage ?? 0 }]));
    const wake = {};
    const c0 = { ...counters };
    sqlCounts = new Map();
    urls = [];
    const t0 = performance.now();
    for (let t = 0; t < ms; t += 1000) {
      await sleep(1000);
      for (const m of app.getAppMetrics()) (wake[procName(m)] ??= []).push(m.cpu.idleWakeupsPerSecond ?? 0);
    }
    const sec = (performance.now() - t0) / 1000;
    const per = {};
    for (const m of app.getAppMetrics()) {
      const s0 = start.get(m.pid);
      const name = procName(m);
      const used = (m.cpu.cumulativeCPUUsage ?? 0) - (s0?.cum ?? 0);
      const w = wake[name] ?? [];
      per[name] = { cpuPct: +((used / sec) * 100).toFixed(3), wakeupsPerSec: +(w.reduce((a, b) => a + b, 0) / Math.max(1, w.length)).toFixed(1) };
    }
    const totalCpu = +Object.values(per).reduce((s, v) => s + v.cpuPct, 0).toFixed(3);
    return {
      topSql: [...sqlCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
      urls,
      seconds: +sec.toFixed(1),
      totalCpuPct: totalCpu,
      perProcess: per,
      dbCallsPerMin: +(((counters.dbCalls - c0.dbCalls) / sec) * 60).toFixed(1),
      requestsPerMin: +(((counters.requests - c0.requests) / sec) * 60).toFixed(1),
      broadcastsPerMin: +(((counters.broadcasts - c0.broadcasts) / sec) * 60).toFixed(1),
    };
  }
  const waitMark = async (name, timeout = 20000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (marks.some((m) => m.name === name)) return true;
      await sleep(50);
    }
    return false;
  };
  const js = (win, code) => win.webContents.executeJavaScript(code);

  // 렌더러 안에서 재는 반응 속도: 진짜 입력(sendInputEvent) → 다음 그림까지(Event Timing API, 16ms 미만은 기록되지 않음)
  // Event Timing: 입력부터 그 결과가 그려질 때까지(duration, 16ms 미만은 기록되지 않음)와 처리기 실행 시간(processing).
  // Long Task: 메인 스레드가 50ms 넘게 막힌 구간(막힌 총시간 = 50ms를 넘은 부분의 합)
  const INSTALL = `(() => {
    if (window.__bench) return true;
    const b = (window.__bench = { events: [], long: [] });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) b.events.push({ name: e.name, d: Math.round(e.duration), p: Math.round(e.processingEnd - e.processingStart) }); }).observe({ type: 'event', durationThreshold: 16, buffered: false });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) b.long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: false });
    return true;
  })()`;
  const takeEvents = (win) => js(win, `(() => { const e = window.__bench.events; const l = window.__bench.long; window.__bench.events = []; window.__bench.long = []; return { e, l }; })()`);
  const summarize = (taken, re) => {
    const ev = taken.e.filter((x) => re.test(x.name));
    const d = ev.map((x) => x.d);
    const pr = ev.map((x) => x.p);
    return {
      eventsOver16: ev.length,
      durationP95: pct(d, 0.95),
      durationMax: d.length ? Math.max(...d) : 0,
      processingP95: pct(pr, 0.95),
      processingMax: pr.length ? Math.max(...pr) : 0,
      longTasks: taken.l.length,
      blockingMs: taken.l.reduce((s, x) => s + Math.max(0, x - 50), 0),
    };
  };
  const pct = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);

  /** 폴더 탭을 차례로 눌러(진짜 클릭) 누른 순간부터 바뀐 화면이 그려질 때까지 */
  async function folderSwitch(win, rounds = 12) {
    await js(win, INSTALL);
    const times = [];
    for (let i = 0; i < rounds; i++) {
      const r = await js(
        win,
        `(() => { const tabs = [...document.querySelectorAll('[role="tab"]')].filter((t) => t.getBoundingClientRect().width > 0 && t.getBoundingClientRect().top < 200); const t = tabs[${i} % tabs.length]; if (!t) return null; const b = t.getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2), n: tabs.length }; })()`,
      );
      if (!r) break;
      const t0 = performance.now();
      win.webContents.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: 1 });
      // 다음 두 프레임(그려짐)까지 렌더러 쪽 시간
      await js(win, `new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))`);
      times.push(Math.round(performance.now() - t0));
      await sleep(350);
    }
    return { rounds: times.length, wallMsP50: pct(times, 0.5), wallMsP95: pct(times, 0.95), ...summarize(await takeEvents(win), /pointer|mouse|click/) };
  }

  /** 입력칸에 글자를 하나씩 치고(진짜 키 입력) 키 입력 → 그림까지 */
  async function typing(win, selector, chars = 40) {
    await js(win, INSTALL);
    const ok = await js(win, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.focus(); return document.activeElement === el; })()`);
    if (!ok) return { skipped: `no ${selector}` };
    const times = [];
    for (let i = 0; i < chars; i++) {
      const t0 = performance.now();
      win.webContents.sendInputEvent({ type: 'char', keyCode: String.fromCharCode(97 + (i % 26)) });
      await js(win, `new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))`);
      times.push(Math.round(performance.now() - t0));
      await sleep(60);
    }
    // 친 글은 지운다(측정 데이터에 남기지 않게)
    for (let i = 0; i < chars; i++) win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
    await sleep(300);
    return { chars: times.length, wallMsP50: pct(times, 0.5), wallMsP95: pct(times, 0.95), ...summarize(await takeEvents(win), /key|input/) };
  }

  /** 목록 위에서 휠로 내렸다 올리며 프레임 간격(16.7ms 넘으면 늦은 프레임) */
  async function scroll(win, x, y, steps = 40, every = 30) {
    await js(win, `(() => { const f = (window.__frames = []); let last = performance.now(); const loop = (t) => { f.push(t - last); last = t; if (window.__framesOn) requestAnimationFrame(loop); }; window.__framesOn = true; requestAnimationFrame(loop); return true; })()`);
    for (let i = 0; i < steps; i++) {
      win.webContents.sendInputEvent({ type: 'mouseWheel', x, y, deltaX: 0, deltaY: i < steps / 2 ? -120 : 120 });
      await sleep(every);
    }
    await sleep(300);
    const f = await js(win, `(() => { window.__framesOn = false; return window.__frames.slice(1).map((x) => Math.round(x * 10) / 10); })()`);
    return { frames: f.length, p50FrameMs: pct(f, 0.5), p95FrameMs: pct(f, 0.95), maxFrameMs: f.length ? Math.max(...f) : 0, over33ms: f.filter((x) => x > 33.4).length };
  }

  /** 지금까지의 프로세스별 누적 CPU 시간(초) */
  const cpuNow = () => ({ t: performance.now(), m: new Map(app.getAppMetrics().map((m) => [m.pid, { name: procName(m), cum: m.cpu.cumulativeCPUUsage ?? 0 }])) });
  /** cpuNow() 이후 프로세스 종류별 평균 CPU %(한 코어 기준)와 합 */
  function cpuSince(c0) {
    const sec = (performance.now() - c0.t) / 1000;
    const per = {};
    for (const m of app.getAppMetrics()) {
      const name = procName(m);
      per[name] = +((per[name] ?? 0) + (((m.cpu.cumulativeCPUUsage ?? 0) - (c0.m.get(m.pid)?.cum ?? 0)) / sec) * 100).toFixed(1);
    }
    return { seconds: +sec.toFixed(1), totalPct: +Object.values(per).reduce((a, b) => a + b, 0).toFixed(1), perProcess: per };
  }

  const result = { scenario, env: { electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform, arch: process.arch, packaged: app.isPackaged, argv: process.argv.slice(1) } };
  const save = () => {
    result.marks = marks;
    result.counters = counters;
    if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2));
  };

  async function run() {
    await app.whenReady();
    const miniReady = await waitMark('mini:interactive', 30000);
    result.startup = { miniInteractiveMs: marks.find((m) => m.name === 'mini:interactive')?.t ?? null, ok: miniReady, steps: ctx.startupMarks?.() };
    const settle = Number(process.env.MODO_BENCH_SETTLE || 15000);
    const idle = Number(process.env.MODO_BENCH_IDLE || 30000);
    const openMain = async () => {
      const t0 = performance.now();
      const before = marks.length;
      ctx.openSettings();
      const end = Date.now() + 20000;
      while (Date.now() < end && !marks.slice(before).some((m) => m.name === 'main:interactive')) await sleep(20);
      return Math.round(performance.now() - t0);
    };
    if (scenario === 'mini' || scenario === 'mini-cold') {
      await sleep(settle);
      result.idle = await cpu(idle);
      result.memory = memory();
    } else if (scenario === 'main') {
      ctx.mini().hide();
      result.openMainMs = await openMain();
      await sleep(settle);
      result.idle = await cpu(idle);
      result.memory = memory();
    } else if (scenario === 'both') {
      result.openMainMs = await openMain();
      await sleep(settle);
      result.idle = await cpu(idle);
      result.memory = memory();
    } else if (scenario === 'hidden') {
      // 트레이만: 미니창 숨기고 큰 창 없음
      ctx.mini().hide();
      await sleep(settle);
      result.idle = await cpu(Math.max(idle, 60000));
      result.memory = memory();
    } else if (scenario === 'minimized') {
      // 큰 창은 작업표시줄로 최소화, 미니창은 숨김
      result.openMainMs = await openMain();
      ctx.settings().minimize();
      ctx.mini().hide();
      await sleep(settle);
      result.idle = await cpu(Math.max(idle, 60000));
      result.memory = memory();
    } else if (scenario === 'autostart') {
      // 로그인 자동 실행 흉내(--autostart 인자로 켬): 켠 직후 5초, 안정된 뒤 60초
      await sleep(5000);
      result.memoryAt5s = memory();
      result.idleEarly = await cpu(10000);
      await sleep(45000);
      result.idle = await cpu(30000);
      result.memory = memory();
    } else if (scenario === 'reopen') {
      await sleep(settle);
      result.memoryBefore = memory();
      result.openTimes = [];
      for (let i = 0; i < 10; i++) {
        result.openTimes.push(await openMain());
        await sleep(1500);
        ctx.settings()?.close();
        await sleep(1500);
        ctx.toggleMini();
        await sleep(500);
        ctx.toggleMini();
        await sleep(500);
      }
      await sleep(settle);
      result.memoryAfter = memory();
      result.idle = await cpu(idle);
    } else if (scenario === 'crosswin') {
      // 메인 ↔ 미니 반영 + 닫기 직전 저장(검증용, 입력은 진짜 키 입력)
      result.openMainMs = await openMain();
      await sleep(2000);
      const main = ctx.settings();
      const mini = ctx.mini();
      const has = (win, text) => js(win, `document.body.innerText.includes(${JSON.stringify(text)})`);
      const typeInto = async (win, selector, text, enter) => {
        await js(win, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); el && el.focus(); return !!el; })()`);
        win.webContents.insertText(text);
        if (enter) {
          await sleep(100);
          win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
          win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
          win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
        }
      };
      const until = async (fn, ms = 4000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          if (await fn()) return Date.now() - t0;
          await sleep(50);
        }
        return null;
      };
      // 1) 메인 입력창에서 할 일 추가 → 미니에 보이는지
      await typeInto(main, 'textarea[aria-label="새로운 할 일"]', '창 사이 반영 확인', true);
      result.mainToMiniMs = await until(() => has(mini, '창 사이 반영 확인'));
      // 2) 미니에서 메모 첫 문단을 눌러 이어 쓰기 → 메인에 보이는지(0.5초 뒤 저장)
      const at = await js(mini, `(() => { const t = [...document.querySelectorAll('div[dir="auto"]')].find((e) => e.textContent.startsWith('메모 ')); if (!t) return null; const b = t.getBoundingClientRect(); return { x: Math.round(b.right - 4), y: Math.round(b.y + b.height / 2) }; })()`);
      if (at) {
        mini.webContents.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount: 1 });
        mini.webContents.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'left', clickCount: 1 });
        await sleep(400);
        mini.webContents.insertText(' 미니에서 이어 씀');
        result.miniToMainMs = await until(() => has(main, '미니에서 이어 씀'));
      }
      // 3) 메인 메모에 쓰고 0.2초 만에 창 닫기 → 다시 열면 남아 있는지
      const memoAt = await js(main, `(() => { const t = [...document.querySelectorAll('div[dir="auto"]')].find((e) => e.textContent.startsWith('메모 ')); if (!t) return null; const b = t.getBoundingClientRect(); return { x: Math.round(b.right - 4), y: Math.round(b.y + b.height / 2) }; })()`);
      if (memoAt) {
        main.webContents.sendInputEvent({ type: 'mouseDown', x: memoAt.x, y: memoAt.y, button: 'left', clickCount: 1 });
        main.webContents.sendInputEvent({ type: 'mouseUp', x: memoAt.x, y: memoAt.y, button: 'left', clickCount: 1 });
        await sleep(400);
        main.webContents.insertText(' 닫기 직전 입력');
        await sleep(200);
        main.close();
        await sleep(1500);
        result.closedMainGone = !ctx.settings() || ctx.settings().isDestroyed();
        await openMain();
        await sleep(1500);
        result.keptAfterClose = await has(ctx.settings(), '닫기 직전 입력');
      }
    } else if (scenario === 'loginitem') {
      // 로그인 시 실행 흐름(실제 Windows 시작 프로그램 레지스트리를 쓰고, 끝에 지운다)
      const { execSync } = require('node:child_process');
      const reg = () => {
        try {
          return execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"', { encoding: 'utf8' })
            .split(/\r?\n/)
            .filter((l) => /modo/i.test(l))
            .map((l) => l.trim());
        } catch {
          return [];
        }
      };
      const steps = [];
      const snap = (name) => steps.push({ name, ours: ctx.loginItem(), legacy: app.getLoginItemSettings().openAtLogin, reg: reg() });
      snap('start');
      app.setLoginItemSettings({ openAtLogin: true }); // 예전 버전처럼 인자 없이 켜 둠
      snap('legacy-on');
      ctx.migrateLoginItem();
      snap('after-migrate');
      ctx.setLoginItem(false);
      snap('user-off');
      ctx.migrateLoginItem(); // 업데이트 뒤 다시 켜지 않는다
      snap('migrate-again');
      ctx.setLoginItem(true);
      snap('user-on');
      ctx.setLoginItem(false);
      app.setLoginItemSettings({ openAtLogin: false });
      snap('cleanup');
      result.loginItem = steps;
      result.launchedAtLogin = ctx.launchedAtLogin;
      result.miniState = ctx.miniState();
    } else if (scenario === 'paint') {
      // 큰 창 그리기 부담: 창 크기(MODO_SETTINGS_SIZE)·배율·CPU 제한(코어 묶기)을 바꿔 가며 같은 동작(폴더 전환, 긴 스크롤)의 프레임·CPU를 잰다.
      // 하드웨어 가속 켬/끔(--disable-gpu) 비교용
      result.openMainMs = await openMain();
      await sleep(settle);
      const main = ctx.settings();
      const { screen } = require('electron');
      result.window = { bounds: main.getBounds(), content: main.getContentBounds(), scale: screen.getDisplayMatching(main.getBounds()).scaleFactor };
      result.mainFolderSwitch = await folderSwitch(main);
      const b = main.getContentBounds();
      const c0 = cpuNow();
      result.mainScroll = await scroll(main, Math.round(b.width / 2), Math.min(400, Math.round(b.height / 2)), 120, 16);
      result.scrollCpu = cpuSince(c0);
      result.memory = memory();
    } else if (scenario === 'interact') {
      result.openMainMs = await openMain();
      await sleep(settle);
      const main = ctx.settings();
      const mini = ctx.mini();
      result.mainFolderSwitch = await folderSwitch(main);
      result.miniFolderSwitch = await folderSwitch(mini);
      result.mainTyping = await typing(main, 'textarea[aria-label="새로운 할 일"], textarea[placeholder="새로운 할 일"]');
      // 미니창 메모 입력: 첫 문단을 눌러 편집을 연 뒤 친다
      await js(mini, `(() => { const t = [...document.querySelectorAll('div[dir="auto"]')].find((e) => e.textContent.startsWith('메모 ')); if (!t) return false; const b = t.getBoundingClientRect(); window.__memoAt = { x: Math.round(b.x + 20), y: Math.round(b.y + b.height / 2) }; return true; })()`);
      const at = await js(mini, 'window.__memoAt || null');
      if (at) {
        mini.webContents.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount: 1 });
        mini.webContents.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'left', clickCount: 1 });
        await sleep(400);
        result.miniMemoTyping = await typing(mini, 'textarea');
      }
      const b = main.getContentBounds();
      result.mainScroll = await scroll(main, Math.round(b.width / 2), 400);
      result.memory = memory();
      result.heaps = await heaps();
      // 20초 쉰 뒤에도 남는지(가비지 수거가 돈 뒤)
      await sleep(20000);
      result.memoryLater = memory();
      result.heapsLater = await heaps();
    }
    save();
    if (process.env.MODO_BENCH_EXIT !== '0') ctx.quit();
  }
  run().catch((e) => {
    result.error = String(e && e.stack ? e.stack : e);
    save();
    ctx.quit();
  });
};
