const { withAppBuildGradle } = require('@expo/config-plugins');

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes('// modo release upload signing')) {
      mod.modResults.contents += `
// modo release upload signing: credentials come only from the environment.
def modoKeystore = System.getenv('MODO_UPLOAD_KEYSTORE')
android {
    signingConfigs {
        modoRelease {
            if (modoKeystore) {
                storeFile file(modoKeystore)
                storePassword System.getenv('MODO_UPLOAD_STORE_PASSWORD')
                keyAlias System.getenv('MODO_UPLOAD_KEY_ALIAS')
                keyPassword System.getenv('MODO_UPLOAD_KEY_PASSWORD')
            }
        }
    }
    buildTypes.release.signingConfig = modoKeystore ? signingConfigs.modoRelease : null
}
gradle.taskGraph.whenReady { graph ->
    if (graph.allTasks.any { it.project == project && it.name in ['bundleRelease', 'assembleRelease'] }) {
        if (!modoKeystore || !System.getenv('MODO_UPLOAD_STORE_PASSWORD') || !System.getenv('MODO_UPLOAD_KEY_ALIAS') || !System.getenv('MODO_UPLOAD_KEY_PASSWORD')) {
            throw new GradleException('Release upload signing credentials are required; debug signing is forbidden.')
        }
    }
}
`;
    }
    return mod;
  });
};
