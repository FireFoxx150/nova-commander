'use strict';
/* Nova Commander — larger tools: Quick Look, network shares, tag lists, archive browser,
 * copy/move to recent folders, folder notes and backgrounds, scripts, running programs,
 * batch image editing, File Automator, saved windows, columns, icon packs, thumbnail cache.
 * Loaded after app.js and uses its globals. */

/* =========================================================
 * Startup
 * ======================================================= */
function initTools() {
  loadScripts();
  applyIconPack();
  if (MAIN_WIN) applyBackground();
  window.addEventListener('focus', loadScripts);
}
// Tray / keep running and the global shortcut live in the main process; window 1 owns them.
async function applyBackground() {
  api.setBackground(S().keepInTray);
  const r = await api.setHotkey(S().globalHotkey);
  if (!r.ok && S().globalHotkey) toast(`Global shortcut ${S().globalHotkey}: ${r.error}`, 'error', { timeout: 8000 });
  return r;
}
async function loadScripts() {
  const r = await api.scripts();
  state.scripts = r.items;
  state.scriptsDir = r.dir;
}

/* =========================================================
 * Opening paths, tabs
 * ======================================================= */
async function openPathInTab(p) {
  const st = await api.stat(p);
  if (!st.ok) { toast(`Can't open ${P.display(p)}`, 'error'); return; }
  const pane = activePane();
  const dir = st.entry.isDir ? p : P.dirname(p);
  const cur = tabOf(pane);
  const t = newTab(dir, cur.view, cur.sort);
  pane.tabs.push(t);
  pane.activeTab = pane.tabs.length - 1;
  renderPane(pane);
  await navigate(pane, t, dir, { push: false, select: st.entry.isDir ? null : p, openSelected: false });
}
// "New tab from clipboard path": copied files or a path / file:// URI as text.
async function pasteTab() {
  const files = await api.readFilesClipboard();
  let p = files?.paths[0];
  if (!p) {
    const text = (await api.readText()).trim().split('\n')[0].trim();
    try { p = text.startsWith('file://') ? decodeURIComponent(new URL(text).pathname) : P.expand(text); } catch { p = ''; }
  }
  if (!p || !p.startsWith('/')) { toast('The clipboard doesn’t contain a path'); return; }
  openPathInTab(p);
}
function closeStaleTabs(pane, minutes = 60) {
  const cutoff = Date.now() - minutes * 60e3;
  const active = tabOf(pane);
  const gone = pane.tabs.filter((t) => t !== active && (t.lastUsed || 0) < cutoff);
  if (!gone.length) { toast(`No tabs unused for ${minutes} minutes`); return; }
  for (const t of gone) rememberClosed(pane, t, pane.tabs.indexOf(t));
  pane.tabs = pane.tabs.filter((t) => !gone.includes(t));
  activateTab(pane, pane.tabs.indexOf(active));
  toast(`Closed ${plural(gone.length, 'tab')} unused for ${minutes} minutes`, 'info', { action: { label: 'Reopen', fn: async () => { for (let i = 0; i < gone.length; i++) await reopenTab(pane); } } });
}

/* =========================================================
 * Everything with one colour tag (shown in the search panel)
 * ======================================================= */
async function showTagged(color) {
  const pane = activePane();
  const paths = Object.keys(state.tags).filter((p) => state.tags[p] === color);
  const stats = await Promise.all(paths.map((p) => api.stat(p)));
  const items = stats.filter((r) => r.ok).map((r) => r.entry);
  openSearch(pane, '/');
  const s = pane.search;
  if (s.running) api.search.cancel(s.id);
  Object.assign(s, { id: null, running: false, query: '', results: items, map: new Map(items.map((e) => [e.path, e])), sel: new Set(), cursor: null, anchor: null, done: { ok: true, count: items.length, dirs: 0, ms: 0, tag: color } });
  pane.sInput.value = '';
  pane.sInput.blur();
  renderSearch(pane);
  updatePreview(true);
}

/* =========================================================
 * Network shares & devices
 * ======================================================= */
async function connectDialog() {
  const r = await dialog({
    title: 'Connect to server',
    html: `<div class="cz-grid">
        <label>Address</label><input data-k="uri" spellcheck="false" value="smb://" placeholder="smb://nas/share · sftp://user@host · ftp://host · dav://host">
        <label>User</label><input data-k="user" spellcheck="false" placeholder="Empty to connect as guest">
        <label>Password</label><input data-k="password" type="password">
        <label>Domain</label><input data-k="domain" spellcheck="false" placeholder="WORKGROUP">
      </div>
      <div class="nc-hosts"></div>
      <div class="m-actions"><button class="btn" data-scan>Find servers</button><span class="br-sp"></span><button class="btn" data-cancel>Cancel</button><button class="btn primary" data-submit>Connect</button></div>`,
    setup: (root) => {
      const uri = $('[data-k="uri"]', root);
      const hosts = $('.nc-hosts', root);
      uri.focus();
      uri.setSelectionRange(uri.value.length, uri.value.length);
      root.addEventListener('click', async (e) => {
        if (e.target.closest('[data-scan]')) {
          hosts.textContent = 'Looking for servers on the network…';
          const list = await api.net.scan();
          hosts.innerHTML = list.length ? list.map((h) => `<button class="tok" data-host="${esc(h)}">${esc(h)}</button>`).join('') : 'No servers advertise themselves here — type an address instead.';
          return;
        }
        const h = e.target.closest('[data-host]');
        if (h) {
          uri.value = `smb://${h.dataset.host}/`;
          hosts.textContent = `Reading shares on ${h.dataset.host}…`;
          const res = await api.net.shares(h.dataset.host);
          hosts.innerHTML = res.ok && res.shares.length ? res.shares.map((x) => `<button class="tok" data-share="${esc(x)}">${esc(x)}</button>`).join('') : esc(res.error || 'No shares visible without signing in — enter a user and connect.');
          return;
        }
        const sh = e.target.closest('[data-share]');
        if (sh) uri.value = uri.value.replace(/\/?[^/]*$/, `/${sh.dataset.share}`);
      });
    },
    submit: (root) => {
      const v = (k) => $(`[data-k="${k}"]`, root).value.trim();
      if (!/^[a-z0-9+]+:\/\/./i.test(v('uri'))) { toast('Enter an address such as smb://server/share', 'error'); return undefined; }
      return { uri: v('uri'), user: v('user'), password: $('[data-k="password"]', root).value, domain: v('domain') };
    },
  });
  if (!r) return;
  const before = new Set((state.netMounts || []).map((m) => m.path));
  const id = `net${++jobSeq}`;
  const task = taskToast(id, `Connecting to ${r.uri}…`);
  const res = await api.net.connect({ ...r, anonymous: !r.user });
  task.close();
  if (!res.ok) { toast(`Couldn't connect — ${res.error}`, 'error', { timeout: 8000 }); return; }
  await loadPlaces();
  const added = (state.netMounts || []).find((m) => !before.has(m.path));
  if (added) navigate(activePane(), tabOf(activePane()), added.path);
  else toast('Connected');
}
async function unmountShare(p) {
  for (const pane of state.panes) {
    const tab = tabOf(pane);
    if (P.isInside(currentDir(tab), p)) await navigate(pane, tab, HOME);
  }
  const r = await api.net.unmount(p);
  if (!r.ok) toast(`Couldn't unmount — ${r.error}`, 'error');
  await loadPlaces();
}

/* =========================================================
 * Quick Look (Space): a large preview you can step through
 * ======================================================= */
const OFFICE_RE = /\.(docx?|odt|rtf|xlsx?|ods|pptx?|odp)$/i;
const FONT_RE = /\.(ttf|otf|woff2?)$/i;
let fontSeq = 0;
async function loadFontFamily(p) {
  const family = `nova-font-${++fontSeq}`;
  const face = new FontFace(family, `url("${fileUri(p)}")`);
  await face.load();
  document.fonts.add(face);
  return family;
}
function fontSampleHtml(family, big = false) {
  return `<div class="font-sample${big ? ' big' : ''}" style="font-family:'${family}'"><div class="fs-aa">Aa Bb Cc</div><div>The quick brown fox jumps over the lazy dog</div>${big ? '<div class="fs-chars">ABCDEFGHIJKLMNOPQRSTUVWXYZ<br>abcdefghijklmnopqrstuvwxyz<br>0123456789 !?&amp;@#%(){}[]</div>' : ''}</div>`;
}

function quickLookList(pane) {
  if (pane.search.open) {
    const s = pane.search;
    return { list: searchVisible(s), start: s.cursor || searchSel(pane)[0] };
  }
  const { tab, col } = activeCtx(pane);
  if (!col) return { list: [], start: null };
  return { list: visible(tab, col), start: col.cursor || orderedSel(tab, col)[0] };
}
function quickLook() {
  if ($('.ql')) { closeQuickLook(); return; }
  const pane = activePane();
  const { list, start } = quickLookList(pane);
  if (!list.length) return;
  let idx = Math.max(0, list.findIndex((e) => e.path === start));
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop ql';
  bd.innerHTML = `<div class="ql-box"><div class="ql-head"><span class="ql-name"></span><span class="ql-pos"></span><button class="ib" data-ql="open" title="Open (Enter)">${line('open')}</button><button class="ib" data-ql="close" title="Close (Space / Esc)">${line('x')}</button></div><div class="ql-body"></div><div class="ql-foot">← → to move through the folder · Enter opens · Space closes</div></div>`;
  $('#modal-root').appendChild(bd);
  let token = 0;
  const show = async () => {
    const e = list[idx];
    const t = ++token;
    $('.ql-name', bd).textContent = e.name;
    $('.ql-pos', bd).textContent = `${idx + 1} of ${list.length}`;
    const body = $('.ql-body', bd);
    body.innerHTML = '<div class="ql-wait">Loading…</div>';
    const html = await quickLookHtml(e);
    if (t !== token) return;
    body.innerHTML = html;
  };
  const move = (d) => { idx = (idx + d + list.length) % list.length; show(); };
  const onKey = (ev) => {
    ev.stopPropagation();
    if (['Escape', ' '].includes(ev.key)) { ev.preventDefault(); closeQuickLook(); }
    else if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') { ev.preventDefault(); move(1); }
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') { ev.preventDefault(); move(-1); }
    else if (ev.key === 'Enter') { ev.preventDefault(); const e = list[idx]; closeQuickLook(); if (e.isDir) navigate(pane, tabOf(pane), e.path); else openFile(e.path); }
  };
  bd.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-ql]');
    if (b?.dataset.ql === 'close' || ev.target === bd) closeQuickLook();
    else if (b?.dataset.ql === 'open') { const e = list[idx]; closeQuickLook(); if (e.isDir) navigate(pane, tabOf(pane), e.path); else openFile(e.path); }
  });
  document.addEventListener('keydown', onKey, true);
  bd.close = () => { document.removeEventListener('keydown', onKey, true); bd.remove(); };
  show();
}
function closeQuickLook() { $('.ql')?.close(); }

async function quickLookHtml(e) {
  if (FONT_RE.test(e.name)) {
    try { return fontSampleHtml(await loadFontFamily(e.path), true); } catch { return '<div class="ql-wait">This font couldn’t be loaded</div>'; }
  }
  if (OFFICE_RE.test(e.name)) {
    const r = await api.officePreview(e.path);
    return r.ok ? `<iframe class="ql-doc" src="${esc(r.url)}#toolbar=0"></iframe>` : `<div class="ql-wait">No preview — ${esc(r.error)}</div>`;
  }
  if (/\.(eml|msg)$/i.test(e.name)) {
    const m = await (/\.msg$/i.test(e.name) ? api.outlookPreview(e.path) : api.mailPreview(e.path));
    if (!m.ok) return `<div class="ql-wait">${esc(m.error)}</div>`;
    return `<div class="ql-mail"><dl><dt>From</dt><dd>${esc(m.from)}</dd><dt>To</dt><dd>${esc(m.to)}</dd><dt>Date</dt><dd>${esc(m.date)}</dd><dt>Subject</dt><dd><b>${esc(m.subject)}</b></dd></dl><pre>${esc(m.text)}</pre></div>`;
  }
  const info = await api.preview(e.path);
  if (!info.ok) return `<div class="ql-wait">${esc(info.error)}</div>`;
  switch (info.kind) {
    case 'image': return `<img class="ql-img" src="${esc(info.url)}" alt="">`;
    case 'video': return `<video class="ql-img" src="${esc(info.url)}" controls autoplay></video>`;
    case 'audio': return `<div class="ql-icon">${iconFor(e, { big: true })}</div><audio src="${esc(info.url)}" controls autoplay></audio>`;
    case 'pdf': return `<iframe class="ql-doc" src="${esc(info.url)}"></iframe>`;
    case 'text': return `<pre class="ql-text">${esc(info.text)}${info.truncated ? '\n…' : ''}</pre>`;
    case 'dir': return `<div class="ql-icon">${iconFor(e, { big: true })}</div><div class="ql-wait">${info.count == null ? 'No access' : `${plural(info.folders, 'folder')}, ${plural(info.files, 'file')}`}</div>`;
    default: return `<div class="ql-icon">${iconFor(e, { big: true })}</div><div class="ql-wait">${fmtSize(info.size)} · no preview for this type</div>`;
  }
}

/* =========================================================
 * Archive browser: folders inside the archive, extract a selection
 * ======================================================= */
async function browseArchive(p, destDir, password = null) {
  const r = await api.archive.list(p, password);
  if (!r.ok) {
    if (r.needPassword) {
      const pw = await promptDialog({ title: `Password for “${P.basename(p)}”`, body: r.error, password: true, confirm: 'Open' });
      if (pw != null) browseArchive(p, destDir, pw);
      return;
    }
    toast(`Couldn't read “${P.basename(p)}” — ${r.error}`, 'error', { timeout: 8000 });
    return;
  }
  // Build a folder tree; some archives only list files, so parents are derived from paths.
  const tree = new Map();
  const ensure = (dir) => {
    if (tree.has(dir)) return tree.get(dir);
    const node = { dirs: new Set(), files: [], mtime: 0 };
    tree.set(dir, node);
    if (dir) ensure(dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '').dirs.add(dir);
    return node;
  };
  ensure('');
  let files = 0, total = 0;
  for (const e of r.entries) {
    if (e.isDir) { ensure(e.path).mtime = e.mtime; continue; }
    files++;
    total += e.size;
    ensure(e.path.includes('/') ? e.path.slice(0, e.path.lastIndexOf('/')) : '').files.push(e);
  }
  let cwd = '';
  const sel = new Set();
  const base = (x) => x.slice(x.lastIndexOf('/') + 1);
  const when = (ms) => (ms ? `${isoDay(ms)} ${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}` : '');
  const row = (path, isDir, size, mtime, label = base(path)) => `<div class="arc-row${sel.has(path) ? ' on' : ''}" data-entry="${esc(path)}" data-dir="${isDir ? 1 : ''}"><input type="checkbox" ${sel.has(path) ? 'checked' : ''}><span class="r-icon">${iconFor({ name: base(path), isDir })}</span><span class="a-name" title="${esc(path)}">${esc(label)}</span><span class="a-size">${isDir ? '' : fmtSize(size)}</span><span class="a-date">${when(mtime)}</span></div>`;
  const rowsHtml = (filter) => {
    if (filter) {
      const f = filter.toLowerCase();
      const hits = r.entries.filter((e) => e.path.toLowerCase().includes(f)).slice(0, 2000);
      return hits.map((e) => row(e.path, e.isDir, e.size, e.mtime, e.path)).join('') || '<div class="br-more">No matches</div>';
    }
    const node = tree.get(cwd);
    const dirs = [...node.dirs].sort(collator.compare);
    const fl = node.files.slice().sort((a, b) => collator.compare(a.path, b.path));
    return (cwd ? `<div class="arc-row up" data-up><span></span><span class="r-icon">${line('up')}</span><span class="a-name">..</span><span></span><span></span></div>` : '')
      + dirs.map((d) => row(d, true, 0, tree.get(d).mtime)).join('')
      + fl.slice(0, 3000).map((e) => row(e.path, false, e.size, e.mtime)).join('')
      + (fl.length > 3000 ? `<div class="br-more">…and ${fl.length - 3000} more files</div>` : '')
      + (!dirs.length && !fl.length ? '<div class="br-more">Empty folder</div>' : '');
  };
  const crumbs = () => [`<span class="crumb" data-cd="">${esc(P.basename(p))}</span>`, ...cwd.split('/').filter(Boolean).map((part, i, a) => `<span class="crumb-sep">/</span><span class="crumb" data-cd="${esc(a.slice(0, i + 1).join('/'))}">${esc(part)}</span>`)].join('');
  const choice = await dialog({
    title: P.basename(p),
    cls: 'wide',
    html: `
      <div class="arc-sum">${plural(files, 'file')} · ${fmtSize(total)} uncompressed${r.encrypted ? ' · <span class="arc-lock">encrypted</span>' : ''}${r.truncated ? ' · listing truncated' : ''}</div>
      <div class="arc-bar"><div class="arc-crumbs crumbs"></div><div class="filter arc-filter">${line('search')}<input placeholder="Filter whole archive" spellcheck="false"></div></div>
      <div class="arc-list"></div>
      <div class="m-actions"><span class="arc-selinfo"></span><button class="btn" data-cancel>Close</button><button class="btn" data-pick="selected" disabled>Extract selected</button><button class="btn" data-value="folder">Extract to “${esc(archiveBase(P.basename(p)))}/”</button><button class="btn primary" data-value="here">Extract here</button></div>`,
    setup: (root, close) => {
      const input = $('.arc-filter input', root);
      const redraw = () => {
        $('.arc-list', root).innerHTML = rowsHtml(input.value.trim());
        $('.arc-crumbs', root).innerHTML = crumbs();
        $('.arc-selinfo', root).textContent = sel.size ? `${plural(sel.size, 'item')} selected` : '';
        $('[data-pick]', root).disabled = !sel.size;
      };
      input.addEventListener('input', redraw);
      root.addEventListener('click', (e) => {
        if (e.target.closest('[data-pick]')) { close({ mode: 'here', entries: [...sel] }); return; }
        const cd = e.target.closest('[data-cd]');
        if (cd) { cwd = cd.dataset.cd; input.value = ''; redraw(); return; }
        if (e.target.closest('[data-up]')) { cwd = cwd.includes('/') ? cwd.slice(0, cwd.lastIndexOf('/')) : ''; redraw(); return; }
        const rowEl = e.target.closest('[data-entry]');
        if (!rowEl) return;
        const path = rowEl.dataset.entry;
        // Checkbox (or Ctrl-click) selects; clicking a folder opens it.
        if (e.target.matches('input') || e.ctrlKey || !rowEl.dataset.dir) {
          if (sel.has(path)) sel.delete(path); else sel.add(path);
        } else { cwd = path; input.value = ''; }
        redraw();
      });
      redraw();
      input.focus();
    },
  });
  if (!choice) return;
  if (typeof choice === 'object') extractArchives([p], destDir, choice.mode, choice.entries);
  else extractArchives([p], destDir, choice);
}

/* =========================================================
 * Copy / move to a recent destination
 * ======================================================= */
function recordDest(dir) {
  state.recentDest = [dir, ...state.recentDest.filter((d) => d !== dir)].slice(0, 12);
  saveState();
}
async function copyToDialog(paths, mode) {
  if (!paths.length) return;
  const src = new Set(paths.map(P.dirname));
  const cands = [];
  const add = (p, why) => { if (p && !src.has(p) && !cands.some((c) => c.path === p)) cands.push({ path: p, why }); };
  if (state.dual) add(currentDir(tabOf(otherPane())), 'other pane');
  for (const d of state.recentDest) add(d, 'recent');
  for (const g of state.favGroups) for (const f of g.items) add(f.path, g.name);
  for (const d of state.recent) add(d, 'visited');
  const verb = mode === 'move' ? 'Move' : 'Copy';
  const dest = await dialog({
    title: `${verb} ${paths.length === 1 ? `“${P.basename(paths[0])}”` : plural(paths.length, 'item')} to…`,
    cls: 'ow',
    html: `<input class="m-input ct-path" spellcheck="false" placeholder="Folder path (~ works)" value="${esc(cands[0] ? P.display(cands[0].path) : '')}">
      <div class="ow-list ct-list">${cands.map((c, i) => `<div class="ow-item${i === 0 ? ' on' : ''}" data-i="${i}">${line('folder')}<span>${esc(P.display(c.path))}</span><em>${esc(c.why)}</em></div>`).join('') || '<div class="br-more">No recent folders yet</div>'}</div>
      <div class="m-actions"><button class="btn" data-cancel>Cancel</button><button class="btn primary" data-submit>${verb}</button></div>`,
    setup: (root, close) => {
      const input = $('.ct-path', root);
      root.addEventListener('click', (e) => {
        const it = e.target.closest('[data-i]');
        if (!it) return;
        root.querySelectorAll('.ow-item').forEach((x) => x.classList.toggle('on', x === it));
        input.value = P.display(cands[+it.dataset.i].path);
        if (e.detail === 2) close(cands[+it.dataset.i].path);
      });
      input.focus();
      input.select();
    },
    submit: (root) => P.expand($('.ct-path', root).value) || undefined,
  });
  if (!dest) return;
  const st = await api.stat(dest);
  if (!st.ok || !st.entry.isDir) { toast(`${P.display(dest)} isn’t a folder`, 'error'); return; }
  transfer(paths, dest, mode);
}

/* =========================================================
 * Properties
 * ======================================================= */
const rwx = (mode) => [...mode.padStart(3, '0')].map((d) => ['r', 'w', 'x'].map((c, i) => (d & (4 >> i) ? c : '-')).join('')).join('');
const ACCESS = ['None', 'Execute only', 'Write only', 'Write and execute', 'Read-only', 'Read and execute', 'Read and write', 'Read, write and execute'];
// Used/free pie chart, as in Nemo's Properties.
function pieSvg(used, total) {
  const f = total ? Math.min(used / total, 0.9999) : 0;
  const a = f * 2 * Math.PI, r = 90, cx = 95, cy = 95;
  const x = cx + r * Math.sin(a), y = cy - r * Math.cos(a);
  return `<svg viewBox="0 0 190 190" width="190" height="190"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#6c9bd2" stroke="#2a3d55" stroke-width="1.5"/>`
    + (f > 0 ? `<path d="M${cx} ${cy}L${cx} ${cy - r}A${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${x} ${y}Z" fill="#fce94f" stroke="#7a6a10" stroke-width="1.5"/>` : '') + '</svg>';
}
async function showProperties(paths) {
  const [infos, vol] = await Promise.all([Promise.all(paths.map((p) => api.preview(p))), api.props(paths[0])]);
  const one = paths.length === 1 ? infos[0] : null;
  const name = one ? P.basename(paths[0]) || '/' : plural(paths.length, 'item');
  const isDir = one?.kind === 'dir';
  const groups = [];
  const g1 = [['Name', esc(name)]];
  if (one) {
    g1.push(['Type', isDir ? 'Folder (inode/directory)' : esc(typeName({ name, isDir: false }))]);
    if (isDir) g1.push(['Contents', one.count == null ? 'No access' : plural(one.count, 'item')]);
  } else {
    const files = infos.filter((i) => i.ok && i.kind !== 'dir').length;
    g1.push(['Contents', `${plural(infos.length - files, 'folder')}, ${plural(files, 'file')}`]);
  }
  g1.push(['Size', !one || isDir ? '<span data-dirsize>Calculating…</span>' : one.ok ? `${fmtSize(one.size)} (${one.size.toLocaleString()} bytes)` : esc(one.error)]);
  groups.push(g1);
  groups.push([['Location', esc(P.dirname(paths[0]))], ...(vol.volume ? [['Volume', esc(vol.volume)]] : [])]);
  if (one?.ok) groups.push([['Modified', esc(new Date(one.mtime).toLocaleString([], { dateStyle: 'full', timeStyle: 'medium' }))], ['Created', esc(new Date(one.ctime).toLocaleString([], { dateStyle: 'full', timeStyle: 'medium' }))]]);
  if (vol.total) groups.push([['Free space', fmtSize(vol.free)]]);
  const grid = groups.map((g) => g.map(([k, v]) => `<dt>${k}:</dt><dd>${v}</dd>`).join('')).join('<div class="np-gap"></div>');
  const used = vol.total - vol.free;
  const chart = vol.total ? `<div class="np-chart">${pieSvg(used, vol.total)}<div class="np-legend">
      <div><i style="background:#fce94f"></i>${fmtSize(used)} used</div>
      <div><i style="background:#6c9bd2"></i>${fmtSize(vol.free)} free</div>
      <div class="np-cap">Total capacity: ${fmtSize(vol.total)}</div>
      <div class="np-cap">Filesystem type: ${esc(vol.fstype || '')}</div></div></div>` : '';
  const m = one?.ok ? one.mode.padStart(3, '0') : null;
  const perms = m ? `<dl class="np-grid">
      <dt>Owner:</dt><dd>${esc(vol.owner || '')}</dd><dt>Access:</dt><dd>${ACCESS[+m[0]]}</dd>
      <div class="np-gap"></div>
      <dt>Group:</dt><dd>${esc(vol.group || '')}</dd><dt>Access:</dt><dd>${ACCESS[+m[1]]}</dd>
      <div class="np-gap"></div>
      <dt>Others:</dt><dd></dd><dt>Access:</dt><dd>${ACCESS[+m[2]]}</dd>
      <div class="np-gap"></div>
      <dt>Text view:</dt><dd class="np-mono">${isDir ? 'd' : '-'}${rwx(m)} (${m})</dd></dl>` : '<p>Not available for several items.</p>';
  const icon = one ? iconFor({ name, isDir }, { big: true }) : folderSvg();
  return dialog({
    title: `${name} Properties`,
    cls: 'np-modal',
    html: `<div class="np-tabs"><button class="on" data-np="basic">Basic</button><button data-np="perms">Permissions</button></div>
      <div class="np-page" data-page="basic"><div class="np-top"><div class="np-icon">${icon}</div><dl class="np-grid">${grid}</dl></div>${chart}</div>
      <div class="np-page" data-page="perms" hidden><div class="np-top"><div class="np-icon">${icon}</div>${perms}</div></div>
      <div class="m-actions"><button class="btn" data-copy>Copy path</button><span class="br-sp"></span><button class="btn primary" data-cancel>Close</button></div>`,
    setup: async (root) => {
      $('[data-copy]', root).onclick = () => copyPaths(paths);
      root.querySelectorAll('[data-np]').forEach((b) => { b.onclick = () => {
        root.querySelectorAll('[data-np]').forEach((x) => x.classList.toggle('on', x === b));
        root.querySelectorAll('[data-page]').forEach((pg) => { pg.hidden = pg.dataset.page !== b.dataset.np; });
      }; });
      const cell = $('[data-dirsize]', root);
      if (!cell) return;
      // Folders need a recursive walk; plain files just add their size.
      const sizes = await Promise.all(paths.map((p, i) => (infos[i].kind === 'dir' ? api.dirSize(p) : { size: infos[i].size || 0, partial: false })));
      const total = sizes.reduce((a, r) => a + r.size, 0);
      cell.textContent = `${sizes.some((r) => r.partial) ? 'more than ' : ''}${fmtSize(total)} (${total.toLocaleString()} bytes)`;
    },
  });
}

/* =========================================================
 * Folder notes and backgrounds
 * ======================================================= */
async function editNote(dir) {
  const v = await dialog({
    title: `Note for ${dirLabel(dir)}`,
    html: `<p>Shown at the top of this folder. Leave empty to remove it.</p><textarea class="note-text" spellcheck="true">${esc(state.notes[dir] || '')}</textarea>
      <div class="m-actions"><button class="btn" data-cancel>Cancel</button><button class="btn primary" data-submit>Save</button></div>`,
    setup: (root) => { const t = $('textarea', root); t.focus(); t.setSelectionRange(t.value.length, t.value.length); },
    submit: (root) => $('textarea', root).value,
  });
  if (v == null) return;
  if (v.trim()) state.notes[dir] = v.trim(); else delete state.notes[dir];
  saveState();
  for (const p of state.panes) renderPane(p);
}
function setFolderBg(dir, img) {
  if (img) state.folderBg[dir] = img; else delete state.folderBg[dir];
  saveState();
  for (const p of state.panes) renderPane(p);
}

/* =========================================================
 * Scripts and programs
 * ======================================================= */
function scriptItems(paths, dir) {
  const items = state.scripts.map((sc) => ({ label: `Script: ${P.basename(sc)}`, icon: 'script', act: () => runScript(sc, paths, dir) }));
  items.push({ label: state.scripts.length ? 'Open scripts folder' : 'Add scripts…', icon: 'script', act: () => navigate(activePane(), tabOf(activePane()), state.scriptsDir) });
  return items;
}
async function runScript(script, paths, dir) {
  const id = `sc${++jobSeq}`;
  const name = P.basename(script);
  const task = taskToast(id, `Running ${name}…`, () => api.archive.cancel(id));
  const r = await api.runScript({ id, script, paths, cwd: dir, otherDir: state.dual ? currentDir(tabOf(otherPane())) : '' });
  task.close();
  const tail = r.output ? `\n${r.output.split('\n').slice(-8).join('\n')}` : '';
  if (r.cancelled) toast(`${name} was stopped`);
  else if (r.ok) toast(`${name} finished${tail}`, 'success', { timeout: tail ? 10000 : 4500 });
  else toast(`${name} failed (exit code ${r.code})${tail}`, 'error', { timeout: 10000 });
  await refreshDir(dir);
}
function runItems(e) {
  if (!e?.exec) return [];
  return [
    { label: 'Run', icon: 'play2', act: () => runProgram(e.path, false, false) },
    { label: 'Run with parameters…', icon: 'play2', act: () => runProgram(e.path, true, false) },
    { label: 'Run as administrator', icon: 'shield', act: () => runProgram(e.path, false, true) },
  ];
}
async function runProgram(p, withArgs, admin) {
  let args = [];
  if (withArgs) {
    const lineText = await promptDialog({ title: `Run ${P.basename(p)} with parameters`, body: 'Separate arguments with spaces; quote values that contain spaces.', confirm: 'Run' });
    if (lineText == null) return;
    args = await api.splitArgs(lineText);
  }
  const r = await api.runProgram(p, args, admin);
  if (!r.ok) toast(`Couldn't run ${P.basename(p)} — ${r.error}`, 'error');
  else toast(`Started ${P.basename(p)}${admin ? ' as administrator' : ''}`);
}

/* =========================================================
 * Batch image convert / resize / watermark (canvas, no external tools)
 * ======================================================= */
const IMG_RE = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
const IMG_KEY = 'nova-batch-images';
async function batchImages(paths, dir) {
  const imgs = paths.filter((p) => IMG_RE.test(p));
  if (!imgs.length) { toast('Select some images first'); return; }
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(IMG_KEY)) || {}; } catch { /* first use */ }
  const o = { format: 'keep', quality: 85, maxW: '', maxH: '', mark: '', pos: 'br', opacity: 60, out: 'suffix', suffix: '-edited', folder: 'converted', ...saved };
  const sel = (k, opts) => `<select data-k="${k}">${opts.map(([v, l]) => `<option value="${v}" ${String(o[k]) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const opts = await dialog({
    title: `Convert ${plural(imgs.length, 'image')}`,
    html: `<div class="cz-grid bi-grid">
        <label>Format</label>${sel('format', [['keep', 'Keep format'], ['jpeg', 'JPEG'], ['png', 'PNG'], ['webp', 'WebP']])}
        <label>Quality</label><div class="bi-row"><input type="range" min="40" max="100" data-k="quality" value="${o.quality}"><output>${o.quality}</output></div>
        <label>Fit within</label><div class="bi-row"><input type="number" min="1" data-k="maxW" placeholder="width" value="${esc(o.maxW)}"> × <input type="number" min="1" data-k="maxH" placeholder="height" value="${esc(o.maxH)}"> px <small>(blank = original size; never enlarges)</small></div>
        <label>Watermark</label><input data-k="mark" placeholder="Optional text, e.g. © 2026 Matthew" value="${esc(o.mark)}">
        <label>Position</label><div class="bi-row">${sel('pos', [['br', 'Bottom right'], ['bl', 'Bottom left'], ['tr', 'Top right'], ['tl', 'Top left'], ['c', 'Centre']])} opacity <input type="range" min="10" max="100" data-k="opacity" value="${o.opacity}"><output>${o.opacity}%</output></div>
        <label>Save as</label><div class="bi-row">${sel('out', [['suffix', 'Next to the originals, adding'], ['folder', 'In a sub-folder called']])}<input data-k="suffix" value="${esc(o.suffix)}"><input data-k="folder" value="${esc(o.folder)}"></div>
      </div>
      <p class="st-note">Originals are never changed. Animated GIFs keep only their first frame.</p>
      <div class="m-actions"><button class="btn" data-cancel>Cancel</button><button class="btn primary" data-submit>Convert</button></div>`,
    setup: (root) => {
      const sync = () => {
        const out = $('[data-k="out"]', root).value;
        $('[data-k="suffix"]', root).hidden = out !== 'suffix';
        $('[data-k="folder"]', root).hidden = out !== 'folder';
        root.querySelectorAll('input[type=range]').forEach((r) => { r.nextElementSibling.textContent = r.dataset.k === 'opacity' ? `${r.value}%` : r.value; });
      };
      root.addEventListener('input', sync);
      sync();
    },
    submit: (root) => {
      const v = {};
      root.querySelectorAll('[data-k]').forEach((el) => { v[el.dataset.k] = el.value; });
      try { localStorage.setItem(IMG_KEY, JSON.stringify(v)); } catch { /* storage unavailable */ }
      return v;
    },
  });
  if (!opts) return;
  const outDir = opts.out === 'folder' ? `${dir === '/' ? '' : dir}/${opts.folder.trim() || 'converted'}` : dir;
  const id = `img${++jobSeq}`;
  let cancelled = false;
  const task = taskToast(id, `Converting ${plural(imgs.length, 'image')}…`, () => { cancelled = true; });
  const created = [], errors = [];
  for (let i = 0; i < imgs.length && !cancelled; i++) {
    task.set(Math.round((i / imgs.length) * 100));
    try { created.push(await convertImage(imgs[i], outDir, opts)); } catch (e) { errors.push(`${P.basename(imgs[i])}: ${e.message}`); }
  }
  task.close();
  if (created.length) {
    const entry = { type: 'create', pairs: created.map((to) => ({ to })) };
    pushUndo(entry);
    toast(`Saved ${plural(created.length, 'image')}${opts.out === 'folder' ? ` in “${P.basename(outDir)}”` : ''}`, 'success', { action: { label: 'Undo', fn: () => undo(entry) } });
  }
  if (errors.length) toast(errors.slice(0, 4).join('\n'), 'error', { timeout: 8000 });
  await refreshDirs([dir, outDir]);
}
async function convertImage(p, outDir, o) {
  const img = new Image();
  img.src = fileUri(p);
  await img.decode();
  const scale = Math.min(1, o.maxW ? +o.maxW / img.naturalWidth : 1, o.maxH ? +o.maxH / img.naturalHeight : 1);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const srcExt = extOf(P.basename(p));
  const fmt = o.format === 'keep' ? ({ jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp' }[srcExt] || 'png') : o.format;
  if (fmt === 'jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); } // JPEG has no transparency
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  if (o.mark.trim()) {
    const size = Math.max(12, Math.round(Math.min(w, h) / 22));
    g.font = `600 ${size}px ${getComputedStyle(document.body).fontFamily}`;
    g.globalAlpha = +o.opacity / 100;
    g.fillStyle = '#fff';
    g.shadowColor = 'rgba(0,0,0,.6)';
    g.shadowBlur = size / 4;
    const tw = g.measureText(o.mark).width;
    const m = size;
    const x = o.pos.includes('r') ? w - tw - m : o.pos === 'c' ? (w - tw) / 2 : m;
    const y = o.pos.includes('b') ? h - m : o.pos === 'c' ? h / 2 + size / 3 : m + size;
    g.fillText(o.mark, x, y);
  }
  const blob = await new Promise((res) => c.toBlob(res, `image/${fmt}`, +o.quality / 100));
  if (!blob) throw new Error('could not encode');
  const base = P.basename(p).replace(/\.[^.]+$/, '');
  const name = `${base}${o.out === 'suffix' ? o.suffix : ''}.${fmt === 'jpeg' ? 'jpg' : fmt}`;
  const r = await api.writeNew(outDir, name, new Uint8Array(await blob.arrayBuffer()));
  if (!r.ok) throw new Error(r.error);
  return r.path;
}

/* =========================================================
 * File Automator: rules applied to the files of a folder
 * ======================================================= */
const RULE_ACTIONS = [['move', 'Move to folder'], ['copy', 'Copy to folder'], ['tag', 'Colour tag'], ['rename', 'Rename to'], ['trash', 'Move to Trash']];
const globRe = (list) => {
  const parts = list.split(',').map((x) => x.trim()).filter(Boolean);
  return parts.length ? new RegExp(`^(?:${parts.map((g) => g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')).join('|')})$`, 'i') : null;
};
// First matching rule wins for each file.
function automatorPlan(entries, rules) {
  const plan = [];
  const compiled = rules.filter((r) => r.on !== false).map((r) => ({ r, re: globRe(r.match || '') }));
  const now = Date.now();
  entries.forEach((e) => {
    if (e.isDir) return;
    const hit = compiled.find(({ r, re }) => re && re.test(e.name) && (!r.days || now - e.mtime >= +r.days * 86400e3));
    if (hit) plan.push({ e, r: hit.r });
  });
  return plan;
}
function ruleTarget(r, e, i) {
  if (r.action === 'rename') {
    const [base, ext] = splitName(e);
    const name = expandTokens(r.target || '{name}', { name: base, ext, full: e.name, n: i + 1, date: isoDay(e.mtime), parent: P.basename(P.dirname(e.path)) }, null);
    return ext && !name.includes('.') ? `${name}.${ext}` : name;
  }
  if (r.action === 'tag') return TAGS[+r.target || 1]?.[0] || 'Red';
  return r.target || '';
}
async function fileAutomator(dir, entries) {
  const rulesHtml = () => state.rules.map((r, i) => `<div class="fa-rule" data-i="${i}">
      <input type="checkbox" data-f="on" ${r.on === false ? '' : 'checked'} title="Rule on/off">
      <input data-f="match" value="${esc(r.match || '')}" placeholder="*.jpg, *.png" spellcheck="false">
      <input data-f="days" type="number" min="0" value="${esc(r.days || '')}" placeholder="any age" title="Only files older than this many days">
      <select data-f="action">${RULE_ACTIONS.map(([v, l]) => `<option value="${v}" ${r.action === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${r.action === 'tag' ? `<select data-f="target">${TAGS.slice(1).map(([n], j) => `<option value="${j + 1}" ${+r.target === j + 1 ? 'selected' : ''}>${n}</option>`).join('')}</select>`
        : r.action === 'trash' ? '<span></span>'
        : `<input data-f="target" value="${esc(r.target || '')}" placeholder="${r.action === 'rename' ? '{date} {name}' : 'Images (inside this folder) or /full/path'}" spellcheck="false">`}
      <button class="ib" data-del title="Delete rule">${line('x')}</button></div>`).join('') || '<div class="br-more">No rules yet — add one below.</div>';
  const planHtml = () => {
    const plan = automatorPlan(entries, state.rules);
    if (!plan.length) return '<div class="br-more">No files in this folder match the rules.</div>';
    return plan.slice(0, 500).map(({ e, r }, i) => `<div class="br-row ok"><span class="old">${esc(e.name)}</span><span class="new">${esc(RULE_ACTIONS.find(([v]) => v === r.action)[1])} ${esc(ruleTarget(r, e, i))}</span><span></span></div>`).join('');
  };
  const go = await dialog({
    title: `File Automator — ${dirLabel(dir)}`,
    cls: 'wide',
    html: `<p>Rules run top to bottom on the files of this folder; the first match decides. Patterns use * and ?.</p>
      <div class="fa-head"><span></span><span>Files</span><span>Older than (days)</span><span>Action</span><span>Target</span><span></span></div>
      <div class="fa-rules"></div>
      <div class="fa-add"><button class="btn" data-add>Add rule</button></div>
      <div class="br-table"><div class="br-head"><span>File</span><span>Will be</span><span></span></div><div class="br-rows fa-plan"></div></div>
      <div class="m-actions"><button class="btn" data-cancel>Close</button><button class="btn primary" data-submit>Run rules</button></div>`,
    setup: (root) => {
      const redraw = (rules = true) => {
        if (rules) $('.fa-rules', root).innerHTML = rulesHtml();
        $('.fa-plan', root).innerHTML = planHtml();
        saveState();
      };
      root.addEventListener('click', (e) => {
        if (e.target.closest('[data-add]')) { state.rules.push({ match: '*.jpg', action: 'move', target: 'Images', on: true }); redraw(); return; }
        const del = e.target.closest('[data-del]');
        if (del) { state.rules.splice(+del.closest('[data-i]').dataset.i, 1); redraw(); }
      });
      const edit = (e) => {
        const el = e.target.closest('[data-f]');
        if (!el) return;
        const r = state.rules[+el.closest('[data-i]').dataset.i];
        r[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
        if (el.dataset.f === 'action') { r.target = r.action === 'tag' ? '1' : ''; redraw(); } else redraw(false);
      };
      root.addEventListener('input', edit);
      root.addEventListener('change', edit);
      redraw();
    },
    submit: () => true,
  });
  if (!go) return;
  await runAutomator(dir, automatorPlan(entries, state.rules));
}
async function runAutomator(dir, plan) {
  if (!plan.length) { toast('Nothing to do'); return; }
  // Group the plan into one operation per action + target.
  const groups = new Map();
  plan.forEach(({ e, r }, i) => {
    const key = r.action === 'rename' ? 'rename' : `${r.action}\0${r.target || ''}`;
    if (!groups.has(key)) groups.set(key, { r, items: [] });
    groups.get(key).items.push({ e, i });
  });
  for (const { r, items } of groups.values()) {
    const paths = items.map(({ e }) => e.path);
    if (r.action === 'move' || r.action === 'copy') {
      let target = (r.target || '').trim();
      if (!target) continue;
      target = target.startsWith('/') || target.startsWith('~') ? P.expand(target) : `${dir === '/' ? '' : dir}/${target}`;
      const st = await api.stat(target);
      if (!st.ok) {
        if (P.dirname(target) === dir) { const m = await api.mkdir(dir, P.basename(target)); if (!m.ok) { toast(m.error, 'error'); continue; } target = m.path; }
        else { toast(`${P.display(target)} doesn’t exist`, 'error'); continue; }
      }
      await transfer(paths, target, r.action);
    } else if (r.action === 'tag') await api.setTag(paths, +r.target || 1);
    else if (r.action === 'trash') await trashPaths(paths);
    else if (r.action === 'rename') {
      const pairs = items.map(({ e, i }) => ({ from: e.path, to: `${dir === '/' ? '' : dir}/${ruleTarget(r, e, i)}` })).filter((x) => x.from !== x.to);
      const res = await api.batchRename(pairs);
      if (res.done.length) pushUndo({ type: 'batchRename', pairs: res.done });
      if (res.errors.length) toast(res.errors.slice(0, 3).join('\n'), 'error', { timeout: 8000 });
    }
  }
  toast(`File Automator handled ${plural(plan.length, 'file')}`, 'success');
  await refreshDir(dir);
}

/* =========================================================
 * Windows
 * ======================================================= */
async function saveWindowLayout() {
  const name = await promptDialog({ title: 'Save this window', body: 'Saves the tabs and panes so you can open them again later.', value: `Window ${state.savedWindows.length + 1}`, confirm: 'Save' });
  if (!name?.trim()) return;
  state.savedWindows = [...state.savedWindows.filter((w) => w.name !== name.trim()), { name: name.trim(), ...windowLayout() }];
  saveState();
  toast(`Saved “${name.trim()}”`);
}
async function savedWindowsDialog() {
  const listHtml = () => state.savedWindows.map((w, i) => `<div class="ow-item" data-i="${i}">${line('window')}<span>${esc(w.name)}</span><em>${plural(w.panes.reduce((n, p) => n + p.tabs.length, 0), 'tab')}</em><button class="btn sw-open" data-open="${i}">Open</button><button class="ib" data-del="${i}" title="Delete">${line('x')}</button></div>`).join('') || '<div class="br-more">No saved windows yet — use “Save this window…”.</div>';
  await dialog({
    title: 'Saved windows',
    cls: 'ow',
    html: `<div class="ow-list sw-list">${listHtml()}</div><div class="m-actions"><button class="btn" data-save>Save this window…</button><span class="br-sp"></span><button class="btn primary" data-cancel>Done</button></div>`,
    setup: (root, close) => root.addEventListener('click', async (e) => {
      const o = e.target.closest('[data-open]');
      if (o) { api.newWindow({ saved: state.savedWindows[+o.dataset.open].name }); close(null); return; }
      const d = e.target.closest('[data-del]');
      if (d) { state.savedWindows.splice(+d.dataset.del, 1); saveState(); $('.sw-list', root).innerHTML = listHtml(); return; }
      if (e.target.closest('[data-save]')) { close(null); saveWindowLayout(); }
    }),
  });
}

/* =========================================================
 * Columns, icon packs, thumbnail cache
 * ======================================================= */
function chooseColumns() {
  dialog({
    title: 'List columns',
    html: `<p>Name is always shown. Columns that don’t fit a narrow pane are hidden automatically.</p>
      ${COLUMNS.map((c) => `<label class="st-row"><input type="checkbox" data-col="${c.id}" ${S().columns[c.id] ? 'checked' : ''}><span>${c.label}${c.id === 'taken' || c.id === 'dims' ? '<small>Read from photo files as you browse</small>' : ''}</span></label>`).join('')}
      <div class="m-actions"><button class="btn primary" data-cancel>Done</button></div>`,
    setup: (root) => root.addEventListener('change', (e) => {
      const el = e.target.closest('[data-col]');
      if (!el) return;
      S().columns = { ...S().columns, [el.dataset.col]: el.checked };
      settingsChanged();
    }),
  });
}
async function applyIconPack() {
  const theme = S().iconTheme;
  window.Icons.setPack(theme ? await api.resolveIcons(theme, window.Icons.PACK_NAMES) : null);
  if (state.panes.length) renderAll();
}
// Video tiles: pull one frame per file (two at a time) and swap it in for the film icon.
let videoQueue = [], videoRunning = 0;
function loadVideoThumbs(pane) {
  for (const f of pane.listEl.querySelectorAll('.v-frame[data-video]')) {
    const p = f.dataset.video;
    f.removeAttribute('data-video');
    videoQueue.push({ p, f });
  }
  pumpVideoThumbs();
}
function pumpVideoThumbs() {
  while (videoRunning < 2 && videoQueue.length) {
    const { p, f } = videoQueue.shift();
    if (!f.isConnected) continue;
    videoRunning++;
    api.videoThumb(p).then((r) => {
      if (r.ok && f.isConnected) f.innerHTML = `<img src="${esc(r.url)}" alt="" draggable="false">`;
    }).catch(() => {}).finally(() => { videoRunning--; pumpVideoThumbs(); });
  }
}
// Large images in thumbnail view load from a cached 256 px WebP once one has been made.
const thumbBusy = new Set();
function cacheThumbs(pane) {
  for (const img of pane.listEl.querySelectorAll('.g-thumb img[data-full]')) {
    const full = img.dataset.full;
    img.removeAttribute('data-full');
    const p = img.closest('[data-path]')?.dataset.path;
    if (!p) continue;
    api.thumb(p).then(({ key, url }) => {
      if (url) { img.src = url; return; }
      img.src = full;
      if (!key || thumbBusy.has(key)) return;
      const make = async () => {
        const s = 256 / Math.max(img.naturalWidth, img.naturalHeight);
        if (!(s < 1)) return;
        thumbBusy.add(key);
        try {
          const c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * s);
          c.height = Math.round(img.naturalHeight * s);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          const blob = await new Promise((res) => c.toBlob(res, 'image/webp', 0.82));
          if (blob) await api.putThumb(key, new Uint8Array(await blob.arrayBuffer()));
        } catch { /* leave uncached */ } finally { thumbBusy.delete(key); }
      };
      if (img.complete && img.naturalWidth) make(); else img.addEventListener('load', make, { once: true });
    });
  }
}
