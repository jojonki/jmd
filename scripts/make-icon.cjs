/**
 * Derives the packaged icons from build/icon-source.png.
 * Run with `npm run icon` on macOS. Writes build/icon.png (the 1024px master),
 * build/icon.ico (Windows), and build/icon.icns (macOS). Uses sips/iconutil,
 * so there is no additional image toolchain to install.
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

// ICO files can contain PNG-compressed images. Build a multi-resolution ICO
// directly so Windows Explorer, shortcuts, and the taskbar can choose the
// appropriate size without falling back to Electron's icon.
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoImages = icoSizes.map((size) => {
  const file = path.join(iconset, `windows_${size}.png`);
  execFileSync('sips', ['-z', String(size), String(size), master, '--out', file], { stdio: 'ignore' });
  return { size, data: fs.readFileSync(file) };
});
const headerSize = 6 + icoImages.length * 16;
let imageOffset = headerSize;
const header = Buffer.alloc(headerSize);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoImages.length, 4);
icoImages.forEach(({ size, data }, index) => {
  const offset = 6 + index * 16;
  header.writeUInt8(size === 256 ? 0 : size, offset);
  header.writeUInt8(size === 256 ? 0 : size, offset + 1);
  header.writeUInt8(0, offset + 2);
  header.writeUInt8(0, offset + 3);
  header.writeUInt16LE(1, offset + 4);
  header.writeUInt16LE(32, offset + 6);
  header.writeUInt32LE(data.length, offset + 8);
  header.writeUInt32LE(imageOffset, offset + 12);
  imageOffset += data.length;
});
const ico = path.join(OUT, 'icon.ico');
fs.writeFileSync(ico, Buffer.concat([header, ...icoImages.map(({ data }) => data)]));
console.log(`wrote ${ico}`);
for (const { size } of icoImages) {
  fs.rmSync(path.join(iconset, `windows_${size}.png`));
}

execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(OUT, 'icon.icns')]);
fs.rmSync(iconset, { recursive: true, force: true });
console.log(`wrote ${path.join(OUT, 'icon.icns')}`);
