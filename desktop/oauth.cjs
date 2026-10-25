// Use the user's system browser for OAuth. Google forbids embedded user agents.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, timingSafeEqual } = require('node:crypto');

// 로그인을 마치고 브라우저에 남는 페이지(사용자 요청 2026-10-25: 글 한 줄뿐이라 밋밋했다). 앱 아이콘 · 결과 · 돌아가라는 안내.
// 브라우저 언어(Accept-Language)로 한국어 · English · 日本語 · 中文 중에서. 스크립트 없이 정해진 스타일만 허용한다(CSP 해시)
const PAGE_TEXT = {
  ko: { ok: '로그인했어요', okBody: '이 탭을 닫고 modo로 돌아가세요.', fail: '로그인하지 못했어요', failBody: 'modo로 돌아가 다시 시도해 주세요.' },
  en: { ok: "You're signed in", okBody: 'You can close this tab and go back to modo.', fail: "Couldn't sign in", failBody: 'Go back to modo and try again.' },
  ja: { ok: 'ログインしました', okBody: 'このタブを閉じて modo に戻ってください。', fail: 'ログインできませんでした', failBody: 'modo に戻ってもう一度お試しください。' },
  zh: { ok: '已登录', okBody: '可以关闭此标签页，返回 modo。', fail: '未能登录', failBody: '请返回 modo 重试。' },
};
const PAGE_CSS = `
:root{color-scheme:light dark;--bg:#F3F5F9;--card:#FFFFFF;--text:#1C1E22;--muted:#6B717C;--line:rgba(28,30,34,.08);--accent:#85ADE2;--bad:#E0736B}
@media (prefers-color-scheme:dark){:root{--bg:#111214;--card:#1B1C20;--text:#ECEDEF;--muted:#9097A1;--line:rgba(255,255,255,.07)}}
*{box-sizing:border-box;margin:0}
html,body{height:100%}
body{display:flex;align-items:center;justify-content:center;padding:24px 16px;background:radial-gradient(120% 70% at 50% 0%,color-mix(in srgb,var(--accent) 26%,transparent),transparent 70%),var(--bg);color:var(--text);font-family:Pretendard,-apple-system,BlinkMacSystemFont,"Segoe UI","Apple SD Gothic Neo","Malgun Gothic","Hiragino Sans","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:360px;padding:40px 28px 36px;border-radius:24px;background:var(--card);border:1px solid var(--line);box-shadow:0 18px 50px rgba(0,0,0,.08);text-align:center}
.icon{position:relative;width:76px;height:76px;margin:0 auto 22px}
.icon img{width:76px;height:76px;border-radius:19px;display:block}
.badge{position:absolute;right:-7px;bottom:-7px;width:30px;height:30px;border-radius:50%;background:var(--accent);border:3px solid var(--card);display:flex;align-items:center;justify-content:center}
.fail .badge{background:var(--bad)}
.badge svg{width:14px;height:14px}
h1{font-size:21px;font-weight:700;letter-spacing:-.2px;margin-bottom:9px}
p{font-size:15px;line-height:1.55;color:var(--muted)}
`;
const PAGE_CSP = `default-src 'none'; img-src data:; style-src 'sha256-${createHash('sha256').update(PAGE_CSS).digest('base64')}'; frame-ancestors 'none'`;
const CHECK = '<path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';
const CROSS = '<path d="M4.5 4.5l7 7m0-7l-7 7" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>';
let iconData;
function iconUri() {
  if (iconData === undefined) {
    try { iconData = `data:image/png;base64,${fs.readFileSync(path.join(__dirname, 'assets', 'icon.png')).toString('base64')}`; }
    catch { iconData = null; }
  }
  return iconData;
}
function pageLang(header) {
  for (const part of String(header || '').toLowerCase().split(',')) {
    const code = part.trim().slice(0, 2);
    if (PAGE_TEXT[code]) return code;
  }
  return 'en';
}
function resultPage(ok, acceptLanguage) {
  const lang = pageLang(acceptLanguage);
  const s = PAGE_TEXT[lang];
  const icon = iconUri();
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>modo</title><style>${PAGE_CSS}</style></head><body><main class="${ok ? 'ok' : 'fail'}">` +
    `<div class="icon">${icon ? `<img src="${icon}" alt="">` : ''}<span class="badge"><svg viewBox="0 0 16 16">${ok ? CHECK : CROSS}</svg></span></div>` +
    `<h1>${ok ? s.ok : s.fail}</h1><p>${ok ? s.okBody : s.failBody}</p></main></body></html>`;
}

function validStart(raw, redirect) {
  try {
    const u = new URL(raw);
    if (u.origin !== 'https://modo.kodeploy.com' || u.username || u.password || u.hash ||
      !/^\/api\/auth\/(google|kakao)\/start$/.test(u.pathname) ||
      redirect !== 'modo://auth' || u.searchParams.get('redirect_uri') !== redirect ||
      !/^[A-Za-z0-9_-]{16,200}$/.test(u.searchParams.get('state') || '') ||
      !/^[A-Za-z0-9_-]{43}$/.test(u.searchParams.get('code_challenge') || '')) return null;
    return u;
  } catch { return null; }
}

function openSystemAuth(raw, redirect, openExternal, { timeout = 180_000, signal } = {}) {
  const start = validStart(raw, redirect);
  if (!start) return Promise.reject(new Error('Invalid authentication destination'));
  return new Promise((resolve, reject) => {
    let done = false;
    let timer;
    const state = Buffer.from(start.searchParams.get('state'));
    const finish = (value, error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      server.close();
      server.closeIdleConnections();
      if (error) reject(error); else resolve(value);
    };
    const cancel = () => finish(null);
    const server = http.createServer((req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const address = server.address();
      let cb;
      try {
        if (done || !address || !req.url.startsWith('/') || req.url.startsWith('//')) throw new Error('Invalid callback');
        cb = new URL(req.url, `http://127.0.0.1:${address.port}`);
      } catch { res.writeHead(400); res.end('Invalid login response.'); return; }
      const received = Buffer.from(cb.searchParams.get('state') || '');
      if (req.method !== 'GET' || cb.pathname !== '/oauth/callback' ||
        req.headers.host !== `127.0.0.1:${address.port}` ||
        received.length !== state.length || !timingSafeEqual(received, state) ||
        !(cb.searchParams.get('code') || cb.searchParams.get('error'))) {
        res.writeHead(400); res.end('Invalid login response.'); return;
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', PAGE_CSP);
      res.end(resultPage(!!cb.searchParams.get('code') && !cb.searchParams.get('error'), req.headers['accept-language']));
      const back = new URL(redirect);
      for (const name of ['state', 'code', 'error']) {
        const value = cb.searchParams.get(name);
        if (value) back.searchParams.set(name, value);
      }
      finish(back.href);
    });
    server.requestTimeout = 5000;
    server.headersTimeout = 5000;
    server.on('error', () => finish(null, new Error('Could not open local login callback')));
    server.listen(0, '127.0.0.1', async () => {
      if (signal?.aborted) { finish(null); return; }
      signal?.addEventListener('abort', cancel, { once: true });
      start.searchParams.set('redirect_uri', `http://127.0.0.1:${server.address().port}/oauth/callback`);
      timer = setTimeout(cancel, timeout);
      try { await openExternal(start.href); }
      catch { finish(null, new Error('Could not open system browser')); }
    });
  });
}
module.exports = { openSystemAuth, validStart, resultPage };
