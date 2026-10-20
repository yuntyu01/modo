import { kakaoTalkAuth } from '../kakaoTalk';
import { AuthCancelled } from '../sync';

const redirect = 'modo://auth';
const challenge = 'c'.repeat(43);
const start = `https://modo.kodeploy.com/api/auth/kakao/start?redirect_uri=modo%3A%2F%2Fauth&state=state-1&code_challenge=${challenge}`;

test('Talk success exchanges the credential only with modo and returns the existing PKCE callback', async () => {
  const request = jest.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'one+time' })));
  const result = await kakaoTalkAuth(start, redirect, async () => 'provider-credential', request);
  expect(result).toBe('modo://auth?code=one%2Btime&state=state-1');
  expect(request).toHaveBeenCalledWith('https://modo.kodeploy.com/api/auth/kakao/native', expect.objectContaining({
    body: JSON.stringify({ access_token: 'provider-credential', code_challenge: challenge }),
    redirect: 'error', credentials: 'omit',
  }));
});

test.each([
  start.replace('modo.kodeploy.com', 'other.example'),
  start.replace('/kakao/', '/google/'),
  start.replace('https:', 'http:'),
  start.replace('modo.kodeploy.com/', 'modo.kodeploy.com.attacker.example/'),
])('non-modo/native-login destinations never obtain a provider credential: %s', async url => {
  const login = jest.fn();
  const request = jest.fn();
  expect(await kakaoTalkAuth(url, redirect, login, request)).toBeUndefined();
  expect(login).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});

test('missing Talk returns control to browser without an API request', async () => {
  const request = jest.fn();
  expect(await kakaoTalkAuth(start, redirect, async () => null, request)).toBeUndefined();
  expect(request).not.toHaveBeenCalled();
});

test('Talk cancellation stays cancelled and does not open another authentication flow', async () => {
  const request = jest.fn();
  await expect(kakaoTalkAuth(start, redirect, async () => { throw { code: 'ERR_KAKAO_CANCELLED' }; }, request)).rejects.toBeInstanceOf(AuthCancelled);
  expect(request).not.toHaveBeenCalled();
});

test('rejected server credential does not produce a successful app callback', async () => {
  const request = jest.fn().mockResolvedValue(new Response('{}', { status: 401 }));
  await expect(kakaoTalkAuth(start, redirect, async () => 'invalid', request)).rejects.toMatchObject({ code: 'kakao_failed' });
});

test('non-JSON error bodies and network failures become coded errors the UI can translate', async () => {
  const html = jest.fn().mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502 }));
  await expect(kakaoTalkAuth(start, redirect, async () => 'provider-credential', html)).rejects.toMatchObject({ code: 'kakao_failed', status: 502 });
  const down = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
  await expect(kakaoTalkAuth(start, redirect, async () => 'provider-credential', down)).rejects.toMatchObject({ code: 'network' });
});
