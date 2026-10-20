/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'widget',
  name: 'ModoWidget',
  displayName: 'modo',
  deploymentTarget: '17.0',
  frameworks: ['SwiftUI', 'WidgetKit', 'AppIntents', 'UserNotifications'],
  // $accent: 대표색(src/brand.ts와 같은 값, src/__tests__/brand.test.ts가 확인)
  // 다크 모드 색은 { light, dark }(예전 { color, darkColor }는 이 플러그인이 읽지 않아 색 세트가 비었다)
  colors: { $accent: '#85ADE2', $widgetBackground: { light: '#FFFFFF', dark: '#1B1C20' } },
  // 앱과 같은 SQLite 파일(App Group 컨테이너)을 연다. 자동 미러링에 기대지 않고 명시한다.
  entitlements: { 'com.apple.security.application-groups': ['group.com.yuntyu01.naegirok'] },
};
