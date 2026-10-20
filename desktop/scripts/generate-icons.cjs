// Windows encodings of the approved artwork. Preserve RGB; round only its plate.
const fs = require('node:fs/promises');
const path = require('node:path');
const Jimp = require('../../app/node_modules/jimp-compact');
const { generateFaviconAsync } = require('../../app/node_modules/@expo/image-utils');

const root = path.resolve(__dirname, '../..');
const sizes = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 128, 256];

async function generateWindowsIcons() {
  const image = await Jimp.read(path.join(root, 'app/assets/brand/app-icon-source.png'));
  const { width, height } = image.bitmap;
  if (width !== height) throw new Error('Approved icon source must be square');
  const radius = width * 0.22;
  image.scan(0, 0, width, height, function (x, y, i) {
    const dx = Math.max(radius - x - 0.5, x + 0.5 - (width - radius), 0);
    const dy = Math.max(radius - y - 0.5, y + 0.5 - (height - radius), 0);
    const coverage = Math.min(1, Math.max(0, radius + 0.5 - Math.hypot(dx, dy)));
    this.bitmap.data[i + 3] = Math.round(this.bitmap.data[i + 3] * coverage);
  });
  const bytes = await image.getBufferAsync(Jimp.MIME_PNG);
  const assets = path.join(root, 'desktop/assets');
  const tiles = path.join(root, 'desktop/build/appx');
  await fs.mkdir(tiles, { recursive: true });
  await fs.writeFile(path.join(assets, 'icon.png'), bytes);
  await fs.writeFile(path.join(assets, 'icon.ico'), await generateFaviconAsync(bytes, sizes));
  const write = async (name, w, h = w) => {
    const resized = image.clone().contain(w, h, Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE, Jimp.RESIZE_BICUBIC);
    await fs.writeFile(path.join(tiles, name + '.png'), await resized.getBufferAsync(Jimp.MIME_PNG));
  };
  for (const [name, size] of [['Square44x44Logo', 44], ['Square150x150Logo', 150], ['StoreLogo', 50]]) {
    await write(name, size);
    for (const scale of [100, 200, 400]) await write(`${name}.scale-${scale}`, size * scale / 100);
  }
  await write('Wide310x150Logo', 310, 150);
  for (const size of sizes) {
    for (const suffix of ['', '_altform-unplated', '_altform-lightunplated']) {
      await write(`Square44x44Logo.targetsize-${size}${suffix}`, size);
    }
  }
  console.log('Generated rounded Windows ICO and scale/target-size assets without recoloring the approved artwork.');
}

module.exports = { generateWindowsIcons };
if (require.main === module) generateWindowsIcons().catch(e => { console.error(e); process.exitCode = 1; });
