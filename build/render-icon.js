// Renders icon.svg to PNGs with Electron's own Chromium (no image tools needed).
// Usage: electron build/render-icon.js <icon.svg> <outDir>
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const [svgPath, outDir] = process.argv.slice(-2);
const SIZES = [16, 32, 48, 64, 128, 256, 512];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<body></body>');
  const svg = Buffer.from(fs.readFileSync(svgPath)).toString('base64');
  for (const size of SIZES) {
    const url = await win.webContents.executeJavaScript(`new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = ${size};
        c.getContext('2d').drawImage(img, 0, 0, ${size}, ${size}); res(c.toDataURL('image/png')); };
      img.onerror = () => rej(new Error('decode failed'));
      img.src = 'data:image/svg+xml;base64,${svg}';
    })`);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${size}.png`), Buffer.from(url.split(',')[1], 'base64'));
  }
  app.quit();
});
