// Renders assets/icon.svg into assets/icon.png (256 px) and assets/icon.ico (16 to 256 px).
// Run with Electron, not Node, since it draws with Chromium:
//   node_modules/electron/dist/electron.exe scripts/make-icon.mjs
// Sizes up to 24 px show only "2": "(2);" is unreadable that small.
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';

const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const svg = readFileSync('assets/icon.svg', 'utf8');
const small = svg.replace('font-size="86" letter-spacing="-5"', 'font-size="168" letter-spacing="0"').replace('y="157"', 'y="186"').replace('(2);', '2');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html,<canvas></canvas>');
  const draw = (source, size) =>
    win.webContents.executeJavaScript(`new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = ${size};
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, ${size}, ${size});
        resolve(c.toDataURL('image/png').split(',')[1]);
      };
      img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(source).toString('base64'))};
    })`);

  const pngs = [];
  for (const size of SIZES) pngs.push(Buffer.from(await draw(size <= 24 ? small : svg, size), 'base64'));
  writeFileSync('assets/icon.png', pngs.at(-1));

  // ICO: a 6-byte header, a 16-byte entry per image, then the PNGs themselves.
  const header = Buffer.alloc(6 + 16 * SIZES.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(SIZES.length, 4);
  let offset = header.length;
  SIZES.forEach((size, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size % 256, e);
    header.writeUInt8(size % 256, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(pngs[i].length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += pngs[i].length;
  });
  writeFileSync('assets/icon.ico', Buffer.concat([header, ...pngs]));
  app.quit();
});
