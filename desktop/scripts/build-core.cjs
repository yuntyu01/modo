const path = require('node:path');
const { buildSync } = require('esbuild');

buildSync({
  entryPoints: [path.join(__dirname, '../src/core-entry.ts')],
  outfile: path.join(__dirname, '../core.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  define: process.argv.includes('--release') ? { 'process.env.NODE_ENV': '"production"' } : {},
});
