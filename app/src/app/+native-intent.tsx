/**
 * 카카오 로그인에서 브라우저가 돌려보내는 modo://auth?code=… 는 화면 이동이 아니다
 * (WebBrowser.openAuthSessionAsync가 받아 처리한다). 라우터가 없는 화면으로 가지 않게 그대로 머문다.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (/^(modo|naegirok):\/\/auth(\?|\/|$)/.test(path) || /^\/?auth(\?|\/|$)/.test(path)) return null;
    // 위젯 링크(naegirok://?folder=…)는 누를 때마다 다른 값을 붙인다: 같은 위젯을 다시 누르면 주소가 같아 홈이 무시했다
    if (/^((modo|naegirok):\/\/)?\/?\?folder=/.test(path) && !/[?&]n=/.test(path)) return `${path}&n=${Date.now()}`;
  } catch {
    // 아래로
  }
  return path;
}
