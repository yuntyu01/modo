/**
 * 카카오 로그인에서 브라우저가 돌려보내는 modo://auth?code=… 는 화면 이동이 아니다
 * (WebBrowser.openAuthSessionAsync가 받아 처리한다). 라우터가 없는 화면으로 가지 않게 그대로 머문다.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (/^(modo|naegirok):\/\/auth(\?|\/|$)/.test(path) || /^\/?auth(\?|\/|$)/.test(path)) return null;
  } catch {
    // 아래로
  }
  return path;
}
