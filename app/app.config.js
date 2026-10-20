const base = require('./app.json').expo;

// The native platform key is supplied only to prebuild, never a REST/Admin secret.
module.exports = () => {
  const key = process.env.MODO_KAKAO_NATIVE_APP_KEY?.trim();
  return {
    ...base,
    plugins: [...base.plugins, ...(key ? [['./plugins/withKakaoTalk', { nativeAppKey: key }]] : [])],
  };
};
