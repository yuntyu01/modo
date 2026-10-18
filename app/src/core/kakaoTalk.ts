import { AuthCancelled, HttpError } from './sync';

/** A native provider credential must only be sent to the configured modo service. */
export async function kakaoTalkAuth(
  startUrl: string,
  redirect: string,
  login: () => Promise<string | null>,
  fetchFn: typeof fetch,
): Promise<string | undefined> {
  const origin = 'https://modo.kodeploy.com';
  if (!startUrl.startsWith(`${origin}/api/auth/kakao/start?`) || startUrl.includes('#') || redirect !== 'modo://auth') return undefined;
  // Keep this independent of URLSearchParams, as with the existing mobile sync flow.
  const params: Record<string, string> = {};
  for (const part of startUrl.split('?')[1].split('&')) {
    const [name, value = ''] = part.split('=');
    params[decodeURIComponent(name)] = decodeURIComponent(value.replace(/\+/g, ' '));
  }
  if (params.redirect_uri !== redirect) return undefined;
  const challenge = params.code_challenge;
  const state = params.state;
  if (!challenge || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge) || !state) {
    throw new HttpError(400, 'Invalid login request', 'auth_mismatch');
  }
  let accessToken: string | null;
  try {
    accessToken = await login();
  } catch (e) {
    if ((e as { code?: string })?.code === 'ERR_KAKAO_CANCELLED') throw new AuthCancelled();
    throw new HttpError(502, 'Kakao Talk login failed', 'kakao_failed');
  }
  if (!accessToken) return undefined;
  const response = await fetchFn(`${origin}/api/auth/kakao/native`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: accessToken, code_challenge: challenge }),
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
  });
  const result = await response.json() as { code?: string };
  if (!response.ok || !result.code) throw new HttpError(response.status, 'Kakao login failed', 'kakao_failed');
  // Reuse the existing single-use code exchange, state check and local-data adoption.
  return `${redirect}?code=${encodeURIComponent(result.code)}&state=${encodeURIComponent(state)}`;
}
