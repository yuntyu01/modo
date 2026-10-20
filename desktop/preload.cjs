// 렌더러(RN 웹 화면)에 노출하는 최소 API. app/src/native/bridge.ts, app/src/core/platform/openDb.web.ts 와 짝.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  db: {
    all: (sql, params) => ipcRenderer.invoke('db:all', sql, params),
    run: (sql, params) => ipcRenderer.invoke('db:run', sql, params),
    exec: (sql) => ipcRenderer.invoke('db:exec', sql),
    begin: () => ipcRenderer.invoke('db:begin'),
    commit: () => ipcRenderer.invoke('db:commit'),
    rollback: () => ipcRenderer.invoke('db:rollback'),
    /** 메인이 스키마 고치기를 끝낼 때까지 기다린다(창은 그동안 화면 코드를 불러온다) */
    ready: () => ipcRenderer.invoke('db:ready'),
  },
  setPinned: (on) => ipcRenderer.invoke('win:setPinned', on),
  isPinned: () => ipcRenderer.invoke('win:isPinned'),
  hide: () => ipcRenderer.invoke('win:hide'),
  setContentHeight: (h) => ipcRenderer.invoke('win:setContentHeight', h),
  setSheetHeight: (h) => ipcRenderer.invoke('win:setSheetHeight', h),
  openSettings: (route) => ipcRenderer.invoke('win:openSettings', route),
  setTitleBarDark: (dark) => ipcRenderer.invoke('win:titleBarDark', dark),
  toggleMini: () => ipcRenderer.invoke('win:toggleMini'),
  saveFile: (name, text) => ipcRenderer.invoke('file:save', name, text),
  openFile: () => ipcRenderer.invoke('file:open'),
  openAuth: (url, redirect) => ipcRenderer.invoke('auth:open', url, redirect),
  /** 다른 창이나 메인 동기화가 DB를 바꿨을 때. tables: 바뀐 표(모르면 없음 = 전부) */
  onDataChanged: (fn) => {
    const h = (_e, tables) => fn(Array.isArray(tables) ? tables : undefined);
    ipcRenderer.on('data-changed', h);
    return () => ipcRenderer.removeListener('data-changed', h);
  },
  /** 동기화는 메인 프로세스 한 곳에서(sync-host.cjs). 창은 명령을 보내고 상태를 받는다 */
  sync: {
    call: (method, args) => ipcRenderer.invoke('sync:call', method, args ?? []),
    onStatus: (fn) => {
      const h = (_e, st) => fn(st);
      ipcRenderer.on('sync:status', h);
      return () => ipcRenderer.removeListener('sync:status', h);
    },
    serverState: () => ipcRenderer.invoke('sync:serverState'),
    onServerState: (fn) => {
      const h = (_e, st) => fn(st);
      ipcRenderer.on('server:state', h);
      return () => ipcRenderer.removeListener('server:state', h);
    },
  },
  /** 창을 닫거나 앱을 끝내기 직전: 쓰던 글을 저장하고 알린다 */
  onFlushRequest: (fn) => {
    const h = async () => {
      try {
        await fn();
      } finally {
        ipcRenderer.send('app:flushed');
      }
    };
    ipcRenderer.on('app:flush', h);
    return () => ipcRenderer.removeListener('app:flush', h);
  },
  /** tables: 이 창이 바꾼 표(다른 창은 그 표만 다시 읽는다). 없으면 전부 */
  notifyDataChanged: (tables) => ipcRenderer.send('data-changed', Array.isArray(tables) ? tables : undefined),
  /** 성능 측정용 표시(첫 데이터가 그려져 입력할 수 있게 된 때 등). 측정을 켜지 않으면 받는 쪽이 없다 */
  perfMark: (name) => ipcRenderer.send('perf:mark', name),
});
