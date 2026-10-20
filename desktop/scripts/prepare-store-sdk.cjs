// Prepare an identity-matched SDK package, including qualified shell icon assets.
const fs = require('node:fs/promises');
const path = require('node:path');

async function main() {
  const desktop = path.resolve(__dirname, '..');
  const config = require('../electron-builder.store.cjs');
  const { version, description } = require('../package.json');
  const runtime = path.join(desktop, 'dist/win-unpacked');
  await fs.access(path.join(runtime, 'modo.exe'));
  const stage = path.join(desktop, 'dist/store-sdk-x64', version);
  const assets = path.join(stage, 'appx/assets');
  await fs.mkdir(assets, { recursive: true });
  const mappings = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Unexpected symlink in packaged runtime');
      if (entry.isDirectory()) await walk(file);
      else mappings.push([file, 'app\\' + path.relative(runtime, file).replaceAll('/', '\\')]);
    }
  }
  await walk(runtime);
  for (const name of await fs.readdir(path.join(desktop, 'build/appx'))) {
    if (!name.endsWith('.png')) throw new Error('Only PNG icon assets belong in build/appx');
    const file = path.join(assets, name);
    await fs.copyFile(path.join(desktop, 'build/appx', name), file);
    mappings.push([file, 'assets\\' + name]);
  }
  const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&apos;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const opts = config.appx;
  const macros = {
    identityName: escape(opts.identityName), arch: 'x64', publisher: escape(opts.publisher),
    version: version + '.0', publisherDisplayName: escape(opts.publisherDisplayName),
    description: escape(description), logo: 'assets\\StoreLogo.png',
    resourceLanguages: opts.languages.map(l => `<Resource Language="${escape(l)}"/>`).join(''),
    minVersion: opts.minVersion, maxVersionTested: opts.maxVersionTested,
    capabilities: '<Capabilities><rescap:Capability Name="runFullTrust"/></Capabilities>',
    applicationId: opts.applicationId, executable: 'app\\modo.exe',
    backgroundColor: opts.backgroundColor,
    square150x150Logo: 'assets\\Square150x150Logo.png',
    square44x44Logo: 'assets\\Square44x44Logo.png',
    lockScreen: '', defaultTile: '<uap:DefaultTile Wide310x150Logo="assets\\Wide310x150Logo.png"/>',
    splashScreen: '', extensions: '',
  };
  const template = await fs.readFile(path.join(desktop, 'build/AppxManifest.xml'), 'utf8');
  const manifest = template.replace(/\$\{(\w+)\}/g, (_, key) => {
    if (!(key in macros)) throw new Error(`Unsupported manifest macro: ${key}`);
    return macros[key];
  });
  const manifestFile = path.join(stage, 'AppxManifest.xml');
  await fs.writeFile(manifestFile, manifest);
  // A single PRI keeps every scale/target-size variant in this desktop package.
  const priConfig = path.join(stage, 'priconfig.xml');
  await fs.writeFile(priConfig, '<?xml version="1.0" encoding="utf-8"?><resources targetOsVersion="10.0.0" majorVersion="1"><index root="\\" startIndexAt="\\"><default><qualifier name="Language" value="en-US"/><qualifier name="Scale" value="100"/><qualifier name="Contrast" value="standard"/></default><indexer-config type="folder" foldernameAsQualifier="true" filenameAsQualifier="true" qualifierDelimiter="."/></index></resources>');
  const pri = path.join(stage, 'resources.pri');
  mappings.push([manifestFile, 'AppxManifest.xml'], [pri, 'resources.pri']);
  const mapping = path.join(stage, 'mapping.txt');
  await fs.writeFile(mapping, '[Files]\r\n' + mappings.map(([from, to]) => `"${from}" "${to}"`).join('\r\n') + '\r\n');
  process.stdout.write(JSON.stringify({ stage, manifest: manifestFile, priRoot: path.dirname(assets), priConfig, pri, mapping, output: path.join(desktop, `dist/modo-${version}-store-x64.appx`) }));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
