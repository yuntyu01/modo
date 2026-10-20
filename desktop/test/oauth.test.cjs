const assert = require('node:assert/strict');
const http = require('node:http');
const { openSystemAuth, validStart } = require('../oauth.cjs');
const state = 'test-state-0123456789';
const start = `https://modo.kodeploy.com/api/auth/google/start?redirect_uri=modo%3A%2F%2Fauth&state=${state}&code_challenge=${'c'.repeat(43)}`;
(async () => {
  assert.ok(validStart(start, 'modo://auth'));
  for (const bad of [start.replace('modo.kodeploy.com','evil.test'), start.replace('/google/start','/logout'), start.replace('https:', 'http:'), start.replace(state,'short')]) {
    await assert.rejects(openSystemAuth(bad,'modo://auth',async()=>{throw Error('must not open')}));
  }
  let callback;
  const result = await openSystemAuth(start, 'modo://auth', async raw => {
    const u = new URL(raw);
    assert.equal(u.searchParams.get('state'), state);
    callback = new URL(u.searchParams.get('redirect_uri'));
    assert.equal(callback.hostname, '127.0.0.1');
    assert.equal(callback.pathname, '/oauth/callback');
    const malformedStatus = await new Promise((resolve, reject) => {
      const req = http.request({ hostname:callback.hostname, port:callback.port, path:'http://[', method:'GET' }, res => {
        res.resume(); res.on('end',()=>resolve(res.statusCode));
      });
      req.on('error',reject); req.end();
    });
    assert.equal(malformedStatus,400); // Malformed local requests cannot crash the app.
    let res = await fetch(callback + '?state=wrong&code=stolen');
    assert.equal(res.status,400); // Invalid probes must not terminate the real login.
    res = await fetch(callback + `?state=${state}&code=one-use-code`);
    assert.equal(res.status,200);
    assert.equal(res.headers.get('cache-control'),'no-store');
    assert.match(res.headers.get('content-security-policy'),/default-src 'none'/);
  });
  const back = new URL(result);
  assert.equal(back.origin,'null');
  assert.equal(back.protocol,'modo:');
  assert.equal(back.hostname,'auth');
  assert.equal(back.searchParams.get('code'),'one-use-code');
  assert.equal(back.searchParams.get('state'),state);
  await assert.rejects(fetch(callback.href)); // Listener closed after success.
  assert.equal(await openSystemAuth(start,'modo://auth',async()=>{}, {timeout:20}),null);
  await assert.rejects(openSystemAuth(start,'modo://auth',async()=>{throw Error('system browser failed')}));
  const controller = new AbortController();
  assert.equal(await openSystemAuth(start,'modo://auth',async()=>controller.abort(),{signal:controller.signal}),null);
  console.log('System-browser OAuth: destination, PKCE forwarding, state, listener cleanup, timeout and cancellation passed');
})().catch(e => { console.error(e); process.exitCode=1; });
