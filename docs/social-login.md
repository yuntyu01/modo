# Google / Kakao login

This branch implements server-mediated sign-in. Provider registration and real-user sign-in must be verified separately; compiling or passing fake-provider tests does not issue credentials or activate a production provider.

## Server configuration

| Provider | Server-only variables | Exact authorized redirect |
|---|---|---|
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `https://modo.kodeploy.com/api/auth/google/callback` |
| Kakao | `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET` | `https://modo.kodeploy.com/api/auth/kakao/callback` |

Set `PUBLIC_URL=https://modo.kodeploy.com`. Store credentials in the existing modo hosting secret environment and a private encrypted recovery backup. Never put secrets in `EXPO_PUBLIC_*`, app.json, source control, Notion, reports, query strings, screenshots, or CI logs. Google API keys and service-account JSON keys are not needed. Kakao JavaScript/Native/Admin keys are not needed for this REST sign-in flow.

Google: use a **Web application** OAuth client in a dedicated modo project. Configure the consent screen with the confirmed support email `yuntyu01@gmail.com`, published homepage and privacy policy; request only `openid email profile`. Do not enable offline access, Drive, Gmail, contacts, or Calendar permissions. Check test-user restrictions or publish the OAuth consent configuration as appropriate before inviting real app testers. An Android OAuth client/SHA fingerprint is not used by this server callback flow.

Kakao: enable Kakao Login for the modo app and configure the exact callback above on its REST API key. New REST keys have Client Secret enabled by default. Request nickname and optional email only if the developer account is eligible; sign-in also works without email. Do not request birth date, phone, friends, messaging, or payment APIs. Review the provider's current consent, unlink/webhook and hosting-location disclosure requirements before activation. This change does not create a Kakao native SDK or a KakaoTalk messaging integration.

## Flow and security

1. App generates its own random state and PKCE S256 verifier/challenge; verifier stays on the device.
2. `GET /api/auth/{google|kakao}/start` stores a hashed upstream state, provider, app callback/state/challenge for 10 minutes. Google additionally uses its own upstream PKCE and nonce (only nonce hash stored).
3. Provider redirects to the HTTPS **server** callback. Google ID tokens are verified with cached official JWKS for RS256 signature, issuer, audience, expiry, subject, authorized party and nonce. Kakao user identity is fetched server-side with its access token; email is accepted only when valid and verified.
4. Existing provider+subject maps to the same user. **Matching email never merges or takes over a password or another provider account.** If the email is already used, the new social account has no email. No account-linking UI is introduced.
5. The server returns a hashed-storage, single-use 2-minute modo code to the app, never a provider token. `POST /api/auth/exchange` requires the app PKCE verifier and consumes the code even on a failed verification. Existing modo session, sync and deletion controls then apply.

Android/iOS use the existing system authentication browser. Windows uses the external default browser with a listener bound only to `127.0.0.1` on a random port and exact `/oauth/callback` path. The listener checks state and host, expires after 3 minutes, closes on success/cancellation/quit, and returns the result to the same app flow. Provider consoles still register only the fixed server HTTPS redirect, **not** the local callback or `modo://auth`.

`/api/auth/providers` gates the UI; old servers without a Google field remain compatible. Google is off unless both credentials exist. Unconfigured providers stay hidden. App callbacks allow only `modo://auth`, legacy `naegirok://auth`, or the bounded IPv4 loopback path. Upstream tokens are not persisted. Profile pictures are ignored. Database identity/name/email follow the existing account deletion policy; ephemeral login rows cannot be used after expiry and the hourly cleanup removes expired rows. Account deletion cascades identities/login codes, invalidates all sessions immediately and uses the existing deletion journal for retries/restores. New sign-in after deletion creates a new empty account; it does not restore the deleted account.

## Validation

- Fake Google token/JWKS integration with real isolated PostgreSQL: end-to-end sign-in, upstream/app PKCE, provider-bound state, replay, audience/issuer/signature/expiry/nonce/authorized-party rejection, verified email, no email takeover, deletion/session rejection.
- Existing Kakao integration and migration from pre-Google schema preserve identities, sessions and pending Kakao state; migration is repeatable.
- Windows tests cover destination restrictions, callback state, listener cleanup, timeout, cancellation and browser-open failure; shared app tests exercise Google and Kakao code exchange.
- `npm run typecheck`, `npm run lint`, `npm test -- --runInBand` in app; `npm run test:unit` and `npm run dist:win` in desktop; `go test ./... -count=1` with an isolated `TEST_DATABASE_URL` in server. Tests reset tables; never point that variable at production.

The Google button image is the unmodified pre-approved Light/Pill PNG @2x from Google's [branding asset bundle](https://developers.google.com/static/identity/images/signin-assets.zip), used under the [Sign in with Google branding guidelines](https://developers.google.com/identity/branding-guidelines). Its visible text is the official English artwork; accessibility labels are localized in Korean, English, Japanese and Simplified Chinese.

Sources: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect), [Kakao REST Login](https://developers.kakao.com/docs/ko/kakaologin/rest-api), [Kakao service requirements](https://developers.kakao.com/docs/ko/kakaologin/common).
