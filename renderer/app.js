'use strict';
/* Nova Commander — renderer (One Commander-style layout) */

/* global api — exposed by preload.js */
const { iconFor, line, typeName, extOf, folderSvg } = window.Icons;
const HOME = api.home;

/* =========================================================
 * Utilities
 * ======================================================= */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const P = {
  dirname(p) { if (p === '/') return '/'; const i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); },
  basename(p) { return p === '/' ? '/' : p.slice(p.lastIndexOf('/') + 1); },
  isInside(child, parent) { return child === parent || child.startsWith(parent === '/' ? '/' : parent + '/'); },
  display(p) { return p === HOME ? '~' : p.startsWith(HOME + '/') ? '~' + p.slice(HOME.length) : p; },
  expand(p) {
    p = p.trim();
    if (p === '~') return HOME;
    if (p.startsWith('~/')) p = HOME + p.slice(1);
    if (p.length > 1) p = p.replace(/\/+$/, '');
    return p;
  },
};
// Also encode ' ( ) so a file name can't break out of CSS url('…') or attribute values.
const fileUri = (p) => 'file://' + p.split('/').map((seg) => encodeURIComponent(seg).replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function fmtSize(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return `${n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
}
const pad = (n) => String(n).padStart(2, '0');
function fmtDay(ms) {
  const d = new Date(ms);
  const [y, m, day] = [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())];
  switch (state.settings.dateFormat) {
    case 'dmy': return `${day}/${m}/${y}`;
    case 'mdy': return `${m}/${day}/${y}`;
    case 'locale': return d.toLocaleDateString();
    default: return `${y}-${m}-${day}`;
  }
}
const isoDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
function fmtFull(ms) { const d = new Date(ms); return `${fmtDay(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// One Commander-style colour-coded file age:
// today = red→orange, 1–7 days = yellow→green, 7–30 days = green→cyan, 1–12 months = cyan→blue, 1 year+ = grey.
function ageInfo(ms) {
  const sec = Math.max(0, (Date.now() - ms) / 1000);
  const min = sec / 60, hr = min / 60, day = hr / 24, mon = day / 30.44, yr = day / 365.25;
  const hsl = (h) => `hsl(${h.toFixed(0)} 72% 58%)`;
  const lerp = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));
  if (hr < 1) return { label: `${Math.max(1, Math.floor(min))} m`, color: hsl(0) };
  if (day < 1) return { label: `${Math.floor(hr)} h`, color: hsl(lerp(0, 30, hr / 24)) };
  if (day < 7) return { label: `${Math.floor(day)} d`, color: hsl(lerp(52, 100, (day - 1) / 6)) };
  if (day < 30) return { label: `${Math.floor(day)} d`, color: hsl(lerp(110, 180, (day - 7) / 23)) };
  if (yr < 1) return { label: `${Math.max(1, Math.floor(mon))} M`, color: hsl(lerp(185, 228, (mon - 1) / 11)) };
  return { label: `${Math.floor(yr)} y`, color: `hsl(${(212 + Math.min(yr, 8) * 2).toFixed(0)} 52% 62%)` };
}

/* =========================================================
 * State
 * ======================================================= */
const THEMES = [['black', 'Black'], ['nord', 'Nord'], ['midnight', 'Midnight']];
const STYLE_VERSION = 2;
// Colour tags, indexed 1..7 (stored by index in the main process). Alt+1…7 toggles, Alt+0 clears.
const TAGS = [null, ['Red', '#f05252'], ['Orange', '#fb8c2c'], ['Yellow', '#f5cf3f'], ['Green', '#3fc56b'], ['Blue', '#3b8cf6'], ['Purple', '#a66cf0'], ['Grey', '#9aa0a6']];
const SORTS = [['name', 'Name'], ['type', 'Extension'], ['mtime', 'Date modified'], ['ctime', 'Date created'], ['size', 'Size'], ['tag', 'Colour tag'], ['taken', 'Date taken'], ['resolution', 'Resolution'], ['duration', 'Length']];
// Quick type filters (Icons.category values).
const TYPE_FILTERS = [
  ['', 'All items'], ['folder', 'Folders'], ['image', 'Images'], ['video', 'Videos'], ['audio', 'Audio'],
  ['doc', 'Documents', ['doc', 'pdf', 'sheet', 'slides', 'text']], ['archive', 'Archives'], ['code', 'Code'],
];

const DEFAULT_SETTINGS = {
  foldersFirst: true,
  showExtensions: true,
  dateFormat: 'iso', // iso | dmy | mdy | locale
  rowHeight: 23,
  fontSize: 13.5,
  gridSize: 112,
  accent: '', // '' = theme default
  confirmTrash: false,
  showRecent: true,
  recentMax: 30,
  keepTabAlias: false,
  hiddenPatterns: '', // extra names treated as hidden, e.g. "*.tmp, __pycache__"
  keys: {}, // action id -> [combo] overrides
  layout: 'side', // side | stacked (panes above each other)
  parentColWidth: 190,
  expandColumns: true, // widen a parent column to fit its names while the mouse rests on it
  markRecent: true, // highlight items changed in the last hour
  showDrives: true,
  iconTheme: '', // '' = built-in icons, else a freedesktop icon theme id
  thumbCache: true,
  keepInTray: false,
  globalHotkey: '', // Electron accelerator, e.g. "Control+Alt+E"
  columns: { ext: true, age: true, mtime: true, ctime: false, size: true, dims: false, taken: false, duration: false, tag: false },
};
// Shared between windows (stored in window 1's record); everything else is per window.
const SHARED_KEYS = ['settings', 'favGroups', 'recent', 'dropList', 'savedWindows', 'notes', 'folderBg', 'recentDest', 'collapsed', 'rules', 'theme', 'showHidden'];
const QUERY = new URLSearchParams(location.search);
const MAIN_WIN = (QUERY.get('w') || '1') === '1';

const state = {
  panes: [],
  active: 0,
  dual: true,
  info: false,
  showHidden: false,
  theme: 0,
  split: 0.5,
  favGroups: [{ name: 'Favorites', items: [] }], // items: { path, alias? }
  recent: [], // recently visited folders, newest first
  dropList: [], // paths collected on the Drop List shelf
  savedWindows: [], // { name, dual, split, panes }
  notes: {}, // folder path -> note text
  folderBg: {}, // folder path -> background image path
  recentDest: [], // recent copy/move destinations, newest first
  collapsed: {}, // sidebar section id -> true
  rules: [], // File Automator rules
  scripts: [], // executables in the scripts folder
  settings: { ...DEFAULT_SETTINGS },
  clipboard: null, // {mode: 'copy'|'cut', paths, set}
  undo: [],
  places: [],
  drives: [],
  templatesDir: '',
  tags: {}, // path -> TAGS index
  user: P.basename(HOME),
};
let uid = 0;
let jobSeq = 0;
const tagOf = (p) => state.tags[p] || 0;
const S = () => state.settings;

function newTab(path, view = 'details', sort) {
  return { id: ++uid, path, view, columns: [], focusCol: 0, history: [path], hIndex: 0, filter: '', typeFilter: '', sort: sort || { key: 'name', dir: 1 }, token: 0, loaded: false, alias: '', aliasPath: '', lastUsed: Date.now() };
}
const tabLabel = (t) => (t.alias && (S().keepTabAlias || t.path === t.aliasPath) ? t.alias : dirLabel(t.path));
const tabOf = (pane) => pane.tabs[pane.activeTab];
const activePane = () => state.panes[state.dual ? state.active : 0];
const otherPane = () => state.panes[activePane().index === 0 ? 1 : 0];
const visiblePanes = () => state.panes.filter((p) => state.dual || p.index === 0);
const currentDir = (tab) => (tab.columns.length ? tab.columns[tab.columns.length - 1].path : tab.path);
const syncPath = (tab) => { tab.path = currentDir(tab); };
const placeByPath = (p) => state.places.find((x) => x.path === p);
function dirLabel(p) {
  if (p === '/') return 'File System';
  if (p === HOME) return state.user;
  return P.basename(p);
}

const windowLayout = () => ({
  dual: state.dual, info: state.info, split: state.split, active: state.active,
  panes: state.panes.map((p) => ({ activeTab: p.activeTab, tabs: p.tabs.map((t) => ({ path: t.path, view: t.view, sort: t.sort, alias: t.alias, aliasPath: t.aliasPath })) })),
});
function saveState() {
  clearTimeout(saveState.t);
  saveState.t = setTimeout(() => {
    try {
      // Extra windows only update the shared part; window 1 also stores its layout.
      const rec = MAIN_WIN ? { ...windowLayout() } : (loadState() || {});
      for (const k of SHARED_KEYS) rec[k] = state[k];
      rec.v = STYLE_VERSION;
      localStorage.setItem('nova-state', JSON.stringify(rec));
    } catch { /* storage unavailable */ }
  }, 300);
}
// Another window changed shared settings: pick them up.
window.addEventListener('storage', (e) => {
  if (e.key !== 'nova-state' || !e.newValue) return;
  let rec;
  try { rec = JSON.parse(e.newValue); } catch { return; }
  for (const k of SHARED_KEYS) if (k in rec && k !== 'theme') state[k] = rec[k];
  state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
  if (rec.theme !== state.theme) setTheme(rec.theme ?? 0);
  applySettings();
  renderAll();
});
function loadState() {
  try { return JSON.parse(localStorage.getItem('nova-state')) || null; } catch { return null; }
}

/* =========================================================
 * Column data
 * ======================================================= */
function makeCol(path, res) {
  const entries = res && res.ok ? res.entries : [];
  return { path, entries, map: new Map(entries.map((e) => [e.path, e])), sel: new Set(), cursor: null, anchor: null, error: res && !res.ok ? res.error : null };
}

/* Folder sizes are computed in the background (like One Commander) and cached. */
const dirSizes = new Map(); // path -> { size, partial, t }
const sizeQueue = [];
let sizeBusy = 0;
const sizeOf = (e) => (e.isDir ? dirSizes.get(e.path)?.size ?? -1 : e.size);
function fmtDirSize(p) {
  const d = dirSizes.get(p);
  if (!d) return '';
  return (d.partial ? '>' : '') + fmtSize(d.size);
}
function queueDirSizes(pane) {
  const tab = tabOf(pane);
  const last = tab.columns[tab.columns.length - 1];
  if (!last) return;
  const now = Date.now();
  for (const e of visible(tab, last)) {
    if (!e.isDir || e.isLink) continue;
    const c = dirSizes.get(e.path);
    if ((c && now - c.t < 120000) || sizeQueue.includes(e.path)) continue;
    sizeQueue.push(e.path);
  }
  pumpSizes();
}
function stillShown(p) {
  return visiblePanes().some((pane) => { const t = tabOf(pane); return t.columns[t.columns.length - 1]?.map.has(p); });
}
function pumpSizes() {
  while (sizeBusy < 2 && sizeQueue.length) {
    const p = sizeQueue.shift();
    if (!stillShown(p)) continue;
    sizeBusy++;
    api.dirSize(p).then((r) => {
      dirSizes.set(p, { size: r.size, partial: r.partial, t: Date.now() });
      for (const pane of visiblePanes()) {
        const cell = pane.listEl.querySelector(`.row[data-path="${CSS.escape(p)}"] .c-size`);
        if (cell) { cell.textContent = fmtDirSize(p); cell.classList.remove('pending'); }
        if (tabOf(pane).columns.at(-1)?.map.has(p)) renderHeadInfo(pane);
      }
    }).finally(() => { sizeBusy--; pumpSizes(); });
  }
}
/* Image dimensions / photo date taken, read from file headers on demand (Taken / Dimensions
 * columns and the matching sorts). */
const metaCache = new Map(); // path -> { mtime, width, height, taken }
const META_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']);
const metaOf = (e) => { const m = metaCache.get(e.path); return m && m.mtime === e.mtime ? m : {}; };
// Audio/video length via the built-in media engine (whatever Chromium can play), a few at a time.
const MEDIA_EXT = new Set(['mp4', 'webm', 'mkv', 'mov', 'm4v', 'ogv', 'mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'opus']);
const durationQueue = [];
let durationBusy = 0;
function mediaDuration(p) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const done = (d) => { clearTimeout(t); v.removeAttribute('src'); v.load(); resolve(d); };
    const t = setTimeout(() => done(null), 6000);
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => done(null);
    v.src = fileUri(p);
  });
}
function pumpDurations() {
  while (durationBusy < 3 && durationQueue.length) {
    const { e, pane } = durationQueue.shift();
    durationBusy++;
    mediaDuration(e.path).then((d) => {
      metaCache.set(e.path, { mtime: e.mtime, duration: d });
      clearTimeout(pane.metaT);
      pane.metaT = setTimeout(() => { if (!pane.renaming) renderBody(pane); }, 150);
    }).finally(() => { durationBusy--; pumpDurations(); });
  }
}
function queueMeta(pane, vis) {
  const tab = tabOf(pane);
  if (S().columns.duration || tab.sort.key === 'duration') {
    for (const e of vis) {
      if (e.isDir || !MEDIA_EXT.has(extOf(e.name)) || metaCache.get(e.path)?.mtime === e.mtime) continue;
      metaCache.set(e.path, { mtime: e.mtime }); // pending
      durationQueue.push({ e, pane });
    }
    pumpDurations();
  }
  const want = S().columns.taken || S().columns.dims || tab.sort.key === 'taken' || tab.sort.key === 'resolution';
  if (!want) return;
  const todo = vis.filter((e) => !e.isDir && META_EXT.has(extOf(e.name)) && metaCache.get(e.path)?.mtime !== e.mtime);
  if (!todo.length) return;
  for (const e of todo) metaCache.set(e.path, { mtime: e.mtime }); // mark as pending
  api.mediaMeta(todo.map((e) => e.path)).then((res) => {
    for (const e of todo) metaCache.set(e.path, { mtime: e.mtime, ...(res[e.path] || {}) });
    if (!pane.renaming) renderBody(pane);
  });
}

function invalidateSizes(dirs) {
  for (const k of [...dirSizes.keys()]) if (dirs.some((d) => P.isInside(d, k))) dirSizes.delete(k);
}

function sortEntries(list, { key, dir }) {
  const foldersFirst = S().foldersFirst;
  return list.slice().sort((a, b) => {
    if (foldersFirst && a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    let r = 0;
    if (key === 'size') r = sizeOf(a) - sizeOf(b);
    else if (key === 'mtime') r = a.mtime - b.mtime;
    else if (key === 'ctime') r = (a.ctime || 0) - (b.ctime || 0);
    else if (key === 'type') r = collator.compare(extOf(a.name), extOf(b.name));
    else if (key === 'tag') r = (tagOf(a.path) || 99) - (tagOf(b.path) || 99);
    else if (key === 'taken') r = collator.compare(metaOf(a).taken || '', metaOf(b).taken || '');
    else if (key === 'resolution') r = (metaOf(a).width || 0) * (metaOf(a).height || 0) - (metaOf(b).width || 0) * (metaOf(b).height || 0);
    else if (key === 'duration') r = (metaOf(a).duration ?? -1) - (metaOf(b).duration ?? -1);
    if (!r) r = collator.compare(a.name, b.name);
    return r * dir;
  });
}

// "Files to treat as hidden" setting: comma-separated names with * and ? wildcards.
let hiddenRe = null;
function compileHidden() {
  const parts = S().hiddenPatterns.split(',').map((s) => s.trim()).filter(Boolean);
  hiddenRe = parts.length ? new RegExp(`^(?:${parts.map((g) => g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')).join('|')})$`, 'i') : null;
}
const isHidden = (e) => e.hidden || (hiddenRe && hiddenRe.test(e.name));
function typeMatch(e, filter) {
  if (filter === 'folder') return e.isDir;
  if (e.isDir) return false;
  const def = TYPE_FILTERS.find(([k]) => k === filter);
  const cat = window.Icons.category(e);
  return def?.[2] ? def[2].includes(cat) : cat === filter;
}

function visible(tab, col) {
  const isLast = col === tab.columns[tab.columns.length - 1];
  let list = col.entries;
  if (!state.showHidden) list = list.filter((e) => !isHidden(e) || col.sel.has(e.path));
  if (isLast && tab.filter) {
    const f = tab.filter.toLowerCase();
    list = list.filter((e) => e.name.toLowerCase().includes(f));
  }
  if (isLast && tab.typeFilter) list = list.filter((e) => typeMatch(e, tab.typeFilter));
  return sortEntries(list, isLast ? tab.sort : { key: 'name', dir: 1 });
}

function orderedSel(tab, col) {
  const vis = visible(tab, col).filter((e) => col.sel.has(e.path)).map((e) => e.path);
  for (const p of col.sel) if (!vis.includes(p)) vis.push(p);
  return vis;
}

function activeCtx(pane = activePane()) {
  const tab = tabOf(pane);
  const col = tab.columns[tab.focusCol] || tab.columns[tab.columns.length - 1];
  return { pane, tab, col };
}
function selectedPaths() {
  if (activePane().search.open) return searchSel(activePane());
  const { tab, col } = activeCtx();
  return col ? orderedSel(tab, col) : [];
}

/* =========================================================
 * Navigation
 * ======================================================= */
function chainFor(path) {
  const root = P.isInside(path, HOME) ? HOME : '/';
  const chain = [];
  let cur = path;
  for (;;) {
    chain.unshift(cur);
    if (cur === root || cur === '/') break;
    cur = P.dirname(cur);
  }
  return chain;
}

async function navigate(pane, tab, path, { push = true, select = null, openSelected = true } = {}) {
  path = P.expand(path);
  const token = ++tab.token;
  const res = await api.list(path);
  if (token !== tab.token) return false;
  if (!res.ok) { toast(`Can't open ${P.display(path)} — ${res.error}`, 'error'); return false; }

  let cols;
  if (tab.view === 'columns') {
    const chain = chainFor(path);
    const lists = await Promise.all(chain.slice(0, -1).map((p) => api.list(p)));
    if (token !== tab.token) return false;
    cols = chain.map((p, i) => makeCol(p, i === chain.length - 1 ? res : lists[i]));
    for (let i = 0; i < cols.length - 1; i++) { cols[i].sel.add(chain[i + 1]); cols[i].cursor = cols[i].anchor = chain[i + 1]; }
  } else {
    cols = [makeCol(path, res)];
  }
  tab.columns = cols;
  tab.focusCol = cols.length - 1;
  tab.filter = '';
  tab.loaded = true;
  const last = cols[cols.length - 1];
  if (select && last.map.has(select)) {
    last.sel = new Set([select]);
    last.cursor = last.anchor = select;
    if (tab.view === 'columns' && openSelected && last.map.get(select).isDir) {
      const r = await api.list(select);
      if (token !== tab.token) return false;
      tab.columns.push(makeCol(select, r));
    }
  }
  syncPath(tab);
  addRecent(path);
  tab.lastUsed = Date.now();
  if (push && tab.history[tab.hIndex] !== path) {
    tab.history = tab.history.slice(0, tab.hIndex + 1);
    tab.history.push(path);
    tab.hIndex = tab.history.length - 1;
  }
  if (tabOf(pane) === tab) {
    if (pane.search.open) closeSearch(pane); // navigating shows the folder again
    renderPane(pane);
    scrollParentsToEnd(pane);
    ensureCursorVisible(pane);
    updatePreview();
  }
  renderSidebarCurrent();
  updateWatch();
  saveState();
  return true;
}

function openChild(pane, tab, k, dir, delay = 0, focusChild = false) {
  const token = ++tab.token;
  const run = async () => {
    if (token !== tab.token) return;
    const res = await api.list(dir);
    if (token !== tab.token) return;
    const col = tab.columns[k];
    if (!col || col.sel.size !== 1 || !col.sel.has(dir)) return;
    tab.columns.length = k + 1;
    tab.columns.push(makeCol(dir, res));
    if (res.ok) addRecent(dir);
    if (focusChild) tab.focusCol = k + 1;
    syncPath(tab);
    if (tabOf(pane) === tab) { renderPane(pane); scrollParentsToEnd(pane); }
    updatePreview();
    renderSidebarCurrent();
    updateWatch();
    saveState();
  };
  if (delay) setTimeout(run, delay); else run();
}

function goUp(pane = activePane()) {
  const tab = tabOf(pane);
  const cur = currentDir(tab);
  if (cur === '/') return;
  navigate(pane, tab, P.dirname(cur), { select: cur, openSelected: false });
}
function goHistory(pane, delta) {
  const tab = tabOf(pane);
  const i = tab.hIndex + delta;
  if (i < 0 || i >= tab.history.length) return;
  tab.hIndex = i;
  navigate(pane, tab, tab.history[i], { push: false });
}

function selectEntry(pane, tab, k, path, { ctrl = false, shift = false, delay = 0, focusChild = false } = {}) {
  const col = tab.columns[k];
  if (!col) return;
  setActivePane(pane.index, false);
  tab.focusCol = k;
  if (ctrl) {
    if (col.sel.has(path)) col.sel.delete(path); else col.sel.add(path);
    col.cursor = col.anchor = path;
  } else if (shift && col.anchor) {
    const vis = visible(tab, col).map((e) => e.path);
    let a = vis.indexOf(col.anchor);
    const b = vis.indexOf(path);
    if (a < 0) a = b;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    col.sel = new Set(vis.slice(lo, hi + 1));
    col.cursor = path;
  } else {
    col.sel = new Set([path]);
    col.cursor = col.anchor = path;
  }
  if (tab.view === 'columns') {
    const entry = col.map.get(path);
    const next = tab.columns[k + 1];
    const single = col.sel.size === 1 && col.sel.has(path) && entry?.isDir;
    const keep = single && next && next.path === path;
    if (keep && focusChild) tab.focusCol = k + 1;
    if (!keep) {
      tab.columns.length = k + 1;
      tab.token++; // cancel pending child loads
      if (single) openChild(pane, tab, k, path, delay, focusChild);
    }
  }
  syncPath(tab);
  renderPane(pane);
  ensureCursorVisible(pane);
  updatePreview();
  renderSidebarCurrent();
}

function activateEntry(pane, tab, k, path) {
  const e = tab.columns[k]?.map.get(path);
  if (!e) return;
  if (e.isDir) navigate(pane, tab, path);
  else openFile(path);
}

async function openFile(p) {
  const r = await api.open(p);
  if (!r.ok) toast(`Couldn't open “${P.basename(p)}” — ${r.error}`, 'error');
}

/* =========================================================
 * Refresh & watching
 * ======================================================= */
async function refreshDir(dir) {
  const res = await api.list(dir);
  const touched = new Set();
  for (const pane of state.panes) {
    for (const tab of pane.tabs) {
      const k = tab.columns.findIndex((c) => c.path === dir);
      if (k < 0) continue;
      touched.add(pane);
      const col = tab.columns[k];
      if (!res.ok) {
        if (res.code === 'ENOENT') {
          tab.columns.length = k;
          if (!tab.columns.length) { navigate(pane, tab, P.dirname(dir), { push: false }); continue; }
          tab.focusCol = Math.min(tab.focusCol, tab.columns.length - 1);
          tab.columns[tab.columns.length - 1].sel.delete(dir);
        } else col.error = res.error;
        syncPath(tab);
        continue;
      }
      col.entries = res.entries;
      col.map = new Map(res.entries.map((e) => [e.path, e]));
      col.error = null;
      for (const p of [...col.sel]) if (!col.map.has(p)) col.sel.delete(p);
      if (col.cursor && !col.map.has(col.cursor)) col.cursor = null;
      if (col.anchor && !col.map.has(col.anchor)) col.anchor = null;
      const next = tab.columns[k + 1];
      if (next && !col.map.has(next.path)) {
        tab.columns.length = k + 1;
        tab.focusCol = Math.min(tab.focusCol, k);
      }
      syncPath(tab);
    }
  }
  for (const pane of touched) if (!pane.renaming) renderPane(pane);
  if (touched.size) { updatePreview(true); updateWatch(); }
}
async function refreshDirs(dirs) {
  invalidateSizes([...dirs]);
  for (const d of new Set(dirs)) await refreshDir(d);
}

function updateWatch() {
  const dirs = new Set();
  for (const pane of visiblePanes()) for (const c of tabOf(pane).columns) dirs.add(c.path);
  api.watch([...dirs]);
}

/* =========================================================
 * Rendering — panes
 * ======================================================= */
function buildPane(pane) {
  pane.el.innerHTML = `
    <div class="tabs"></div>
    <div class="addr">
      <button class="ib" data-act="menu" title="Pane menu">${line('menu')}</button>
      <div class="crumbs" title="Click to type a path (Ctrl+L)"></div>
      <button class="ib" data-act="dual" title="Dual pane (Ctrl+D)">${line('dual')}</button>
    </div>
    <div class="pane-body side">
      <div class="parents"></div>
      <div class="current">
        <div class="cur-head">
          <div class="cur-left">
            <div class="cur-title"></div>
            <div class="cur-count"></div>
            <div class="cur-bar">
              <button class="ib" data-act="back" title="Back (Alt+←)">${line('back')}</button>
              <button class="ib" data-act="forward" title="Forward (Alt+→)">${line('forward')}</button>
              <button class="ib" data-act="up" title="Up one level (Backspace)">${line('up')}</button>
              <button class="ib" data-act="newfolder" title="New folder (Ctrl+Shift+N)">${line('folderPlus')}</button>
              <span class="sep"></span>
              <button class="ib" data-view="columns" title="Columns view (Ctrl+1)">${line('columns')}</button>
              <button class="ib" data-view="details" title="List view (Ctrl+2)">${line('details')}</button>
              <button class="ib" data-view="grid" title="Thumbnail view (Ctrl+3)">${line('grid')}</button>
            </div>
          </div>
          <div class="cur-right">
            <div class="cur-tools">
              <div class="filter">${line('search')}<input placeholder="Filter" spellcheck="false"></div>
              <button class="ib" data-act="type" title="Filter by type">${line('funnel')}</button>
              <button class="ib" data-act="search" title="Search in this folder (Ctrl+Shift+F)">${line('searchFolder')}</button>
              <button class="ib" data-act="refresh" title="Refresh (F5)">${line('refresh')}</button>
              <button class="ib" data-act="terminal" title="Open terminal here">${line('terminal')}</button>
            </div>
            <div class="cur-size"></div>
          </div>
        </div>
        <div class="list"></div>
      </div>
    </div>
    <div class="search">
      <div class="s-bar">
        <div class="s-input">${line('search')}<input spellcheck="false"></div>
        <button class="s-opt" data-opt="matchCase" title="Match case">Aa</button>
        <button class="s-opt" data-opt="regex" title="Regular expression">.*</button>
        <button class="s-opt" data-opt="content" title="Search inside text files (up to 2 MB)">${line('documents')}</button>
        <button class="s-opt" data-opt="hidden" title="Include hidden files and folders">${line('eye')}</button>
        <button class="btn s-go"></button>
        <button class="ib s-close" title="Close search (Esc)">${line('x')}</button>
      </div>
      <div class="s-status"></div>
      <div class="s-list"></div>
    </div>
    <div class="info"></div>
    <div class="pstatus"><span class="ps-count"></span><button class="ps-toggle"></button><span class="ps-sel"></span></div>`;
  pane.tabsEl = $('.tabs', pane.el);
  pane.crumbsEl = $('.crumbs', pane.el);
  pane.bodyEl = $('.pane-body', pane.el);
  pane.parentsEl = $('.parents', pane.el);
  pane.currentEl = $('.current', pane.el);
  pane.titleEl = $('.cur-title', pane.el);
  pane.listEl = $('.list', pane.el);
  pane.filterEl = $('.filter input', pane.el);
  pane.infoEl = $('.info', pane.el);
  pane.statusEl = $('.pstatus', pane.el);
  pane.searchEl = $('.search', pane.el);
  pane.sInput = $('.s-input input', pane.el);
  pane.pv = { token: 0, key: '' };
  new ResizeObserver(() => {
    if (layoutMode(pane) !== pane.mode || (tabOf(pane).view !== 'grid' && colsKey(pane) !== pane.colsKey)) renderBody(pane);
  }).observe(pane.bodyEl);
  bindPane(pane);
  bindSearch(pane);
}

function renderAll() {
  for (const pane of state.panes) renderPane(pane);
  renderSidebar();
  updatePreview(true);
}

function renderPane(pane) {
  if (!pane.el) return;
  pane.el.classList.toggle('active', state.dual && state.active === pane.index);
  renderTabs(pane);
  renderToolbar(pane);
  renderBody(pane);
}

function renderTabs(pane) {
  const x = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  pane.tabsEl.innerHTML = pane.tabs.map((t, i) => `
    <div class="tab ${i === pane.activeTab ? 'active' : ''}" data-tab="${i}" data-drop="${esc(t.path)}" title="${esc(t.path)}">
      <span class="t-icon">${folderSvg()}</span>
      <span class="t-name">${esc(tabLabel(t))}</span>
      ${pane.tabs.length > 1 ? `<button class="t-close" data-close="${i}" title="Close tab (Ctrl+W)">${x}</button>` : ''}
    </div>`).join('') + `<button class="tab-add" title="New tab (Ctrl+T)"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>`;
}

function renderToolbar(pane) {
  const tab = tabOf(pane);
  $('[data-act="back"]', pane.el).disabled = tab.hIndex <= 0;
  $('[data-act="forward"]', pane.el).disabled = tab.hIndex >= tab.history.length - 1;
  $('[data-act="up"]', pane.el).disabled = currentDir(tab) === '/';
  pane.el.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === tab.view));
  if (pane.filterEl.value !== tab.filter) pane.filterEl.value = tab.filter;
  const typeBtn = $('[data-act="type"]', pane.el);
  typeBtn.classList.toggle('on', !!tab.typeFilter);
  typeBtn.title = tab.typeFilter ? `Showing: ${TYPE_FILTERS.find(([k]) => k === tab.typeFilter)[1]} (click to change)` : 'Filter by type';
  pane.titleEl.textContent = dirLabel(currentDir(tab));
  pane.currentEl.dataset.drop = currentDir(tab);
  $('[data-act="dual"]', pane.el).classList.toggle('on', state.dual);
  renderCrumbs(pane);
}

// Item count, total size and selection summary for the current folder.
function renderHeadInfo(pane) {
  const tab = tabOf(pane);
  const last = tab.columns[tab.columns.length - 1];
  if (!last) return;
  const vis = visible(tab, last);
  let total = 0, pending = false;
  for (const e of vis) {
    if (!e.isDir) total += e.size;
    else if (!e.isLink) { const d = dirSizes.get(e.path); if (d) total += d.size; else pending = true; }
  }
  const count = plural(vis.length, 'item');
  $('.cur-count', pane.el).textContent = count;
  $('.cur-size', pane.el).textContent = (pending ? '≥ ' : '') + fmtSize(total);
  $('.ps-count', pane.statusEl).textContent = count;
  const { col } = activeCtx(pane);
  let selTxt = '';
  if (col && col.sel.size) {
    let sz = 0;
    for (const p of col.sel) { const e = col.map.get(p); if (e) sz += e.isDir ? (dirSizes.get(p)?.size || 0) : e.size; }
    selTxt = `${col.sel.size} selected · ${fmtSize(sz)}`;
  }
  $('.ps-sel', pane.statusEl).textContent = selTxt;
  $('.ps-toggle', pane.statusEl).innerHTML = state.info ? '⌄ HIDE PREVIEW' : '⌃ SHOW PREVIEW';
}

function renderCrumbs(pane) {
  if (pane.editingPath) return;
  const p = currentDir(tabOf(pane));
  const segs = [];
  if (P.isInside(p, HOME)) {
    segs.push({ label: state.user, path: HOME });
    let acc = HOME;
    for (const part of p.slice(HOME.length).split('/').filter(Boolean)) { acc += '/' + part; segs.push({ label: part, path: acc }); }
  } else {
    segs.push({ label: 'File System', path: '/' });
    let acc = '';
    for (const part of p.split('/').filter(Boolean)) { acc += '/' + part; segs.push({ label: part, path: acc }); }
  }
  pane.crumbsEl.innerHTML = `<div class="c-scroll">${segs.map((s, i) => `${i ? '<span class="crumb-sep">/</span>' : ''}<span class="crumb" data-crumb="${esc(s.path)}" data-drop="${esc(s.path)}">${esc(s.label)}</span>`).join('')}</div>`;
  const sc = $('.c-scroll', pane.crumbsEl);
  sc.scrollLeft = sc.scrollWidth;
}

function editPath(pane) {
  if (pane.editingPath) return;
  pane.editingPath = true;
  const tab = tabOf(pane);
  const cur = currentDir(tab);
  pane.crumbsEl.innerHTML = `<input spellcheck="false" value="${esc(cur)}">`;
  const input = $('input', pane.crumbsEl);
  // Suggestions: subfolders of what's typed, then matching recent folders and favorites.
  const box = document.createElement('div');
  box.className = 'path-sugg';
  $('.addr', pane.el).appendChild(box);
  let items = [], idx = -1, token = 0;
  const icon = { dir: 'folder', recent: 'clock', fav: 'star' };
  const show = () => {
    box.hidden = !items.length;
    box.innerHTML = items.map((it, i) => `<div class="ps-item ${i === idx ? 'on' : ''}" data-i="${i}">${line(icon[it.kind])}<span>${esc(P.display(it.path))}</span></div>`).join('');
    box.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };
  const others = (q, out) => {
    const add = (p, kind) => { if (out.length < 16 && p !== cur && !out.some((o) => o.path === p) && (!q || P.display(p).toLowerCase().includes(q))) out.push({ path: p, kind }); };
    for (const p of state.recent) add(p, 'recent');
    for (const g of state.favGroups) for (const f of g.items) add(f.path, 'fav');
  };
  const suggest = async () => {
    const t = ++token;
    const raw = input.value;
    const out = [];
    if (raw === cur) others('', out);
    else {
      if (raw.startsWith('/') || raw.startsWith('~')) {
        const val = P.expand(raw);
        const dir = raw.endsWith('/') ? val || '/' : P.dirname(val);
        const prefix = raw.endsWith('/') ? '' : P.basename(val).toLowerCase();
        const r = await api.list(dir);
        if (t !== token) return;
        if (r.ok) {
          const dirs = r.entries.filter((e) => e.isDir && (state.showHidden || prefix.startsWith('.') || !isHidden(e)) && e.name.toLowerCase().startsWith(prefix));
          for (const e of sortEntries(dirs, { key: 'name', dir: 1 }).slice(0, 12)) out.push({ path: e.path, kind: 'dir' });
        }
      }
      others(raw.trim().toLowerCase(), out);
    }
    if (t !== token) return;
    items = out;
    idx = -1;
    show();
  };
  const done = async (go, target = null) => {
    if (!pane.editingPath) return;
    pane.editingPath = false;
    const val = target ?? input.value;
    box.remove();
    renderCrumbs(pane);
    if (go && val.trim()) {
      const p = P.expand(val);
      const st = await api.stat(p);
      if (st.ok && !st.entry.isDir) navigate(pane, tab, P.dirname(p), { select: p });
      else navigate(pane, tab, p);
    }
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); done(true, idx >= 0 ? items[idx].path : null); }
    else if (e.key === 'Escape') { e.preventDefault(); if (items.length && !box.hidden) { box.hidden = true; items = []; } else done(false); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length + 1) % (items.length + 1);
      if (idx === items.length) idx = -1;
      show();
    } else if (e.key === 'Tab' && items.length) {
      // Complete to the highlighted (or first) suggestion and keep typing below it.
      e.preventDefault();
      input.value = P.display(items[Math.max(0, idx)].path).replace(/\/?$/, '/');
      suggest();
    }
  });
  input.addEventListener('input', suggest);
  input.addEventListener('blur', () => done(false));
  box.addEventListener('mousedown', (e) => {
    e.preventDefault(); // keep focus in the input
    const it = e.target.closest('[data-i]');
    if (it) done(true, items[+it.dataset.i].path);
  });
  input.focus();
  input.select();
  suggest();
}

function rowClasses(e, col, focused) {
  const cls = ['row'];
  if (col.sel.has(e.path)) cls.push('sel');
  if (focused && col.cursor === e.path && (col.sel.size > 1 || !col.sel.has(e.path))) cls.push('cursor');
  if (isHidden(e)) cls.push('hidden-file');
  if (S().markRecent && !e.isDir && Date.now() - e.mtime < 3600e3) cls.push('recent-item');
  if (e.isLink) cls.push('link');
  if (tagOf(e.path)) cls.push('tagged');
  if (state.clipboard?.mode === 'cut' && state.clipboard.set.has(e.path)) cls.push('cut');
  return cls.join(' ');
}
const tagStyle = (p) => (tagOf(p) ? ` style="--tag:${TAGS[tagOf(p)][1]}"` : '');
function rowAttrs(e, col, focused) {
  return `class="${rowClasses(e, col, focused)}" data-path="${esc(e.path)}" draggable="true"${tagStyle(e.path)}${e.isDir ? ` data-drop="${esc(e.path)}"` : ''}${e.isLink ? ` title="Link${e.broken ? ' (broken)' : ''}"` : ''}`;
}
function rowIcon(e) {
  const place = e.isDir ? placeByPath(e.path) : null;
  return `<span class="r-icon">${iconFor(e, { special: place && place.id !== 'trash' ? place.id : null })}</span>`;
}
function parentRowHtml(e, col, focused) {
  return `<div ${rowAttrs(e, col, focused)}>${rowIcon(e)}<span class="r-name">${esc(e.name)}</span>${e.isDir ? `<span class="r-chev">${line('chevron')}</span>` : ''}</div>`;
}
// List-view columns (Name is always first). Settings → Columns chooses which are shown.
const COLUMNS = [
  { id: 'ext', label: 'Ext', sort: 'type', w: 46, cls: 'c-ext', cell: (e) => (e.isDir ? '[DIR]' : esc(extOf(e.name))) },
  { id: 'age', label: 'Age', sort: 'mtime', w: 44, cls: 'c-age num', cell: (e) => { const a = ageInfo(e.mtime); return `<i style="background:${a.color}">${a.label}</i>`; } },
  { id: 'mtime', label: 'Modified', sort: 'mtime', w: 82, cls: 'c-date', cell: (e) => fmtDay(e.mtime) },
  { id: 'ctime', label: 'Created', sort: 'ctime', w: 82, cls: 'c-date', cell: (e) => (e.ctime ? fmtDay(e.ctime) : '') },
  { id: 'taken', label: 'Taken', sort: 'taken', w: 106, cls: 'c-date', cell: (e) => esc(metaOf(e).taken || '') },
  { id: 'dims', label: 'Dimensions', sort: 'resolution', w: 84, cls: 'c-dims num', cell: (e) => { const m = metaOf(e); return m.width ? `${m.width}×${m.height}` : ''; } },
  { id: 'duration', label: 'Length', sort: 'duration', w: 58, cls: 'c-dims num', cell: (e) => (metaOf(e).duration != null ? fmtDuration(metaOf(e).duration) : '') },
  { id: 'tag', label: 'Tag', sort: 'tag', w: 30, cls: 'c-tag', cell: (e) => (tagOf(e.path) ? `<i class="tag-dot" style="--tag:${TAGS[tagOf(e.path)][1]}"></i>` : '') },
  { id: 'size', label: 'Size', sort: 'size', w: 70, cls: 'c-size num', cell: (e) => (e.isDir ? (e.isLink ? '' : fmtDirSize(e.path)) : fmtSize(e.size)) },
];
// Dropped in this order when the pane is too narrow (Age already conveys the modified date).
const COL_DROP = ['ctime', 'mtime', 'tag', 'ext', 'duration', 'taken', 'dims'];
function listColumns(pane) {
  let cols = COLUMNS.filter((c) => S().columns[c.id]);
  const avail = pane.currentEl.clientWidth || 800;
  for (const id of COL_DROP) {
    if (18 + 150 + cols.reduce((n, c) => n + c.w + 8, 0) + 24 <= avail) break;
    cols = cols.filter((c) => c.id !== id);
  }
  return cols;
}
const colsKey = (pane) => listColumns(pane).map((c) => c.id).join();
function listRowHtml(e, col, focused, cols) {
  const ext = e.isDir ? '' : extOf(e.name);
  const base = ext ? esc(e.name.slice(0, -(ext.length + 1))) : esc(e.name);
  const name = ext && S().showExtensions ? `${base}<span class="r-ext">.${esc(e.name.slice(-ext.length))}</span>` : base;
  return `<div ${rowAttrs(e, col, focused)}>${rowIcon(e)}<span class="r-name">${name}</span>`
    + cols.map((c) => `<span class="${c.cls}${c.id === 'size' && e.isDir && !dirSizes.has(e.path) ? ' pending' : ''}">${c.cell(e)}</span>`).join('') + '</div>';
}

// Thumbnail view tiles: images show the picture itself, everything else a big icon.
const THUMB_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico', 'apng']);
function gridTileHtml(e, col, focused) {
  const place = e.isDir ? placeByPath(e.path) : null;
  // Big images get their src from the thumbnail cache (cacheThumbs) instead of the full file.
  const cached = S().thumbCache && e.size > 150 * 1024;
  const thumb = !e.isDir && !e.broken && THUMB_EXT.has(extOf(e.name))
    ? `<img loading="lazy" decoding="async" ${cached ? 'data-full' : 'src'}="${esc(fileUri(e.path))}" alt="" draggable="false">`
    : iconFor(e, { big: true, special: place && place.id !== 'trash' ? place.id : null });
  return `<div ${rowAttrs(e, col, focused)} title="${esc(e.name)}"><span class="r-icon g-thumb">${thumb}</span><span class="r-name">${esc(e.name)}</span></div>`;
}
function gridCols(pane) {
  const b = $('.list-body.grid', pane.listEl);
  return b ? Math.max(1, getComputedStyle(b).gridTemplateColumns.split(' ').length) : 1;
}

// Parent columns sit beside the list when there's room, otherwise above it.
function layoutMode(pane) {
  const tab = tabOf(pane);
  const parents = Math.max(0, tab.columns.length - 1);
  if (!parents) return 'side';
  const w = pane.bodyEl.clientWidth || 800;
  return w - Math.min(parents, 3) * S().parentColWidth >= 560 ? 'side' : 'stacked';
}

function renderBody(pane) {
  const tab = tabOf(pane);
  const lastIdx = tab.columns.length - 1;
  const isActive = activePane() === pane;
  pane.mode = layoutMode(pane);
  pane.bodyEl.className = `pane-body ${pane.mode}`;

  // Parent columns
  const tops = {};
  pane.parentsEl.querySelectorAll('.pcol').forEach((c) => { tops[c.dataset.path] = c.scrollTop; });
  const left = pane.parentsEl.scrollLeft;
  let html = '';
  for (let k = 0; k < lastIdx; k++) {
    const col = tab.columns[k];
    const focused = isActive && k === tab.focusCol;
    const vis = visible(tab, col);
    html += `<div class="pcol ${focused ? 'focused' : ''}" data-col="${k}" data-path="${esc(col.path)}" data-drop="${esc(col.path)}">`;
    html += col.error ? `<div class="empty err">${esc(col.error)}</div>` : vis.map((e) => parentRowHtml(e, col, focused)).join('');
    html += '</div>';
  }
  pane.parentsEl.innerHTML = html;
  pane.parentsEl.classList.toggle('expand-hover', S().expandColumns);
  pane.parentsEl.scrollLeft = left;
  pane.parentsEl.querySelectorAll('.pcol').forEach((c) => { if (tops[c.dataset.path]) c.scrollTop = tops[c.dataset.path]; });

  // Current folder list
  const col = tab.columns[lastIdx];
  if (!col) { pane.listEl.innerHTML = ''; return; }
  const oldBody = $('.list-body', pane.listEl);
  const top = oldBody && oldBody.dataset.path === col.path ? oldBody.scrollTop : 0;
  const focused = isActive && tab.focusCol === lastIdx;
  const vis = visible(tab, col);
  const head = (key, label, cls = '') => {
    const s = tab.sort.key === key;
    return `<span class="${s ? 'sorted' : ''} ${cls}" data-sort="${key}">${label}${s ? (tab.sort.dir > 0 ? ' ▴' : ' ▾') : ''}</span>`;
  };
  const grid = tab.view === 'grid';
  let body;
  if (col.error) body = `<div class="empty err">${esc(col.error)}</div>`;
  else if (!vis.length) body = `<div class="empty">${tab.filter || tab.typeFilter ? 'No matches' : 'Empty folder'}</div>`;
  const cols = grid ? [] : listColumns(pane);
  pane.colsKey = cols.map((c) => c.id).join();
  if (!col.error && vis.length) body = vis.map((e) => (grid ? gridTileHtml(e, col, focused) : listRowHtml(e, col, focused, cols))).join('');
  queueMicrotask(() => { renderHeadInfo(pane); queueDirSizes(pane); queueMeta(pane, vis); if (grid) cacheThumbs(pane); });
  const note = state.notes[col.path];
  const noteHtml = note ? `<div class="folder-note" data-note title="Click to edit this folder's note">${line('documents')}<span>${esc(note)}</span></div>` : '';
  const bg = state.folderBg[col.path];
  const bgAttr = bg ? ` style="--bg-img:url('${esc(fileUri(bg))}')"` : '';
  if (grid) {
    pane.listEl.innerHTML = `${noteHtml}<div class="list-body grid ${focused ? 'focused' : ''}${bg ? ' has-bg' : ''}" data-col="${lastIdx}" data-path="${esc(col.path)}" style="--tile:${S().gridSize}px;${bg ? `--bg-img:url('${esc(fileUri(bg))}')` : ''}">${body}</div>`;
    $('.list-body', pane.listEl).scrollTop = top;
    return;
  }
  pane.listEl.style.setProperty('--cols', `18px minmax(110px, 1fr) ${cols.map((c) => `${c.w}px`).join(' ')}`);
  pane.listEl.innerHTML = `${noteHtml}
    <div class="list-head"><span></span>${head('name', 'Name')}${cols.map((c) => head(c.sort, c.label, c.cls)).join('')}</div>
    <div class="list-body ${focused ? 'focused' : ''}${bg ? ' has-bg' : ''}" data-col="${lastIdx}" data-path="${esc(col.path)}"${bgAttr}>${body}</div>`;
  $('.list-body', pane.listEl).scrollTop = top;
}

function colEl(pane, k) {
  const tab = tabOf(pane);
  return k === tab.columns.length - 1 ? $('.list-body', pane.listEl) : $(`.pcol[data-col="${k}"]`, pane.parentsEl);
}

function ensureCursorVisible(pane) {
  const tab = tabOf(pane);
  const col = tab.columns[tab.focusCol];
  const scope = colEl(pane, tab.focusCol);
  if (!scope) return;
  if (col && col.cursor) {
    const row = scope.querySelector(`.row[data-path="${CSS.escape(col.cursor)}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
  }
  if (scope.classList.contains('pcol')) {
    const box = pane.parentsEl;
    const l = scope.offsetLeft, r = l + scope.offsetWidth;
    if (l < box.scrollLeft) box.scrollLeft = l;
    else if (r > box.scrollLeft + box.clientWidth) box.scrollLeft = r - box.clientWidth;
  }
}
function scrollParentsToEnd(pane) { pane.parentsEl.scrollLeft = pane.parentsEl.scrollWidth; }

function setActivePane(i, render = true) {
  if (!state.dual) i = 0;
  if (state.active === i) return;
  state.active = i;
  if (render) for (const p of state.panes) renderPane(p);
  else for (const p of state.panes) if (p.index !== i) renderPane(p);
  renderSidebarCurrent();
  updatePreview();
  saveState();
}

// Swap highlight classes only: a full re-render on mousedown would replace
// the element under the cursor and swallow the click or drag.
function lightActivate(i) {
  if (!state.dual) i = 0;
  if (state.active === i) return;
  state.active = i;
  for (const p of state.panes) {
    const on = p.index === i;
    p.el.classList.toggle('active', state.dual && on);
    p.el.querySelectorAll('.focused').forEach((el) => el.classList.remove('focused'));
    if (on) colEl(p, tabOf(p).focusCol)?.classList.add('focused');
  }
  renderSidebarCurrent();
  saveState();
}

/* =========================================================
 * Sidebar
 * ======================================================= */
// Sidebar section with a collapsible header (click the title to fold it).
function sbSection(id, title, body, { head = '', attrs = '' } = {}) {
  const folded = !!state.collapsed[id];
  return `<div class="sb-sec${folded ? ' folded' : ''}" ${attrs}><div class="sb-head"${attrs.includes('data-group=') ? ` data-group-head="${attrs.match(/data-group="(\d+)"/)[1]}"` : ''}><span class="t" data-collapse="${esc(id)}" title="Click to ${folded ? 'expand' : 'collapse'}"><i class="fold">${line('chevron')}</i>${esc(title)}</span>${head}</div>${folded ? '' : body}</div>`;
}
function renderSidebar() {
  const box = $('#sb-boxes');
  let html = '';
  if (S().showDrives) {
    let body = '';
    for (const d of state.drives) {
      const used = d.total ? (d.total - d.free) / d.total : 0;
      body += `<div class="sb-drive" data-nav="${esc(d.path)}" data-drop="${esc(d.path)}" title="${esc(d.path)}">
        <span class="d-icon">${line(d.removable ? 'usb' : 'drive')}</span>
        <span class="d-name">${esc(d.name)}</span>
        ${d.total ? `<span class="d-free">${fmtGB(d.free)} / ${fmtGB(d.total, true)}</span><span class="d-bar"><i class="${used > 0.9 ? 'full' : ''}" style="width:${(used * 100).toFixed(1)}%"></i></span>` : ''}
      </div>`;
    }
    html += sbSection('drives', 'Drives', body);
  }
  let places = '';
  for (const p of state.places) {
    const drop = p.id === 'trash' ? 'trash:' : p.path;
    const icon = p.id === 'trash' ? `<span class="si-icon">${line('trash')}</span>`
      : `<span class="si-icon folder">${iconFor({ name: p.name, isDir: true }, { special: p.id === 'home' ? null : p.id })}</span>`;
    places += `<div class="sb-item" data-nav="${esc(p.path)}" data-drop="${esc(drop)}" title="${esc(p.path)}">${icon}<span class="si-name">${esc(p.name)}</span></div>`;
  }
  html += sbSection('places', state.user, places);
  state.favGroups.forEach((g, gi) => {
    let body = g.items.length ? '' : `<div class="sb-empty">Drop folders here or press +</div>`;
    g.items.forEach((f, ii) => {
      body += `<div class="sb-item" draggable="true" data-nav="${esc(f.path)}" data-drop="${esc(f.path)}" data-fav="${gi}:${ii}" title="${esc(f.path)}"><span class="si-icon folder">${folderSvg()}</span><span class="si-name">${esc(f.alias || dirLabel(f.path))}</span></div>`;
    });
    html += sbSection(`fav:${g.name}`, g.name, body, { head: `<button class="ib" data-fav-add="${gi}" title="Add current folder to ${esc(g.name)}">${line('plus')}</button>`, attrs: `data-drop="fav:${gi}" data-group="${gi}"` });
  });
  // Colour tags in use, with counts; clicking one lists everything with that tag.
  const counts = {};
  for (const t of Object.values(state.tags)) counts[t] = (counts[t] || 0) + 1;
  if (Object.keys(counts).length) {
    let body = '';
    for (let i = 1; i < TAGS.length; i++) if (counts[i]) body += `<div class="sb-item" data-tagged="${i}" title="Show everything tagged ${TAGS[i][0]}"><span class="si-icon"><i class="tag-dot" style="--tag:${TAGS[i][1]}"></i></span><span class="si-name">${TAGS[i][0]}</span><span class="si-count">${counts[i]}</span></div>`;
    html += sbSection('tags', 'Tags', body);
  }
  // GVfs mounts: network shares and phones (MTP).
  let net = '';
  for (const m of state.netMounts || []) {
    net += `<div class="sb-item" data-nav="${esc(m.path)}" data-drop="${esc(m.path)}" data-mount="${esc(m.path)}" title="${esc(m.path)}"><span class="si-icon">${line(m.kind === 'phone' ? 'phone' : 'network')}</span><span class="si-name">${esc(m.label)}</span><button class="ib si-eject" data-unmount="${esc(m.path)}" title="Unmount">${line('eject')}</button></div>`;
  }
  net += `<div class="sb-item sb-action" data-connect><span class="si-icon">${line('plus')}</span><span class="si-name">Connect to server…</span></div>`;
  html += sbSection('network', 'Network & devices', net);
  if (S().showRecent && state.recent.length) {
    let body = '';
    for (const p of state.recent.slice(0, 8)) {
      body += `<div class="sb-item" data-nav="${esc(p)}" data-drop="${esc(p)}" data-recent="${esc(p)}" title="${esc(p)}"><span class="si-icon">${line('clock')}</span><span class="si-name">${esc(dirLabel(p))}</span></div>`;
    }
    html += sbSection('recent', 'Recent', body, { head: `<button class="ib" data-recent-clear title="Clear recent folders">${line('x')}</button>` });
  }
  box.innerHTML = html;
  renderDropList();
  renderSidebarCurrent();
}
function fmtGB(n, unit) {
  const g = n / 1024 ** 3;
  const t = g >= 1000 ? `${(g / 1024).toFixed(g >= 10240 ? 0 : 1)}` : g >= 10 ? `${Math.round(g)}` : g.toFixed(1);
  return unit ? `${t} ${g >= 1000 ? 'TB' : 'GB'}` : t;
}
function renderSidebarCurrent() {
  if (!state.panes.length) return;
  const cur = currentDir(tabOf(activePane()));
  document.querySelectorAll('#sidebar [data-nav]').forEach((el) => el.classList.toggle('is-current', el.dataset.nav === cur));
}
async function loadPlaces() {
  const r = await api.places();
  state.places = r.places;
  state.drives = r.drives;
  state.user = r.user || state.user;
  state.netMounts = await api.net.mounts();
  renderSidebar();
}
function sidebarChanged() { renderSidebar(); saveState(); }

/* Favorites: named groups of { path, alias } shown as sidebar sections. */
function addFavorites(paths, gi = 0) {
  const g = state.favGroups[gi] || state.favGroups[0];
  let n = 0;
  for (const p of paths) if (!g.items.some((f) => f.path === p)) { g.items.push({ path: p }); n++; }
  if (n) { sidebarChanged(); toast(`Added ${n === 1 ? `“${dirLabel(paths[0])}”` : plural(n, 'folder')} to ${g.name}`); }
}
const favAt = (key) => { const [gi, ii] = key.split(':').map(Number); return { gi, ii, g: state.favGroups[gi], f: state.favGroups[gi]?.items[ii] }; };
function removeFavorite(key) {
  const { g, ii } = favAt(key);
  g.items.splice(ii, 1);
  sidebarChanged();
}
async function renameFavorite(key) {
  const { f } = favAt(key);
  const v = await promptDialog({ title: 'Favorite name', body: `Shown in the sidebar for ${P.display(f.path)}. Leave empty to use the folder name.`, value: f.alias || dirLabel(f.path), confirm: 'Save' });
  if (v == null) return;
  f.alias = v.trim() && v.trim() !== dirLabel(f.path) ? v.trim() : undefined;
  sidebarChanged();
}
// Move a favorite to position `ii` of group `gi` (end of the group when ii is null).
function moveFavorite(key, gi, ii = null) {
  const from = favAt(key);
  const [item] = from.g.items.splice(from.ii, 1);
  const to = state.favGroups[gi];
  if (ii == null) ii = to.items.length;
  else if (gi === from.gi && from.ii < ii) ii--;
  to.items.splice(ii, 0, item);
  sidebarChanged();
}
async function newFavGroup() {
  const name = await promptDialog({ title: 'New favorites group', value: 'New group', confirm: 'Create' });
  if (!name?.trim()) return;
  state.favGroups.push({ name: name.trim(), items: [] });
  sidebarChanged();
}
async function renameFavGroup(gi) {
  const g = state.favGroups[gi];
  const name = await promptDialog({ title: 'Rename group', value: g.name, confirm: 'Rename' });
  if (!name?.trim()) return;
  g.name = name.trim();
  sidebarChanged();
}
async function deleteFavGroup(gi) {
  const g = state.favGroups[gi];
  if (g.items.length && !(await confirmDialog({ title: `Delete the group “${g.name}”?`, body: `Its ${plural(g.items.length, 'favorite')} will be removed from the sidebar. The folders themselves are not touched.`, confirm: 'Delete group', danger: true }))) return;
  state.favGroups.splice(gi, 1);
  if (!state.favGroups.length) state.favGroups.push({ name: 'Favorites', items: [] });
  sidebarChanged();
}
function moveFavGroup(gi, delta) {
  const to = gi + delta;
  if (to < 0 || to >= state.favGroups.length) return;
  const [g] = state.favGroups.splice(gi, 1);
  state.favGroups.splice(to, 0, g);
  sidebarChanged();
}

/* Recently visited folders. */
function addRecent(p) {
  if (state.recent[0] === p) return;
  state.recent = [p, ...state.recent.filter((x) => x !== p)].slice(0, S().recentMax);
  if (S().showRecent) renderSidebar();
}

/* Drop List: a shelf for collecting items from many folders, then copying or moving them in one go. */
function renderDropList() {
  const el = $('#droplist');
  const n = state.dropList.length;
  el.classList.toggle('has-items', n > 0);
  el.innerHTML = `<div class="dl-head"><span class="dl-title" ${n ? 'draggable="true" data-dl-all title="Drag to drop everything somewhere"' : ''}>${line('tray')}<span>Drop List</span>${n ? `<b>${n}</b>` : ''}</span>`
    + (n ? `<button class="ib" data-dl="copy" title="Copy all into the current folder">${line('copy')}</button><button class="ib" data-dl="move" title="Move all into the current folder">${line('folderIn')}</button><button class="ib" data-dl="clear" title="Clear the list">${line('x')}</button>` : '')
    + '</div>'
    + (n ? `<div class="dl-items">${state.dropList.map((it) => `<div class="dl-item" draggable="true" data-dl-item="${esc(it.path)}" title="${esc(it.path)}"><span class="r-icon">${iconFor({ name: P.basename(it.path), isDir: it.isDir })}</span><span class="si-name">${esc(P.basename(it.path))}</span><button class="dl-x" data-dl-remove="${esc(it.path)}" title="Remove from list">${line('x')}</button></div>`).join('')}</div>`
      : '<div class="dl-empty">Drag files here to collect them</div>');
}
function addToDropList(items) {
  let n = 0;
  for (const it of items) if (!state.dropList.some((x) => x.path === it.path)) { state.dropList.push(it); n++; }
  if (!n) { toast('Already on the Drop List'); return; }
  renderDropList();
  saveState();
  toast(`Added ${n === 1 ? `“${P.basename(items[0].path)}”` : plural(n, 'item')} to the Drop List`);
}
function removeFromDropList(paths) {
  const gone = new Set(paths);
  state.dropList = state.dropList.filter((x) => !gone.has(x.path));
  renderDropList();
  saveState();
}
async function applyDropList(mode) {
  if (!state.dropList.length) return;
  const dest = currentDir(tabOf(activePane()));
  const res = await transfer(state.dropList.map((x) => x.path), dest, mode);
  if (res && mode === 'move') removeFromDropList(res.done.map((d) => d.from));
}
function selectionItems(paths, get) {
  return paths.map((p) => ({ path: p, isDir: !!get(p)?.isDir }));
}

/* =========================================================
 * Info / preview bar (bottom of each pane)
 * ======================================================= */
function updatePreview(force = false) {
  clearTimeout(updatePreview.t);
  updatePreview.t = setTimeout(() => { for (const p of visiblePanes()) renderInfo(p, force); }, 40);
}

function fmtDuration(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`;
}
// Dimensions / duration from the preview element itself, plus EXIF for JPEG photos.
function addMediaInfo(pane, entry, token) {
  const dl = $('.info-props', pane.infoEl);
  const add = (k, v, html) => {
    if (token !== pane.pv.token || !dl.isConnected) return;
    dl.insertAdjacentHTML('beforeend', `<dt>${k}</dt><dd title="${esc(v)}">${html || esc(v)}</dd>`);
  };
  const media = $('.info-thumb img, .info-thumb video, .info-thumb audio', pane.infoEl);
  if (media?.tagName === 'IMG') {
    const done = () => media.naturalWidth && add('Dimensions', `${media.naturalWidth} × ${media.naturalHeight}`);
    if (media.complete) done(); else media.addEventListener('load', done, { once: true });
  } else if (media) {
    media.addEventListener('loadedmetadata', () => {
      if (media.videoWidth) add('Dimensions', `${media.videoWidth} × ${media.videoHeight}`);
      if (Number.isFinite(media.duration)) add('Duration', fmtDuration(media.duration));
    }, { once: true });
    // Codec, bit rate and sample rate need ffprobe (returns null when it isn't installed).
    api.probe(entry.path).then((x) => {
      if (!x) return;
      if (x.codec) add('Codec', x.codec);
      if (x.bitRate) add('Bit rate', `${Math.round(x.bitRate / 1000)} kb/s`);
      if (x.sampleRate) add('Audio', `${(x.sampleRate / 1000).toFixed(1)} kHz${x.channels ? ` · ${x.channels === 2 ? 'stereo' : x.channels === 1 ? 'mono' : `${x.channels} ch`}` : ''}`);
    });
  }
  if (/\.jpe?g$/i.test(entry.name)) {
    api.exif(entry.path).then((x) => {
      if (!x) return;
      if (x.taken) add('Taken', x.taken);
      if (x.camera) add('Camera', x.camera);
      const shot = [x.aperture, x.exposure, x.iso, x.focal].filter(Boolean).join(' · ');
      if (shot) add('Shot', shot);
      if (x.gps) add('Location', `${x.gps.lat}, ${x.gps.lon}`, `<a href="#" data-map="${x.gps.lat},${x.gps.lon}">${x.gps.lat}, ${x.gps.lon} ↗</a>`);
    });
  }
}

async function renderInfo(pane, force) {
  if (!state.info || !pane.infoEl) return;
  // Describe either the search results or the focused folder column.
  let vis, sel, get, cursor, fallbackDir;
  if (pane.search.open) {
    const s = pane.search;
    vis = s.results; sel = searchSel(pane); get = (p) => s.map.get(p); cursor = s.cursor; fallbackDir = s.root;
  } else {
    const { tab, col } = activeCtx(pane);
    const last = tab.columns[tab.columns.length - 1];
    if (!col || !last) return;
    vis = visible(tab, last); sel = orderedSel(tab, col); get = (p) => col.map.get(p); cursor = col.cursor; fallbackDir = currentDir(tab);
  }
  let total = 0;
  for (const e of vis) total += e.isDir ? (dirSizes.get(e.path)?.size || 0) : e.size;
  let selSize = 0;
  for (const p of sel) { const e = get(p); if (e && !e.isDir) selSize += e.size; }
  const top = `<div class="info-top"><div>${plural(vis.length, 'item')}<br><span class="sel">${sel.length ? `${sel.length} selected` : '&nbsp;'}</span></div><div class="r">${fmtSize(total)}<br>${sel.length ? fmtSize(selSize) : '&nbsp;'}</div></div>`;
  const actions = `<div class="info-actions">
      <button data-a="cut" title="Cut (Ctrl+X)">${line('cut')}</button>
      <button data-a="copy" title="Copy (Ctrl+C)">${line('copy')}</button>
      <button data-a="paste" title="Paste (Ctrl+V)">${line('paste')}</button>
      <button data-a="rename" title="Rename (F2)">${line('rename')}</button>
      <button data-a="copypath" title="Copy path (Ctrl+Shift+C)">${line('link')}</button>
      <button data-a="trash" class="del" title="Move to Trash (Del)">${line('trash')}</button>
    </div>`;

  let entry = null;
  if (sel.length === 1) entry = get(sel[0]);
  else if (!sel.length && cursor) entry = get(cursor);
  if (sel.length > 1) {
    const key = 'multi:' + sel.join('|') + vis.length;
    if (key === pane.pv.key && !force) return;
    pane.pv.key = key; pane.pv.token++;
    pane.infoEl.innerHTML = `<div class="info-thumb"><div class="big-icon">${folderSvg()}</div></div><div class="info-main">${top}${actions}<dl class="info-props"><dt>Selected</dt><dd>${plural(sel.length, 'item')}</dd><dt>Size</dt><dd>${fmtSize(selSize)} (files)</dd></dl></div>`;
    return;
  }
  if (!entry) entry = { name: dirLabel(fallbackDir), path: fallbackDir, isDir: true };
  const key = `${entry.path}:${entry.mtime || ''}:${vis.length}:${sel.length}:${tagOf(entry.path)}`;
  if (key === pane.pv.key && !force) return;
  pane.pv.key = key;
  const token = ++pane.pv.token;
  const info = await api.preview(entry.path);
  if (token !== pane.pv.token) return;
  let thumb;
  if (!info.ok) thumb = `<div class="big-icon">${iconFor(entry, { big: true })}</div>`;
  else if (info.kind === 'image') thumb = `<img src="${esc(info.url)}" alt="">`;
  else if (info.kind === 'video') thumb = `<video src="${esc(info.url)}" controls muted preload="metadata"></video>`;
  else if (info.kind === 'audio') thumb = `<audio src="${esc(info.url)}" controls preload="metadata"></audio>`;
  else if (info.kind === 'text') thumb = `<pre>${esc(info.text.slice(0, 2000))}</pre>`;
  else thumb = `<div class="big-icon">${iconFor(entry, { big: true, special: placeByPath(entry.path)?.id })}</div>`;
  const props = [['Name', entry.name], ['Type', entry.isDir ? 'Directory' : typeName(entry)]];
  if (info.ok) {
    if (info.kind === 'dir') props.push(['Contains', info.count == null ? 'No access' : `${plural(info.folders, 'folder')}, ${plural(info.files, 'file')}`]);
    else props.push(['Size', `${fmtSize(info.size)}${info.size >= 1024 ? ` (${info.size.toLocaleString()} B)` : ''}`]);
    props.push(['Created', fmtFull(info.ctime)], ['Modified', fmtFull(info.mtime)], ['Age', ageInfo(info.mtime).label]);
    if (tagOf(entry.path)) props.push(['Tag', TAGS[tagOf(entry.path)][0]]);
  } else props.push(['Error', info.error]);
  pane.infoEl.innerHTML = `<div class="info-thumb">${thumb}</div><div class="info-main">${top}${actions}<dl class="info-props">${props.map(([k, v]) => `<dt>${k}</dt><dd title="${esc(v)}">${esc(v)}</dd>`).join('')}</dl></div>`;
  pane.infoEl.dataset.path = entry.path;
  if (info.ok) addMediaInfo(pane, entry, token);
  if (FONT_RE.test(entry.name)) {
    loadFontFamily(entry.path).then((family) => { if (token === pane.pv.token) $('.info-thumb', pane.infoEl).innerHTML = fontSampleHtml(family); }).catch(() => {});
  }
}

/* =========================================================
 * File operations
 * ======================================================= */
async function transfer(paths, destDir, mode) {
  paths = [...new Set(paths)];
  if (mode === 'move') paths = paths.filter((p) => P.dirname(p) !== destDir);
  const bad = paths.filter((p) => P.isInside(destDir, p));
  if (bad.length) { toast(`Can't ${mode} a folder into itself`, 'error'); paths = paths.filter((p) => !bad.includes(p)); }
  if (!paths.length) return;
  let policy = 'keep';
  const conflicts = await api.conflicts(paths, destDir);
  if (conflicts.length) {
    policy = await conflictDialog(conflicts, mode, destDir);
    if (!policy) return;
  }
  const res = await queueOp({ mode, paths, destDir, policy });
  const n = res.done.length;
  if (n) {
    const entry = { type: mode, pairs: res.done };
    pushUndo(entry);
    const what = n === 1 ? `“${P.basename(res.done[0].to)}”` : plural(n, 'item');
    toast(`${mode === 'move' ? 'Moved' : 'Copied'} ${what} to ${dirLabel(destDir)}`, 'success', { action: { label: 'Undo', fn: () => undo(entry) } });
    recordDest(destDir);
  }
  if (res.cancelled) toast(`${mode === 'move' ? 'Move' : 'Copy'} cancelled${n ? ` — ${plural(n, 'item')} had already finished` : ''}`);
  if (res.errors.length) toast(res.errors.slice(0, 3).join('\n') + (res.errors.length > 3 ? `\n…and ${res.errors.length - 3} more` : ''), 'error', { timeout: 8000 });
  if (mode === 'move') searchForget(res.done.map((d) => d.from));
  await refreshDirs([destDir, ...paths.map(P.dirname)]);
  return res;
}

async function trashPaths(paths) {
  if (!paths.length) return;
  if (S().confirmTrash && !(await confirmDialog({ title: `Move ${paths.length === 1 ? `“${P.basename(paths[0])}”` : plural(paths.length, 'item')} to the Trash?`, items: paths.length > 1 ? paths.map(P.basename) : null, confirm: 'Move to Trash' }))) return;
  const r = await api.trash(paths);
  let left = r.failed || [];
  if (r.count) {
    const moved = paths.filter((p) => !left.includes(p));
    toast(`Moved ${r.count === 1 ? `“${P.basename(moved[0])}”` : plural(r.count, 'item')} to Trash`, 'success');
  }
  // Some drives (typically Windows/NTFS mounts) have no Trash the system will use: offer to delete instead.
  if (left.length) {
    const one = left.length === 1;
    const del = await confirmDialog({
      title: one ? `“${P.basename(left[0])}” can’t be moved to the Trash` : `${plural(left.length, 'item')} can’t be moved to the Trash`,
      body: 'This drive has no Trash the system can use — common on Windows (NTFS) drives. Delete permanently instead? This can’t be undone.',
      items: one ? null : left.map(P.basename),
      confirm: 'Delete permanently',
      danger: true,
    });
    if (del) {
      const d = await api.remove(left);
      if (d.count) toast(`Deleted ${one ? `“${P.basename(left[0])}”` : plural(d.count, 'item')}`, 'success');
      if (d.errors.length) toast(d.errors.join('\n'), 'error', { timeout: 8000 });
      const gone = await Promise.all(left.map((p) => api.stat(p)));
      left = left.filter((p, i) => gone[i].ok);
    }
  }
  searchForget(paths.filter((p) => !left.includes(p)));
  await refreshDirs(paths.map(P.dirname));
}

async function deletePermanently(paths) {
  if (!paths.length) return;
  const ok = await confirmDialog({
    title: `Permanently delete ${paths.length === 1 ? `“${P.basename(paths[0])}”` : plural(paths.length, 'item')}?`,
    body: 'This can’t be undone. The items will not go to the Trash.',
    items: paths.map(P.basename),
    confirm: 'Delete permanently',
    danger: true,
  });
  if (!ok) return;
  const r = await api.remove(paths);
  if (r.count) toast(`Deleted ${plural(r.count, 'item')}`, 'success');
  if (r.errors.length) toast(r.errors.join('\n'), 'error', { timeout: 8000 });
  searchForget(paths);
  await refreshDirs(paths.map(P.dirname));
}

function pushUndo(entry) {
  state.undo.push(entry);
  if (state.undo.length > 50) state.undo.shift();
  updateUndoBtn();
}
function updateUndoBtn() { $('#btn-undo').disabled = !state.undo.length; }

async function undo(entry) {
  if (!entry) entry = state.undo[state.undo.length - 1];
  if (!entry) { toast('Nothing to undo'); return; }
  const i = state.undo.indexOf(entry);
  if (i < 0) return; // already undone
  state.undo.splice(i, 1);
  updateUndoBtn();
  const dirs = [];
  if (entry.type === 'move') {
    const r = await api.undoMove(entry.pairs);
    for (const p of entry.pairs) dirs.push(P.dirname(p.from), P.dirname(p.to));
    if (r.errors.length) toast(r.errors.join('\n'), 'error');
    else toast(`Undid move of ${plural(entry.pairs.length, 'item')}`);
  } else if (entry.type === 'copy' || entry.type === 'create') {
    const r = await api.trash(entry.pairs.map((p) => p.to));
    for (const p of entry.pairs) dirs.push(P.dirname(p.to));
    if (r.errors.length) toast(r.errors.join('\n'), 'error');
    else toast(entry.type === 'copy' ? `Undid copy — ${plural(r.count, 'item')} sent to Trash` : 'Undid create — sent to Trash');
  } else if (entry.type === 'rename') {
    const r = await api.rename(entry.to, P.basename(entry.from));
    dirs.push(P.dirname(entry.from));
    if (!r.ok) toast(r.error, 'error'); else toast(`Renamed back to “${P.basename(entry.from)}”`);
  } else if (entry.type === 'batchRename') {
    const r = await api.batchRename(entry.pairs.map(({ from, to }) => ({ from: to, to: from })));
    for (const p of entry.pairs) dirs.push(P.dirname(p.from));
    if (r.errors.length) toast(r.errors.join('\n'), 'error');
    else toast(`Renamed ${plural(r.done.length, 'item')} back`);
  }
  await refreshDirs(dirs);
}

function setClipboard(mode, paths) {
  if (!paths.length) return;
  state.clipboard = { mode, paths, set: new Set(paths) };
  api.writeFilesClipboard(mode, paths);
  toast(`${mode === 'cut' ? 'Cut' : 'Copied'} ${paths.length === 1 ? `“${P.basename(paths[0])}”` : plural(paths.length, 'item')}`);
  for (const p of state.panes) { renderPane(p); renderSearch(p); }
}

async function paste(destDir) {
  let clip = state.clipboard;
  const sys = await api.readFilesClipboard();
  if (sys && (!clip || sys.paths.join('\n') !== clip.paths.join('\n'))) clip = sys;
  if (!clip) { toast('Clipboard is empty'); return; }
  const mode = clip.mode === 'cut' ? 'move' : 'copy';
  await transfer(clip.paths, destDir, mode);
  if (mode === 'move') {
    state.clipboard = null;
    api.copyText('');
    for (const p of state.panes) renderPane(p);
  }
}

async function createItem(kind, dir) {
  const r = kind === 'folder' ? await api.mkdir(dir, 'New folder') : await api.newFile(dir, 'New file.txt');
  if (!r.ok) { toast(r.error, 'error'); return; }
  pushUndo({ type: 'create', pairs: [{ to: r.path }] });
  await selectAndRename(dir, r.path);
}
// Select a freshly created item in the active pane and start renaming it.
async function selectAndRename(dir, path, rename = true) {
  await refreshDir(dir);
  const pane = activePane();
  const tab = tabOf(pane);
  const k = tab.columns.findIndex((c) => c.path === dir);
  if (k < 0) return;
  const col = tab.columns[k];
  col.sel = new Set([path]);
  col.cursor = col.anchor = path;
  tab.columns.length = k + 1;
  tab.token++;
  tab.focusCol = k;
  syncPath(tab);
  renderPane(pane);
  ensureCursorVisible(pane);
  if (rename) startRename(pane, path);
}

async function newFolderWithSelection(col, paths) {
  if (!paths.length) return;
  const r = await api.mkdir(col.path, 'New folder');
  if (!r.ok) { toast(r.error, 'error'); return; }
  pushUndo({ type: 'create', pairs: [{ to: r.path }] });
  await transfer(paths, r.path, 'move');
  await selectAndRename(col.path, r.path);
}

async function makeLinks(paths, destDir, kind) {
  if (!paths.length) return;
  const r = await api.link(paths, destDir, kind);
  if (r.done.length) {
    const entry = { type: 'create', pairs: r.done.map((d) => ({ to: d.to })) };
    pushUndo(entry);
    toast(`Created ${plural(r.done.length, kind === 'hard' ? 'hard link' : 'link')} in ${dirLabel(destDir)}`, 'success', { action: { label: 'Undo', fn: () => undo(entry) } });
  }
  if (r.errors.length) toast(r.errors.join('\n'), 'error', { timeout: 8000 });
  await refreshDir(destDir);
}

async function createFromTemplate(tpl, dir) {
  const r = await api.fromTemplate(tpl, dir);
  if (!r.ok) { toast(r.error, 'error'); return; }
  pushUndo({ type: 'create', pairs: [{ to: r.path }] });
  await selectAndRename(dir, r.path);
}
async function saveAsTemplate(p) {
  const r = await api.saveTemplate(p);
  if (r.ok) toast(`Saved “${P.basename(r.path)}” as a template`, 'success', { action: { label: 'Show', fn: () => locate(r.path) } });
  else toast(r.error, 'error');
}

/* "Open with": applications that declare the file's MIME type, then everything else. */
async function openWithDialog(p) {
  const r = await api.apps(p);
  const list = [
    ...r.apps.map((a) => ({ ...a, rec: true })).sort((a, b) => (b.id === r.defaultId) - (a.id === r.defaultId)),
    ...r.others,
  ];
  let selIdx = list.length ? 0 : -1;
  const rows = (f) => {
    const q = f.toLowerCase();
    let html = '', section = null;
    list.forEach((a, i) => {
      if (q && !a.name.toLowerCase().includes(q)) return;
      const sec = a.rec ? 'Suggested' : 'Other applications';
      if (sec !== section) { html += `<div class="ow-sec">${sec}</div>`; section = sec; }
      html += `<div class="ow-item ${i === selIdx ? 'on' : ''}" data-i="${i}">${line('appWindow')}<span>${esc(a.name)}</span>${a.id === r.defaultId ? '<em>default</em>' : ''}</div>`;
    });
    return html || '<div class="br-more">No applications found</div>';
  };
  const choice = await dialog({
    title: `Open “${P.basename(p)}” with`,
    html: `<div class="ow-mime">${esc(r.mime || 'Unknown type')}</div>
      <div class="filter arc-filter">${line('search')}<input placeholder="Find an application" spellcheck="false"></div>
      <div class="ow-list">${rows('')}</div>
      <label class="ow-def"><input type="checkbox" data-k="def" ${r.mime ? '' : 'disabled'}> Always use this application for ${esc(r.mime || 'this type')}</label>
      <div class="m-actions"><button class="btn" data-cancel>Cancel</button><button class="btn primary" data-submit ${selIdx < 0 ? 'disabled' : ''}>Open</button></div>`,
    cls: 'ow',
    setup: (root, close) => {
      const input = $('.arc-filter input', root);
      const listEl = $('.ow-list', root);
      const redraw = () => { listEl.innerHTML = rows(input.value.trim()); listEl.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); };
      input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        selIdx = list.findIndex((a) => !q || a.name.toLowerCase().includes(q));
        $('[data-submit]', root).disabled = selIdx < 0;
        redraw();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const vis = [...listEl.querySelectorAll('[data-i]')].map((el) => +el.dataset.i);
        const at = vis.indexOf(selIdx);
        selIdx = vis[Math.max(0, Math.min(vis.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))] ?? selIdx;
        redraw();
      });
      listEl.addEventListener('click', (e) => {
        const it = e.target.closest('[data-i]');
        if (!it) return;
        if (e.detail === 2) close({ app: list[+it.dataset.i], makeDefault: $('[data-k="def"]', root).checked });
        else { selIdx = +it.dataset.i; redraw(); }
      });
      input.focus();
    },
    submit: (root) => (selIdx >= 0 ? { app: list[selIdx], makeDefault: $('[data-k="def"]', root).checked } : undefined),
  });
  if (!choice) return;
  const res = await api.openWith(p, choice.app, r.mime, choice.makeDefault);
  if (!res.ok) toast(`Couldn't open with ${choice.app.name} — ${res.error}`, 'error', { timeout: 8000 });
  else if (choice.makeDefault) toast(`${choice.app.name} is now the default for ${r.mime}`);
}

function startRename(pane, path) {
  const tab = tabOf(pane);
  const k = tab.focusCol;
  const scope = colEl(pane, k);
  const row = scope && scope.querySelector(`.row[data-path="${CSS.escape(path)}"]`);
  if (!row) return;
  row.scrollIntoView({ block: 'nearest' });
  const nameEl = $('.r-name', row);
  const old = P.basename(path);
  const input = document.createElement('input');
  input.className = 'rename-input';
  input.value = old;
  input.spellcheck = false;
  nameEl.replaceWith(input);
  row.classList.add('renaming');
  row.draggable = false;
  pane.renaming = true;
  input.focus();
  const dot = old.lastIndexOf('.');
  input.setSelectionRange(0, dot > 0 && !tab.columns[k].map.get(path)?.isDir ? dot : old.length);
  let finished = false;
  const finish = async (commit) => {
    if (finished) return;
    finished = true;
    pane.renaming = false;
    const name = input.value.trim();
    if (!commit || !name || name === old) { renderPane(pane); return; }
    const r = await api.rename(path, name);
    if (!r.ok) { toast(r.error, 'error'); renderPane(pane); return; }
    pushUndo({ type: 'rename', from: path, to: r.path });
    const dir = P.dirname(path);
    await refreshDir(dir);
    const col = tab.columns.find((c) => c.path === dir);
    if (col) selectEntry(pane, tab, tab.columns.indexOf(col), r.path);
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  for (const ev of ['mousedown', 'click', 'dblclick']) input.addEventListener(ev, (e) => e.stopPropagation());
}

function toOtherPane(mode) {
  if (!state.dual) { toast('Turn on dual pane (Ctrl+D) to send items to the other pane'); return; }
  const paths = selectedPaths();
  if (!paths.length) return;
  transfer(paths, currentDir(tabOf(otherPane())), mode);
}

function copyPaths(paths) {
  api.copyText(paths.join('\n'));
  toast(paths.length === 1 ? 'Path copied' : `${plural(paths.length, 'path')} copied`);
}

/* =========================================================
 * Tabs, view, toggles
 * ======================================================= */
async function addTab(pane, path, activate = true) {
  const t = newTab(path || currentDir(tabOf(pane)), tabOf(pane)?.view || 'columns', tabOf(pane)?.sort);
  pane.tabs.push(t);
  if (activate) pane.activeTab = pane.tabs.length - 1;
  renderPane(pane);
  await navigate(pane, t, t.path, { push: false });
}
// Closed tabs are remembered per pane so Ctrl+Shift+T can bring them back.
function rememberClosed(pane, tab, index) {
  pane.closed.push({ path: tab.path, view: tab.view, sort: tab.sort, history: tab.history, hIndex: tab.hIndex, index });
  if (pane.closed.length > 25) pane.closed.shift();
}
function closeTab(pane, i) {
  if (pane.tabs.length <= 1) return;
  rememberClosed(pane, pane.tabs[i], i);
  pane.tabs.splice(i, 1);
  if (pane.activeTab >= pane.tabs.length) pane.activeTab = pane.tabs.length - 1;
  else if (i < pane.activeTab) pane.activeTab--;
  activateTab(pane, pane.activeTab);
}
function closeOtherTabs(pane, keep) {
  if (pane.tabs.length <= 1) return;
  pane.tabs.forEach((t, i) => { if (i !== keep) rememberClosed(pane, t, i); });
  pane.tabs = [pane.tabs[keep]];
  activateTab(pane, 0);
}
function closeTabsRight(pane, i) {
  const gone = pane.tabs.splice(i + 1);
  gone.forEach((t, j) => rememberClosed(pane, t, i + 1 + j));
  activateTab(pane, Math.min(pane.activeTab, i));
}
async function reopenTab(pane) {
  const c = pane.closed.pop();
  if (!c) { toast('No recently closed tabs'); return; }
  const t = newTab(c.path, c.view, c.sort);
  t.history = c.history;
  t.hIndex = c.hIndex;
  const at = Math.min(c.index, pane.tabs.length);
  pane.tabs.splice(at, 0, t);
  pane.activeTab = at;
  renderPane(pane);
  if (!(await navigate(pane, t, c.path, { push: false }))) await navigate(pane, t, HOME, { push: false });
}
function tabMenu(x, y, pane, i) {
  const t = pane.tabs[i];
  const many = pane.tabs.length > 1;
  showMenu(x, y, [
    { label: 'New tab', icon: 'tab', key: kb('newTab'), act: () => addTab(pane) },
    { label: 'Duplicate tab', icon: 'duplicate', act: () => addTab(pane, t.path) },
    { label: 'Rename tab…', icon: 'rename', key: kb('renameTab'), act: () => renameTab(pane, i) },
    ...(state.dual ? [{ label: 'Open in other pane', icon: 'moveRight', act: () => addTab(otherPane(), t.path) }] : []),
    '-',
    { label: 'Close tab', icon: 'x', key: kb('closeTab'), disabled: !many, act: () => closeTab(pane, i) },
    { label: 'Close other tabs', icon: 'x', disabled: !many, act: () => closeOtherTabs(pane, i) },
    { label: 'Close tabs to the right', icon: 'x', disabled: i === pane.tabs.length - 1, act: () => closeTabsRight(pane, i) },
    { label: 'Reopen closed tab', icon: 'undoTab', key: kb('reopenTab'), disabled: !pane.closed.length, act: () => reopenTab(pane) },
    { label: 'Close tabs unused for an hour', icon: 'x', key: kb('closeStale'), act: () => closeStaleTabs(pane) },
    { label: 'New tab from clipboard path', icon: 'clipboard', key: kb('pasteTab'), act: pasteTab },
    '-',
    { label: 'Copy folder path', icon: 'link', act: () => copyPaths([t.path]) },
    { label: 'Add to Favorites', icon: 'star', act: () => addFavorites([t.path]) },
  ]);
}
function activateTab(pane, i) {
  pane.activeTab = i;
  const tab = tabOf(pane);
  tab.lastUsed = Date.now();
  if (!tab.loaded) navigate(pane, tab, tab.path, { push: false });
  renderPane(pane);
  scrollParentsToEnd(pane);
  updateWatch();
  updatePreview();
  renderSidebarCurrent();
  saveState();
}
function setView(pane, view) {
  const tab = tabOf(pane);
  if (tab.view === view) return;
  const col = tab.columns[tab.focusCol];
  const sel = col && col.sel.size === 1 ? [...col.sel][0] : null;
  const dir = col ? col.path : currentDir(tab);
  tab.view = view;
  navigate(pane, tab, dir, { push: false, select: sel, openSelected: false });
}
function toggleHidden() {
  state.showHidden = !state.showHidden;
  syncToggles();
  for (const p of state.panes) renderPane(p);
  saveState();
}
function toggleDual() {
  state.dual = !state.dual;
  if (!state.dual) state.active = 0;
  syncToggles();
  applySplit();
  const p1 = state.panes[1];
  if (state.dual && !tabOf(p1).loaded) navigate(p1, tabOf(p1), tabOf(p1).path, { push: false });
  for (const p of state.panes) renderPane(p);
  updateWatch();
  updatePreview(true);
  saveState();
}
function toggleInfo() {
  state.info = !state.info;
  syncToggles();
  for (const p of state.panes) if (p.statusEl) renderHeadInfo(p);
  updatePreview(true);
  saveState();
}
function setTheme(i) {
  state.theme = ((i % THEMES.length) + THEMES.length) % THEMES.length;
  document.documentElement.dataset.theme = THEMES[state.theme][0];
  $('#btn-theme').title = `Theme: ${THEMES[state.theme][1]} (click to change)`;
  saveState();
}
function syncToggles() {
  $('#btn-hidden').classList.toggle('on', state.showHidden);
  $('#btn-dual').classList.toggle('on', state.dual);
  $('#btn-preview').classList.toggle('on', state.info);
  $('#panes').classList.toggle('single', !state.dual);
  document.body.classList.toggle('no-info', !state.info);
}
function applySplit() {
  // A lone pane must take all the space: a flex-grow below 1 would leave part of it empty.
  state.panes[0].el.style.flex = state.dual ? `${state.split} 1 0` : '1 1 0';
  state.panes[1].el.style.flex = `${1 - state.split} 1 0`;
}

/* =========================================================
 * Pane events
 * ======================================================= */
function colIndexFrom(el, tab) {
  const c = el.closest('[data-col]');
  return c ? +c.dataset.col : tab.columns.length - 1;
}

function bindPane(pane) {
  pane.el.addEventListener('mousedown', () => lightActivate(pane.index));

  pane.el.querySelector('.addr [data-act="menu"]').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    paneMenu(r.left, r.bottom + 2, pane);
  });

  pane.el.querySelector('.cur-bar').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const tab = tabOf(pane);
    if (b.dataset.act === 'back') goHistory(pane, -1);
    else if (b.dataset.act === 'forward') goHistory(pane, 1);
    else if (b.dataset.act === 'up') goUp(pane);
    else if (b.dataset.act === 'newfolder') createItem('folder', currentDir(tab));
    else if (b.dataset.act === 'refresh') refreshDirs(tab.columns.map((c) => c.path));
    else if (b.dataset.view) setView(pane, b.dataset.view);
  });
  pane.el.querySelector('.cur-tools').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    const tab = tabOf(pane);
    if (b?.dataset.act === 'refresh') refreshDirs(tab.columns.map((c) => c.path));
    else if (b?.dataset.act === 'terminal') openTerminal(currentDir(tab));
    else if (b?.dataset.act === 'search') openSearch(pane);
    else if (b?.dataset.act === 'type') {
      const r = b.getBoundingClientRect();
      showMenu(r.left, r.bottom + 2, TYPE_FILTERS.map(([k, label]) => ({
        label: `${label}${tab.typeFilter === k ? '  ●' : ''}`, icon: k ? 'funnel' : 'selectAll',
        act: () => { tab.typeFilter = k; tab.focusCol = tab.columns.length - 1; renderPane(pane); updatePreview(); },
      })));
    }
  });
  pane.el.querySelector('.addr [data-act="dual"]').addEventListener('click', toggleDual);
  pane.statusEl.querySelector('.ps-toggle').addEventListener('click', toggleInfo);

  pane.crumbsEl.addEventListener('click', (e) => {
    const c = e.target.closest('[data-crumb]');
    if (c) navigate(pane, tabOf(pane), c.dataset.crumb);
    else if (!e.target.closest('input')) editPath(pane);
  });

  pane.filterEl.addEventListener('input', () => {
    const tab = tabOf(pane);
    tab.filter = pane.filterEl.value;
    tab.focusCol = tab.columns.length - 1;
    renderBody(pane);
    updatePreview();
  });
  pane.filterEl.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { pane.filterEl.value = ''; pane.filterEl.dispatchEvent(new Event('input')); pane.filterEl.blur(); }
    else if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      pane.filterEl.blur();
      const tab = tabOf(pane);
      const k = tab.columns.length - 1;
      const first = visible(tab, tab.columns[k])[0];
      if (first) selectEntry(pane, tab, k, first.path);
    }
  });

  pane.tabsEl.addEventListener('click', (e) => {
    const close = e.target.closest('[data-close]');
    if (close) { closeTab(pane, +close.dataset.close); return; }
    if (e.target.closest('.tab-add')) { addTab(pane); return; }
    const t = e.target.closest('[data-tab]');
    // Clicks re-render the tabs, so Chromium never fires dblclick on them; use the click count.
    if (t && e.detail === 2) renameTab(pane, +t.dataset.tab);
    else if (t) activateTab(pane, +t.dataset.tab);
  });
  pane.tabsEl.addEventListener('auxclick', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t && e.button === 1) closeTab(pane, +t.dataset.tab);
  });
  pane.tabsEl.addEventListener('dblclick', (e) => { if (!e.target.closest('.tab')) addTab(pane); });
  // Ctrl + wheel resizes thumbnails.
  pane.listEl.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey) || tabOf(pane).view !== 'grid') return;
    e.preventDefault();
    S().gridSize = Math.max(72, Math.min(240, S().gridSize + (e.deltaY < 0 ? 12 : -12)));
    for (const p of visiblePanes()) $('.list-body.grid', p.listEl)?.style.setProperty('--tile', `${S().gridSize}px`);
    saveState();
  }, { passive: false });
  pane.tabsEl.addEventListener('contextmenu', (e) => {
    const t = e.target.closest('[data-tab]');
    if (!t) return;
    e.preventDefault();
    tabMenu(e.clientX, e.clientY, pane, +t.dataset.tab);
  });

  pane.infoEl.addEventListener('click', (e) => {
    const map = e.target.closest('[data-map]');
    if (map) { e.preventDefault(); const [lat, lon] = map.dataset.map.split(','); api.openMap(+lat, +lon); return; }
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const tab = tabOf(pane);
    const paths = selectedPaths();
    switch (b.dataset.a) {
      case 'cut': setClipboard('cut', paths); break;
      case 'copy': setClipboard('copy', paths); break;
      case 'paste': paste(currentDir(tab)); break;
      case 'rename': if (paths.length === 1) startRename(pane, paths[0]); break;
      case 'copypath': copyPaths(paths.length ? paths : [currentDir(tab)]); break;
      case 'trash': trashPaths(paths); break;
    }
  });

  const body = pane.bodyEl;
  body.addEventListener('click', (e) => {
    if (e.target.closest('.rename-input') || e.target.closest('.cur-bar') || e.target.closest('.cur-title')) return;
    const tab = tabOf(pane);
    if (e.target.closest('[data-note]')) { editNote(currentDir(tab)); return; }
    const sortH = e.target.closest('[data-sort]');
    if (sortH) { setSort(pane, tab, sortH.dataset.sort); return; }
    if (e.target.closest('.list-head')) return;
    const row = e.target.closest('.row[data-path]');
    const k = colIndexFrom(e.target, tab);
    if (!row) {
      const col = tab.columns[k];
      if (!col) return;
      tab.focusCol = k;
      col.sel.clear();
      col.cursor = null;
      if (tab.view === 'columns') { tab.columns.length = k + 1; tab.token++; }
      syncPath(tab);
      renderPane(pane);
      updatePreview();
      renderSidebarCurrent();
      return;
    }
    const mods = { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey };
    // The first click re-renders the list, so Chromium never fires dblclick on the row;
    // treat the second click of a double-click as "open". Open what the first click hit:
    // in columns view the list shifts between the clicks.
    if (e.detail === 2 && !mods.ctrl && !mods.shift && pane.firstClick) {
      const { path, isDir } = pane.firstClick;
      pane.firstClick = null;
      if (isDir) navigate(pane, tab, path); else openFile(path);
      return;
    }
    pane.firstClick = { path: row.dataset.path, isDir: !!tab.columns[k]?.map.get(row.dataset.path)?.isDir };
    selectEntry(pane, tab, k, row.dataset.path, { ...mods, focusChild: !mods.ctrl && !mods.shift });
  });
  body.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    setActivePane(pane.index);
    const tab = tabOf(pane);
    const k = colIndexFrom(e.target, tab);
    const col = tab.columns[k];
    if (!col) return;
    const row = e.target.closest('.row[data-path]');
    if (row) {
      const p = row.dataset.path;
      if (!col.sel.has(p)) selectEntry(pane, tab, k, p);
      else { tab.focusCol = k; renderPane(pane); }
      itemMenu(e.clientX, e.clientY, pane, tab, tab.columns[k]);
    } else {
      backgroundMenu(e.clientX, e.clientY, pane, tab, col.path);
    }
  });
}

/* =========================================================
 * Context menus
 * ======================================================= */
const menuEl = $('#ctxmenu');
// Menu items are '-' separators, { label, icon, key, act, disabled, danger },
// or { swatches: true, current, act(tagIndex) } for the colour-tag row.
function swatchRow(it, i) {
  const sw = TAGS.slice(1).map(([name, c], j) => `<button class="sw ${it.current === j + 1 ? 'on' : ''}" data-sw="${j + 1}" title="${name} (Alt+${j + 1})" style="--tag:${c}"></button>`).join('');
  return `<div class="mi-swatches" data-i="${i}"><span class="mi-sw-label">Tag</span>${sw}<button class="sw none" data-sw="0" title="Remove tag (Alt+0)">${line('x')}</button></div>`;
}
function showMenu(x, y, items) {
  menuEl.innerHTML = items.map((it, i) => it === '-' ? '<div class="msep"></div>' : it.swatches ? swatchRow(it, i) :
    `<div class="mi ${it.danger ? 'danger' : ''} ${it.disabled ? 'disabled' : ''}" data-i="${i}">${line(it.icon || '')}<span class="mi-label">${esc(it.label)}</span>${it.key ? `<span class="mi-key">${it.key}</span>` : ''}</div>`).join('');
  menuEl.hidden = false;
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.min(x, innerWidth - r.width - 6) + 'px';
  menuEl.style.top = Math.max(6, Math.min(y, innerHeight - r.height - 6)) + 'px';
  menuEl.onclick = (e) => {
    const mi = e.target.closest('[data-i]');
    if (!mi) return;
    const it = items[+mi.dataset.i];
    const sw = e.target.closest('[data-sw]');
    if (it.swatches && !sw) return;
    hideMenu();
    if (it.swatches) it.act(+sw.dataset.sw); else it.act();
  };
}
function hideMenu() { menuEl.hidden = true; }
document.addEventListener('mousedown', (e) => { if (!menuEl.hidden && !menuEl.contains(e.target)) hideMenu(); }, true);
window.addEventListener('blur', hideMenu);

function itemMenu(x, y, pane, tab, col) {
  const paths = orderedSel(tab, col);
  const single = paths.length === 1 ? col.map.get(paths[0]) : null;
  const dirs = paths.filter((p) => col.map.get(p)?.isDir);
  const items = [];
  if (single?.isDir) {
    items.push({ label: 'Open', icon: 'open', key: 'Enter', act: () => navigate(pane, tab, single.path) });
    items.push({ label: 'Open in new tab', icon: 'tab', act: () => addTab(pane, single.path) });
    if (state.dual) items.push({ label: 'Open in other pane', icon: 'moveRight', act: () => navigate(otherPane(), tabOf(otherPane()), single.path) });
    items.push({ label: 'Open in terminal', icon: 'terminal', act: () => openTerminal(single.path) });
  } else {
    items.push({ label: paths.length > 1 ? `Open ${paths.length} items` : 'Open', icon: 'open', key: 'Enter', act: () => paths.slice(0, 12).forEach(openFile) });
    if (single) items.push({ label: 'Open with…', icon: 'appWindow', key: kb('openWith'), act: () => openWithDialog(single.path) });
    items.push(...runItems(single));
  }
  items.push({ label: 'Quick Look', icon: 'quicklook', key: kb('quickLook'), act: () => quickLook() });
  if (dirs.length) items.push({ label: 'Add to Favorites', icon: 'star', act: () => addFavorites(dirs) });
  items.push('-');
  items.push({ label: 'Cut', icon: 'cut', key: kb('cut'), act: () => setClipboard('cut', paths) });
  items.push({ label: 'Copy', icon: 'copy', key: kb('copy'), act: () => setClipboard('copy', paths) });
  if (single?.isDir) items.push({ label: 'Paste into folder', icon: 'paste', act: () => paste(single.path) });
  items.push({ label: 'Duplicate', icon: 'duplicate', key: kb('duplicate'), act: () => transfer(paths, col.path, 'copy') });
  items.push({ label: 'Copy to…', icon: 'copy', key: kb('copyTo'), act: () => copyToDialog(paths, 'copy') });
  items.push({ label: 'Move to…', icon: 'moveRight', key: kb('moveTo'), act: () => copyToDialog(paths, 'move') });
  items.push({ label: 'Add to Drop List', icon: 'tray', key: kb('dropList'), act: () => addToDropList(selectionItems(paths, (p) => col.map.get(p))) });
  if (state.dual) {
    items.push({ label: 'Move to other pane', icon: 'moveRight', key: kb('moveOther'), act: () => toOtherPane('move') });
    items.push({ label: 'Copy to other pane', icon: 'copy', key: kb('copyOther'), act: () => toOtherPane('copy') });
  }
  items.push('-');
  items.push(...archiveItems(paths, col.path, (p) => col.map.get(p)));
  items.push({ label: 'New folder with selection', icon: 'folderIn', key: kb('newFolderFromSel'), act: () => newFolderWithSelection(col, paths) });
  items.push({ label: paths.length > 1 ? 'Create symbolic links' : 'Create symbolic link', icon: 'symlink', key: kb('symlink'), act: () => makeLinks(paths, col.path, 'sym') });
  if (!dirs.length) items.push({ label: paths.length > 1 ? 'Create hard links' : 'Create hard link', icon: 'symlink', act: () => makeLinks(paths, col.path, 'hard') });
  if (single && !single.isDir) items.push({ label: 'Save as template', icon: 'template', act: () => saveAsTemplate(single.path) });
  if (paths.some((p) => IMG_RE.test(p))) items.push({ label: 'Convert / resize images…', icon: 'image', key: kb('images'), act: () => batchImages(paths, col.path) });
  if (single && IMG_RE.test(single.name)) items.push({ label: 'Use as folder background', icon: 'image', act: () => setFolderBg(col.path, single.path) });
  items.push('-', ...scriptItems(paths, col.path));
  items.push('-');
  items.push({ label: 'Rename', icon: 'rename', key: kb('rename'), disabled: !single, act: () => startRename(pane, single.path) });
  items.push({ label: 'Batch rename…', icon: 'rename', key: kb('batchRename'), act: () => openBatchRename(col, paths) });
  items.push({ label: 'Copy path', icon: 'link', key: kb('copyPath'), act: () => copyPaths(paths) });
  items.push({ label: 'Show in system file manager', icon: 'reveal', act: () => api.reveal(paths[0]) });
  items.push(tagItem(paths));
  items.push('-');
  items.push({ label: 'Move to Trash', icon: 'trash', key: kb('trash'), danger: true, act: () => trashPaths(paths) });
  items.push({ label: 'Delete permanently', icon: 'x', key: kb('deletePerm'), danger: true, act: () => deletePermanently(paths) });
  showMenu(x, y, items);
}

function tagItem(paths) {
  const t = tagOf(paths[0]);
  return { swatches: true, current: paths.every((p) => tagOf(p) === t) ? t : 0, act: (i) => setTag(paths, i) };
}
function archiveItems(paths, dir, get) {
  const items = [];
  const archives = paths.filter((p) => isArchive(get(p)));
  if (archives.length) {
    items.push({ label: 'Extract here', icon: 'unarchive', act: () => extractArchives(archives, dir, 'here') });
    items.push({ label: archives.length === 1 ? `Extract to “${archiveBase(P.basename(archives[0]))}/”` : 'Extract each to its own folder', icon: 'unarchive', act: () => extractArchives(archives, dir, 'folder') });
    if (archives.length === 1 && paths.length === 1) items.push({ label: 'Browse archive…', icon: 'search', act: () => browseArchive(archives[0], dir) });
  }
  items.push({ label: `Compress to “${archiveName(paths, dir)}.zip”`, icon: 'archive', act: () => compress(paths, dir, true) });
  items.push({ label: 'Compress…', icon: 'archive', act: () => compress(paths, dir, false) });
  return items;
}
function sortItems(pane, tab) {
  return SORTS.map(([key, label]) => ({
    label: `Sort by ${label.toLowerCase()}${tab.sort.key === key ? (tab.sort.dir > 0 ? '  ▴' : '  ▾') : ''}`,
    icon: key === 'tag' ? 'star' : 'sort',
    act: () => setSort(pane, tab, key),
  }));
}
function setSort(pane, tab, key) {
  tab.sort = tab.sort.key === key ? { key, dir: -tab.sort.dir } : { key, dir: key === 'mtime' || key === 'size' ? -1 : 1 };
  renderBody(pane);
  saveState();
}

async function backgroundMenu(x, y, pane, tab, dir) {
  const tpl = await api.templates();
  showMenu(x, y, [
    { label: 'New folder', icon: 'folderPlus', key: kb('newFolder'), act: () => createItem('folder', dir) },
    { label: 'New text file', icon: 'filePlus', key: kb('newFile'), act: () => createItem('file', dir) },
    ...tpl.items.slice(0, 12).map((t) => ({ label: `New ${P.basename(t)}`, icon: 'template', act: () => createFromTemplate(t, dir) })),
    { label: tpl.items.length ? 'Edit templates…' : 'Add templates…', icon: 'template', act: () => navigate(pane, tab, tpl.dir).then((ok) => { if (!ok) toast(`Create ${P.display(tpl.dir)} and put files in it to use them as templates`); }) },
    '-',
    { label: 'Paste', icon: 'paste', key: kb('paste'), act: () => paste(dir) },
    { label: 'Select all', icon: 'selectAll', key: kb('selectAll'), act: () => selectAll(pane, tab, tab.columns.findIndex((c) => c.path === dir)) },
    '-',
    { label: 'Search in this folder…', icon: 'searchFolder', key: kb('search'), act: () => openSearch(pane, dir) },
    { label: state.showHidden ? 'Hide hidden files' : 'Show hidden files', icon: 'eye', key: kb('toggleHidden'), act: toggleHidden },
    { label: 'Refresh', icon: 'refresh', key: kb('refresh'), act: () => refreshDir(dir) },
    '-',
    { label: state.notes[dir] ? 'Edit folder note…' : 'Add folder note…', icon: 'note', key: kb('note'), act: () => editNote(dir) },
    ...(state.folderBg[dir] ? [{ label: 'Remove folder background', icon: 'image', act: () => setFolderBg(dir, null) }] : []),
    { label: 'File Automator…', icon: 'wand', key: kb('automator'), act: () => fileAutomator(dir, tab.columns.find((c) => c.path === dir)?.entries || []) },
    ...scriptItems([], dir),
    '-',
    ...sortItems(pane, tab),
    '-',
    { label: 'Add to Favorites', icon: 'star', key: kb('addFavorite'), act: () => addFavorites([dir]) },
    { label: 'Open in terminal', icon: 'terminal', act: () => openTerminal(dir) },
    { label: 'Copy folder path', icon: 'link', act: () => copyPaths([dir]) },
    { label: 'Open in new tab', icon: 'tab', act: () => addTab(pane, dir) },
  ]);
}

function paneMenu(x, y, pane) {
  const tab = tabOf(pane);
  const dir = currentDir(tab);
  const views = [['columns', 'Columns view', 'viewColumns'], ['details', 'List view', 'viewList'], ['grid', 'Thumbnail view', 'viewGrid']];
  showMenu(x, y, [
    { label: 'New tab', icon: 'tab', key: kb('newTab'), act: () => addTab(pane) },
    { label: 'Reopen closed tab', icon: 'undoTab', key: kb('reopenTab'), disabled: !pane.closed.length, act: () => reopenTab(pane) },
    { label: 'Rename tab…', icon: 'rename', key: kb('renameTab'), act: () => renameTab(pane, pane.activeTab) },
    { label: 'New tab from clipboard path', icon: 'clipboard', key: kb('pasteTab'), act: pasteTab },
    { label: 'Close tabs unused for an hour', icon: 'x', key: kb('closeStale'), act: () => closeStaleTabs(pane) },
    '-',
    { label: 'New window', icon: 'window', key: kb('newWindow'), act: () => api.newWindow({ path: dir }) },
    { label: 'Saved windows…', icon: 'window', act: savedWindowsDialog },
    { label: 'Save this window…', icon: 'window', act: saveWindowLayout },
    '-',
    ...views.map(([v, label, id]) => ({ label: `${label}${tab.view === v ? '  ●' : ''}`, icon: v === 'grid' ? 'grid' : v, key: kb(id), act: () => setView(pane, v) })),
    { label: state.showHidden ? 'Hide hidden files' : 'Show hidden files', icon: 'eye', key: kb('toggleHidden'), act: toggleHidden },
    { label: 'Search in this folder…', icon: 'searchFolder', key: kb('search'), act: () => openSearch(pane) },
    { label: 'Choose columns…', icon: 'columns', act: chooseColumns },
    { label: S().layout === 'stacked' ? 'Panes side by side' : 'Panes above each other', icon: 'dual', act: () => { S().layout = S().layout === 'stacked' ? 'side' : 'stacked'; settingsChanged(); applySplit(); } },
    '-',
    ...sortItems(pane, tab),
    '-',
    { label: 'Add to Favorites', icon: 'star', key: kb('addFavorite'), act: () => addFavorites([dir]) },
    { label: 'Open in terminal', icon: 'terminal', act: () => openTerminal(dir) },
    { label: 'Copy folder path', icon: 'link', act: () => copyPaths([dir]) },
    { label: 'Show in system file manager', icon: 'reveal', act: () => api.open(dir) },
    { label: 'Connect to server…', icon: 'network', key: kb('connect'), act: connectDialog },
    '-',
    { label: 'Settings…', icon: 'settings', key: kb('settings'), act: openSettings },
  ]);
}

async function openTerminal(dir) {
  const r = await api.terminal(dir);
  if (!r.ok) toast(r.error, 'error');
}

function selectAll(pane, tab, k) {
  if (k < 0) k = tab.focusCol;
  const col = tab.columns[k];
  if (!col) return;
  col.sel = new Set(visible(tab, col).map((e) => e.path));
  tab.focusCol = k;
  if (tab.view === 'columns') { tab.columns.length = k + 1; tab.token++; }
  syncPath(tab);
  renderPane(pane);
  updatePreview();
}

/* =========================================================
 * Keyboard
 * ======================================================= */
let typeBuf = '', typeT = 0;

function moveCursor(pane, tab, to, shift) {
  const k = tab.focusCol;
  const col = tab.columns[k];
  if (!col) return;
  const vis = visible(tab, col);
  if (!vis.length) return;
  let idx = vis.findIndex((e) => e.path === col.cursor);
  if (typeof to === 'number') idx = idx < 0 ? (to > 0 ? 0 : vis.length - 1) : Math.max(0, Math.min(vis.length - 1, idx + to));
  else if (to === 'home') idx = 0;
  else if (to === 'end') idx = vis.length - 1;
  selectEntry(pane, tab, k, vis[idx].path, { shift, delay: 90 });
}

/* Rebindable commands (Settings → Keyboard). Plain navigation keys — arrows, Enter,
 * Escape, Home/End, PageUp/Down, type-ahead — and Alt+0…7 tags stay fixed. */
const sel = () => selectedPaths();
const ACTIONS = [
  { id: 'newTab', label: 'New tab', keys: ['Ctrl+T'], run: ({ pane }) => addTab(pane) },
  { id: 'closeTab', label: 'Close tab', keys: ['Ctrl+W'], run: ({ pane }) => closeTab(pane, pane.activeTab) },
  { id: 'reopenTab', label: 'Reopen closed tab', keys: ['Ctrl+Shift+T'], run: ({ pane }) => reopenTab(pane) },
  { id: 'nextTab', label: 'Next tab', keys: ['Ctrl+Tab'], run: ({ pane }) => activateTab(pane, (pane.activeTab + 1) % pane.tabs.length) },
  { id: 'prevTab', label: 'Previous tab', keys: ['Ctrl+Shift+Tab'], run: ({ pane }) => activateTab(pane, (pane.activeTab - 1 + pane.tabs.length) % pane.tabs.length) },
  { id: 'renameTab', label: 'Rename tab', keys: [], run: ({ pane }) => renameTab(pane, pane.activeTab) },
  { id: 'otherPane', label: 'Switch to the other pane', keys: ['Tab'], run: () => { if (state.dual) setActivePane(state.active === 0 ? 1 : 0); } },
  { id: 'editPath', label: 'Type a path', keys: ['Ctrl+L'], run: ({ pane }) => editPath(pane) },
  { id: 'filter', label: 'Filter this folder', keys: ['Ctrl+F'], run: ({ pane }) => { pane.filterEl.focus(); pane.filterEl.select(); } },
  { id: 'search', label: 'Search in this folder', keys: ['Ctrl+Shift+F'], run: ({ pane }) => openSearch(pane) },
  { id: 'back', label: 'Back', keys: ['Alt+Left'], run: ({ pane }) => goHistory(pane, -1) },
  { id: 'forward', label: 'Forward', keys: ['Alt+Right'], run: ({ pane }) => goHistory(pane, 1) },
  { id: 'up', label: 'Up one level', keys: ['Alt+Up', 'Backspace'], run: ({ pane }) => goUp(pane) },
  { id: 'refresh', label: 'Refresh', keys: ['F5', 'Ctrl+R'], run: ({ tab }) => { refreshDirs(tab.columns.map((c) => c.path)); loadPlaces(); } },
  { id: 'viewColumns', label: 'Columns view', keys: ['Ctrl+1'], run: ({ pane }) => setView(pane, 'columns') },
  { id: 'viewList', label: 'List view', keys: ['Ctrl+2'], run: ({ pane }) => setView(pane, 'details') },
  { id: 'viewGrid', label: 'Thumbnail view', keys: ['Ctrl+3'], run: ({ pane }) => setView(pane, 'grid') },
  { id: 'toggleHidden', label: 'Show / hide hidden files', keys: ['Ctrl+H'], run: () => toggleHidden() },
  { id: 'toggleDual', label: 'Dual pane on / off', keys: ['Ctrl+D'], run: () => toggleDual() },
  { id: 'togglePreview', label: 'Preview panel on / off', keys: ['Ctrl+P'], run: () => toggleInfo() },
  { id: 'selectAll', label: 'Select all', keys: ['Ctrl+A'], run: ({ pane, tab }) => selectAll(pane, tab, tab.focusCol) },
  { id: 'cut', label: 'Cut', keys: ['Ctrl+X'], run: () => setClipboard('cut', sel()) },
  { id: 'copy', label: 'Copy', keys: ['Ctrl+C'], run: () => setClipboard('copy', sel()) },
  { id: 'paste', label: 'Paste', keys: ['Ctrl+V'], run: ({ tab }) => paste(currentDir(tab)) },
  { id: 'copyPath', label: 'Copy path', keys: ['Ctrl+Shift+C'], run: ({ tab }) => { const ps = sel(); copyPaths(ps.length ? ps : [currentDir(tab)]); } },
  { id: 'duplicate', label: 'Duplicate', keys: ['Ctrl+Shift+D'], run: ({ col }) => { const ps = sel(); if (ps.length && col) transfer(ps, col.path, 'copy'); } },
  { id: 'rename', label: 'Rename (batch rename for several items)', keys: ['F2'], run: ({ pane, col }) => { const ps = sel(); if (ps.length === 1) startRename(pane, ps[0]); else if (ps.length && col) openBatchRename(col, ps); } },
  { id: 'batchRename', label: 'Batch rename', keys: ['Ctrl+F2'], run: ({ col }) => { const ps = sel(); if (ps.length && col) openBatchRename(col, ps); } },
  { id: 'newFolder', label: 'New folder', keys: ['Ctrl+Shift+N'], run: ({ tab }) => createItem('folder', currentDir(tab)) },
  { id: 'newFile', label: 'New text file', keys: ['Ctrl+Alt+N'], run: ({ tab }) => createItem('file', currentDir(tab)) },
  { id: 'newFolderFromSel', label: 'New folder with selection', keys: [], run: ({ col }) => col && newFolderWithSelection(col, sel()) },
  { id: 'trash', label: 'Move to Trash', keys: ['Delete'], run: () => trashPaths(sel()) },
  { id: 'deletePerm', label: 'Delete permanently', keys: ['Shift+Delete'], run: () => deletePermanently(sel()) },
  { id: 'moveOther', label: 'Move to other pane', keys: ['F6'], run: () => toOtherPane('move') },
  { id: 'copyOther', label: 'Copy to other pane', keys: ['Shift+F6'], run: () => toOtherPane('copy') },
  { id: 'dropList', label: 'Add to Drop List', keys: ['Alt+D'], run: ({ pane, col }) => { const ps = sel(); if (ps.length) addToDropList(selectionItems(ps, (p) => (pane.search.open ? pane.search.map : col.map).get(p))); } },
  { id: 'compress', label: 'Compress…', keys: [], run: ({ col }) => { const ps = sel(); if (ps.length && col) compress(ps, col.path, false); } },
  { id: 'extractHere', label: 'Extract here', keys: [], run: ({ col }) => { const ps = sel().filter((p) => isArchive(col?.map.get(p))); if (ps.length) extractArchives(ps, col.path, 'here'); } },
  { id: 'openWith', label: 'Open with…', keys: [], run: () => { const ps = sel(); if (ps.length === 1) openWithDialog(ps[0]); } },
  { id: 'symlink', label: 'Create symbolic link', keys: [], run: ({ col }) => { const ps = sel(); if (ps.length && col) makeLinks(ps, col.path, 'sym'); } },
  { id: 'addFavorite', label: 'Add folder to Favorites', keys: ['Ctrl+B'], run: ({ tab }) => addFavorites([currentDir(tab)]) },
  { id: 'undo', label: 'Undo', keys: ['Ctrl+Z'], run: () => undo() },
  { id: 'settings', label: 'Settings', keys: ['Ctrl+,'], run: () => openSettings() },
  { id: 'quickLook', label: 'Quick Look preview', keys: ['Space'], run: () => quickLook() },
  { id: 'pasteTab', label: 'New tab from clipboard path', keys: ['Ctrl+Shift+V'], run: () => pasteTab() },
  { id: 'newWindow', label: 'New window', keys: ['Ctrl+N'], run: ({ tab }) => api.newWindow({ path: currentDir(tab) }) },
  { id: 'copyTo', label: 'Copy to…', keys: ['F7'], run: () => copyToDialog(sel(), 'copy') },
  { id: 'moveTo', label: 'Move to…', keys: ['Shift+F7'], run: () => copyToDialog(sel(), 'move') },
  { id: 'closeStale', label: 'Close tabs unused for an hour', keys: [], run: ({ pane }) => closeStaleTabs(pane) },
  { id: 'note', label: 'Folder note', keys: [], run: ({ tab }) => editNote(currentDir(tab)) },
  { id: 'automator', label: 'File Automator', keys: [], run: ({ tab }) => fileAutomator(currentDir(tab), tab.columns.at(-1)?.entries || []) },
  { id: 'images', label: 'Convert / resize images', keys: [], run: ({ col }) => col && batchImages(sel(), col.path) },
  { id: 'connect', label: 'Connect to server', keys: [], run: () => connectDialog() },
];
const actionKeys = (a) => S().keys[a.id] ?? a.keys;
let keymap = new Map();
function buildKeymap() {
  keymap = new Map();
  for (const a of ACTIONS) for (const k of actionKeys(a)) if (!keymap.has(k)) keymap.set(k, a);
}
function comboOf(e) {
  let k = e.key;
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(k)) return null;
  if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
  else if (k === ' ') k = 'Space';
  else if (k.startsWith('Arrow')) k = k.slice(5);
  else if (k.length === 1) k = k.toUpperCase();
  return [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', k].filter(Boolean).join('+');
}
const prettyKey = (c) => c.replace(/\bLeft\b/, '←').replace(/\bRight\b/, '→').replace(/\bUp\b/, '↑').replace(/\bDown\b/, '↓').replace('Delete', 'Del');
// Current shortcut of an action, for menus and tooltips.
const kb = (id) => { const a = ACTIONS.find((x) => x.id === id); const k = a && actionKeys(a)[0]; return k ? prettyKey(k) : ''; };

document.addEventListener('keydown', (e) => {
  if (document.querySelector('.modal-backdrop')) return;
  if (!menuEl.hidden) { if (e.key === 'Escape') hideMenu(); return; }
  if (e.target.matches?.('input, textarea, select')) return;

  const pane = activePane();
  const tab = tabOf(pane);
  const col = tab.columns[tab.focusCol];
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key;
  const handled = () => e.preventDefault();

  if (pane.search.open && searchKey(e, pane)) return;

  // Alt+1…7 toggles a colour tag on the selection, Alt+0 clears it.
  const digit = e.altKey && !ctrl && /^Digit([0-7])$/.exec(e.code);
  if (digit) { handled(); setTag(selectedPaths(), +digit[1]); return; }

  const combo = comboOf(e);
  const action = combo && keymap.get(combo);
  if (action) { handled(); action.run({ pane, tab, col }); return; }
  if (ctrl || e.altKey) return;

  const grid = tab.view === 'grid';
  switch (key) {
    case 'ArrowDown': handled(); moveCursor(pane, tab, grid ? gridCols(pane) : 1, e.shiftKey); return;
    case 'ArrowUp': handled(); moveCursor(pane, tab, grid ? -gridCols(pane) : -1, e.shiftKey); return;
    case 'PageDown': handled(); moveCursor(pane, tab, grid ? gridCols(pane) * 4 : 15, e.shiftKey); return;
    case 'PageUp': handled(); moveCursor(pane, tab, grid ? -gridCols(pane) * 4 : -15, e.shiftKey); return;
    case 'Home': handled(); moveCursor(pane, tab, 'home', e.shiftKey); return;
    case 'End': handled(); moveCursor(pane, tab, 'end', e.shiftKey); return;
    case 'ArrowRight': {
      if (grid) { handled(); moveCursor(pane, tab, 1, e.shiftKey); return; }
      if (tab.view !== 'columns' || !col) return;
      handled();
      const next = tab.columns[tab.focusCol + 1];
      if (next && col.sel.size === 1 && col.sel.has(next.path)) {
        tab.focusCol++;
        const first = next.cursor ? next.cursor : visible(tab, next)[0]?.path;
        if (first) selectEntry(pane, tab, tab.focusCol, first, { delay: 90 });
        else { renderPane(pane); updatePreview(); }
      }
      return;
    }
    case 'ArrowLeft':
      if (grid) { handled(); moveCursor(pane, tab, -1, e.shiftKey); return; }
      if (tab.view !== 'columns') return;
      handled();
      if (tab.focusCol > 0) {
        const child = tab.columns[tab.focusCol];
        child.sel.clear(); child.cursor = null;
        tab.focusCol--;
        tab.columns.length = tab.focusCol + 2;
        syncPath(tab);
        renderPane(pane);
        ensureCursorVisible(pane);
        updatePreview();
      } else goUp(pane);
      return;
    case 'Enter': {
      handled();
      if (!col) return;
      const paths = orderedSel(tab, col);
      if (paths.length === 1) activateEntry(pane, tab, tab.focusCol, paths[0]);
      else paths.filter((p) => !col.map.get(p)?.isDir).slice(0, 12).forEach(openFile);
      return;
    }
    case 'Escape':
      if (tab.filter || tab.typeFilter) { tab.filter = ''; tab.typeFilter = ''; renderPane(pane); return; }
      if (col && col.sel.size) { col.sel.clear(); if (tab.view === 'columns') tab.columns.length = tab.focusCol + 1; syncPath(tab); renderPane(pane); updatePreview(); }
      return;
  }

  // Type-ahead: jump to the first item that starts with the typed text.
  if (key.length === 1 && col && key !== ' ') {
    clearTimeout(typeT);
    typeBuf += key.toLowerCase();
    typeT = setTimeout(() => { typeBuf = ''; }, 900);
    const vis = visible(tab, col);
    const hit = vis.find((x) => x.name.toLowerCase().startsWith(typeBuf)) || vis.find((x) => x.name.toLowerCase().includes(typeBuf));
    if (hit) selectEntry(pane, tab, tab.focusCol, hit.path, { delay: 150 });
  }
});

document.addEventListener('mouseup', (e) => {
  if (e.button === 3) { e.preventDefault(); goHistory(activePane(), -1); }
  if (e.button === 4) { e.preventDefault(); goHistory(activePane(), 1); }
});

/* =========================================================
 * Drag & drop — default action is MOVE, hold Ctrl to copy
 * ======================================================= */
let drag = null;          // internal drag: { paths, dirs }
let dropEl = null;
let spring = { el: null, t: 0 };
const tipEl = $('#drag-tip');
const ghostEl = $('#drag-ghost');

let favDrag = null; // key "group:index" of a favorite being reordered
function beginDrag(e, paths, first) {
  e.dataTransfer.effectAllowed = 'all';
  e.dataTransfer.setData('application/x-nova-paths', JSON.stringify(paths));
  e.dataTransfer.setData('text/uri-list', paths.map(fileUri).join('\r\n'));
  e.dataTransfer.setData('text/plain', paths.join('\n'));
  ghostEl.innerHTML = `<span class="r-icon">${iconFor(first)}</span><span>${esc(first.name)}</span>${paths.length > 1 ? `<span class="badge">${paths.length}</span>` : ''}`;
  e.dataTransfer.setDragImage(ghostEl, 14, 16);
  document.body.classList.add('dragging');
}
function clearFavIns() {
  document.querySelectorAll('.ins-before, .ins-after, .ins-end').forEach((el) => el.classList.remove('ins-before', 'ins-after', 'ins-end'));
}

document.addEventListener('dragstart', (e) => {
  const fav = e.target.closest?.('[data-fav]');
  if (fav) {
    favDrag = fav.dataset.fav;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-nova-fav', favDrag);
    return;
  }
  const dl = e.target.closest?.('[data-dl-item], [data-dl-all]');
  if (dl) {
    const items = dl.dataset.dlItem ? state.dropList.filter((x) => x.path === dl.dataset.dlItem) : state.dropList.slice();
    if (!items.length) return;
    drag = { paths: items.map((x) => x.path), dirs: items.filter((x) => x.isDir).map((x) => x.path), fromDropList: true };
    beginDrag(e, drag.paths, { name: P.basename(items[0].path), isDir: items[0].isDir });
    return;
  }
  const row = e.target.closest?.('.row[data-path]');
  if (!row || row.classList.contains('renaming')) return;
  const pane = state.panes.find((p) => p.el === row.closest('.pane'));
  if (!pane) return;
  const path = row.dataset.path;
  // Rows come from a folder column or from the search results; both expose sel/cursor/anchor/map.
  let src, ordered;
  if (row.closest('.search')) {
    src = pane.search;
    ordered = () => searchSel(pane);
  } else {
    const tab = tabOf(pane);
    src = tab.columns[colIndexFrom(row, tab)];
    ordered = () => orderedSel(tab, src);
  }
  let paths;
  if (src.sel.has(path)) paths = ordered();
  else {
    // Select just the dragged row without re-rendering (re-rendering would cancel the drag).
    src.sel = new Set([path]);
    src.cursor = src.anchor = path;
    row.parentElement.querySelectorAll('.row.sel').forEach((r) => r.classList.remove('sel'));
    row.classList.add('sel');
    paths = [path];
  }
  drag = { paths, dirs: paths.filter((p) => src.map.get(p)?.isDir) };
  beginDrag(e, paths, src.map.get(paths[0]) || { name: P.basename(paths[0]), isDir: false });
});

function dropInfo(target, e) {
  if (!target) return { valid: false };
  const dir = target.dataset.drop;
  const external = !drag;
  if (external && !e.dataTransfer.types.includes('Files') && !e.dataTransfer.types.includes('text/uri-list')) return { valid: false };
  if (dir === 'trash:') return { valid: true, mode: 'trash', label: 'Move to Trash' };
  if (dir.startsWith('fav:')) {
    const gi = +dir.slice(4) || 0;
    if (drag && !drag.dirs.length) return { valid: false, reason: 'Only folders can be added to Favorites' };
    return { valid: true, mode: 'fav', gi, label: `Add to ${state.favGroups[gi]?.name || 'Favorites'}` };
  }
  if (dir === 'drop:') {
    if (drag?.fromDropList) return { valid: false, reason: 'Already on the Drop List' };
    return { valid: true, mode: 'droplist', label: 'Add to the Drop List' };
  }
  // Plain drag moves, Ctrl copies, Ctrl+Shift creates symbolic links.
  const mode = e.ctrlKey && e.shiftKey ? 'link' : e.ctrlKey ? 'copy' : 'move';
  if (drag && mode !== 'link') {
    if (drag.paths.some((p) => P.isInside(dir, p))) return { valid: false, reason: 'Can’t drop a folder into itself' };
    if (mode === 'move' && drag.paths.every((p) => P.dirname(p) === dir)) return { valid: false, reason: 'Already in this folder · hold Ctrl to duplicate' };
  }
  const verb = { move: 'Move to', copy: 'Copy to', link: 'Create links in' }[mode];
  return { valid: true, mode, dir, label: `${verb} ${dirLabel(dir)}` };
}

function setDropEl(el) {
  if (dropEl === el) return;
  dropEl?.classList.remove('drop-target');
  dropEl = el;
  dropEl?.classList.add('drop-target');
}

function showTip(e, info) {
  if (!info.label && !info.reason) { tipEl.hidden = true; return; }
  tipEl.hidden = false;
  tipEl.className = info.valid ? (info.mode === 'copy' ? 'copy' : '') : 'invalid';
  tipEl.innerHTML = info.valid ? `${esc(info.label)}${info.mode === 'move' ? '<kbd>Ctrl = copy</kbd><kbd>Ctrl+Shift = link</kbd>' : ''}` : esc(info.reason);
  tipEl.style.left = e.clientX + 16 + 'px';
  tipEl.style.top = e.clientY + 18 + 'px';
}

function springLoad(target) {
  const isFolderRow = target && target.matches('.row[data-drop]');
  const isTab = target && target.matches('.tab:not(.active)');
  if (!isFolderRow && !isTab) { clearTimeout(spring.t); spring.el = null; return; }
  if (spring.el === target) return;
  clearTimeout(spring.t);
  spring.el = target;
  spring.t = setTimeout(() => {
    if (spring.el !== target || !target.isConnected) return;
    const pane = state.panes.find((p) => p.el === target.closest('.pane'));
    if (!pane) return;
    if (isTab) { activateTab(pane, +target.dataset.tab); return; }
    const tab = tabOf(pane);
    if (tab.view === 'columns') selectEntry(pane, tab, colIndexFrom(target, tab), target.dataset.path);
    else navigate(pane, tab, target.dataset.path);
  }, 750);
}

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (favDrag) {
    // Reordering favorites: show where the item will land.
    clearFavIns();
    const over = e.target.closest?.('[data-fav]');
    const sec = e.target.closest?.('[data-group]');
    if (over) {
      const r = over.getBoundingClientRect();
      over.classList.add(e.clientY > r.top + r.height / 2 ? 'ins-after' : 'ins-before');
    } else if (sec) sec.classList.add('ins-end');
    e.dataTransfer.dropEffect = over || sec ? 'move' : 'none';
    tipEl.hidden = true;
    return;
  }
  const target = e.target.closest?.('[data-drop]') || null;
  const info = dropInfo(target, e);
  setDropEl(info.valid ? target : null);
  e.dataTransfer.dropEffect = info.valid ? ({ copy: 'copy', fav: 'copy', droplist: 'copy', link: 'link' }[info.mode] || 'move') : 'none';
  showTip(e, info);
  springLoad(info.valid ? target : null);
});

document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) { setDropEl(null); tipEl.hidden = true; }
});

function endDrag() {
  if (!drag && !dropEl && tipEl.hidden) return;
  drag = null;
  setDropEl(null);
  tipEl.hidden = true;
  clearTimeout(spring.t);
  spring.el = null;
  document.body.classList.remove('dragging');
  for (const p of state.panes) {
    renderPane(p);
    renderSearch(p);
    // A drag may have selected a folder without opening its column; open it now.
    const tab = tabOf(p);
    const col = tab.columns[tab.focusCol];
    if (tab.view === 'columns' && col && col.sel.size === 1) {
      const sel = [...col.sel][0];
      if (col.map.get(sel)?.isDir && tab.columns[tab.focusCol + 1]?.path !== sel) {
        tab.columns.length = tab.focusCol + 1;
        openChild(p, tab, tab.focusCol, sel);
      }
    }
  }
  updatePreview();
}
document.addEventListener('dragend', () => { favDrag = null; clearFavIns(); endDrag(); });
document.addEventListener('mousemove', (e) => { if (drag && !e.buttons) endDrag(); });

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  if (favDrag) {
    const key = favDrag;
    favDrag = null;
    clearFavIns();
    const over = e.target.closest?.('[data-fav]');
    const sec = e.target.closest?.('[data-group]');
    if (over && over.dataset.fav !== key) {
      const { gi, ii } = favAt(over.dataset.fav);
      const r = over.getBoundingClientRect();
      moveFavorite(key, gi, e.clientY > r.top + r.height / 2 ? ii + 1 : ii);
    } else if (!over && sec) moveFavorite(key, +sec.dataset.group);
    return;
  }
  const target = e.target.closest?.('[data-drop]') || null;
  const info = dropInfo(target, e);
  let paths = drag?.paths;
  const dirs = drag?.dirs;
  const fromDropList = !!drag?.fromDropList;
  if (!paths) {
    paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
    if (!paths.length) {
      paths = (e.dataTransfer.getData('text/uri-list') || '').split(/\r?\n/)
        .filter((u) => u.startsWith('file://')).map((u) => decodeURIComponent(new URL(u).pathname));
    }
  }
  endDrag();
  if (!info.valid || !paths || !paths.length) return;
  if (info.mode === 'trash') { trashPaths(paths); return; }
  if (info.mode === 'fav') {
    let favDirs = dirs;
    if (!favDirs) {
      const stats = await Promise.all(paths.map((p) => api.stat(p)));
      favDirs = paths.filter((p, i) => stats[i].ok && stats[i].entry.isDir);
    }
    addFavorites(favDirs, info.gi);
    return;
  }
  if (info.mode === 'droplist') {
    const stats = dirs ? null : await Promise.all(paths.map((p) => api.stat(p)));
    addToDropList(paths.map((p, i) => ({ path: p, isDir: dirs ? dirs.includes(p) : !!stats[i].entry?.isDir })));
    return;
  }
  if (info.mode === 'link') { makeLinks(paths, info.dir, 'sym'); return; }
  const res = await transfer(paths, info.dir, info.mode);
  if (fromDropList && info.mode === 'move' && res) removeFromDropList(res.done.map((d) => d.from));
});

/* =========================================================
 * Toasts, modals
 * ======================================================= */
function toast(msg, type = 'info', { action, timeout = 4500 } = {}) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="t-msg">${esc(msg).replace(/\n/g, '<br>')}</span>${action ? `<button class="t-act">${esc(action.label)}</button>` : ''}`;
  if (action) $('.t-act', el).onclick = () => { el.remove(); action.fn(); };
  $('#toasts').appendChild(el);
  const all = $('#toasts').children;
  while (all.length > 5) all[0].remove();
  const t = setTimeout(() => el.remove(), action ? Math.max(timeout, 7000) : timeout);
  el.addEventListener('mouseenter', () => clearTimeout(t));
  el.addEventListener('mouseleave', () => setTimeout(() => el.remove(), 2500));
  return el;
}

/* Operation queue ("Taskmaster"): transfers run one at a time with byte progress, pause and cancel. */
const ops = [];
let opsRunning = false, opsPinned = false, opsDismissed = false, opsHideT = 0, opsRenderT = 0;
const OP_SHOW_DELAY = 350; // quick operations never show the panel

function queueOp(job) {
  return new Promise((resolve) => {
    ops.push({ id: `op${++jobSeq}`, ...job, total: job.paths.length, status: 'queued', index: 0, name: '', bytesDone: 0, bytesTotal: null, resolve });
    renderOps();
    pumpOps();
  });
}
async function pumpOps() {
  if (opsRunning) return;
  const op = ops.find((o) => o.status === 'queued');
  if (!op) return;
  opsRunning = true;
  Object.assign(op, { status: 'running', started: Date.now(), paused: false });
  setTimeout(renderOps, OP_SHOW_DELAY + 20);
  renderOps();
  const res = await api.transfer({ id: op.id, sources: op.paths, destDir: op.destDir, mode: op.mode, policy: op.policy });
  Object.assign(op, { status: res.cancelled ? 'cancelled' : res.errors.length ? 'failed' : 'done', result: res, finished: Date.now() });
  opsRunning = false;
  renderOps();
  op.resolve(res);
  pumpOps();
}
function opControl(id, action) {
  const op = ops.find((o) => o.id === id);
  if (!op) return;
  if (op.status === 'queued' && action === 'cancel') {
    op.status = 'cancelled';
    op.result = { done: [], skipped: [], errors: [], cancelled: true };
    op.resolve(op.result);
  } else if (op.status === 'running') {
    api.opControl(op.id, action);
    op.paused = action === 'pause';
  }
  renderOps();
}
api.onProgress((d) => {
  const op = ops.find((o) => o.id === d.id);
  if (!op || d.finished) return;
  Object.assign(op, { index: d.index, name: d.name, bytesDone: d.bytesDone, bytesTotal: d.bytesTotal });
  if (!opsRenderT) opsRenderT = setTimeout(() => { opsRenderT = 0; renderOps(); }, 150);
});

function opRowHtml(o) {
  const moving = o.mode === 'move';
  const r = o.result;
  let label, pct, sub = '';
  if (o.status === 'queued') { label = `${moving ? 'Move' : 'Copy'} ${plural(o.total, 'item')} to ${dirLabel(o.destDir)}`; pct = 0; sub = 'Waiting…'; }
  else if (o.status === 'running') {
    label = `${moving ? 'Moving' : 'Copying'} ${o.index} of ${o.total} — ${o.name}`;
    pct = o.bytesTotal ? o.bytesDone / o.bytesTotal : (o.index - 1) / o.total;
    if (o.bytesTotal) {
      const secs = Math.max(0.5, (Date.now() - o.started) / 1000);
      const rate = o.bytesDone / secs;
      const left = rate > 0 ? (o.bytesTotal - o.bytesDone) / rate : 0;
      sub = `${fmtSize(o.bytesDone)} of ${fmtSize(o.bytesTotal)} · ${fmtSize(rate)}/s${left > 2 ? ` · ${left > 90 ? `${Math.round(left / 60)} min` : `${Math.round(left)} s`} left` : ''}`;
    } else sub = `to ${dirLabel(o.destDir)}`;
    if (o.paused) sub = `Paused · ${sub}`;
  } else {
    const n = r.done.length;
    label = o.status === 'cancelled' ? `Cancelled${n ? ` after ${plural(n, 'item')}` : ''}` : `${moving ? 'Moved' : 'Copied'} ${plural(n, 'item')} to ${dirLabel(o.destDir)}`;
    pct = 1;
    if (r.errors.length) sub = `${plural(r.errors.length, 'error')}: ${r.errors[0]}`;
  }
  const btns = o.status === 'running'
    ? `<button class="ib" data-op="${o.paused ? 'resume' : 'pause'}" title="${o.paused ? 'Resume' : 'Pause'}">${line(o.paused ? 'play' : 'pause')}</button><button class="ib" data-op="cancel" title="Cancel">${line('x')}</button>`
    : o.status === 'queued' ? `<button class="ib" data-op="cancel" title="Remove from queue">${line('x')}</button>` : '';
  return `<div class="op ${o.status}${o.paused ? ' paused' : ''}" data-id="${o.id}"><div class="op-text"><div class="op-label" title="${esc(label)}">${esc(label)}</div>${sub ? `<div class="op-sub" title="${esc(sub)}">${esc(sub)}</div>` : ''}<div class="t-progress"><i style="width:${(pct * 100).toFixed(1)}%"></i></div></div>${btns}</div>`;
}
function renderOps() {
  const el = $('#ops');
  const now = Date.now();
  const active = ops.filter((o) => o.status === 'queued' || o.status === 'running');
  const badge = $('#btn-ops .badge');
  badge.hidden = !active.length;
  badge.textContent = active.length;
  $('#btn-ops').classList.toggle('on', opsPinned);
  const slow = active.some((o) => o.status === 'queued' || now - o.started >= OP_SHOW_DELAY);
  clearTimeout(opsHideT);
  if (slow) el.dataset.seen = '1';
  if (!active.length) opsDismissed = false;
  // Keep finished operations visible briefly once the panel has been shown.
  if (!active.length && el.dataset.seen && !opsPinned) {
    opsHideT = setTimeout(() => { delete el.dataset.seen; renderOps(); }, 4000);
  }
  const show = ops.length && (opsPinned || ((slow || el.dataset.seen) && !opsDismissed));
  el.hidden = !show;
  if (show) {
    const finished = ops.length - active.length;
    el.innerHTML = `<div class="ops-head"><span>File operations</span>${finished ? '<button class="ops-clear" data-ops="clear">Clear finished</button>' : ''}<button class="ib" data-ops="close" title="Hide">${line('x')}</button></div>`
      + `<div class="ops-list">${ops.slice(-12).map(opRowHtml).join('')}</div>`;
  }
  $('#toasts').style.bottom = show ? `${el.offsetHeight + 44}px` : '';
}
function bindOps() {
  $('#btn-ops').innerHTML += line('activity');
  $('#btn-ops').onclick = () => { opsPinned = !opsPinned; if (!ops.length && opsPinned) toast('No file operations yet'); renderOps(); };
  $('#ops').addEventListener('click', (e) => {
    const b = e.target.closest('[data-op]');
    if (b) { opControl(b.closest('[data-id]').dataset.id, b.dataset.op); return; }
    const h = e.target.closest('[data-ops]');
    if (h?.dataset.ops === 'clear') { for (let i = ops.length - 1; i >= 0; i--) if (!['queued', 'running'].includes(ops[i].status)) ops.splice(i, 1); renderOps(); }
    else if (h?.dataset.ops === 'close') { opsPinned = false; opsDismissed = ops.some((o) => o.status === 'queued' || o.status === 'running'); delete $('#ops').dataset.seen; renderOps(); }
  });
}

function modal({ title, body, items, buttons }) {
  return new Promise((resolve) => {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `<div class="modal" role="dialog"><h3>${esc(title)}</h3>${body ? `<p>${esc(body)}</p>` : ''}
      ${items && items.length ? `<ul>${items.slice(0, 50).map((i) => `<li>${esc(i)}</li>`).join('')}${items.length > 50 ? `<li>…and ${items.length - 50} more</li>` : ''}</ul>` : ''}
      <div class="m-actions">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-b="${i}">${esc(b.label)}</button>`).join('')}</div></div>`;
    const close = (v) => { bd.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); const p = buttons.find((b) => b.primary); close(p ? p.value : null); }
    };
    bd.addEventListener('click', (e) => {
      const b = e.target.closest('[data-b]');
      if (b) close(buttons[+b.dataset.b].value);
      else if (e.target === bd) close(null);
    });
    document.addEventListener('keydown', onKey, true);
    $('#modal-root').appendChild(bd);
    bd.querySelector('.btn.primary, .btn.danger')?.focus();
  });
}

function conflictDialog(names, mode, destDir) {
  return modal({
    title: names.length === 1 ? `“${names[0]}” already exists in ${dirLabel(destDir)}` : `${names.length} items already exist in ${dirLabel(destDir)}`,
    body: `Choose what to do with the ${mode === 'move' ? 'items you’re moving' : 'copies'}. Replaced items are sent to the Trash.`,
    items: names.length > 1 ? names : null,
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'Skip', value: 'skip' },
      { label: 'Replace', value: 'replace' },
      { label: 'Keep both', value: 'keep', cls: 'primary', primary: true },
    ],
  });
}

function confirmDialog({ title, body, items, confirm, danger }) {
  return modal({
    title, body, items,
    buttons: [{ label: 'Cancel', value: false }, { label: confirm, value: true, cls: danger ? 'danger' : 'primary', primary: true }],
  });
}

// Form dialog: `html` is the body; [data-cancel] closes, [data-value] closes with
// its value, [data-submit] (or Enter) resolves with submit(root) unless that returns undefined.
function dialog({ title, html, cls = '', setup, submit }) {
  return new Promise((resolve) => {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `<div class="modal ${cls}" role="dialog"><h3>${esc(title)}</h3>${html}</div>`;
    const root = $('.modal', bd);
    const close = (v) => { bd.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const doSubmit = async () => {
      if (!submit || root.querySelector('[data-submit]')?.disabled) return;
      const v = await submit(root);
      if (v !== undefined) close(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
      else if (e.key === 'Enter' && !e.target.matches('textarea, button')) { e.preventDefault(); e.stopPropagation(); doSubmit(); }
    };
    bd.addEventListener('click', (e) => {
      const v = e.target.closest('[data-value]');
      if (e.target.closest('[data-cancel]')) close(null);
      else if (v) close(v.dataset.value);
      else if (e.target.closest('[data-submit]')) doSubmit();
    });
    document.addEventListener('keydown', onKey, true);
    $('#modal-root').appendChild(bd);
    setup?.(root, close);
  });
}

function promptDialog({ title, body, value = '', password = false, confirm = 'OK' }) {
  return dialog({
    title,
    html: `${body ? `<p>${esc(body)}</p>` : ''}<input class="m-input" type="${password ? 'password' : 'text'}" spellcheck="false" value="${esc(value)}">
      <div class="m-actions"><button class="btn" data-cancel>Cancel</button><button class="btn primary" data-submit>${esc(confirm)}</button></div>`,
    setup: (root) => { const i = $('input', root); i.focus(); i.select(); },
    submit: (root) => $('input', root).value,
  });
}

// Progress toast for long-running jobs (archives). Shown after a short delay so quick jobs don't flash.
const tasks = new Map();
function taskToast(id, label, onCancel) {
  const t = { el: null, pct: null };
  t.timer = setTimeout(() => {
    t.el = document.createElement('div');
    t.el.className = 'toast';
    t.el.innerHTML = `<div class="t-msg"><div class="op-label">${esc(label)}</div><div class="t-progress ${t.pct == null ? 'indeterminate' : ''}"><i style="width:${t.pct ?? 0}%"></i></div></div>${onCancel ? '<button class="t-act">Cancel</button>' : ''}`;
    if (onCancel) $('.t-act', t.el).onclick = onCancel;
    $('#toasts').appendChild(t.el);
  }, 300);
  t.set = (pct) => {
    t.pct = pct;
    if (!t.el) return;
    const bar = $('.t-progress', t.el);
    bar.classList.remove('indeterminate');
    $('i', bar).style.width = `${pct}%`;
  };
  t.close = () => { clearTimeout(t.timer); t.el?.remove(); tasks.delete(id); };
  tasks.set(id, t);
  return t;
}
api.archive.onProgress(({ id, percent }) => tasks.get(id)?.set(percent));

/* =========================================================
 * Colour tags
 * ======================================================= */
// Toggle semantics: applying the tag every selected item already has removes it.
function setTag(paths, color) {
  if (!paths.length) return;
  if (color && paths.every((p) => tagOf(p) === color)) color = 0;
  api.setTag(paths, color || null);
}
api.onTags((t) => {
  state.tags = t;
  for (const p of state.panes) { if (!p.renaming) renderPane(p); renderSearch(p); }
  renderSidebar(); // Tags section counts
  updatePreview(true);
});

/* =========================================================
 * Batch rename
 * ======================================================= */
function splitName(e) {
  const dot = e.name.lastIndexOf('.');
  return !e.isDir && dot > 0 ? [e.name.slice(0, dot), e.name.slice(dot + 1)] : [e.name, ''];
}
function applyCase(s, mode) {
  if (mode === 'lower') return s.toLowerCase();
  if (mode === 'upper') return s.toUpperCase();
  if (mode === 'title') return s.toLowerCase().replace(/(^|[\s_\-.([])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
  return s;
}
// {name} {ext} {full} {n} {n:3} {date} {parent}, plus $1…$9 / $& from the regex match.
function expandTokens(tpl, ctx, groups) {
  return tpl.replace(/\{(name|ext|full|n|date|parent)(?::(\d+))?\}|\$(\d|&)/g, (all, tok, width, grp) => {
    if (grp !== undefined) return groups ? (grp === '&' ? groups[0] : groups[+grp] ?? '') : all;
    if (tok === 'n') return String(ctx.n).padStart(+width || 0, '0');
    return ctx[tok];
  });
}

function batchNames(items, o, existing) {
  let re = null;
  if (o.find) {
    try { re = new RegExp(o.regex ? o.find : o.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), o.matchCase ? 'g' : 'gi'); }
    catch { return { error: 'Invalid regular expression' }; }
  }
  const rows = items.map((e, i) => {
    const [base, ext] = splitName(e);
    const target = o.withExt ? e.name : base;
    const ctx = { name: base, ext, full: e.name, n: o.start + i * o.step, date: isoDay(e.mtime), parent: P.basename(P.dirname(e.path)) };
    let out;
    if (re) {
      out = target.replace(re, (...a) => {
        const named = typeof a[a.length - 1] === 'object';
        return expandTokens(o.replace, ctx, a.slice(0, a.length - (named ? 3 : 2)));
      });
    } else out = o.replace ? expandTokens(o.replace, ctx, null) : target;
    out = applyCase(out, o.case);
    return { e, newName: o.withExt || !ext ? out : `${out}.${ext}` };
  });
  // Names freed up by items that are themselves being renamed don't count as conflicts.
  const freed = new Set(rows.filter((r) => r.newName !== r.e.name).map((r) => r.e.name));
  const counts = new Map();
  for (const r of rows) counts.set(r.newName, (counts.get(r.newName) || 0) + 1);
  const enc = new TextEncoder();
  for (const r of rows) {
    if (r.newName === r.e.name) { r.status = 'same'; continue; }
    const n = r.newName;
    if (!n.trim() || n === '.' || n === '..' || n.includes('/') || n.includes('\0')) r.err = 'Invalid name';
    else if (enc.encode(n).length > 255) r.err = 'Too long';
    else if (counts.get(n) > 1) r.err = 'Duplicate';
    else if (existing.has(n) && !freed.has(n)) r.err = 'Already exists';
    r.status = r.err ? 'error' : 'ok';
  }
  return { rows };
}

const BR_KEY = 'nova-batch-rename';
async function openBatchRename(col, paths) {
  const items = paths.map((p) => col.map.get(p)).filter(Boolean);
  if (!items.length) return;
  const dir = col.path;
  const existing = new Set(col.entries.map((e) => e.name));
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(BR_KEY)) || {}; } catch { /* first use */ }
  const tokens = ['{name}', '{ext}', '{n}', '{n:3}', '{date}', '{parent}'];
  let rows = [];
  const read = (root) => {
    const v = (k) => $(`[data-k="${k}"]`, root);
    return {
      find: v('find').value, replace: v('replace').value, regex: v('regex').checked, matchCase: v('matchCase').checked,
      withExt: v('withExt').checked, case: v('case').value, start: Number(v('start').value) || 0, step: Number(v('step').value) || 1,
    };
  };
  const update = (root) => {
    const o = read(root);
    const res = batchNames(items, o, existing);
    const status = $('.br-status', root);
    const btn = $('[data-submit]', root);
    if (res.error) {
      rows = [];
      $('.br-rows', root).innerHTML = '';
      status.textContent = res.error;
      status.className = 'br-status bad';
      btn.disabled = true;
      return;
    }
    rows = res.rows;
    const shown = rows.slice(0, 1000);
    $('.br-rows', root).innerHTML = shown.map((r) => `<div class="br-row ${r.status}"><span class="old" title="${esc(r.e.name)}">${esc(r.e.name)}</span><span class="new" title="${esc(r.newName)}">${esc(r.newName)}</span><span class="why">${r.err || ''}</span></div>`).join('')
      + (rows.length > shown.length ? `<div class="br-more">…and ${rows.length - shown.length} more</div>` : '');
    const n = { ok: 0, same: 0, error: 0 };
    for (const r of rows) n[r.status]++;
    status.textContent = `${plural(n.ok, 'item')} to rename${n.same ? ` · ${n.same} unchanged` : ''}${n.error ? ` · ${plural(n.error, 'problem')}` : ''}`;
    status.className = `br-status ${n.error ? 'bad' : ''}`;
    btn.disabled = !!n.error || !n.ok;
  };
  const html = `
    <div class="br-grid">
      <label for="br-find">Find</label><input id="br-find" data-k="find" spellcheck="false" placeholder="Leave empty to rename everything with the template below" value="${esc(saved.find || '')}">
      <label for="br-rep">Replace</label><input id="br-rep" data-k="replace" spellcheck="false" placeholder="{name}" value="${esc(saved.replace || '')}">
    </div>
    <div class="br-tokens">${tokens.map((t) => `<button class="tok" data-token="${t}">${t}</button>`).join('')}<span class="br-hint">Regex groups: $1 $2 …</span></div>
    <div class="br-opts">
      <label><input type="checkbox" data-k="regex" ${saved.regex ? 'checked' : ''}> Regular expression</label>
      <label><input type="checkbox" data-k="matchCase" ${saved.matchCase ? 'checked' : ''}> Match case</label>
      <label><input type="checkbox" data-k="withExt" ${saved.withExt ? 'checked' : ''}> Include extension</label>
      <span class="br-sp"></span>
      <label>Case <select data-k="case">${[['', 'Keep'], ['lower', 'lower'], ['upper', 'UPPER'], ['title', 'Title']].map(([v, l]) => `<option value="${v}" ${saved.case === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>{n} from <input type="number" data-k="start" value="${saved.start ?? 1}"> step <input type="number" data-k="step" value="${saved.step ?? 1}"></label>
    </div>
    <div class="br-table"><div class="br-head"><span>Current name</span><span>New name</span><span></span></div><div class="br-rows"></div></div>
    <div class="br-foot"><span class="br-status"></span><button class="btn" data-cancel>Cancel</button><button class="btn primary" data-submit>Rename</button></div>`;

  const go = await dialog({
    title: `Batch rename ${plural(items.length, 'item')}`,
    html,
    cls: 'wide',
    setup: (root) => {
      let t;
      root.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => update(root), 60); });
      root.addEventListener('change', () => update(root));
      root.addEventListener('click', (e) => {
        const tok = e.target.closest('[data-token]');
        if (!tok) return;
        const input = $('[data-k="replace"]', root);
        const s = input.selectionStart ?? input.value.length;
        input.setRangeText(tok.dataset.token, s, input.selectionEnd ?? s, 'end');
        input.focus();
        update(root);
      });
      update(root);
      const f = $('[data-k="find"]', root);
      f.focus();
      f.select();
    },
    submit: (root) => {
      const o = read(root);
      try { localStorage.setItem(BR_KEY, JSON.stringify(o)); } catch { /* storage unavailable */ }
      return rows.filter((r) => r.status === 'ok').map((r) => ({ from: r.e.path, to: (P.dirname(r.e.path) === '/' ? '/' : P.dirname(r.e.path) + '/') + r.newName }));
    },
  });
  if (!go || !go.length) return;
  const r = await api.batchRename(go);
  if (r.done.length) {
    const entry = { type: 'batchRename', pairs: r.done };
    pushUndo(entry);
    toast(`Renamed ${plural(r.done.length, 'item')}`, 'success', { action: { label: 'Undo', fn: () => undo(entry) } });
  }
  if (r.errors.length) toast(r.errors.slice(0, 4).join('\n'), 'error', { timeout: 8000 });
  await refreshDir(dir);
  // Keep the renamed items selected.
  for (const pane of state.panes) {
    const tab = tabOf(pane);
    const c = tab.columns.find((x) => x.path === dir);
    if (!c) continue;
    c.sel = new Set(r.done.map((d) => d.to).filter((p) => c.map.has(p)));
    c.cursor = c.anchor = [...c.sel][0] || null;
    renderPane(pane);
  }
}

/* =========================================================
 * Archives
 * ======================================================= */
const ARCHIVE_RE = /\.(zip|7z|rar|jar|apk|iso|cab|deb|rpm|cpio|wim|gz|bz2|xz|zst|lzma|tar|tgz|tbz2?|txz|tzst)$/i;
const isArchive = (e) => !!e && !e.isDir && ARCHIVE_RE.test(e.name);
function archiveBase(name) {
  const m = name.match(/\.tar\.\w+$/i) || name.match(/\.[^.]+$/);
  return m && m.index > 0 ? name.slice(0, m.index) : name;
}
function archiveName(paths, dir) {
  if (paths.length !== 1) return dirLabel(dir);
  const name = P.basename(paths[0]);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}
function locate(p) {
  const pane = activePane();
  navigate(pane, tabOf(pane), P.dirname(p), { select: p, openSelected: false });
}

async function extractArchives(paths, destDir, mode, entries = null) {
  for (const p of paths) {
    let password = null;
    for (;;) {
      const id = `x${++jobSeq}`;
      const task = taskToast(id, `Extracting “${P.basename(p)}”…`, () => api.archive.cancel(id));
      const r = await api.archive.extract({ id, archive: p, destDir, mode, password, entries });
      task.close();
      if (r.ok) {
        toast(`Extracted “${P.basename(p)}” to “${P.basename(r.path)}”`, 'success', { action: { label: 'Show', fn: () => locate(r.path) } });
        if (r.warning) toast(`Some files had problems: ${r.warning}`, 'error', { timeout: 8000 });
        break;
      }
      if (r.cancelled) { toast('Extraction cancelled'); await refreshDir(destDir); return; }
      if (r.needPassword) {
        password = await promptDialog({ title: `Password for “${P.basename(p)}”`, body: r.error, password: true, confirm: 'Extract' });
        if (password == null) break;
        continue;
      }
      toast(`Couldn't extract “${P.basename(p)}” — ${r.error}`, 'error', { timeout: 8000 });
      break;
    }
  }
  await refreshDir(destDir);
}

const FORMATS = [['zip', '.zip'], ['7z', '.7z'], ['tar.gz', '.tar.gz'], ['tar.xz', '.tar.xz'], ['tar.zst', '.tar.zst'], ['tar', '.tar']];
const FMT_KEY = 'nova-compress-format';

function compressDialog(base, count) {
  let fmt = 'zip';
  try { fmt = localStorage.getItem(FMT_KEY) || 'zip'; } catch { /* default */ }
  if (!FORMATS.some(([f]) => f === fmt)) fmt = 'zip';
  return dialog({
    title: `Compress ${plural(count, 'item')}`,
    html: `
      <div class="cz-grid">
        <label>Name</label><div class="cz-name"><input data-k="name" spellcheck="false" value="${esc(base)}"><span class="cz-ext"></span></div>
        <label>Format</label><select data-k="format">${FORMATS.map(([f, e]) => `<option value="${f}" ${f === fmt ? 'selected' : ''}>${e.slice(1)}</option>`).join('')}</select>
        <label>Password</label><input data-k="password" type="password" placeholder="Optional — zip and 7z only">
      </div>
      <div class="m-actions"><button class="btn" data-cancel>Cancel</button><button class="btn primary" data-submit>Compress</button></div>`,
    setup: (root) => {
      const sync = () => {
        const f = $('[data-k="format"]', root).value;
        $('.cz-ext', root).textContent = FORMATS.find(([x]) => x === f)[1];
        const pw = $('[data-k="password"]', root);
        pw.disabled = !(f === 'zip' || f === '7z');
        if (pw.disabled) pw.value = '';
        $('[data-submit]', root).disabled = !$('[data-k="name"]', root).value.trim();
      };
      root.addEventListener('input', sync);
      root.addEventListener('change', sync);
      sync();
      const n = $('[data-k="name"]', root);
      n.focus();
      n.select();
    },
    submit: (root) => {
      const format = $('[data-k="format"]', root).value;
      try { localStorage.setItem(FMT_KEY, format); } catch { /* storage unavailable */ }
      return { name: $('[data-k="name"]', root).value.trim(), format, password: $('[data-k="password"]', root).value || null };
    },
  });
}

async function compress(paths, destDir, quick) {
  if (!paths.length) return;
  const base = archiveName(paths, destDir);
  const opts = quick ? { name: base, format: 'zip', password: null } : await compressDialog(base, paths.length);
  if (!opts) return;
  const id = `c${++jobSeq}`;
  const what = paths.length === 1 ? `“${P.basename(paths[0])}”` : plural(paths.length, 'item');
  const task = taskToast(id, `Compressing ${what}…`, () => api.archive.cancel(id));
  const r = await api.archive.compress({ id, sources: paths, destDir, ...opts });
  task.close();
  if (r.ok) {
    pushUndo({ type: 'create', pairs: [{ to: r.path }] });
    toast(`Created “${P.basename(r.path)}”`, 'success', { action: { label: 'Show', fn: () => locate(r.path) } });
  } else if (r.cancelled) toast('Compression cancelled');
  else toast(`Couldn't compress — ${r.error}`, 'error', { timeout: 8000 });
  await refreshDir(destDir);
}

/* =========================================================
 * Recursive search (replaces the pane body while open)
 * ======================================================= */
function newSearch() {
  return {
    open: false, root: HOME, query: '', opts: { matchCase: false, regex: false, content: false, hidden: false },
    results: [], map: new Map(), sel: new Set(), cursor: null, anchor: null,
    id: null, running: false, dirs: 0, done: null, sort: { key: null, dir: 1 },
  };
}
function searchVisible(s) {
  if (!s.sort.key) return s.results;
  const { key, dir } = s.sort;
  return s.results.slice().sort((a, b) => {
    let r = 0;
    if (key === 'size') r = (a.size ?? -1) - (b.size ?? -1);
    else if (key === 'mtime') r = a.mtime - b.mtime;
    else if (key === 'dir') r = collator.compare(P.dirname(a.path), P.dirname(b.path));
    if (!r) r = collator.compare(a.name, b.name);
    return r * dir;
  });
}
const searchSel = (pane) => searchVisible(pane.search).filter((e) => pane.search.sel.has(e.path)).map((e) => e.path);

function openSearch(pane, root = currentDir(tabOf(pane))) {
  const s = pane.search;
  if (s.root !== root) {
    if (s.running) api.search.cancel(s.id);
    Object.assign(s, { root, results: [], map: new Map(), sel: new Set(), cursor: null, anchor: null, id: null, running: false, done: null });
  }
  s.open = true;
  pane.el.classList.add('searching');
  setActivePane(pane.index);
  renderSearch(pane);
  pane.sInput.focus();
  pane.sInput.select();
  updatePreview(true);
}
function closeSearch(pane) {
  const s = pane.search;
  if (s.running) api.search.cancel(s.id);
  s.open = false;
  pane.el.classList.remove('searching');
  if (document.activeElement === pane.sInput) pane.sInput.blur();
  updatePreview(true);
}
async function runSearch(pane) {
  const s = pane.search;
  const query = pane.sInput.value.trim();
  if (!query) return;
  if (s.running) api.search.cancel(s.id);
  const id = `s${++jobSeq}`;
  Object.assign(s, { id, query, results: [], map: new Map(), sel: new Set(), cursor: null, anchor: null, running: true, dirs: 0, done: null });
  renderSearch(pane);
  const r = await api.search.start(id, { root: s.root, query, ...s.opts });
  if (s.id !== id) return; // superseded by a newer search
  s.running = false;
  s.done = r;
  if (!r.ok) toast(r.error, 'error');
  renderSearch(pane);
}
api.search.onBatch(({ id, items, dirs }) => {
  const pane = state.panes.find((p) => p.search.id === id);
  if (!pane) return;
  const s = pane.search;
  s.dirs = dirs;
  for (const e of items) if (!s.map.has(e.path)) { s.results.push(e); s.map.set(e.path, e); }
  // Batches arrive quickly; coalesce re-renders.
  if (!pane.searchRenderT) pane.searchRenderT = setTimeout(() => { pane.searchRenderT = 0; renderSearch(pane); }, 120);
});
// Drop results that were moved or deleted.
function searchForget(paths) {
  for (const pane of state.panes) {
    const s = pane.search;
    if (!s.results.length) continue;
    const gone = (p) => paths.some((x) => P.isInside(p, x));
    const before = s.results.length;
    s.results = s.results.filter((e) => !gone(e.path));
    if (s.results.length === before) continue;
    s.map = new Map(s.results.map((e) => [e.path, e]));
    for (const p of [...s.sel]) if (!s.map.has(p)) s.sel.delete(p);
    if (s.cursor && !s.map.has(s.cursor)) s.cursor = null;
    renderSearch(pane);
  }
}

function highlightName(name, s) {
  if (s.opts.regex || s.opts.content || /[*?]/.test(s.query)) return esc(name);
  const i = s.opts.matchCase ? name.indexOf(s.query) : name.toLowerCase().indexOf(s.query.toLowerCase());
  if (i < 0 || !s.query) return esc(name);
  return `${esc(name.slice(0, i))}<mark>${esc(name.slice(i, i + s.query.length))}</mark>${esc(name.slice(i + s.query.length))}`;
}
function searchRowHtml(e, s) {
  const cls = ['row'];
  if (s.sel.has(e.path)) cls.push('sel');
  if (s.cursor === e.path && (s.sel.size > 1 || !s.sel.has(e.path))) cls.push('cursor');
  if (e.hidden) cls.push('hidden-file');
  if (tagOf(e.path)) cls.push('tagged');
  if (state.clipboard?.mode === 'cut' && state.clipboard.set.has(e.path)) cls.push('cut');
  const parent = P.dirname(e.path);
  const rel = parent === s.root ? '' : parent.slice(s.root === '/' ? 1 : s.root.length + 1);
  const age = ageInfo(e.mtime);
  return `<div class="${cls.join(' ')}" data-path="${esc(e.path)}" draggable="true"${tagStyle(e.path)}${e.isDir ? ` data-drop="${esc(e.path)}"` : ''}>`
    + `${rowIcon(e)}<span class="r-name">${highlightName(e.name, s)}${e.snippet ? `<span class="s-snip">${esc(e.snippet)}</span>` : ''}</span>`
    + `<span class="s-dir" title="${esc(parent)}">${esc(rel || '·')}</span>`
    + `<span class="c-age"><i style="background:${age.color}">${age.label}</i></span>`
    + `<span class="c-size">${e.isDir ? '' : fmtSize(e.size)}</span></div>`;
}
function renderSearch(pane) {
  const s = pane.search;
  if (!s?.open) return;
  pane.searchEl.querySelectorAll('[data-opt]').forEach((b) => b.classList.toggle('on', !!s.opts[b.dataset.opt]));
  $('.s-go', pane.searchEl).textContent = s.running ? 'Stop' : 'Search';
  pane.sInput.placeholder = s.opts.content ? 'Find text inside files' : s.opts.regex ? 'Regular expression for names' : 'Search names — * and ? work as wildcards';
  const where = P.display(s.root);
  let status;
  if (s.done?.tag) status = `${plural(s.results.length, 'item')} tagged ${TAGS[s.done.tag][0]}`;
  else if (s.running) status = `Searching ${where}… ${plural(s.results.length, 'result')} · ${s.dirs.toLocaleString()} folders`;
  else if (s.done?.ok) {
    status = `${plural(s.results.length, 'result')} in ${where} · ${s.done.dirs.toLocaleString()} folders · ${(s.done.ms / 1000).toFixed(1)} s`;
    if (s.done.truncated) status += ' · stopped at 10,000 results';
    else if (s.done.cancelled) status += ' · stopped';
  } else status = `Search in ${where}${s.opts.hidden ? '' : ' (hidden items skipped)'}`;
  const st = $('.s-status', pane.searchEl);
  st.textContent = status;
  st.classList.toggle('running', s.running);

  const vis = searchVisible(s);
  const head = (key, label, cls = '') => {
    const on = s.sort.key === key;
    return `<span class="${on ? 'sorted' : ''} ${cls}" data-sort="${key}">${label}${on ? (s.sort.dir > 0 ? ' ▴' : ' ▾') : ''}</span>`;
  };
  const old = $('.s-body', pane.searchEl);
  const top = old ? old.scrollTop : 0;
  let body;
  if (vis.length) body = vis.map((e) => searchRowHtml(e, s)).join('');
  else body = `<div class="empty">${s.running ? 'Searching…' : s.done ? 'No matches' : 'Type a name and press Enter'}</div>`;
  $('.s-list', pane.searchEl).innerHTML = `
    <div class="s-head"><span></span>${head('name', 'Name')}${head('dir', 'Folder')}${head('mtime', 'Age', 'num')}${head('size', 'Size', 'num')}</div>
    <div class="s-body ${activePane() === pane ? 'focused' : ''}">${body}</div>`;
  $('.s-body', pane.searchEl).scrollTop = top;
}
function searchCursorVisible(pane) {
  const s = pane.search;
  if (!s.cursor) return;
  pane.searchEl.querySelector(`.row[data-path="${CSS.escape(s.cursor)}"]`)?.scrollIntoView({ block: 'nearest' });
}
function searchSelect(pane, path, { ctrl = false, shift = false } = {}) {
  const s = pane.search;
  if (ctrl) {
    if (s.sel.has(path)) s.sel.delete(path); else s.sel.add(path);
    s.cursor = s.anchor = path;
  } else if (shift && s.anchor) {
    const vis = searchVisible(s).map((e) => e.path);
    let a = vis.indexOf(s.anchor);
    const b = vis.indexOf(path);
    if (a < 0) a = b;
    s.sel = new Set(vis.slice(Math.min(a, b), Math.max(a, b) + 1));
    s.cursor = path;
  } else {
    s.sel = new Set([path]);
    s.cursor = s.anchor = path;
  }
  renderSearch(pane);
  searchCursorVisible(pane);
  updatePreview();
}
function openSearchResult(pane, p) {
  const e = pane.search.map.get(p);
  if (!e) return;
  if (e.isDir) navigate(pane, tabOf(pane), p);
  else openFile(p);
}
function searchMenu(x, y, pane) {
  const s = pane.search;
  const paths = searchSel(pane);
  if (!paths.length) return;
  const single = paths.length === 1 ? s.map.get(paths[0]) : null;
  const items = [{ label: paths.length > 1 ? `Open ${paths.length} items` : 'Open', icon: 'open', key: 'Enter', act: () => (single ? openSearchResult(pane, single.path) : paths.slice(0, 12).forEach(openFile)) }];
  if (single) {
    items.push({ label: 'Show in folder', icon: 'reveal', act: () => locate(single.path) });
    items.push({ label: single.isDir ? 'Open in new tab' : 'Open folder in new tab', icon: 'tab', act: () => addTab(pane, single.isDir ? single.path : P.dirname(single.path)) });
  }
  items.push('-');
  items.push({ label: 'Cut', icon: 'cut', key: kb('cut'), act: () => setClipboard('cut', paths) });
  items.push({ label: 'Copy', icon: 'copy', key: kb('copy'), act: () => setClipboard('copy', paths) });
  items.push({ label: 'Copy path', icon: 'link', key: kb('copyPath'), act: () => copyPaths(paths) });
  if (state.dual) items.push({ label: 'Copy to other pane', icon: 'copy', key: kb('copyOther'), act: () => toOtherPane('copy') });
  items.push({ label: 'Add to Drop List', icon: 'tray', key: kb('dropList'), act: () => addToDropList(selectionItems(paths, (p) => s.map.get(p))) });
  items.push(tagItem(paths));
  items.push('-');
  items.push({ label: 'Move to Trash', icon: 'trash', key: kb('trash'), danger: true, act: () => trashPaths(paths) });
  items.push({ label: 'Delete permanently', icon: 'x', key: kb('deletePerm'), danger: true, act: () => deletePermanently(paths) });
  showMenu(x, y, items);
}

// Keys for the search results. Returns true when the key was consumed; anything
// else (Delete, F6, Ctrl+C/X, Alt+digits, Ctrl+T…) falls through to the global handler.
function searchKey(e, pane) {
  const s = pane.search;
  const ctrl = e.ctrlKey || e.metaKey;
  const vis = searchVisible(s);
  const move = (to) => {
    if (!vis.length) return;
    let i = vis.findIndex((x) => x.path === s.cursor);
    if (typeof to === 'number') i = i < 0 ? (to > 0 ? 0 : vis.length - 1) : Math.max(0, Math.min(vis.length - 1, i + to));
    else i = to === 'home' ? 0 : vis.length - 1;
    searchSelect(pane, vis[i].path, { shift: e.shiftKey });
  };
  if (ctrl) {
    const k = e.key.toLowerCase();
    if (k === 'a') { e.preventDefault(); s.sel = new Set(vis.map((x) => x.path)); renderSearch(pane); updatePreview(); return true; }
    if (k === 'f' && !e.shiftKey) { e.preventDefault(); pane.sInput.focus(); pane.sInput.select(); return true; }
    return false;
  }
  if (e.altKey) return false;
  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); move(1); return true;
    case 'ArrowUp': e.preventDefault(); move(-1); return true;
    case 'PageDown': e.preventDefault(); move(15); return true;
    case 'PageUp': e.preventDefault(); move(-15); return true;
    case 'Home': e.preventDefault(); move('home'); return true;
    case 'End': e.preventDefault(); move('end'); return true;
    case 'Enter': {
      e.preventDefault();
      const ps = searchSel(pane);
      if (ps.length === 1) openSearchResult(pane, ps[0]);
      else ps.filter((p) => !s.map.get(p)?.isDir).slice(0, 12).forEach(openFile);
      return true;
    }
    case 'Escape':
      e.preventDefault();
      if (s.running) api.search.cancel(s.id);
      else if (s.sel.size) { s.sel.clear(); renderSearch(pane); updatePreview(); }
      else closeSearch(pane);
      return true;
    case 'Delete': case 'F6': case 'F5': case 'F7': case 'Tab': case ' ': return false;
  }
  // Swallow everything else so it doesn't act on the hidden folder view.
  if (e.key.length === 1 || /^(F\d+|Backspace|ArrowLeft|ArrowRight)$/.test(e.key)) { e.preventDefault(); return true; }
  return false;
}

function bindSearch(pane) {
  pane.search = newSearch();
  const el = pane.searchEl;
  pane.sInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    const s = pane.search;
    if (e.key === 'Enter') { e.preventDefault(); runSearch(pane); }
    else if (e.key === 'Escape') { e.preventDefault(); if (s.running) api.search.cancel(s.id); else closeSearch(pane); }
    else if (e.key === 'ArrowDown' && s.results.length) {
      e.preventDefault();
      pane.sInput.blur();
      searchSelect(pane, searchVisible(s)[0].path);
    }
  });
  $('.s-bar', el).addEventListener('click', (e) => {
    const s = pane.search;
    const opt = e.target.closest('[data-opt]');
    if (opt) {
      s.opts[opt.dataset.opt] = !s.opts[opt.dataset.opt];
      renderSearch(pane);
      if (pane.sInput.value.trim() && (s.done || s.running)) runSearch(pane);
      pane.sInput.focus();
    } else if (e.target.closest('.s-go')) {
      if (s.running) api.search.cancel(s.id); else runSearch(pane);
    } else if (e.target.closest('.s-close')) closeSearch(pane);
  });
  const list = $('.s-list', el);
  list.addEventListener('click', (e) => {
    const s = pane.search;
    const h = e.target.closest('[data-sort]');
    if (h) {
      const key = h.dataset.sort;
      s.sort = s.sort.key === key ? { key, dir: -s.sort.dir } : { key, dir: key === 'mtime' || key === 'size' ? -1 : 1 };
      renderSearch(pane);
      return;
    }
    const row = e.target.closest('.row[data-path]');
    if (!row) { s.sel.clear(); renderSearch(pane); updatePreview(); return; }
    if (e.detail === 2 && !e.ctrlKey && !e.metaKey && !e.shiftKey) { openSearchResult(pane, row.dataset.path); return; }
    searchSelect(pane, row.dataset.path, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
  });
  list.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    setActivePane(pane.index);
    const row = e.target.closest('.row[data-path]');
    if (!row) return;
    if (!pane.search.sel.has(row.dataset.path)) searchSelect(pane, row.dataset.path);
    searchMenu(e.clientX, e.clientY, pane);
  });
}

/* =========================================================
 * Settings
 * ======================================================= */
function applySettings() {
  const root = document.documentElement.style;
  root.setProperty('--row-h', `${S().rowHeight}px`);
  root.setProperty('--fs', `${S().fontSize}px`);
  root.setProperty('--pcol-w', `${S().parentColWidth}px`);
  $('#panes').classList.toggle('stacked', S().layout === 'stacked');
  if (S().accent) root.setProperty('--accent', S().accent); else root.removeProperty('--accent');
  compileHidden();
  buildKeymap();
}
function settingsChanged() {
  applySettings();
  renderAll();
  saveState();
}

async function renameTab(pane, i) {
  const t = pane.tabs[i];
  const v = await promptDialog({ title: 'Tab name', body: 'Leave empty to show the folder name.', value: tabLabel(t), confirm: 'Save' });
  if (v == null) return;
  t.alias = v.trim() && v.trim() !== dirLabel(t.path) ? v.trim() : '';
  t.aliasPath = t.alias ? t.path : '';
  renderTabs(pane);
  saveState();
}

function openSettings() {
  const s = S();
  const chk = (k, label, hint = '') => `<label class="st-row"><input type="checkbox" data-set="${k}" ${s[k] ? 'checked' : ''}><span>${label}${hint ? `<small>${hint}</small>` : ''}</span></label>`;
  const opt = (k, v, label) => `<option value="${v}" ${String(s[k]) === String(v) ? 'selected' : ''}>${label}</option>`;
  const general = `
    ${chk('foldersFirst', 'Keep folders above files')}
    ${chk('showExtensions', 'Show file extensions in names', 'The Ext column always shows them')}
    ${chk('confirmTrash', 'Ask before moving items to the Trash')}
    ${chk('keepTabAlias', 'Keep a renamed tab’s name when it moves to another folder')}
    ${chk('showRecent', 'Show recent folders in the sidebar')}
    <label class="st-field"><span>Remember</span><input type="number" min="5" max="200" data-set="recentMax" value="${s.recentMax}"><span>recent folders</span></label>
    <label class="st-field"><span>Date format</span><select data-set="dateFormat">${opt('dateFormat', 'iso', '2026-10-14')}${opt('dateFormat', 'dmy', '14/10/2026')}${opt('dateFormat', 'mdy', '10/14/2026')}${opt('dateFormat', 'locale', 'System format')}</select></label>
    <label class="st-field wide"><span>Also treat as hidden</span><input data-set="hiddenPatterns" spellcheck="false" placeholder="e.g. *.tmp, __pycache__, desktop.ini" value="${esc(s.hiddenPatterns)}"></label>
    ${chk('markRecent', 'Highlight files changed in the last hour')}
    ${chk('showDrives', 'Show the Drives section in the sidebar')}
    ${chk('thumbCache', 'Cache thumbnails of large images', 'Makes thumbnail view faster the next time')}
    <div class="st-field"><span>Thumbnail cache</span><span class="tc-size">…</span><button class="btn" data-tc-clear>Clear</button></div>
    <h4 class="st-h">System</h4>
    <div class="st-field"><span>Default file manager</span><span class="fm-state">…</span><button class="btn" data-fm hidden>Make Nova the default</button></div>
    ${chk('keepInTray', 'Keep running in the tray when the last window closes')}
    <div class="st-field"><span>Global shortcut</span><kbd class="hk">${esc(s.globalHotkey || 'none')}</kbd><button class="btn" data-hk>Set…</button><button class="btn" data-hk-clear ${s.globalHotkey ? '' : 'disabled'}>Clear</button></div>
    <p class="st-note">The global shortcut brings Nova to the front from anywhere (press it again to hide).</p>`;
  const appearance = `
    <label class="st-field"><span>Theme</span><select data-set="theme">${THEMES.map(([, n], i) => `<option value="${i}" ${state.theme === i ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <label class="st-field"><span>Accent colour</span><input type="color" data-set="accent" value="${s.accent || getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#f7801d'}"><button class="btn" data-accent-reset ${s.accent ? '' : 'disabled'}>Theme default</button></label>
    <label class="st-field"><span>Row height</span><select data-set="rowHeight">${opt('rowHeight', 20, 'Compact')}${opt('rowHeight', 23, 'Normal')}${opt('rowHeight', 28, 'Comfortable')}</select></label>
    <label class="st-field"><span>Text size</span><input type="range" min="12" max="16" step="0.5" data-set="fontSize" value="${s.fontSize}"><output>${s.fontSize}px</output></label>
    <label class="st-field"><span>Thumbnail size</span><input type="range" min="72" max="240" step="8" data-set="gridSize" value="${s.gridSize}"><output>${s.gridSize}px</output></label>
    <label class="st-field"><span>Pane layout</span><select data-set="layout">${opt('layout', 'side', 'Side by side')}${opt('layout', 'stacked', 'Above each other')}</select></label>
    <label class="st-field"><span>Parent column width</span><input type="range" min="130" max="340" step="10" data-set="parentColWidth" value="${s.parentColWidth}"><output>${s.parentColWidth}px</output></label>
    ${chk('expandColumns', 'Widen a parent column to fit long names while the mouse rests on it')}
    <label class="st-field"><span>Icons</span><select data-set="iconTheme"><option value="">Nova (built-in)</option></select></label>
    <div class="st-field"><span>List columns</span><button class="btn" data-columns>Choose columns…</button></div>
    <p class="st-note">Tip: Ctrl + mouse wheel resizes thumbnails too.</p>`;
  const keyRows = () => ACTIONS.map((a) => {
    const keys = actionKeys(a);
    const custom = s.keys[a.id] !== undefined;
    return `<div class="kb-row" data-action="${a.id}"><span class="kb-label">${esc(a.label)}</span><span class="kb-keys">${keys.map((k) => `<kbd>${esc(prettyKey(k))}</kbd>`).join('') || '<em>none</em>'}</span><button class="btn kb-set">Change</button><button class="ib kb-reset" title="Reset to default" ${custom ? '' : 'disabled'}>${line('undoTab')}</button></div>`;
  }).join('');
  const keyboard = `<div class="kb-note">Click <b>Change</b>, then press the new shortcut. Backspace removes it, Esc cancels.</div><div class="kb-list">${keyRows()}</div><div class="kb-foot"><span class="kb-msg"></span><button class="btn" data-kb-reset-all>Reset all shortcuts</button></div>`;

  dialog({
    title: 'Settings',
    cls: 'wide settings',
    html: `<div class="st-tabs"><button class="on" data-st="general">General</button><button data-st="appearance">Appearance</button><button data-st="keyboard">Keyboard</button></div>
      <div class="st-page" data-page="general">${general}</div>
      <div class="st-page" data-page="appearance" hidden>${appearance}</div>
      <div class="st-page" data-page="keyboard" hidden>${keyboard}</div>
      <div class="m-actions"><button class="btn primary" data-cancel>Done</button></div>`,
    setup: (root) => {
      const msg = (t) => { $('.kb-msg', root).textContent = t; };
      // Things that need the main process: default file manager, cache size, icon themes.
      const showFM = (r) => { $('.fm-state', root).textContent = r.isNova ? 'Nova Commander' : (r.current || 'not set').replace(/\.desktop$/, ''); $('[data-fm]', root).hidden = r.isNova; };
      api.defaultFM().then(showFM);
      const showTC = (r) => { $('.tc-size', root).textContent = `${plural(r.count, 'image')} · ${fmtSize(r.size)}`; };
      api.thumbStats(false).then(showTC);
      api.iconThemes().then((themes) => {
        const sel = $('[data-set="iconTheme"]', root);
        sel.insertAdjacentHTML('beforeend', themes.map((t) => `<option value="${esc(t.id)}" ${s.iconTheme === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join(''));
      });
      root.addEventListener('click', async (e) => {
        if (e.target.closest('[data-fm]')) { showFM(await api.defaultFM(true)); return; }
        if (e.target.closest('[data-tc-clear]')) { showTC(await api.thumbStats(true)); return; }
        if (e.target.closest('[data-columns]')) { chooseColumns(); return; }
        if (e.target.closest('[data-hk-clear]')) { s.globalHotkey = ''; settingsChanged(); applyBackground(); $('.hk', root).textContent = 'none'; e.target.closest('[data-hk-clear]').disabled = true; return; }
        if (e.target.closest('[data-hk]')) {
          // Capture a key combination for the system-wide shortcut (needs a modifier).
          $('.hk', root).textContent = 'Press keys…';
          const onKey = async (ev) => {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            const combo = comboOf(ev);
            if (!combo) return;
            window.removeEventListener('keydown', onKey, true);
            if (combo === 'Escape' || !/^(Ctrl|Alt|Shift)\+/.test(combo) || /^Shift\+[^+]+$/.test(combo)) { $('.hk', root).textContent = s.globalHotkey || 'none'; if (combo !== 'Escape') toast('Use Ctrl or Alt (plus a key) for a global shortcut'); return; }
            const accel = combo.replace(/^Ctrl\b/, 'Control');
            const prev = s.globalHotkey;
            s.globalHotkey = accel;
            const r = await applyBackground();
            if (!r.ok) s.globalHotkey = prev;
            settingsChanged();
            $('.hk', root).textContent = s.globalHotkey || 'none';
            $('[data-hk-clear]', root).disabled = !s.globalHotkey;
          };
          window.addEventListener('keydown', onKey, true);
          return;
        }
        const tabBtn = e.target.closest('[data-st]');
        if (tabBtn) {
          root.querySelectorAll('[data-st]').forEach((b) => b.classList.toggle('on', b === tabBtn));
          root.querySelectorAll('[data-page]').forEach((p) => { p.hidden = p.dataset.page !== tabBtn.dataset.st; });
          return;
        }
        if (e.target.closest('[data-accent-reset]')) {
          s.accent = '';
          settingsChanged();
          e.target.closest('[data-accent-reset]').disabled = true;
          $('[data-set="accent"]', root).value = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
          return;
        }
        if (e.target.closest('[data-kb-reset-all]')) { s.keys = {}; settingsChanged(); $('.kb-list', root).innerHTML = keyRows(); msg('All shortcuts are back to their defaults.'); return; }
        const row = e.target.closest('[data-action]');
        if (!row) return;
        const a = ACTIONS.find((x) => x.id === row.dataset.action);
        if (e.target.closest('.kb-reset')) { delete s.keys[a.id]; settingsChanged(); $('.kb-list', root).innerHTML = keyRows(); msg(''); return; }
        if (!e.target.closest('.kb-set')) return;
        // Capture the next key press (window capture runs before the dialog's own handler).
        row.classList.add('capturing');
        $('.kb-keys', row).innerHTML = '<em>Press a shortcut…</em>';
        const onKey = (ev) => {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          const combo = comboOf(ev);
          if (!combo) return;
          window.removeEventListener('keydown', onKey, true);
          if (combo === 'Escape') { msg(''); }
          else if (combo === 'Backspace') { s.keys[a.id] = []; msg(`${a.label} has no shortcut now.`); }
          else {
            const clash = ACTIONS.find((x) => x !== a && actionKeys(x).includes(combo));
            if (clash) s.keys[clash.id] = actionKeys(clash).filter((k) => k !== combo);
            s.keys[a.id] = [combo];
            msg(clash ? `${prettyKey(combo)} was moved from “${clash.label}”.` : '');
          }
          settingsChanged();
          $('.kb-list', root).innerHTML = keyRows();
        };
        window.addEventListener('keydown', onKey, true);
      });
      root.addEventListener('input', (e) => {
        const el = e.target.closest('[data-set]');
        if (!el) return;
        const k = el.dataset.set;
        if (k === 'theme') { setTheme(+el.value); if (!s.accent) $('[data-set="accent"]', root).value = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); return; }
        if (el.type === 'checkbox') s[k] = el.checked;
        else if (el.type === 'number' || el.type === 'range' || k === 'rowHeight' || k === 'parentColWidth') s[k] = Number(el.value) || DEFAULT_SETTINGS[k];
        else s[k] = el.value;
        if (k === 'accent') $('[data-accent-reset]', root).disabled = false;
        if (k === 'recentMax') state.recent = state.recent.slice(0, s.recentMax);
        const out = el.parentElement.querySelector('output');
        if (out) out.textContent = `${el.value}px`;
        settingsChanged();
        if (k === 'keepInTray') applyBackground();
        if (k === 'iconTheme') applyIconPack();
        if (k === 'layout') applySplit();
      });
    },
  });
}

/* =========================================================
 * Chrome: title bar, sidebar, divider
 * ======================================================= */
function bindChrome() {
  $('#win-min').onclick = api.win.min;
  $('#win-max').onclick = api.win.max;
  $('#win-close').onclick = api.win.close;
  $('#titlebar').addEventListener('dblclick', (e) => { if (e.target.closest('.tb-drag')) api.win.max(); });

  $('#btn-theme').innerHTML = line('palette');
  $('#btn-hidden').innerHTML = line('eye');
  $('#btn-dual').innerHTML = line('dual');
  $('#btn-preview').innerHTML = line('panelBottom');
  $('#btn-undo').innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';
  $('#btn-theme').onclick = () => setTheme(state.theme + 1);
  $('#btn-theme').oncontextmenu = (e) => {
    e.preventDefault();
    showMenu(e.clientX, e.clientY, THEMES.map(([, name], i) => ({ label: (i === state.theme ? '● ' : '') + name, icon: 'palette', act: () => setTheme(i) })));
  };
  $('#btn-undo').onclick = () => undo();
  $('#btn-settings').innerHTML = line('settings');
  $('#btn-settings').onclick = openSettings;
  bindOps();
  $('#btn-hidden').onclick = toggleHidden;
  $('#btn-dual').onclick = toggleDual;
  $('#btn-preview').onclick = toggleInfo;

  const sb = $('#sidebar');
  sb.addEventListener('click', (e) => {
    const fold = e.target.closest('[data-collapse]');
    if (fold) { const id = fold.dataset.collapse; if (state.collapsed[id]) delete state.collapsed[id]; else state.collapsed[id] = true; sidebarChanged(); return; }
    const um = e.target.closest('[data-unmount]');
    if (um) { unmountShare(um.dataset.unmount); return; }
    if (e.target.closest('[data-connect]')) { connectDialog(); return; }
    const tg = e.target.closest('[data-tagged]');
    if (tg) { showTagged(+tg.dataset.tagged); return; }
    const add = e.target.closest('[data-fav-add]');
    if (add) { addFavorites([currentDir(tabOf(activePane()))], +add.dataset.favAdd); return; }
    if (e.target.closest('[data-recent-clear]')) { state.recent = []; sidebarChanged(); return; }
    const dl = e.target.closest('[data-dl]');
    if (dl) { if (dl.dataset.dl === 'clear') removeFromDropList(state.dropList.map((x) => x.path)); else applyDropList(dl.dataset.dl); return; }
    const rm = e.target.closest('[data-dl-remove]');
    if (rm) { removeFromDropList([rm.dataset.dlRemove]); return; }
    const dli = e.target.closest('[data-dl-item]');
    if (dli) { locate(dli.dataset.dlItem); return; }
    const it = e.target.closest('[data-nav]');
    if (!it) return;
    const pane = activePane();
    navigate(pane, tabOf(pane), it.dataset.nav);
  });
  sb.addEventListener('auxclick', (e) => {
    const it = e.target.closest('[data-nav]');
    if (it && e.button === 1) addTab(activePane(), it.dataset.nav);
  });
  sb.addEventListener('contextmenu', (e) => {
    const head = e.target.closest('[data-group-head]');
    if (head) {
      e.preventDefault();
      const gi = +head.dataset.groupHead;
      const n = state.favGroups.length;
      showMenu(e.clientX, e.clientY, [
        { label: 'Add current folder', icon: 'plus', act: () => addFavorites([currentDir(tabOf(activePane()))], gi) },
        { label: 'New group…', icon: 'folderPlus', act: newFavGroup },
        { label: 'Rename group…', icon: 'rename', act: () => renameFavGroup(gi) },
        '-',
        { label: 'Move group up', icon: 'up', disabled: gi === 0, act: () => moveFavGroup(gi, -1) },
        { label: 'Move group down', icon: 'up', disabled: gi === n - 1, act: () => moveFavGroup(gi, 1) },
        '-',
        { label: 'Delete group', icon: 'x', danger: true, act: () => deleteFavGroup(gi) },
      ]);
      return;
    }
    const it = e.target.closest('[data-nav]');
    if (!it) return;
    e.preventDefault();
    const p = it.dataset.nav;
    const items = [
      { label: 'Open', icon: 'open', act: () => navigate(activePane(), tabOf(activePane()), p) },
      { label: 'Open in new tab', icon: 'tab', act: () => addTab(activePane(), p) },
      ...(state.dual ? [{ label: 'Open in other pane', icon: 'moveRight', act: () => navigate(otherPane(), tabOf(otherPane()), p) }] : []),
      { label: 'Open in terminal', icon: 'terminal', act: () => openTerminal(p) },
      { label: 'Copy path', icon: 'link', act: () => copyPaths([p]) },
    ];
    if (it.dataset.fav) {
      const key = it.dataset.fav;
      const { gi, ii, g } = favAt(key);
      items.push('-', { label: 'Rename…', icon: 'rename', act: () => renameFavorite(key) });
      if (ii > 0) items.push({ label: 'Move up', icon: 'up', act: () => moveFavorite(key, gi, ii - 1) });
      if (ii < g.items.length - 1) items.push({ label: 'Move down', icon: 'up', act: () => moveFavorite(key, gi, ii + 2) });
      state.favGroups.forEach((og, ogi) => { if (ogi !== gi) items.push({ label: `Move to “${og.name}”`, icon: 'moveRight', act: () => moveFavorite(key, ogi) }); });
      items.push({ label: 'New group…', icon: 'folderPlus', act: newFavGroup });
      items.push('-', { label: 'Remove from Favorites', icon: 'x', danger: true, act: () => removeFavorite(key) });
    } else if (it.dataset.mount) {
      items.push('-', { label: 'Unmount', icon: 'eject', act: () => unmountShare(p) });
    } else if (it.dataset.recent) {
      items.push('-', { label: 'Add to Favorites', icon: 'star', act: () => addFavorites([p]) });
      items.push({ label: 'Remove from Recent', icon: 'x', act: () => { state.recent = state.recent.filter((x) => x !== p); sidebarChanged(); } });
    } else items.push('-', { label: 'Add to Favorites', icon: 'star', act: () => addFavorites([p]) });
    showMenu(e.clientX, e.clientY, items);
  });

  const div = $('#pane-divider');
  div.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const box = $('#panes').getBoundingClientRect();
    const stacked = S().layout === 'stacked';
    const move = (ev) => {
      const f = stacked ? (ev.clientY - box.top) / box.height : (ev.clientX - box.left) / box.width;
      state.split = Math.min(0.8, Math.max(0.2, f));
      applySplit();
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); saveState(); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  div.addEventListener('dblclick', () => { state.split = 0.5; applySplit(); saveState(); });

  api.win.onState((max) => {
    $('#win-max').innerHTML = max
      ? '<svg viewBox="0 0 24 24"><rect x="5" y="8" width="11" height="11" rx="1"/><path d="M8 8V6a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-2"/></svg>'
      : '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>';
  });

  api.onChanged((dir) => refreshDir(dir));
  // A thumbnail that can't be decoded falls back to the file-type icon.
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG' || !img.closest('.g-thumb')) return;
    const path = img.closest('[data-path]')?.dataset.path || '';
    img.outerHTML = iconFor({ name: P.basename(path), isDir: false }, { big: true });
  }, true);
  window.addEventListener('focus', () => loadPlaces());
  // Keep the age badges current.
  setInterval(() => { for (const p of visiblePanes()) if (!p.renaming && !drag) renderBody(p); }, 60000);
}

/* =========================================================
 * Boot
 * ======================================================= */
async function init() {
  const saved = loadState();
  if (saved) {
    // Extra windows take the shared part, plus a saved layout if one was asked for.
    if (!MAIN_WIN) {
      const layout = (saved.savedWindows || []).find((w) => w.name === QUERY.get('saved'));
      Object.assign(saved, { dual: true, info: false, split: 0.5, active: 0, panes: null }, layout || {});
    }
    for (const k of ['savedWindows', 'notes', 'folderBg', 'recentDest', 'collapsed', 'rules']) if (saved[k]) state[k] = saved[k];
    state.dual = saved.dual ?? true;
    state.info = saved.info ?? true;
    state.showHidden = !!saved.showHidden;
    state.split = saved.split || 0.5;
    state.active = saved.active || 0;
    state.settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}), keys: { ...(saved.settings?.keys || {}) }, columns: { ...DEFAULT_SETTINGS.columns, ...(saved.settings?.columns || {}) } };
    if (Array.isArray(saved.favGroups) && saved.favGroups.length) state.favGroups = saved.favGroups;
    else if (Array.isArray(saved.favorites)) state.favGroups = [{ name: 'Favorites', items: saved.favorites.map((p) => ({ path: p })) }]; // pre-1.2 format
    state.recent = Array.isArray(saved.recent) ? saved.recent : [];
    state.dropList = Array.isArray(saved.dropList) ? saved.dropList : [];
    if (saved.v !== STYLE_VERSION) {
      // First run with the One Commander dark style: switch to its defaults.
      state.info = false;
      saved.theme = 0;
      for (const sp of saved.panes || []) for (const t of sp.tabs || []) t.view = 'details';
    }
  }
  applySettings();
  setTheme(saved?.theme ?? 0);
  syncToggles();
  updateUndoBtn();

  const [, tags] = await Promise.all([loadPlaces(), api.tags()]);
  state.tags = tags || {};
  const downloads = state.places.find((p) => p.id === 'downloads')?.path || HOME;
  for (let i = 0; i < 2; i++) {
    const s = saved?.panes?.[i];
    const tabs = s?.tabs?.length ? s.tabs.map((t) => Object.assign(newTab(t.path, t.view, t.sort), { alias: t.alias || '', aliasPath: t.aliasPath || '' })) : [newTab(i === 0 ? HOME : downloads)];
    const pane = { index: i, el: $('#pane' + i), tabs, activeTab: Math.min(s?.activeTab || 0, tabs.length - 1), closed: [] };
    state.panes.push(pane);
    buildPane(pane);
  }
  applySplit();
  bindChrome();

  await Promise.all(state.panes.map(async (pane) => {
    if (pane.index === 1 && !state.dual) return;
    const tab = tabOf(pane);
    const okNav = await navigate(pane, tab, tab.path, { push: false });
    if (!okNav) await navigate(pane, tab, HOME, { push: false });
  }));
  renderAll();
  initTools();
  // A folder handed to the app (command line, "open folder" from the desktop) opens in a new tab.
  const open = (p) => openPathInTab(p);
  api.onOpenPath(open);
  if (QUERY.get('path')) open(QUERY.get('path'));
}

// Wait for tools.js (loaded after this file) before starting.
document.addEventListener('DOMContentLoaded', init);
