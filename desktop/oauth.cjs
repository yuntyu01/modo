// Use the user's system browser for OAuth. Google forbids embedded user agents.
const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');

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
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('modo: You can close this tab and return to the app. / 앱으로 돌아가세요.');
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
module.exports = { openSystemAuth, validStart };
