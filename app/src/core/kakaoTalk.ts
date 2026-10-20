import { AuthCancelled, HttpError, queryOf, SERVICE_ORIGIN } from './sync';

/** A native provider credential must only be sent to the configured modo service. */
export async function kakaoTalkAuth(
  startUrl: string,
  redirect: string,
  login: () => Promise<string | null>,
  fetchFn: typeof fetch,
): Promise<string | undefined> {
  const origin = SERVICE_ORIGIN;
  if (!startUrl.startsWith(`${origin}/api/auth/kakao/start?`) || startUrl.includes('#') || redirect !== 'modo://auth') return undefined;
  // Keep this independent of URLSearchParams, as with the existing mobile sync flow.
  const params = queryOf(startUrl);
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
  let response: Response;
  try {
    response = await fetchFn(`${origin}/api/auth/kakao/native`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: accessToken, code_challenge: challenge }),
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
    });
  } catch {
    throw new HttpError(0, 'Cannot reach the modo service', 'network');
  }
  // 프록시가 돌려주는 HTML(502·504)처럼 JSON이 아니어도 번역되는 오류로(예전엔 SyntaxError가 그대로 화면에 나왔다)
  const result = (await response.json().catch(() => null)) as { code?: string } | null;
  if (!response.ok || !result?.code) throw new HttpError(response.status, 'Kakao login failed', 'kakao_failed');
  // Reuse the existing single-use code exchange, state check and local-data adoption.
  return `${redirect}?code=${encodeURIComponent(result.code)}&state=${encodeURIComponent(state)}`;
}
