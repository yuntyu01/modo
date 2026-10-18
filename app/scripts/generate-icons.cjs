// Platform icon encoding from the supplied artwork; never redraw the logo.
// Run: node app/scripts/generate-icons.cjs (from any directory).
const fs = require('node:fs/promises');
const path = require('node:path');
const Jimp = require('jimp-compact');
const { generateFaviconAsync } = require('@expo/image-utils');

const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/assets');
const desktop = path.join(root, 'desktop');
const source = path.join(assets, 'brand/app-icon-source.png');
const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const resize = (image, w, h = w) => image.clone().resize(w, h, Jimp.RESIZE_BICUBIC);
const png = image => image.getBufferAsync(Jimp.MIME_PNG);
const write = async (file, image) => fs.writeFile(file, await png(image));

async function main() {
  const bytes = await fs.readFile(source);
  const image = await Jimp.read(bytes);
  if (image.bitmap.width !== image.bitmap.height) throw new Error('Icon source must be square');
  await write(path.join(assets, 'icon.png'), resize(image, 1024));
  await write(path.join(assets, 'favicon.png'), resize(image, 64));
  // Adaptive artwork is 108dp; its normal visible viewport is the middle 72dp.
  const contentSize = Math.round(1024 * 72 / 108);
  const offset = Math.floor((1024 - contentSize) / 2);
  const foreground = new Jimp(1024, 1024, 0x00000000);
  foreground.composite(resize(image, contentSize), offset, offset);
  await write(path.join(assets, 'android-icon-foreground.png'), foreground);
  await write(path.join(assets, 'android-icon-background.png'), new Jimp(1024, 1024, 0x121212ff));
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
  await fs.writeFile(path.join(desktop, 'assets/icon.png'), bytes);
  await fs.writeFile(path.join(desktop, 'assets/icon.ico'), await generateFaviconAsync(bytes, sizes));
  const tiles = path.join(desktop, 'build/appx');
  await fs.mkdir(tiles, { recursive: true });
  for (const [name, size] of [['Square44x44Logo', 44], ['Square150x150Logo', 150], ['StoreLogo', 50]]) {
    await write(path.join(tiles, name + '.png'), resize(image, size));
  }
  await write(path.join(tiles, 'Wide310x150Logo.png'), resize(image, 310).crop(0, 80, 310, 150));
  console.log('Generated mobile, adaptive, themed, web, Windows ICO and Store tile icons from app-icon-source.png.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
