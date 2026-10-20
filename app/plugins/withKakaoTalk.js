const { AndroidConfig, withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withKakaoTalk(config, { nativeAppKey }) {
  if (!/^[a-f0-9]{32}$/.test(nativeAppKey)) throw new Error('Invalid Kakao native platform key');
  return withAndroidManifest(config, mod => {
    const manifest = mod.modResults.manifest;
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, 'modo.kakao.native_app_key', nativeAppKey);
    app.activity ??= [];
    if (!app.activity.some(a => a.$['android:name'] === 'com.kakao.sdk.auth.AuthCodeHandlerActivity')) {
      app.activity.push({
        $: { 'android:name': 'com.kakao.sdk.auth.AuthCodeHandlerActivity', 'android:exported': 'true' },
        'intent-filter': [{
          action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
          category: [
            { $: { 'android:name': 'android.intent.category.DEFAULT' } },
            { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
          ],
          data: [{ $: { 'android:scheme': `kakao${nativeAppKey}`, 'android:host': 'oauth' } }],
        }],
      });
    }
    manifest.queries ??= [];
    if (!manifest.queries.some(q => q.package?.some(p => p.$['android:name'] === 'com.kakao.talk'))) {
      manifest.queries.push({ package: [{ $: { 'android:name': 'com.kakao.talk' } }] });
    }
    return mod;
  });
};
