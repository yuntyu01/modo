// These values must come from Product management > Product identity in Partner Center.
// Refuse to create a purported Store upload with an invented identity or publisher.
const required = ['MODO_STORE_IDENTITY', 'MODO_STORE_PUBLISHER', 'MODO_STORE_PUBLISHER_NAME'];
for (const key of required) {
  if (!process.env[key]?.trim()) throw new Error(`Missing ${key}: copy the exact value from Microsoft Partner Center.`);
}
const { build } = require('./package.json');
module.exports = {
  ...build,
  appx: {
    applicationId: 'Modo',
    identityName: process.env.MODO_STORE_IDENTITY,
    publisher: process.env.MODO_STORE_PUBLISHER,
    publisherDisplayName: process.env.MODO_STORE_PUBLISHER_NAME,
    displayName: 'modo - 메모와 할 일',
    languages: ['ko-KR', 'en-US', 'ja-JP', 'zh-CN'],
    minVersion: '10.0.19041.0',
    maxVersionTested: '10.0.26100.0',
    backgroundColor: '#171717',
    capabilities: ['runFullTrust'],
    addAutoLaunchExtension: false,
    artifactName: 'modo-${version}-store-${arch}.${ext}',
  },
};
