const { app, BrowserWindow, ipcMain, shell, clipboard, Tray, Menu, globalShortcut, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');

// Stable WM_CLASS so the taskbar matches the window to nova-commander.desktop.
app.commandLine.appendSwitch('class', 'nova-commander');

let winSeq = 0;
const windows = new Set(); // every open BrowserWindow
let tray = null;
let keepInTray = false; // closing the last window hides it to the tray instead of quitting
let quitting = false;

// Each window gets a number (?w=N); window 1 owns the saved layout. `query.path` opens a folder,
// `query.saved` restores a saved window layout.
function createWindow(query = {}) {
  const w = new BrowserWindow({
    width: 1520,
    height: 920,
    minWidth: 960,
    minHeight: 560,
    frame: false,
    show: false,
    backgroundColor: '#0e1014',
    title: 'Nova Commander',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      plugins: true,
    },
  });
  windows.add(w);
  w.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { w: String(++winSeq), ...query } });
  w.once('ready-to-show', () => w.show());
  w.on('maximize', () => w.webContents.send('win:state', true));
  w.on('unmaximize', () => w.webContents.send('win:state', false));
  w.on('close', (e) => {
    if (keepInTray && !quitting && [...windows].filter((x) => x.isVisible()).length <= 1) { e.preventDefault(); w.hide(); }
  });
  const wcId = w.webContents.id;
  w.on('closed', () => { windows.delete(w); dropWatchers(wcId); });
  // Never let a stray drop navigate the window away from the app.
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  return w;
}
function showMain() {
  const w = [...windows][0];
  if (!w) return createWindow();
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
  return w;
}

// A folder (or file) passed on the command line, e.g. by "open folder" from the desktop.
function pathFromArgv(argv) {
  for (const a of argv.slice(1)) {
    if (a.startsWith('-')) continue;
    let p = a;
    try { if (a.startsWith('file://')) p = decodeURIComponent(new URL(a).pathname); } catch { continue; }
    if (!path.isAbsolute(p) || p === __dirname || p === path.join(__dirname, 'main.js') || p === process.execPath) continue;
    if (fs.existsSync(p)) return p;
  }
  return null;
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  const p = pathFromArgv(argv);
  const w = showMain();
  if (p) w.webContents.send('app:open', p);
});

ipcMain.on('sys:home', (e) => { e.returnValue = os.homedir(); });

app.whenReady().then(() => {
  // Nothing in Nova needs camera, microphone, location, notifications…: refuse them all.
  require('electron').session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  loadTags();
  const p = pathFromArgv(process.argv);
  createWindow(p ? { path: p } : {});
});
app.on('window-all-closed', () => { if (!keepInTray) app.quit(); });
app.on('before-quit', () => { quitting = true; flushTags(); });
app.on('will-quit', () => globalShortcut.unregisterAll());

ipcMain.on('win:new', (_, query) => { createWindow(query || {}); });

// Tray icon + "keep running in the background".
ipcMain.handle('app:background', (_, on) => {
  keepInTray = !!on;
  if (keepInTray && !tray) {
    tray = new Tray(path.join(__dirname, 'icon.png'));
    tray.setToolTip('Nova Commander');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show Nova Commander', click: showMain },
      { label: 'New window', click: () => createWindow() },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('click', showMain);
  } else if (!keepInTray && tray) { tray.destroy(); tray = null; }
  return true;
});
// System-wide shortcut that brings Nova to the front (Electron accelerator syntax).
ipcMain.handle('app:hotkey', (_, accel) => {
  globalShortcut.unregisterAll();
  if (!accel) return { ok: true };
  try {
    const okReg = globalShortcut.register(accel, () => {
      const w = [...windows].find((x) => x.isFocused());
      if (w && w.isVisible()) w.hide(); else showMain();
    });
    return okReg ? { ok: true } : { ok: false, error: 'That shortcut is already used by another program' };
  } catch (e) { return { ok: false, error: e.message }; }
});

/* ---------------- helpers ---------------- */

const ok = (data) => ({ ok: true, ...data });
const fail = (err) => ({ ok: false, error: err && err.message ? err.message.replace(/^\w+: /, '') : String(err), code: err && err.code });

async function exists(p) {
  try { await fsp.lstat(p); return true; } catch { return false; }
}

async function statEntry(dir, name) {
  const p = path.join(dir, name);
  let ls;
  try { ls = await fsp.lstat(p); } catch { return null; }
  const isLink = ls.isSymbolicLink();
  let st = ls;
  let broken = false;
  if (isLink) { try { st = await fsp.stat(p); } catch { broken = true; } }
  const isDir = st.isDirectory();
  return {
    name,
    path: p,
    isDir,
    size: isDir ? null : st.size,
    mtime: st.mtimeMs,
    ctime: st.birthtimeMs || st.ctimeMs,
    exec: !isDir && st.isFile() && (st.mode & 0o111) !== 0,
    isLink,
    broken,
    hidden: name.startsWith('.'),
  };
}

async function uniqueName(dir, name, isDir, copySuffix) {
  const ext = isDir ? '' : path.extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  if (copySuffix) {
    let cand = `${base} - Copy${ext}`;
    if (!(await exists(path.join(dir, cand)))) return path.join(dir, cand);
    for (let i = 2; ; i++) {
      cand = `${base} - Copy (${i})${ext}`;
      if (!(await exists(path.join(dir, cand)))) return path.join(dir, cand);
    }
  }
  for (let i = 2; ; i++) {
    const cand = `${base} (${i})${ext}`;
    if (!(await exists(path.join(dir, cand)))) return path.join(dir, cand);
  }
}

async function moveOne(src, dest) {
  try {
    await fsp.rename(src, dest);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    // Different filesystem: copy then remove the original.
    await fsp.cp(src, dest, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true, errorOnExist: true, force: false });
    await fsp.rm(src, { recursive: true, force: true });
  }
}

async function copyOne(src, dest) {
  await fsp.cp(src, dest, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true, errorOnExist: true, force: false });
}

const isInside = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

// Send to one window (its webContents) or, without a target, to every window.
function send(ch, data, wc) {
  if (wc) { if (!wc.isDestroyed()) wc.send(ch, data); return; }
  for (const w of windows) if (!w.webContents.isDestroyed()) w.webContents.send(ch, data);
}
const progress = (data, wc) => send('op:progress', data, wc);

/* ---------------- colour tags ---------------- */
// Tags live in a JSON sidecar keyed by absolute path (index into the renderer's
// TAGS palette). The file operations below keep it in sync with renames and moves.

let tags = {};
let tagsFile = null;
let tagsSaveT = null;

function loadTags() {
  tagsFile = path.join(app.getPath('userData'), 'tags.json');
  try { tags = JSON.parse(fs.readFileSync(tagsFile, 'utf8')) || {}; } catch { tags = {}; }
  // Forget tags of paths that were deleted outside the app.
  Promise.all(Object.keys(tags).map(async (p) => (await exists(p) ? 0 : (delete tags[p], 1))))
    .then((gone) => { if (gone.some(Boolean)) tagsChanged(); });
}
function flushTags() {
  if (!tagsSaveT) return;
  clearTimeout(tagsSaveT);
  tagsSaveT = null;
  try { fs.writeFileSync(tagsFile, JSON.stringify(tags)); } catch { /* read-only config dir */ }
}
function tagsChanged() {
  clearTimeout(tagsSaveT);
  tagsSaveT = setTimeout(flushTags, 400);
  send('tags:changed', tags);
}
// Move (or copy) the tags of `from` and everything under it to `to`.
function remapTags(from, to, copy = false) {
  let hit = false;
  const prefix = from + path.sep;
  for (const k of Object.keys(tags)) {
    if (k !== from && !k.startsWith(prefix)) continue;
    tags[to + k.slice(from.length)] = tags[k];
    if (!copy) delete tags[k];
    hit = true;
  }
  return hit;
}
function dropTags(p) {
  let hit = false;
  const prefix = p + path.sep;
  for (const k of Object.keys(tags)) if (k === p || k.startsWith(prefix)) { delete tags[k]; hit = true; }
  return hit;
}

ipcMain.handle('tags:get', () => tags);
ipcMain.handle('tags:set', (_, paths, color) => {
  for (const p of paths) { if (color) tags[p] = color; else delete tags[p]; }
  tagsChanged();
  return true;
});

/* ---------------- file system IPC ---------------- */

ipcMain.handle('fs:list', async (_, dir) => {
  try {
    const names = await fsp.readdir(dir);
    const entries = (await Promise.all(names.map((n) => statEntry(dir, n)))).filter(Boolean);
    return ok({ entries });
  } catch (e) { return fail(e); }
});

ipcMain.handle('fs:stat', async (_, p) => {
  try { const e = await statEntry(path.dirname(p), path.basename(p)); return e ? ok({ entry: e }) : fail(new Error('Not found')); }
  catch (e) { return fail(e); }
});

// Recursive folder size, bounded so huge trees can't stall the app.
ipcMain.handle('fs:dirSize', async (_, root) => {
  const started = Date.now();
  let size = 0, count = 0, partial = false;
  const stack = [root];
  while (stack.length) {
    if (count > 250000 || Date.now() - started > 6000) { partial = true; break; }
    const dir = stack.pop();
    let items;
    try { items = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    const files = [];
    for (const d of items) {
      count++;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) stack.push(p);
      else if (d.isFile()) files.push(p);
    }
    const stats = await Promise.all(files.map((p) => fsp.lstat(p).catch(() => null)));
    for (const s of stats) if (s) size += s.size;
  }
  return { size, partial };
});

ipcMain.handle('fs:conflicts', async (_, sources, destDir) => {
  const out = [];
  for (const src of sources) {
    if (path.dirname(src) === destDir) continue;
    if (await exists(path.join(destDir, path.basename(src)))) out.push(path.basename(src));
  }
  return out;
});

/* Copy engine: pausable and cancellable between files and every 1 MB of a big
 * file, reporting bytes. The renderer queues transfers and runs them one at a time. */
const opJobs = new Map(); // id -> { paused, cancelled, waiters }
const BIG_FILE = 8 * 1024 * 1024;
class Cancelled extends Error { constructor() { super('Cancelled'); this.code = 'ECANCELLED'; } }

async function checkpoint(job) {
  while (job.paused && !job.cancelled) await new Promise((r) => job.waiters.push(r));
  if (job.cancelled) throw new Cancelled();
}
ipcMain.on('op:control', (_, id, action) => {
  const job = opJobs.get(id);
  if (!job) return;
  if (action === 'pause') { job.paused = true; return; }
  if (action === 'cancel') job.cancelled = true;
  job.paused = false;
  job.waiters.splice(0).forEach((r) => r());
});

async function streamCopy(src, dest, mode, job, onBytes) {
  const rh = await fsp.open(src, 'r');
  let wh;
  try {
    wh = await fsp.open(dest, 'wx', mode);
    const buf = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      await checkpoint(job);
      const { bytesRead } = await rh.read(buf, 0, buf.length, null);
      if (!bytesRead) break;
      for (let off = 0; off < bytesRead;) off += (await wh.write(buf, off, bytesRead - off)).bytesWritten;
      onBytes(bytesRead);
    }
  } finally {
    await rh.close();
    await wh?.close();
  }
}
// Recursive copy that keeps symlinks as links and preserves modes and timestamps.
async function copyTree(src, dest, job, onBytes) {
  await checkpoint(job);
  const st = await fsp.lstat(src);
  if (st.isSymbolicLink()) { await fsp.symlink(await fsp.readlink(src), dest); return; }
  if (st.isDirectory()) {
    await fsp.mkdir(dest, { mode: (st.mode & 0o7777) | 0o700 });
    for (const name of await fsp.readdir(src)) await copyTree(path.join(src, name), path.join(dest, name), job, onBytes);
    await fsp.chmod(dest, st.mode & 0o7777).catch(() => {});
    await fsp.utimes(dest, st.atime, st.mtime).catch(() => {});
    return;
  }
  if (!st.isFile()) return; // sockets, fifos and devices are skipped
  if (st.size < BIG_FILE) {
    await fsp.copyFile(src, dest, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE);
    onBytes(st.size);
  } else await streamCopy(src, dest, st.mode & 0o7777, job, onBytes);
  await fsp.utimes(dest, st.atime, st.mtime).catch(() => {});
}
// Total bytes under the given roots; null if the tree is too big to measure quickly.
async function measure(roots) {
  const started = Date.now();
  let size = 0, count = 0;
  const stack = [...roots];
  while (stack.length) {
    if (++count > 200000 || Date.now() - started > 3000) return null;
    const p = stack.pop();
    const st = await fsp.lstat(p).catch(() => null);
    if (!st) continue;
    if (st.isDirectory()) {
      const names = await fsp.readdir(p).catch(() => []);
      for (const n of names) stack.push(path.join(p, n));
    } else if (st.isFile()) size += st.size;
  }
  return size;
}

ipcMain.handle('fs:transfer', async (e, { id, sources, destDir, mode, policy }) => {
  const job = { paused: false, cancelled: false, waiters: [] };
  opJobs.set(id, job);
  const done = [], skipped = [], errors = [];
  const total = sources.length;
  let i = 0, tagHit = false, name = '';
  // Moves within one filesystem are instant renames; only real copying counts towards bytes.
  const destDev = (await fsp.stat(destDir).catch(() => null))?.dev;
  const needsCopy = [];
  for (const src of sources) {
    const st = await fsp.lstat(src).catch(() => null);
    if (st && (mode === 'copy' || st.dev !== destDev)) needsCopy.push(src);
  }
  const bytesTotal = needsCopy.length ? await measure(needsCopy) : 0;
  let bytesDone = 0, lastReport = 0;
  const report = (force = false) => {
    const now = Date.now();
    if (!force && now - lastReport < 120) return;
    lastReport = now;
    progress({ id, mode, index: i, total, name, bytesDone, bytesTotal, paused: job.paused }, e.sender);
  };
  const onBytes = (n) => { bytesDone += n; report(); };

  for (const src of sources) {
    if (job.cancelled) break;
    i++;
    name = path.basename(src);
    report(true);
    let dest = null, created = false;
    try {
      await checkpoint(job);
      if (mode === 'move' && path.dirname(src) === destDir) { skipped.push(src); continue; }
      if (isInside(destDir, src)) { errors.push(`Can't ${mode} "${name}" into itself`); continue; }
      dest = path.join(destDir, name);
      if (await exists(dest)) {
        const st = await fsp.stat(src).catch(() => null);
        const isDir = !!(st && st.isDirectory());
        if (mode === 'copy' && path.dirname(src) === destDir) {
          dest = await uniqueName(destDir, name, isDir, true);
        } else if (policy === 'skip') {
          skipped.push(src); continue;
        } else if (policy === 'replace') {
          // Replaced items go to the trash rather than being destroyed.
          try { await shell.trashItem(dest); } catch { await fsp.rm(dest, { recursive: true, force: true }); }
          if (dropTags(dest)) tagHit = true;
        } else {
          dest = await uniqueName(destDir, name, isDir, false);
        }
      }
      if (mode === 'move' && !needsCopy.includes(src)) {
        await fsp.rename(src, dest);
      } else {
        created = true;
        await copyTree(src, dest, job, onBytes);
        if (mode === 'move') await fsp.rm(src, { recursive: true, force: true });
      }
      if (remapTags(src, dest, mode !== 'move')) tagHit = true;
      done.push({ from: src, to: dest });
    } catch (e) {
      // Never leave a half-copied item behind; the source is untouched until a copy completes.
      if (created && dest) await fsp.rm(dest, { recursive: true, force: true }).catch(() => {});
      if (e instanceof Cancelled) break;
      errors.push(`${name}: ${fail(e).error}`);
    }
  }
  opJobs.delete(id);
  progress({ id, mode, finished: true }, e.sender);
  if (tagHit) tagsChanged();
  return { done, skipped, errors, cancelled: job.cancelled };
});

// Symbolic or hard links to `sources`, created in destDir.
ipcMain.handle('fs:link', async (_, sources, destDir, kind) => {
  const done = [], errors = [];
  for (const src of sources) {
    try {
      const st = await fsp.lstat(src);
      if (kind === 'hard' && st.isDirectory()) throw new Error('folders can’t be hard-linked');
      const name = path.dirname(src) === destDir ? `Link to ${path.basename(src)}` : path.basename(src);
      let dest = path.join(destDir, name);
      if (await exists(dest)) dest = await uniqueName(destDir, name, st.isDirectory(), false);
      if (kind === 'hard') await fsp.link(src, dest); else await fsp.symlink(src, dest);
      done.push({ from: src, to: dest });
    } catch (e) { errors.push(`${path.basename(src)}: ${fail(e).error}`); }
  }
  return { done, errors };
});

/* ---------------- templates (XDG Templates folder) ---------------- */

const templatesDir = () => readUserDirs().TEMPLATES || path.join(os.homedir(), 'Templates');
ipcMain.handle('tpl:list', async () => {
  const dir = templatesDir();
  try {
    const names = (await fsp.readdir(dir)).filter((n) => !n.startsWith('.')).sort((a, b) => a.localeCompare(b));
    return { dir, items: names.map((n) => path.join(dir, n)) };
  } catch { return { dir, items: [] }; }
});
ipcMain.handle('tpl:create', async (_, tpl, destDir) => {
  try {
    const name = path.basename(tpl);
    let dest = path.join(destDir, name);
    const isDir = (await fsp.stat(tpl)).isDirectory();
    if (await exists(dest)) dest = await uniqueName(destDir, name, isDir, false);
    await copyOne(tpl, dest);
    return ok({ path: dest });
  } catch (e) { return fail(e); }
});
ipcMain.handle('tpl:save', async (_, src) => {
  try {
    const dir = templatesDir();
    await fsp.mkdir(dir, { recursive: true });
    const name = path.basename(src);
    let dest = path.join(dir, name);
    if (await exists(dest)) dest = await uniqueName(dir, name, (await fsp.stat(src)).isDirectory(), false);
    await copyOne(src, dest);
    return ok({ path: dest });
  } catch (e) { return fail(e); }
});

/* ---------------- photo EXIF (JPEG, no external tools) ---------------- */

function parseTiff(b, base) {
  const le = b.toString('latin1', base, base + 2) === 'II';
  const u16 = (o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const u32 = (o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const s32 = (o) => (le ? b.readInt32LE(o) : b.readInt32BE(o));
  const SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  const readIfd = (at) => {
    const out = {};
    if (!at || base + at + 2 > b.length) return out;
    const n = u16(base + at);
    for (let i = 0; i < n; i++) {
      const e = base + at + 2 + i * 12;
      if (e + 12 > b.length) break;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      const size = (SIZES[type] || 1) * count;
      const vo = size <= 4 ? e + 8 : base + u32(e + 8);
      if (vo + size > b.length) continue;
      const val = (k) => {
        switch (type) {
          case 3: return u16(vo + k * 2);
          case 4: return u32(vo + k * 4);
          case 5: { const d = u32(vo + k * 8 + 4); return d ? u32(vo + k * 8) / d : 0; }
          case 10: { const d = s32(vo + k * 8 + 4); return d ? s32(vo + k * 8) / d : 0; }
          default: return b[vo + k];
        }
      };
      if (type === 2) out[tag] = b.toString('latin1', vo, vo + count).replace(/\0+$/, '').trim();
      else out[tag] = count === 1 ? val(0) : Array.from({ length: Math.min(count, 8) }, (_, k) => val(k));
    }
    return out;
  };
  const ifd0 = readIfd(u32(base + 4));
  const ex = readIfd(ifd0[0x8769]);
  const gps = readIfd(ifd0[0x8825]);
  const r = {};
  const camera = [ifd0[0x010F], ifd0[0x0110]].filter(Boolean);
  if (camera.length) r.camera = camera[1] && camera[0] && camera[1].startsWith(camera[0]) ? camera[1] : camera.join(' ');
  const dt = ex[0x9003] || ifd0[0x0132];
  if (typeof dt === 'string') { const m = dt.match(/^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d)/); if (m) r.taken = `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`; }
  if (ex[0x829A]) r.exposure = ex[0x829A] >= 1 ? `${ex[0x829A]} s` : `1/${Math.round(1 / ex[0x829A])} s`;
  if (ex[0x829D]) r.aperture = `f/${(+ex[0x829D]).toFixed(1)}`;
  if (ex[0x8827]) r.iso = `ISO ${Array.isArray(ex[0x8827]) ? ex[0x8827][0] : ex[0x8827]}`;
  if (ex[0x920A]) r.focal = `${Math.round(ex[0x920A])} mm`;
  const dms = (v, ref) => (Array.isArray(v) && v.length >= 3 ? (v[0] + v[1] / 60 + v[2] / 3600) * (ref === 'S' || ref === 'W' ? -1 : 1) : null);
  const lat = dms(gps[2], gps[1]), lon = dms(gps[4], gps[3]);
  if (lat != null && lon != null && (lat || lon)) r.gps = { lat: +lat.toFixed(6), lon: +lon.toFixed(6) };
  return Object.keys(r).length ? r : null;
}
ipcMain.handle('fs:exif', async (_, p) => {
  let fh;
  try {
    fh = await fsp.open(p, 'r');
    const buf = Buffer.alloc(256 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const b = buf.subarray(0, bytesRead);
    if (b.length < 4 || b.readUInt16BE(0) !== 0xFFD8) return null;
    for (let off = 2; off + 4 < b.length;) {
      if (b[off] !== 0xFF) return null;
      const marker = b[off + 1];
      const len = b.readUInt16BE(off + 2);
      if (marker === 0xE1 && b.toString('latin1', off + 4, off + 10) === 'Exif\0\0') return parseTiff(b, off + 10);
      if (marker === 0xDA) return null;
      off += 2 + len;
    }
    return null;
  } catch { return null; } finally { await fh?.close(); }
});

// Only ever opens a map at given coordinates — the renderer can't pass arbitrary URLs.
ipcMain.handle('sys:openMap', (_, lat, lon) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  shell.openExternal(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`);
  return true;
});

/* ---------------- "Open with" (desktop entries + gio launch) ---------------- */

function applicationDirs() {
  const home = os.homedir();
  const dirs = [path.join(process.env.XDG_DATA_HOME || path.join(home, '.local/share'), 'applications')];
  for (const d of (process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':')) if (d) dirs.push(path.join(d, 'applications'));
  dirs.push(path.join(home, '.local/share/flatpak/exports/share/applications'), '/var/lib/flatpak/exports/share/applications');
  return [...new Set(dirs)];
}
function parseDesktop(txt) {
  const f = {};
  let inMain = false;
  for (const l of txt.split('\n')) {
    if (l.startsWith('[')) { inMain = l.trim() === '[Desktop Entry]'; continue; }
    if (!inMain) continue;
    const i = l.indexOf('=');
    if (i > 0) { const k = l.slice(0, i).trim(); if (!(k in f)) f[k] = l.slice(i + 1).trim(); }
  }
  return f;
}
async function listApps() {
  const seen = new Map(); // desktop id -> app; earlier dirs override later ones
  for (const dir of applicationDirs()) {
    let names;
    try { names = await fsp.readdir(dir); } catch { continue; }
    for (const n of names) {
      if (!n.endsWith('.desktop') || seen.has(n)) continue;
      const file = path.join(dir, n);
      let f;
      try { f = parseDesktop(await fsp.readFile(file, 'utf8')); } catch { continue; }
      if (f.Type !== 'Application' || f.Hidden === 'true' || !f.Exec) { seen.set(n, null); continue; }
      // Apps whose Exec line has no %f/%F/%u/%U can't be handed a file (e.g. settings panels).
      seen.set(n, { id: n, file, name: f.Name || n, mimes: (f.MimeType || '').split(';').filter(Boolean), hidden: f.NoDisplay === 'true', takesFiles: /%[fFuU]/.test(f.Exec) });
    }
  }
  return [...seen.values()].filter(Boolean);
}
const pickApp = (a) => ({ id: a.id, file: a.file, name: a.name });
ipcMain.handle('sys:apps', async (_, p) => {
  const mime = (await run(`mime-${Date.now()}`, 'xdg-mime', ['query', 'filetype', p])).out.trim();
  const def = mime ? (await run(`def-${Date.now()}`, 'xdg-mime', ['query', 'default', mime])).out.trim() : '';
  const apps = await listApps();
  const major = mime.split('/')[0] + '/*';
  const byName = (a, b) => a.name.localeCompare(b.name);
  const matches = apps.filter((a) => a.mimes.includes(mime) || a.mimes.includes(major)).sort(byName);
  const others = apps.filter((a) => !matches.includes(a) && !a.hidden && a.takesFiles).sort(byName);
  return { mime, defaultId: def, apps: matches.map(pickApp), others: others.map(pickApp) };
});
ipcMain.handle('sys:openWith', async (_, file, appRef, mime, makeDefault) => {
  const app = (await listApps()).find((a) => a.file === appRef?.file);
  if (!app) return { ok: false, error: 'Unknown application' };
  if (makeDefault && mime) await run(`setdef-${Date.now()}`, 'xdg-mime', ['default', app.id, mime]);
  return new Promise((resolve) => {
    const child = spawn('gio', ['launch', app.file, file], { detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.once('error', (e) => resolve({ ok: false, error: e.message }));
    // gio exits as soon as the app has been started.
    child.once('exit', (code) => resolve(code ? { ok: false, error: err.trim() || `gio exited with ${code}` } : { ok: true }));
    child.unref();
  });
});

ipcMain.handle('fs:undoMove', async (_, pairs) => {
  const errors = [];
  let tagHit = false;
  for (const { from, to } of pairs.slice().reverse()) {
    try {
      if (await exists(from)) { errors.push(`${path.basename(from)} already exists at its original location`); continue; }
      await moveOne(to, from);
      if (remapTags(to, from)) tagHit = true;
    } catch (e) { errors.push(`${path.basename(to)}: ${fail(e).error}`); }
  }
  if (tagHit) tagsChanged();
  return { errors };
});

ipcMain.handle('fs:rename', async (_, oldPath, newName) => {
  try {
    if (!newName || newName.includes('/') || newName === '.' || newName === '..') throw new Error('Invalid name');
    const dest = path.join(path.dirname(oldPath), newName);
    if (dest === oldPath) return ok({ path: dest });
    if (await exists(dest) && dest.toLowerCase() !== oldPath.toLowerCase()) throw new Error(`"${newName}" already exists`);
    await fsp.rename(oldPath, dest);
    if (remapTags(oldPath, dest)) tagsChanged();
    return ok({ path: dest });
  } catch (e) { return fail(e); }
});

// Rename many items at once. Every source is first parked under a temporary
// name so swaps and chains (a→b, b→a) work; on failure items are put back.
const validName = (n) => !!n && n !== '.' && n !== '..' && !n.includes('/') && !n.includes('\0') && Buffer.byteLength(n) <= 255;

ipcMain.handle('fs:batchRename', async (_, pairs) => {
  pairs = pairs.filter((p) => p.from !== p.to);
  if (!pairs.length) return { done: [], errors: [] };
  const froms = new Set(pairs.map((p) => p.from));
  const tos = new Set();
  for (const { from, to } of pairs) {
    const name = path.basename(to);
    if (!validName(name) || path.dirname(to) !== path.dirname(from)) return { done: [], errors: [`Invalid name “${name}”`] };
    if (tos.has(to)) return { done: [], errors: [`Two items would be named “${name}”`] };
    tos.add(to);
    // A case-only rename on a case-insensitive filesystem "exists" already.
    if (!froms.has(to) && to.toLowerCase() !== from.toLowerCase() && await exists(to)) return { done: [], errors: [`“${name}” already exists`] };
  }

  const stamp = `${process.pid}-${Date.now().toString(36)}`;
  const staged = [];
  try {
    for (let i = 0; i < pairs.length; i++) {
      const tmp = path.join(path.dirname(pairs[i].from), `.nova-rename-${stamp}-${i}`);
      await fsp.rename(pairs[i].from, tmp);
      remapTags(pairs[i].from, tmp);
      staged.push({ ...pairs[i], tmp });
    }
  } catch (e) {
    for (const s of staged.reverse()) { await fsp.rename(s.tmp, s.from).catch(() => {}); remapTags(s.tmp, s.from); }
    return { done: [], errors: [fail(e).error] };
  }

  const done = [], errors = [];
  for (const s of staged) {
    try {
      if (await exists(s.to)) throw new Error(`“${path.basename(s.to)}” already exists`);
      await fsp.rename(s.tmp, s.to);
      remapTags(s.tmp, s.to);
      done.push({ from: s.from, to: s.to });
    } catch (e) {
      errors.push(`${path.basename(s.from)}: ${fail(e).error}`);
      try { await fsp.rename(s.tmp, s.from); remapTags(s.tmp, s.from); }
      catch { errors.push(`${path.basename(s.from)} was left as ${path.basename(s.tmp)}`); }
    }
  }
  tagsChanged();
  return { done, errors };
});

ipcMain.handle('fs:mkdir', async (_, dir, name) => {
  try {
    let p = path.join(dir, name);
    if (await exists(p)) p = await uniqueName(dir, name, true, false);
    await fsp.mkdir(p);
    return ok({ path: p });
  } catch (e) { return fail(e); }
});

ipcMain.handle('fs:newFile', async (_, dir, name) => {
  try {
    let p = path.join(dir, name);
    if (await exists(p)) p = await uniqueName(dir, name, false, false);
    await fsp.writeFile(p, '', { flag: 'wx' });
    return ok({ path: p });
  } catch (e) { return fail(e); }
});

ipcMain.handle('fs:trash', async (_, paths) => {
  // `failed` lists paths the Trash refused (e.g. NTFS drives whose .Trash-UID isn't owned by the user).
  const errors = [], failed = []; let count = 0, tagHit = false;
  for (const p of paths) {
    try { await shell.trashItem(p); count++; if (dropTags(p)) tagHit = true; } catch (e) { errors.push(`${path.basename(p)}: ${fail(e).error}`); failed.push(p); }
  }
  if (tagHit) tagsChanged();
  return { count, errors, failed };
});

ipcMain.handle('fs:delete', async (_, paths) => {
  const errors = []; let count = 0, tagHit = false;
  for (const p of paths) {
    try { await fsp.rm(p, { recursive: true, force: false }); count++; if (dropTags(p)) tagHit = true; } catch (e) { errors.push(`${path.basename(p)}: ${fail(e).error}`); }
  }
  if (tagHit) tagsChanged();
  return { count, errors };
});

ipcMain.handle('fs:open', async (_, p) => {
  const err = await shell.openPath(p);
  return err ? { ok: false, error: err } : { ok: true };
});

ipcMain.handle('fs:reveal', (_, p) => { shell.showItemInFolder(p); return true; });

ipcMain.handle('fs:terminal', async (_, dir) => {
  const candidates = [
    ['x-terminal-emulator', []], ['gnome-terminal', [`--working-directory=${dir}`]], ['ptyxis', ['--new-window', '-d', dir]],
    ['konsole', ['--workdir', dir]], ['xfce4-terminal', [`--working-directory=${dir}`]], ['kitty', ['-d', dir]],
    ['alacritty', ['--working-directory', dir]], ['wezterm', ['start', '--cwd', dir]], ['foot', ['-D', dir]], ['xterm', []],
  ];
  for (const [cmd, args] of candidates) {
    const launched = await new Promise((resolve) => {
      try {
        const child = spawn(cmd, args, { cwd: dir, detached: true, stdio: 'ignore' });
        child.once('error', () => resolve(false));
        child.once('spawn', () => { child.unref(); resolve(true); });
      } catch { resolve(false); }
    });
    if (launched) return { ok: true };
  }
  return { ok: false, error: 'No terminal emulator found' };
});

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif', 'apng']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'mkv', 'ogv', 'm4v']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus', 'oga']);

ipcMain.handle('fs:preview', async (_, p) => {
  try {
    const st = await fsp.stat(p);
    const base = { ok: true, size: st.size, mtime: st.mtimeMs, ctime: st.birthtimeMs || st.ctimeMs, mode: (st.mode & 0o777).toString(8) };
    if (st.isDirectory()) {
      let count = null, folders = 0, files = 0;
      try {
        const items = await fsp.readdir(p, { withFileTypes: true });
        count = items.length;
        for (const d of items) (d.isDirectory() ? folders++ : files++);
      } catch { /* permission denied */ }
      return { ...base, kind: 'dir', count, folders, files };
    }
    const ext = path.extname(p).slice(1).toLowerCase();
    const url = pathToFileURL(p).href;
    if (IMAGE_EXT.has(ext)) return { ...base, kind: 'image', url };
    if (VIDEO_EXT.has(ext)) return { ...base, kind: 'video', url };
    if (AUDIO_EXT.has(ext)) return { ...base, kind: 'audio', url };
    if (ext === 'pdf') return { ...base, kind: 'pdf', url };
    if (st.size <= 4 * 1024 * 1024) {
      const fh = await fsp.open(p, 'r');
      try {
        const buf = Buffer.alloc(Math.min(st.size, 64 * 1024));
        const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
        const slice = buf.subarray(0, bytesRead);
        if (!slice.subarray(0, 8192).includes(0)) {
          return { ...base, kind: 'text', text: slice.toString('utf8'), truncated: st.size > bytesRead };
        }
      } finally { await fh.close(); }
    }
    return { ...base, kind: 'binary' };
  } catch (e) { return fail(e); }
});

function readUserDirs() {
  const home = os.homedir();
  const dirs = {};
  try {
    const txt = fs.readFileSync(path.join(home, '.config', 'user-dirs.dirs'), 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^XDG_(\w+)_DIR="(.*)"$/);
      if (m) dirs[m[1]] = m[2].replace('$HOME', home);
    }
  } catch { /* defaults below */ }
  return dirs;
}

// Device path -> filesystem label, from udev's /dev/disk/by-label links (names escape spaces as \x20).
function driveLabels() {
  const labels = new Map();
  try {
    for (const l of fs.readdirSync('/dev/disk/by-label')) {
      try { labels.set(fs.realpathSync(path.join('/dev/disk/by-label', l)), l.replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))); } catch { /* dangling link */ }
    }
  } catch { /* no udev labels */ }
  return labels;
}

// Extra details for the Properties dialog: the volume holding `p`, and owner/group names.
ipcMain.handle('fs:props', async (_, p) => {
  const out = {};
  try {
    // Longest mount point that contains p.
    let best = null;
    for (const line of fs.readFileSync('/proc/mounts', 'utf8').split('\n')) {
      const [dev, mnt, type] = line.split(' ');
      if (!mnt) continue;
      const point = mnt.replace(/\\040/g, ' ');
      if (isInside(p, point) && (!best || point.length >= best.point.length)) best = { dev, point, type };
    }
    if (best) {
      let label = null;
      try { label = driveLabels().get(fs.realpathSync(best.dev)); } catch { /* not a block device */ }
      const s = await fsp.statfs(best.point);
      Object.assign(out, { mount: best.point, fstype: best.type, volume: label || (best.point === '/' ? 'File System' : path.basename(best.point)), total: s.blocks * s.bsize, free: s.bavail * s.bsize });
    }
  } catch { /* volume info is optional */ }
  try {
    const st = await fsp.lstat(p);
    const nameOf = (file, id) => fs.readFileSync(file, 'utf8').split('\n').map((l) => l.split(':')).find((f) => f[2] === String(id))?.[0] || String(id);
    out.owner = nameOf('/etc/passwd', st.uid);
    out.group = nameOf('/etc/group', st.gid);
  } catch { /* owner info is optional */ }
  return out;
});

ipcMain.handle('sys:places', async () => {
  const home = os.homedir();
  const ud = readUserDirs();
  const list = [
    { id: 'home', name: 'Home', path: home },
    { id: 'desktop', name: 'Desktop', path: ud.DESKTOP || path.join(home, 'Desktop') },
    { id: 'documents', name: 'Documents', path: ud.DOCUMENTS || path.join(home, 'Documents') },
    { id: 'downloads', name: 'Downloads', path: ud.DOWNLOAD || path.join(home, 'Downloads') },
    { id: 'pictures', name: 'Pictures', path: ud.PICTURES || path.join(home, 'Pictures') },
    { id: 'music', name: 'Music', path: ud.MUSIC || path.join(home, 'Music') },
    { id: 'videos', name: 'Videos', path: ud.VIDEOS || path.join(home, 'Videos') },
  ];
  const places = [];
  for (const p of list) if (p.path === home || (p.path !== home && await exists(p.path))) places.push(p);
  const trash = path.join(home, '.local', 'share', 'Trash', 'files');
  if (await exists(trash)) places.push({ id: 'trash', name: 'Trash', path: trash });

  const drives = [];
  const labels = driveLabels();
  try {
    const mounts = fs.readFileSync('/proc/mounts', 'utf8').split('\n');
    const seen = new Set();
    for (const line of mounts) {
      const [dev, mnt] = line.split(' ');
      if (!mnt) continue;
      const point = mnt.replace(/\\040/g, ' ');
      const interesting = point === '/' || /^\/(media|mnt|run\/media)\//.test(point) || (point === '/home' && dev.startsWith('/dev/'));
      if (!interesting || seen.has(point)) continue;
      seen.add(point);
      let total = 0, free = 0;
      try { const s = await fsp.statfs(point); total = s.blocks * s.bsize; free = s.bavail * s.bsize; } catch { /* ignore */ }
      let label = null;
      try { label = labels.get(fs.realpathSync(dev)); } catch { /* not a block device */ }
      // Unlabelled drives get Nemo's "<size> Volume" name (decimal units, like Nemo).
      const volName = total ? `${(total / 1e12 >= 1 ? (total / 1e12).toFixed(1) + ' TB' : Math.round(total / 1e9) + ' GB')} Volume` : path.basename(point);
      drives.push({ name: label || (point === '/' ? 'File System' : volName), path: point, total, free, removable: point !== '/' && point !== '/home' });
    }
  } catch { drives.push({ name: 'File System', path: '/', total: 0, free: 0 }); }
  return { home, user: os.userInfo().username, places, drives };
});

/* ---------------- archives ---------------- */
// Uses the system's 7-Zip for zip/7z/rar/iso/…, GNU tar for tar.*, zstd for bare .zst.

const toolCache = {};
function tool(cmd) {
  if (cmd in toolCache) return toolCache[cmd];
  for (const dir of (process.env.PATH || '/usr/bin:/bin').split(':')) {
    if (!dir) continue;
    try { fs.accessSync(path.join(dir, cmd), fs.constants.X_OK); return (toolCache[cmd] = path.join(dir, cmd)); } catch { /* keep looking */ }
  }
  return (toolCache[cmd] = null);
}
const sevenZip = () => tool('7zz') || tool('7z') || tool('7za');

const TAR_RE = /\.(tar|tar\.(gz|bz2|xz|zst|lz4|lzma|lz|z)|tgz|tbz2?|txz|tzst|tlz)$/i;
// Passwords go to 7-Zip on stdin, never on the command line (where `ps` would show them):
// for x/l it prompts only when the archive is encrypted; an empty stdin then fails fast.
const pwInput = (password) => (password != null ? `${password}\n` : '');
const FORMAT_EXT = { zip: '.zip', '7z': '.7z', 'tar.gz': '.tar.gz', 'tar.xz': '.tar.xz', 'tar.zst': '.tar.zst', tar: '.tar' };

function archiveBase(name) {
  const m = name.match(TAR_RE) || name.match(/\.[^.]+$/);
  return m && m.index > 0 ? name.slice(0, m.index) : name;
}

const jobs = new Map(); // id -> child process
function run(id, cmd, args, { cwd, onData, keep = 20000, input = '' } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try { child = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { resolve({ code: -1, out: e.message }); return; }
    jobs.set(id, child);
    child.stdin.on('error', () => {}); // the tool may exit before reading its input
    child.stdin.end(input);
    const feed = (buf) => { const s = buf.toString(); out += s; if (out.length > keep) out = out.slice(-keep); onData?.(s); };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', (e) => { jobs.delete(id); resolve({ code: -1, out: e.message }); });
    child.on('close', (code) => { jobs.delete(id); resolve({ code, out, cancelled: !!child.cancelled }); });
  });
}
ipcMain.on('arc:cancel', (_, id) => {
  const c = jobs.get(id);
  if (c) { c.cancelled = true; c.kill('SIGTERM'); }
});

// 7-Zip's -bsp1 progress looks like "\b\b\b 42% 17 - file"; forward the percentage.
function percentReporter(id, wc) {
  let last = -1;
  return (s) => {
    const m = s.match(/(\d{1,3})%/g);
    if (!m) return;
    const pct = parseInt(m[m.length - 1], 10);
    if (pct !== last) { last = pct; send('arc:progress', { id, percent: pct }, wc); }
  };
}
function toolError(out, code) {
  const lines = out.replace(/[\b\r]/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  const err = lines.filter((l) => /error|cannot|can't|wrong|unexpected|not |denied|no such|unsupported/i.test(l));
  return (err.length ? err.slice(-2).join(' — ') : lines.at(-1)) || `exit code ${code}`;
}
const needsPassword = (out) => /wrong password|encrypted|enter password/i.test(out);

// `entries` (paths inside the archive) limits extraction to those items and their contents.
ipcMain.handle('arc:extract', async (ev, { id, archive, destDir, mode, password, entries }) => {
  const name = path.basename(archive);
  const tmp = path.join(destDir, `.nova-extract-${Date.now().toString(36)}`);
  try { await fsp.mkdir(tmp); } catch (e) { return fail(e); }
  const cleanup = () => fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});

  let r;
  if (TAR_RE.test(name)) {
    if (!tool('tar')) { await cleanup(); return { ok: false, error: 'tar is not installed' }; }
    r = await run(id, 'tar', ['-xf', archive, '-C', tmp, '--no-same-owner', ...(entries?.length ? ['--', ...entries] : [])]);
  } else if (/\.zst$/i.test(name)) {
    if (!tool('zstd')) { await cleanup(); return { ok: false, error: 'zstd is not installed' }; }
    r = await run(id, 'zstd', ['-d', '-q', archive, '-o', path.join(tmp, archiveBase(name))]);
  } else {
    const sz = sevenZip();
    if (!sz) { await cleanup(); return { ok: false, error: '7-Zip is not installed (package 7zip or p7zip-full)' }; }
    const pick = (entries || []).flatMap((e) => [e, `${e}/*`]);
    r = await run(id, sz, ['x', '-y', '-bsp1', '-bso0', `-o${tmp}`, '--', archive, ...pick], { onData: percentReporter(id, ev.sender), input: pwInput(password) });
  }
  // 7-Zip exit code 1 is a warning (e.g. some files skipped); the rest still extracted.
  if (r.cancelled || r.code < 0 || r.code > 1) {
    await cleanup();
    if (r.cancelled) return { ok: false, cancelled: true };
    // With no password on stdin, 7-Zip's prompt hits end-of-input and reports "Break signaled".
    if (needsPassword(r.out) || (password == null && /break signaled/i.test(r.out))) return { ok: false, needPassword: true, error: password != null ? 'Wrong password' : 'This archive is password protected' };
    return { ok: false, error: toolError(r.out, r.code) };
  }

  try {
    const items = await fsp.readdir(tmp);
    if (!items.length) { await cleanup(); return { ok: false, error: 'The archive is empty' }; }
    let dest;
    if (mode === 'here' && items.length === 1) {
      // A single top-level item goes straight into the folder.
      const src = path.join(tmp, items[0]);
      dest = path.join(destDir, items[0]);
      if (await exists(dest)) dest = await uniqueName(destDir, items[0], (await fsp.lstat(src)).isDirectory(), false);
      await fsp.rename(src, dest);
      await cleanup();
    } else {
      // Several items (or "extract to folder"): wrap them in a folder named after the archive.
      const base = archiveBase(name);
      dest = path.join(destDir, base);
      if (await exists(dest)) dest = await uniqueName(destDir, base, true, false);
      await fsp.rename(tmp, dest);
    }
    return ok({ path: dest, warning: r.code === 1 ? toolError(r.out, r.code) : null });
  } catch (e) { await cleanup(); return fail(e); }
});

ipcMain.handle('arc:compress', async (ev, { id, sources, destDir, name, format, password }) => {
  const ext = FORMAT_EXT[format];
  if (!ext) return { ok: false, error: `Unknown format ${format}` };
  const base = name.endsWith(ext) ? name.slice(0, -ext.length) : name;
  if (!validName(base + ext)) return { ok: false, error: 'Invalid archive name' };
  let out = path.join(destDir, base + ext);
  for (let i = 2; await exists(out); i++) out = path.join(destDir, `${base} (${i})${ext}`);

  // Store entries relative to their folder so the archive has no absolute paths.
  const cwd = path.dirname(sources[0]);
  const rel = sources.map((s) => (path.dirname(s) === cwd ? path.basename(s) : s));
  let r;
  if (format === 'zip' || format === '7z') {
    const sz = sevenZip();
    if (!sz) return { ok: false, error: '7-Zip is not installed (package 7zip or p7zip-full)' };
    const args = ['a', `-t${format}`, '-y', '-bsp1', '-bso0'];
    if (password) { args.push('-p'); if (format === '7z') args.push('-mhe=on'); }
    // With a bare -p, 7-Zip asks for the password and its confirmation on stdin.
    r = await run(id, sz, [...args, '--', out, ...rel], { cwd, onData: percentReporter(id, ev.sender), input: password ? `${password}\n${password}\n` : '' });
  } else {
    if (!tool('tar')) return { ok: false, error: 'tar is not installed' };
    r = await run(id, 'tar', ['-caf', out, '-C', cwd, '--', ...rel]);
  }
  if (r.cancelled || r.code !== 0) {
    await fsp.rm(out, { force: true }).catch(() => {});
    if (r.cancelled) return { ok: false, cancelled: true };
    return { ok: false, error: toolError(r.out, r.code) };
  }
  return ok({ path: out });
});

ipcMain.handle('arc:list', async (_, archive, password) => {
  const name = path.basename(archive);
  const id = `list-${Date.now()}`;
  const entries = [];
  const LIMIT = 20000;
  let encrypted = false;
  if (TAR_RE.test(name)) {
    const r = await run(id, 'tar', ['-tvf', archive, '--full-time'], { keep: 64 * 1024 * 1024 });
    if (r.code !== 0) return { ok: false, error: toolError(r.out, r.code) };
    for (const l of r.out.split('\n')) {
      const m = l.match(/^(\S)\S*\s+\S+\s+(\d+)\s+(\d{4}-\d\d-\d\d \d\d:\d\d(?::\d\d)?)\s(.*)$/);
      if (!m) continue;
      let p = m[4];
      if (m[1] === 'l' || m[1] === 'h') p = p.replace(/ (->|link to) .*$/, '');
      entries.push({ path: p.replace(/\/+$/, ''), isDir: m[1] === 'd', size: +m[2], mtime: Date.parse(m[3].replace(' ', 'T')) || 0 });
      if (entries.length >= LIMIT) break;
    }
  } else {
    const sz = sevenZip();
    if (!sz) return { ok: false, error: '7-Zip is not installed (package 7zip or p7zip-full)' };
    const r = await run(id, sz, ['l', '-slt', '-ba', '--', archive], { keep: 64 * 1024 * 1024, input: pwInput(password) });
    if (r.code !== 0) {
      if (needsPassword(r.out) || (password == null && /break signaled/i.test(r.out))) return { ok: false, needPassword: true, error: password != null ? 'Wrong password' : 'This archive is password protected' };
      return { ok: false, error: toolError(r.out, r.code) };
    }
    for (const block of r.out.split(/\r?\n\s*\r?\n/)) {
      const f = {};
      for (const l of block.split(/\r?\n/)) { const i = l.indexOf(' = '); if (i > 0) f[l.slice(0, i)] = l.slice(i + 3); }
      if (!f.Path) continue;
      if (f.Encrypted === '+') encrypted = true;
      entries.push({
        path: f.Path.replace(/\/+$/, ''),
        isDir: f.Folder === '+' || /^D/.test(f.Attributes || ''),
        size: +f.Size || 0,
        mtime: f.Modified ? Date.parse(f.Modified.slice(0, 19).replace(' ', 'T')) || 0 : 0,
      });
      if (entries.length >= LIMIT) break;
    }
  }
  return ok({ entries, truncated: entries.length >= LIMIT, encrypted });
});

/* ---------------- recursive search ---------------- */

const searchJobs = new Map();
const SKIP_DIRS = new Set(['/proc', '/sys', '/dev', '/run', '/snap']);
const SEARCH_LIMIT = 10000;

function nameMatcher({ query, regex, matchCase }) {
  if (regex) { const re = new RegExp(query, matchCase ? '' : 'i'); return (s) => re.test(s); }
  if (/[*?]/.test(query)) {
    const src = query.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    const re = new RegExp(`^${src}$`, matchCase ? '' : 'i');
    return (s) => re.test(s);
  }
  const q = matchCase ? query : query.toLowerCase();
  return matchCase ? (s) => s.includes(q) : (s) => s.toLowerCase().includes(q);
}
function textMatcher({ query, regex, matchCase }) {
  if (regex) { const re = new RegExp(query, matchCase ? '' : 'i'); return (s) => re.test(s); }
  const q = matchCase ? query : query.toLowerCase();
  return matchCase ? (s) => s.includes(q) : (s) => s.toLowerCase().includes(q);
}
// First matching line of a small text file, or null.
async function grepFile(p, test) {
  try {
    const st = await fsp.stat(p);
    if (st.size > 2 * 1024 * 1024 || st.size === 0) return null;
    const buf = await fsp.readFile(p);
    if (buf.subarray(0, 8192).includes(0)) return null;
    for (const lineText of buf.toString('utf8').split('\n')) {
      if (test(lineText)) return lineText.trim().slice(0, 160);
    }
  } catch { /* unreadable */ }
  return null;
}

ipcMain.handle('search:start', async (ev, id, opts) => {
  let test;
  try { test = opts.content ? textMatcher(opts) : nameMatcher(opts); }
  catch { return { ok: false, error: 'Invalid regular expression' }; }
  const job = { cancelled: false };
  searchJobs.set(id, job);
  const started = Date.now();
  const queue = [opts.root];
  let qi = 0, count = 0, dirs = 0, truncated = false, batch = [], lastSend = Date.now();
  const flush = () => { send('search:batch', { id, items: batch, dirs }, ev.sender); batch = []; lastSend = Date.now(); };

  while (qi < queue.length && !job.cancelled) {
    const dir = queue[qi++];
    let items;
    try { items = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    dirs++;
    for (const d of items) {
      if (job.cancelled) break;
      if (!opts.hidden && d.name.startsWith('.')) continue;
      const p = path.join(dir, d.name);
      if (d.isDirectory() && !SKIP_DIRS.has(p)) queue.push(p); // symlinked dirs are not followed
      let snippet = null;
      if (opts.content) {
        if (!d.isFile()) continue;
        snippet = await grepFile(p, test);
        if (snippet == null) continue;
      } else if (!test(d.name)) continue;
      const e = await statEntry(dir, d.name);
      if (!e) continue;
      if (snippet != null) e.snippet = snippet;
      batch.push(e);
      if (++count >= SEARCH_LIMIT) { truncated = true; break; }
    }
    if (truncated) break;
    if (batch.length >= 250 || Date.now() - lastSend > 150) flush();
  }
  flush();
  searchJobs.delete(id);
  return { ok: true, count, dirs, truncated, cancelled: job.cancelled, ms: Date.now() - started };
});
ipcMain.on('search:cancel', (_, id) => {
  const j = searchJobs.get(id);
  if (j) j.cancelled = true;
});

/* ---------------- default file manager ---------------- */

const DESKTOP_ID = 'nova-commander.desktop';
ipcMain.handle('sys:defaultFM', async (_, set) => {
  if (set === true) await run(`fm-${Date.now()}`, 'xdg-mime', ['default', DESKTOP_ID, 'inode/directory']);
  const cur = (await run(`fmq-${Date.now()}`, 'xdg-mime', ['query', 'default', 'inode/directory'])).out.trim();
  return { current: cur, isNova: cur === DESKTOP_ID };
});

/* ---------------- user scripts ---------------- */
// Executables in <config>/scripts appear in a "Scripts" menu and get the selected paths as arguments.

const scriptsDir = () => path.join(app.getPath('userData'), 'scripts');
ipcMain.handle('scripts:list', async () => {
  const dir = scriptsDir();
  await fsp.mkdir(dir, { recursive: true });
  const readme = path.join(dir, 'README.txt');
  if (!(await exists(readme))) {
    await fsp.writeFile(readme, 'Executable files in this folder appear in Nova Commander\'s "Scripts" menu.\n'
      + 'They run with the selected paths as arguments, in the current folder.\n'
      + 'NOVA_DIR holds the current folder and NOVA_OTHER_DIR the other pane\'s folder.\n'
      + 'Anything the script prints is shown when it finishes.\n');
  }
  const items = [];
  for (const n of (await fsp.readdir(dir)).sort((a, b) => a.localeCompare(b))) {
    const p = path.join(dir, n);
    try { await fsp.access(p, fs.constants.X_OK); if ((await fsp.stat(p)).isFile()) items.push(p); } catch { /* not executable */ }
  }
  return { dir, items };
});
ipcMain.handle('scripts:run', async (_, { id, script, paths, cwd, otherDir }) => {
  if (path.dirname(path.resolve(script)) !== scriptsDir()) return { ok: false, code: -1, output: 'Only scripts in the scripts folder can be run' };
  const r = await new Promise((resolve) => {
    let out = '';
    let child;
    try { child = spawn(script, paths, { cwd, env: { ...process.env, NOVA_DIR: cwd, NOVA_OTHER_DIR: otherDir || '' }, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { resolve({ code: -1, out: e.message }); return; }
    jobs.set(id, child);
    const feed = (b) => { out = (out + b).slice(-8000); };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', (e) => { jobs.delete(id); resolve({ code: -1, out: e.message }); });
    child.on('close', (code) => { jobs.delete(id); resolve({ code, out, cancelled: !!child.cancelled }); });
  });
  return { ok: r.code === 0, code: r.code, output: r.out.trim(), cancelled: r.cancelled };
});

/* ---------------- run programs ---------------- */

ipcMain.handle('sys:run', (_, file, args, admin) => new Promise((resolve) => {
  const [cmd, argv] = admin ? ['pkexec', [file, ...args]] : [file, args];
  let child;
  try { child = spawn(cmd, argv, { cwd: path.dirname(file), detached: true, stdio: 'ignore' }); }
  catch (e) { resolve({ ok: false, error: e.message }); return; }
  child.once('error', (e) => resolve({ ok: false, error: e.message }));
  child.once('spawn', () => { child.unref(); resolve({ ok: true }); });
}));
// Split a command line into arguments, honouring "double" and 'single' quotes.
ipcMain.handle('sys:splitArgs', (_, line) => {
  const out = [];
  const re = /"((?:\\.|[^"])*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1] != null ? m[1].replace(/\\(.)/g, '$1') : m[2] != null ? m[2] : m[3]);
  return out;
});

/* ---------------- network shares & devices (GVfs) ---------------- */

const gvfsDir = () => path.join('/run/user', String(process.getuid()), 'gvfs');
// "smb-share:server=nas,share=media" -> { kind: 'smb', label: 'media on nas' }
function describeMount(name) {
  const [scheme, rest = ''] = name.split(/:(.*)/s);
  const kv = Object.fromEntries(rest.split(',').map((x) => x.split('=')).filter((x) => x.length === 2));
  if (scheme === 'mtp' || scheme === 'gphoto2') return { kind: 'phone', label: (kv.host || name).replace(/_/g, ' ') };
  if (scheme.startsWith('smb')) return { kind: 'network', label: kv.share ? `${kv.share} on ${kv.server}` : kv.server || name };
  return { kind: 'network', label: kv.host ? `${kv.host} (${scheme})` : name };
}
ipcMain.handle('net:mounts', async () => {
  try {
    const names = await fsp.readdir(gvfsDir());
    return names.map((n) => ({ path: path.join(gvfsDir(), n), ...describeMount(n) }));
  } catch { return []; }
});
// Mount smb://, sftp://, ftp://, dav:// … via gio, answering its credential prompts on stdin.
ipcMain.handle('net:connect', (_, { uri, user, domain, password, anonymous }) => new Promise((resolve) => {
  const child = spawn('gio', ['mount', ...(anonymous ? ['-a'] : []), uri], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  const answered = new Set();
  const onData = (d) => {
    out += d;
    const answer = (re, key, value) => { if (re.test(out) && !answered.has(key)) { answered.add(key); child.stdin.write(`${value ?? ''}\n`); } };
    answer(/User \[.*\]:\s*$|User:\s*$/m, 'user', user);
    answer(/Domain \[.*\]:\s*$|Domain:\s*$/m, 'domain', domain);
    answer(/Password:\s*$/m, 'password', password);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const t = setTimeout(() => child.kill(), 30000);
  child.on('error', (e) => { clearTimeout(t); resolve({ ok: false, error: e.message }); });
  child.on('close', (code) => {
    clearTimeout(t);
    const err = out.split('\n').map((l) => l.trim()).filter((l) => /error|fail|denied|not/i.test(l)).pop();
    resolve(code === 0 || /already mounted/i.test(out) ? { ok: true } : { ok: false, error: err || `gio exited with ${code}` });
  });
}));
ipcMain.handle('net:unmount', async (_, p) => {
  const r = await run(`umount-${Date.now()}`, 'gio', ['mount', '-u', p]);
  return r.code === 0 ? { ok: true } : { ok: false, error: toolError(r.out, r.code) };
});
// Shares offered by one server (smbclient), for the "Connect to server" dialog.
ipcMain.handle('net:shares', async (_, host) => {
  if (!tool('smbclient')) return { ok: false, error: 'smbclient is not installed' };
  const r = await run(`shares-${Date.now()}`, 'smbclient', ['-L', `//${host}`, '-N', '-g'], { keep: 200000 });
  const shares = r.out.split('\n').map((l) => l.split('|')).filter((x) => x[0] === 'Disk' && x[1] && !x[1].endsWith('$')).map((x) => x[1]);
  return shares.length || r.code === 0 ? { ok: true, shares } : { ok: false, error: toolError(r.out, r.code) };
});
// Machines advertising file shares on the local network (Avahi/WS-Discovery via GVfs).
ipcMain.handle('net:scan', async () => {
  const r = await run(`scan-${Date.now()}`, 'gio', ['list', '-u', 'network:///'], { keep: 200000 });
  // Entries look like network:///dnssd-domain-NAS._smb._tcp or network:///smb-root.
  const hosts = new Set();
  for (const l of r.out.split('\n')) {
    if (!l.startsWith('network:///')) continue;
    let name = l.slice('network:///'.length);
    try { name = decodeURIComponent(name); } catch { /* keep raw */ }
    name = name.replace(/^dnssd-domain-/, '').split(/[.:/]/)[0].trim();
    if (name && name !== 'smb-root') hosts.add(name);
  }
  return [...hosts].sort();
});

/* ---------------- previews: Office/RTF via LibreOffice, e-mail ---------------- */

const previewCache = () => path.join(app.getPath('userData'), 'preview-cache');
const cacheKey = (p, st) => crypto.createHash('sha1').update(`${p}\0${st.mtimeMs}\0${st.size}`).digest('hex');
const OFFICE_RE = /\.(docx?|odt|rtf|xlsx?|ods|pptx?|odp|csv)$/i;
const officeJobs = new Map(); // key -> promise, so one file converts once
ipcMain.handle('pv:office', async (_, p) => {
  if (!OFFICE_RE.test(p)) return { ok: false, error: 'Not an office document' };
  const soffice = tool('soffice') || tool('libreoffice');
  if (!soffice) return { ok: false, error: 'LibreOffice is not installed' };
  try {
    const st = await fsp.stat(p);
    const dir = previewCache();
    await fsp.mkdir(dir, { recursive: true });
    const key = cacheKey(p, st);
    const pdf = path.join(dir, `${key}.pdf`);
    if (await exists(pdf)) return ok({ url: pathToFileURL(pdf).href });
    if (!officeJobs.has(key)) {
      officeJobs.set(key, (async () => {
        const out = await fsp.mkdtemp(path.join(dir, 'conv-'));
        // A private profile, so conversion works even while LibreOffice is open.
        const profile = pathToFileURL(path.join(app.getPath('userData'), 'lo-profile')).href;
        const r = await run(`lo-${key}`, soffice, [`-env:UserInstallation=${profile}`, '--headless', '--convert-to', 'pdf', '--outdir', out, p]);
        const made = (await fsp.readdir(out)).find((n) => n.endsWith('.pdf'));
        if (made) await fsp.rename(path.join(out, made), pdf);
        await fsp.rm(out, { recursive: true, force: true });
        if (!made) throw new Error(toolError(r.out, r.code));
      })().finally(() => officeJobs.delete(key)));
    }
    await officeJobs.get(key);
    return ok({ url: pathToFileURL(pdf).href });
  } catch (e) { return fail(e); }
});

// Minimal RFC 822 / MIME reader: headers plus the first text/plain (or stripped text/html) part.
function decodeWords(s) {
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, cs, enc, txt) => {
    const buf = enc.toUpperCase() === 'B' ? Buffer.from(txt, 'base64') : Buffer.from(txt.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
    try { return new TextDecoder(cs).decode(buf); } catch { return buf.toString('utf8'); }
  });
}
function parseHeaders(block) {
  const h = {};
  for (const l of block.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = l.indexOf(':');
    if (i > 0) h[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
  }
  return h;
}
function decodeBody(body, h) {
  const enc = (h['content-transfer-encoding'] || '').toLowerCase();
  const cs = (/charset="?([^";]+)/i.exec(h['content-type'] || '') || [])[1] || 'utf-8';
  let buf;
  if (enc === 'base64') buf = Buffer.from(body.replace(/\s+/g, ''), 'base64');
  else if (enc === 'quoted-printable') buf = Buffer.from(body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (m, x) => String.fromCharCode(parseInt(x, 16))), 'latin1');
  else buf = Buffer.from(body, 'latin1');
  try { return new TextDecoder(cs).decode(buf); } catch { return buf.toString('utf8'); }
}
function mailText(raw) {
  const sep = raw.search(/\r?\n\r?\n/);
  const h = parseHeaders(sep < 0 ? raw : raw.slice(0, sep));
  const body = sep < 0 ? '' : raw.slice(sep).replace(/^\r?\n\r?\n/, '');
  const type = (h['content-type'] || 'text/plain').toLowerCase();
  const boundary = (/boundary="?([^";]+)"?/i.exec(h['content-type'] || '') || [])[1];
  if (type.startsWith('multipart/') && boundary) {
    const parts = body.split(`--${boundary}`).slice(1).filter((x) => !x.startsWith('--'));
    let html = null;
    for (const part of parts) {
      const r = mailText(part.replace(/^\r?\n/, ''));
      if (r.type === 'text/plain' && r.text.trim()) return { h, type: 'text/plain', text: r.text };
      if (r.type === 'text/html' && !html) html = r.text;
    }
    return { h, type: 'text/plain', text: html || '' };
  }
  let text = decodeBody(body, h);
  if (type.startsWith('text/html')) text = text.replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return { h, type: type.startsWith('text/html') ? 'text/html' : 'text/plain', text };
}
// Outlook .msg: an OLE compound file. Read its directory, then the MAPI property streams
// __substg1.0_<tag><type> (001F = UTF-16 string, 001E = 8-bit string).
function readCompoundFile(b) {
  if (b.length < 512 || b.readUInt32LE(0) !== 0xE011CFD0 || b.readUInt32LE(4) !== 0xE11AB1A1) throw new Error('Not an Outlook message');
  const secSize = 1 << b.readUInt16LE(30);
  const miniSize = 1 << b.readUInt16LE(32);
  const cutoff = b.readUInt32LE(56);
  const sec = (n) => 512 + n * secSize;
  // FAT sector list: 109 in the header, the rest in DIFAT sectors.
  const fatSecs = [];
  for (let i = 0; i < 109; i++) { const s = b.readInt32LE(76 + i * 4); if (s >= 0) fatSecs.push(s); }
  for (let d = b.readInt32LE(68), guard = 0; d >= 0 && guard++ < 10000;) {
    for (let i = 0; i < secSize / 4 - 1; i++) { const s = b.readInt32LE(sec(d) + i * 4); if (s >= 0) fatSecs.push(s); }
    d = b.readInt32LE(sec(d) + secSize - 4);
  }
  const fat = [];
  for (const s of fatSecs) for (let i = 0; i < secSize / 4; i++) fat.push(b.readInt32LE(sec(s) + i * 4));
  const chain = (start, table) => { const out = []; for (let s = start, g = 0; s >= 0 && g++ < 1e6; s = table[s]) out.push(s); return out; };
  const readChain = (start) => Buffer.concat(chain(start, fat).map((s) => b.subarray(sec(s), sec(s) + secSize)));
  const dirBuf = readChain(b.readInt32LE(48));
  const dirs = [];
  for (let off = 0; off + 128 <= dirBuf.length; off += 128) {
    const nameLen = dirBuf.readUInt16LE(off + 64);
    dirs.push({
      name: dirBuf.toString('utf16le', off, off + Math.max(0, nameLen - 2)),
      type: dirBuf[off + 66], left: dirBuf.readInt32LE(off + 68), right: dirBuf.readInt32LE(off + 72), child: dirBuf.readInt32LE(off + 76),
      start: dirBuf.readInt32LE(off + 116), size: dirBuf.readUInt32LE(off + 120),
    });
  }
  const root = dirs[0];
  const miniFat = [];
  for (const s of chain(b.readInt32LE(60), fat)) for (let i = 0; i < secSize / 4; i++) miniFat.push(b.readInt32LE(sec(s) + i * 4));
  const miniStream = root.start >= 0 ? readChain(root.start) : Buffer.alloc(0);
  const read = (e) => {
    if (e.size < cutoff) return Buffer.concat(chain(e.start, miniFat).map((s) => miniStream.subarray(s * miniSize, (s + 1) * miniSize))).subarray(0, e.size);
    return readChain(e.start).subarray(0, e.size);
  };
  // Streams directly under the root (attachments and recipients live in sub-storages).
  const top = new Map();
  const walk = (i, depth = 0) => {
    if (i < 0 || i >= dirs.length || depth > 64) return;
    const e = dirs[i];
    if (e.type === 2) top.set(e.name, e);
    walk(e.left, depth + 1);
    walk(e.right, depth + 1);
  };
  walk(root.child);
  return { get: (name) => (top.has(name) ? read(top.get(name)) : null) };
}
function msgText(p) {
  if (fs.statSync(p).size > 64 * 1024 * 1024) throw new Error('Message too large to preview');
  const cf = readCompoundFile(fs.readFileSync(p));
  const prop = (tag) => {
    const w = cf.get(`__substg1.0_${tag}001F`);
    if (w) return w.toString('utf16le').replace(/\0+$/, '');
    const a = cf.get(`__substg1.0_${tag}001E`);
    return a ? a.toString('latin1').replace(/\0+$/, '') : '';
  };
  // Delivery time lives in the fixed-size property stream as a FILETIME (tag 0E06, type 0040).
  let date = '';
  const props = cf.get('__properties_version1.0');
  if (props) {
    for (let off = 32; off + 16 <= props.length; off += 16) {
      if (props.readUInt32LE(off) === 0x0E060040 || props.readUInt32LE(off) === 0x00390040) {
        const ft = props.readBigUInt64LE(off + 8);
        if (ft) { date = new Date(Number(ft / 10000n) - 11644473600000).toUTCString(); break; }
      }
    }
  }
  let text = prop('1000');
  if (!text) {
    const html = cf.get('__substg1.0_10130102');
    if (html) text = html.toString('utf8').replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  }
  const from = prop('0C1A') || prop('0042');
  const addr = prop('0C1F') || prop('0065');
  return { from: addr && !from.includes(addr) ? `${from} <${addr}>` : from, to: prop('0E04'), subject: prop('0037'), date, text: (text || '').trim().slice(0, 20000) };
}
ipcMain.handle('pv:msg', async (_, p) => {
  try { return ok(msgText(p)); } catch (e) { return fail(e); }
});
ipcMain.handle('pv:eml', async (_, p) => {
  try {
    const raw = (await readHead(p, 4 * 1024 * 1024)).toString('latin1');
    const { h, text } = mailText(raw);
    return ok({ from: decodeWords(h.from || ''), to: decodeWords(h.to || ''), subject: decodeWords(h.subject || ''), date: h.date || '', text: text.trim().slice(0, 20000) });
  } catch (e) { return fail(e); }
});

/* ---------------- thumbnail cache ---------------- */
// The renderer draws thumbnails on a canvas; they're stored here keyed by path + mtime + size.

const thumbDir = () => path.join(app.getPath('userData'), 'thumbs');
ipcMain.handle('thumb:get', async (_, p) => {
  try {
    const key = cacheKey(p, await fsp.stat(p));
    const f = path.join(thumbDir(), `${key}.webp`);
    return { key, url: (await exists(f)) ? pathToFileURL(f).href : null };
  } catch { return { key: null, url: null }; }
});
ipcMain.handle('thumb:put', async (_, key, bytes) => {
  if (!/^[0-9a-f]{40}$/.test(key)) return null;
  await fsp.mkdir(thumbDir(), { recursive: true });
  const f = path.join(thumbDir(), `${key}.webp`);
  await fsp.writeFile(f, Buffer.from(bytes));
  return pathToFileURL(f).href;
});
ipcMain.handle('thumb:stats', async (_, clear) => {
  const dir = thumbDir();
  if (clear) await fsp.rm(dir, { recursive: true, force: true });
  let size = 0, count = 0;
  try { for (const n of await fsp.readdir(dir)) { size += (await fsp.stat(path.join(dir, n))).size; count++; } } catch { /* empty */ }
  return { size, count };
});

// Video frames for the thumbnail view. Stored beside the image thumbnails, keyed by path + mtime + size.
const videoThumbFails = new Set();
ipcMain.handle('thumb:video', async (_, p) => {
  try {
    const st = await fsp.stat(p);
    const key = cacheKey(p, st);
    const f = path.join(thumbDir(), `${key}.frame.png`);
    if (await exists(f)) return ok({ url: pathToFileURL(f).href });
    if (videoThumbFails.has(key)) return { ok: false, error: 'No frame' };
    await fsp.mkdir(thumbDir(), { recursive: true });
    const tmp = `${f}.tmp.png`;
    // ffmpegthumbnailer picks a frame about 10% in; ffmpeg is the fallback for files it can't read.
    let r = { code: -1, out: '' };
    const ffthumb = tool('ffmpegthumbnailer');
    if (ffthumb) r = await run(`vt-${key}`, ffthumb, ['-i', p, '-o', tmp, '-s', '256', '-c', 'png', '-t', '10']);
    if (r.code !== 0 || !(await exists(tmp))) {
      const ff = tool('ffmpeg');
      if (ff) r = await run(`vt-${key}`, ff, ['-v', 'error', '-y', '-ss', '3', '-i', p, '-frames:v', '1', '-vf', 'scale=256:-2', tmp]);
    }
    if (!(await exists(tmp))) { videoThumbFails.add(key); return { ok: false, error: r.out ? toolError(r.out, r.code) : 'No video tool' }; }
    await fsp.rename(tmp, f);
    return ok({ url: pathToFileURL(f).href });
  } catch (e) { return fail(e); }
});

// Writes bytes produced by the renderer (batch image tool) to a new file next to the source.
ipcMain.handle('fs:writeNew', async (_, dir, name, bytes) => {
  try {
    if (!validName(name)) throw new Error('Invalid file name');
    let dest = path.join(dir, name);
    if (await exists(dest)) dest = await uniqueName(dir, name, false, false);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(dest, Buffer.from(bytes), { flag: 'wx' });
    return ok({ path: dest });
  } catch (e) { return fail(e); }
});

/* ---------------- media metadata ---------------- */
// Pixel size from image headers (no decoding) and photo date taken, for sorting.

function imageSize(b, ext) {
  try {
    if (ext === 'png' && b.toString('latin1', 12, 16) === 'IHDR') return [b.readUInt32BE(16), b.readUInt32BE(20)];
    if (ext === 'gif' && b.toString('latin1', 0, 3) === 'GIF') return [b.readUInt16LE(6), b.readUInt16LE(8)];
    if (ext === 'bmp' && b.toString('latin1', 0, 2) === 'BM') return [b.readInt32LE(18), Math.abs(b.readInt32LE(22))];
    if (ext === 'webp' && b.toString('latin1', 8, 12) === 'WEBP') {
      const chunk = b.toString('latin1', 12, 16);
      if (chunk === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
      if (chunk === 'VP8L') { const v = b.readUInt32LE(21); return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)]; }
      if (chunk === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    }
    if (ext === 'jpg' || ext === 'jpeg') {
      for (let off = 2; off + 9 < b.length;) {
        if (b[off] !== 0xFF) return null;
        const m = b[off + 1];
        if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return [b.readUInt16BE(off + 7), b.readUInt16BE(off + 5)];
        off += 2 + b.readUInt16BE(off + 2);
      }
    }
  } catch { /* truncated header */ }
  return null;
}
async function readHead(p, n) {
  const fh = await fsp.open(p, 'r');
  try { const buf = Buffer.alloc(n); const { bytesRead } = await fh.read(buf, 0, n, 0); return buf.subarray(0, bytesRead); } finally { await fh.close(); }
}
ipcMain.handle('fs:mediaMeta', async (_, paths) => {
  const out = {};
  for (const p of paths.slice(0, 5000)) {
    const ext = path.extname(p).slice(1).toLowerCase();
    try {
      const b = await readHead(p, ext === 'jpg' || ext === 'jpeg' ? 512 * 1024 : 64);
      const r = {};
      const dims = imageSize(b, ext);
      if (dims) [r.width, r.height] = dims;
      if (ext === 'jpg' || ext === 'jpeg') {
        for (let off = 2; off + 4 < b.length;) {
          if (b[off] !== 0xFF) break;
          if (b[off + 1] === 0xE1 && b.toString('latin1', off + 4, off + 10) === 'Exif\0\0') { const x = parseTiff(b, off + 10); if (x?.taken) r.taken = x.taken; break; }
          if (b[off + 1] === 0xDA) break;
          off += 2 + b.readUInt16BE(off + 2);
        }
      }
      out[p] = r;
    } catch { out[p] = {}; }
  }
  return out;
});
// Audio/video details through ffprobe, when it is installed.
ipcMain.handle('fs:probe', async (_, p) => {
  if (!tool('ffprobe')) return null;
  const r = await run(`probe-${Date.now()}`, 'ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', p], { keep: 1e6 });
  try {
    const j = JSON.parse(r.out);
    const v = j.streams?.find((s) => s.codec_type === 'video');
    const a = j.streams?.find((s) => s.codec_type === 'audio');
    return {
      duration: +j.format?.duration || null,
      bitRate: +j.format?.bit_rate || null,
      sampleRate: a ? +a.sample_rate : null,
      channels: a?.channels || null,
      codec: [v?.codec_name, a?.codec_name].filter(Boolean).join(' / '),
      width: v?.width || null, height: v?.height || null,
    };
  } catch { return null; }
});

/* ---------------- icon themes ---------------- */
// Freedesktop icon themes (Papirus, Mint-L, Adwaita, …) used as file/folder icon packs.

const iconBases = () => [path.join(os.homedir(), '.local/share/icons'), path.join(os.homedir(), '.icons'), '/usr/local/share/icons', '/usr/share/icons'];
function themeDir(name) {
  for (const b of iconBases()) { const d = path.join(b, name); if (fs.existsSync(path.join(d, 'index.theme'))) return d; }
  return null;
}
function readTheme(name) {
  const d = themeDir(name);
  if (!d) return null;
  const txt = fs.readFileSync(path.join(d, 'index.theme'), 'utf8');
  const get = (k) => (txt.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim() || '';
  return { dir: d, name: get('Name') || name, dirs: get('Directories').split(',').filter(Boolean), inherits: get('Inherits').split(',').filter(Boolean) };
}
ipcMain.handle('icons:themes', async () => {
  const seen = new Map();
  for (const b of iconBases()) {
    let names;
    try { names = await fsp.readdir(b); } catch { continue; }
    for (const n of names) {
      if (seen.has(n)) continue;
      const t = readTheme(n);
      // Skip cursor-only themes and the hicolor fallback.
      if (!t || !t.dirs.length || n === 'hicolor' || n === 'default') continue;
      if (!t.dirs.some((d) => /mimetypes|places|scalable/.test(d))) continue;
      seen.set(n, t.name);
    }
  }
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
});
const iconIndex = new Map(); // theme -> Map(icon name -> file)
function indexTheme(name, seen = new Set()) {
  if (iconIndex.has(name)) return iconIndex.get(name);
  const map = new Map();
  const t = readTheme(name);
  if (t) {
    // Prefer scalable SVGs, then the largest bitmap up to 128 px.
    const rank = (d) => (/scalable/.test(d) ? 1000 : Math.min(+(d.match(/(\d+)/) || [0, 0])[1], 128));
    const dirs = t.dirs.filter((d) => /mimetypes|places|apps|devices/.test(d)).sort((a, b) => rank(b) - rank(a));
    for (const d of dirs) {
      let names;
      try { names = fs.readdirSync(path.join(t.dir, d)); } catch { continue; }
      for (const f of names) {
        const n = f.replace(/\.(svg|png)$/, '');
        if (n !== f && !map.has(n)) map.set(n, path.join(t.dir, d, f));
      }
    }
    for (const parent of [...t.inherits, 'hicolor']) {
      if (seen.has(parent) || parent === name) continue;
      seen.add(parent);
      for (const [k, v] of indexTheme(parent, seen)) if (!map.has(k)) map.set(k, v);
    }
  }
  iconIndex.set(name, map);
  return map;
}
// names: { key: [candidate icon names…] } -> { key: file URL }
ipcMain.handle('icons:resolve', (_, theme, names) => {
  const map = indexTheme(theme);
  const out = {};
  for (const [key, cands] of Object.entries(names)) {
    const hit = cands.map((c) => map.get(c)).find(Boolean);
    if (hit) out[key] = pathToFileURL(hit).href;
  }
  return out;
});

/* ---------------- watching ---------------- */

// One set of directory watchers per window.
const watcherSets = new Map(); // webContents id -> Map(dir -> FSWatcher)
function dropWatchers(wcId) {
  for (const w of watcherSets.get(wcId)?.values() || []) w.close();
  watcherSets.delete(wcId);
}
ipcMain.on('fs:watch', (e, dirs) => {
  const wc = e.sender;
  if (!watcherSets.has(wc.id)) watcherSets.set(wc.id, new Map());
  const watchers = watcherSets.get(wc.id);
  const want = new Set(dirs);
  for (const [dir, w] of watchers) if (!want.has(dir)) { w.close(); watchers.delete(dir); }
  for (const dir of want) {
    if (watchers.has(dir)) continue;
    try {
      let t = 0;
      const w = fs.watch(dir, { persistent: false }, () => {
        clearTimeout(t);
        t = setTimeout(() => send('fs:changed', dir, wc), 250);
      });
      w.on('error', () => { w.close(); watchers.delete(dir); });
      watchers.set(dir, w);
    } catch { /* unreadable dir */ }
  }
});

/* ---------------- clipboard ---------------- */

ipcMain.handle('clip:writeText', (_, text) => { clipboard.writeText(text); return true; });
ipcMain.handle('clip:readText', () => clipboard.readText());

ipcMain.handle('clip:writeFiles', (_, mode, paths) => {
  // Interoperate with GNOME/KDE file managers.
  const uris = paths.map((p) => pathToFileURL(p).href);
  try {
    clipboard.writeBuffer('x-special/gnome-copied-files', Buffer.from(`${mode === 'cut' ? 'cut' : 'copy'}\n${uris.join('\n')}`));
  } catch { /* unsupported format on this platform */ }
  return true;
});

ipcMain.handle('clip:readFiles', () => {
  try {
    const raw = clipboard.readBuffer('x-special/gnome-copied-files').toString('utf8').trim();
    if (!raw) return null;
    const [mode, ...uris] = raw.split('\n');
    const paths = uris.filter((u) => u.startsWith('file://')).map((u) => decodeURIComponent(new URL(u).pathname));
    return paths.length ? { mode: mode === 'cut' ? 'cut' : 'copy', paths } : null;
  } catch { return null; }
});

/* ---------------- window ---------------- */

const winOf = (e) => [...windows].find((w) => w.webContents === e.sender);
ipcMain.on('win:min', (e) => winOf(e)?.minimize());
ipcMain.on('win:max', (e) => { const w = winOf(e); if (w) (w.isMaximized() ? w.unmaximize() : w.maximize()); });
ipcMain.on('win:close', (e) => winOf(e)?.close());
ipcMain.handle('win:isMax', (e) => !!winOf(e)?.isMaximized());
// Pick an image file for a custom folder or file-type icon.
ipcMain.handle('dialog:pickImage', async (e) => {
  const r = await dialog.showOpenDialog(winOf(e) || undefined, { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'] }] });
  return r.canceled ? null : r.filePaths[0];
});
