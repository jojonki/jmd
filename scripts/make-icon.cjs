/**
 * Derives the packaged icons from build/icon-source.png.
 * Run with `npm run icon`. Writes build/icon.png (the 1024px master used for
 * Windows) and build/icon.icns (macOS). Uses sips/iconutil, so there is no
 * image toolchain to install; on non-macOS it stops after icon.png.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'build');
const SOURCE = path.join(OUT, 'icon-source.png');
const SIZE = 1024;

if (!fs.existsSync(SOURCE)) {
  console.error(`missing ${SOURCE} — put the square, transparent-cornered artwork there`);
  process.exit(1);
}

const master = path.join(OUT, 'icon.png');
execFileSync('sips', ['-z', String(SIZE), String(SIZE), SOURCE, '--out', master], { stdio: 'ignore' });
console.log(`wrote ${master}`);

if (process.platform !== 'darwin') {
  console.log('not macOS: skipping icon.icns');
  process.exit(0);
}

const iconset = path.join(OUT, 'icon.iconset');
fs.rmSync(iconset, { recursive: true, force: true });
fs.mkdirSync(iconset);
for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
  for (const scale of [1, 2]) {
    const pixels = size * scale;
    if (pixels > SIZE) continue;
    const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
    execFileSync('sips', ['-z', String(pixels), String(pixels), master, '--out', path.join(iconset, name)], {
      stdio: 'ignore',
    });
  }
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(OUT, 'icon.icns')]);
fs.rmSync(iconset, { recursive: true, force: true });
console.log(`wrote ${path.join(OUT, 'icon.icns')}`);
