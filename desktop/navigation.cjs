function isLocalPage(value) {
  try { const url = new URL(value); return url.protocol === 'app:' && url.host === 'local'; }
  catch { return false; }
}
function isExternalLink(value) {
  try { return ['https:', 'mailto:'].includes(new URL(value).protocol); }
  catch { return false; }
}
function protectWindow(win, shell) {
  const open = (url) => { if (isExternalLink(url)) shell.openExternal(url).catch(() => {}); };
  win.webContents.setWindowOpenHandler(({ url }) => { open(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isLocalPage(url)) { event.preventDefault(); open(url); }
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
}
module.exports = { isLocalPage, isExternalLink, protectWindow };
