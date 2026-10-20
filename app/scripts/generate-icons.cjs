// Deterministic platform encodings of the user-approved icon source; never redraw it.
// Run: node app/scripts/generate-icons.cjs (from any directory).
const fs = require('node:fs/promises');
const path = require('node:path');
const Jimp = require('jimp-compact');
const { generateWindowsIcons } = require('../../desktop/scripts/generate-icons.cjs');

const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/assets');
const source = path.join(assets, 'brand/app-icon-source.png');
const resize = (image, w, h = w) => image.clone().resize(w, h, Jimp.RESIZE_BICUBIC);
const png = image => image.getBufferAsync(Jimp.MIME_PNG);
const write = async (file, image) => fs.writeFile(file, await png(image));

async function main() {
  const bytes = await fs.readFile(source);
  const image = await Jimp.read(bytes);
  if (image.bitmap.width !== image.bitmap.height) throw new Error('Icon source must be square');
  const background = image.getPixelColor(0, 0);
  const rgba = Jimp.intToRGBA(background);
  const configFile = path.join(root, 'app/app.json');
  const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
  config.expo.android.adaptiveIcon.backgroundColor = '#' + [rgba.r, rgba.g, rgba.b].map(n => n.toString(16).padStart(2, '0')).join('');
  await fs.writeFile(configFile, JSON.stringify(config, null, 2) + '\n');
  await write(path.join(assets, 'icon.png'), resize(image, 1024));
  await write(path.join(assets, 'splash-icon.png'), resize(image, 1024));
  await write(path.join(assets, 'brand/store-icon-512.png'), resize(image, 512));
  await write(path.join(assets, 'favicon.png'), resize(image, 64));
  // Adaptive artwork is 108dp; its normal visible viewport is the middle 72dp.
  // A wide mark also needs a little inset within the circular 66dp safe zone.
  const contentSize = Math.round(1024 * 66 / 108);
  const offset = Math.floor((1024 - contentSize) / 2);
  const foreground = new Jimp(1024, 1024, 0x00000000);
  foreground.composite(resize(image, contentSize), offset, offset);
  await write(path.join(assets, 'android-icon-foreground.png'), foreground);
  await write(path.join(assets, 'android-icon-background.png'), new Jimp(1024, 1024, background));
  // Android's themed variant uses the blue mark's coverage as a white alpha mask.
  const mono = image.clone();
  mono.scan(0, 0, mono.bitmap.width, mono.bitmap.height, function (_x, _y, i) {
    const b = this.bitmap.data;
    const coverage = Math.min(1, Math.max(0, (b[i + 2] - Math.max(b[i], b[i + 1]) - 2) / 12));
    b[i] = b[i + 1] = b[i + 2] = 255;
    b[i + 3] = Math.round(coverage * b[i + 3]);
  });
  const monochrome = new Jimp(1024, 1024, 0x00000000);
  monochrome.composite(resize(mono, contentSize), offset, offset);
  await write(path.join(assets, 'android-icon-monochrome.png'), monochrome);
  await generateWindowsIcons();
  console.log('Generated mobile, adaptive, themed, web, Windows ICO and Store tile icons from app-icon-source.png.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
