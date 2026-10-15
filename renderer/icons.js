/* Icon set: colored file-type glyphs + stroke line icons. */
(function () {
  const CATS = {
    image: { c: '#c084fc', ext: 'png jpg jpeg gif webp bmp svg ico avif heic tif tiff raw psd xcf apng' },
    video: { c: '#f87171', ext: 'mp4 mkv mov avi webm wmv flv m4v ogv mpg mpeg' },
    audio: { c: '#22d3ee', ext: 'mp3 wav flac ogg m4a aac opus wma oga mid midi' },
    archive: { c: '#fbbf24', ext: 'zip rar 7z tar gz tgz bz2 xz zst iso deb rpm dmg jar appimage' },
    code: { c: '#4ade80', ext: 'js mjs cjs ts tsx jsx py rb go rs c h cpp hpp cc cs java kt swift php lua sh bash zsh fish ps1 sql html htm css scss less vue svelte dart r pl zig nim ex exs erl hs ml clj scala json yaml yml toml xml ini conf cfg env lock gradle make cmake dockerfile' },
    doc: { c: '#60a5fa', ext: 'doc docx odt rtf pages' },
    sheet: { c: '#34d399', ext: 'xls xlsx ods csv tsv numbers' },
    slides: { c: '#fb923c', ext: 'ppt pptx odp key' },
    pdf: { c: '#ef4444', ext: 'pdf epub mobi djvu' },
    text: { c: '#94a3b8', ext: 'txt md markdown log rst nfo org tex' },
    exec: { c: '#a3e635', ext: 'exe msi bin run elf so dll' },
    font: { c: '#f472b6', ext: 'ttf otf woff woff2' },
  };
  const EXT_MAP = {};
  for (const [cat, v] of Object.entries(CATS)) for (const e of v.ext.split(' ')) EXT_MAP[e] = cat;

  const TYPE_NAMES = {
    image: 'Image', video: 'Video', audio: 'Audio', archive: 'Archive', code: 'Source code', doc: 'Document', sheet: 'Spreadsheet',
    slides: 'Presentation', pdf: 'Document', text: 'Text', exec: 'Executable', font: 'Font',
  };

  function extOf(name) {
    const i = name.lastIndexOf('.');
    return i > 0 ? name.slice(i + 1).toLowerCase() : '';
  }
  function category(entry) {
    if (entry.isDir) return 'folder';
    return EXT_MAP[extOf(entry.name)] || 'file';
  }
  function typeName(entry) {
    if (entry.isDir) return 'Folder';
    const ext = extOf(entry.name);
    const cat = EXT_MAP[ext];
    if (!ext) return 'File';
    return `${ext.toUpperCase()} ${cat ? TYPE_NAMES[cat].toLowerCase() : 'file'}`;
  }

  // Windows 11-style folder: darker back flap with a left tab, gradient front panel
  // with a soft top highlight and a small step under the tab. Gradient lives in index.html.
  const GLYPH_COLORS = { desktop: '#2f8ae0', documents: '#3b7fd4', downloads: '#21a05a', pictures: '#2f8ae0', music: '#e8662a', videos: '#8a56d6', home: '#2f8ae0' };
  function folderSvg(open, special, id) {
    const glyph = special
      ? `<g transform="translate(7.4 10.6) scale(.38)" fill="none" stroke="${GLYPH_COLORS[id] || '#2f8ae0'}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${special}</g>`
      : '';
    return `<svg viewBox="0 0 24 24">`
      + `<path d="M2 5.6C2 4.7 2.7 4 3.6 4h4.9c.5 0 .9.2 1.2.5L11.2 6h9.2c.9 0 1.6.7 1.6 1.6V13H2z" fill="var(--folder-back)"/>`
      + `<path d="M2 10.6C2 9.7 2.7 9 3.6 9h5c.5 0 .9-.2 1.2-.5l.7-.7c.3-.3.7-.5 1.2-.5h8.7c.9 0 1.6.7 1.6 1.6v9.5c0 .9-.7 1.6-1.6 1.6H3.6c-.9 0-1.6-.7-1.6-1.6z" fill="url(#nc-folder-front)"/>`
      + `<path d="M2.5 9.9c.2-.5.6-.9 1.1-.9h5c.5 0 .9-.2 1.2-.5l.7-.7c.3-.3.7-.5 1.2-.5h8.7c.5 0 .9.2 1.2.6" fill="none" stroke="var(--folder-edge)" stroke-width=".7" stroke-linecap="round"/>`
      + glyph + `</svg>`;
  }

  function fileSvg(color, label) {
    const txt = label ? `<text x="12" y="18.6" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="700" font-size="${label.length > 3 ? 4.1 : 5}" fill="#0e1014">${label}</text>` : '';
    return `<svg viewBox="0 0 24 24"><path d="M6.2 2.5h7.6l5 5v12.3a1.7 1.7 0 0 1-1.7 1.7H6.2a1.7 1.7 0 0 1-1.7-1.7V4.2a1.7 1.7 0 0 1 1.7-1.7z" fill="#2b303b"/><path d="M13.8 2.5v3.3a1.7 1.7 0 0 0 1.7 1.7h3.3z" fill="#4a5262"/>${label ? `<rect x="4.5" y="13.8" width="15" height="6.4" rx="1.4" fill="${color}"/>` : `<rect x="7.5" y="11" width="9" height="1.6" rx=".8" fill="${color}"/><rect x="7.5" y="14.2" width="6.5" height="1.6" rx=".8" fill="${color}" opacity=".7"/>`}${txt}</svg>`;
  }

  // Lucide-style line icons (ISC licensed shapes, simplified)
  const LINE = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/>',
    desktop: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    documents: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h6"/>',
    downloads: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    pictures: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    videos: '<rect x="2" y="5" width="15" height="14" rx="2"/><path d="m17 10 5-3v10l-5-3"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
    drive: '<rect x="2" y="13" width="20" height="8" rx="2"/><path d="M5.5 13 8 4h8l2.5 9"/><path d="M6 17h.01M10 17h.01"/>',
    usb: '<rect x="6" y="9" width="12" height="13" rx="2"/><path d="M9 9V2h6v7M10 5h.01M14 5h.01"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    forward: '<path d="M9 18l6-6-6-6"/>',
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
    columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>',
    details: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    open: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    paste: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    rename: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    folderPlus: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v6M9 14h6"/>',
    filePlus: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 12v6M9 15h6"/>',
    terminal: '<path d="m4 17 6-5-6-5M12 19h8"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    reveal: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="m10 12 3 2-3 2"/>',
    moveRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    duplicate: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a2 2 0 0 1 2-2h11"/><path d="M14.5 12v6M11.5 15h6"/>',
    tab: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18M9 5v4"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    palette: '<circle cx="13.5" cy="6.5" r="1.2"/><circle cx="17.5" cy="10.5" r="1.2"/><circle cx="8.5" cy="7.5" r="1.2"/><circle cx="6.5" cy="12.5" r="1.2"/><path d="M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A5.6 5.6 0 0 0 22 9.8C22 5.5 17.5 2 12 2z"/>',
    dual: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M12 4v16"/>',
    panelBottom: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 14h18"/>',
    dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    selectAll: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m8 12 3 3 5-6"/>',
    archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/>',
    unarchive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M12 11v6M9.5 14.5 12 17l2.5-2.5"/>',
    searchFolder: '<path d="M21 11V9a2 2 0 0 0-2-2h-8L9 5H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h6"/><circle cx="17" cy="17" r="3"/><path d="m21.5 21.5-2.4-2.4"/>',
    sort: '<path d="M3 6h11M3 12h8M3 18h5M18 4v16M15 17l3 3 3-3"/>',
    undoTab: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
    funnel: '<path d="M3 5h18l-7 8.5V19l-4 2v-7.5z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    tray: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
    play: '<path d="M7 4.5v15l12-7.5z"/>',
    symlink: '<path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8"/>',
    template: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
    appWindow: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20M6 6.5h.01M9 6.5h.01"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
    network: '<rect x="9" y="2" width="6" height="5" rx="1"/><rect x="2" y="17" width="6" height="5" rx="1"/><rect x="16" y="17" width="6" height="5" rx="1"/><path d="M12 7v5M5 17v-3h14v3"/>',
    eject: '<path d="M5 15h14L12 6z"/><path d="M5 19h14"/>',
    note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    wand: '<path d="m15 4 5 5M4 20 15 9M14 4l.5-2M19 9l2-.5M17.5 2.5l1-1M21.5 6.5l1-1"/>',
    play2: '<path d="M8 5v14l11-7z"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
    window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
    clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 13h6M9 17h4"/>',
    script: '<path d="m8 9 3 3-3 3M13 15h3"/><rect x="3" y="4" width="18" height="16" rx="2"/>',
    quicklook: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2"/>',
        folderIn: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6M9 13l3 3 3-3"/>',
  };
  const line = (name) => `<svg viewBox="0 0 24 24">${LINE[name] || ''}</svg>`;

  const SPECIAL = {
    desktop: LINE.desktop, documents: LINE.documents, downloads: LINE.downloads, pictures: LINE.pictures,
    music: LINE.music, videos: LINE.videos, home: LINE.home,
  };

  // Optional icon pack (a freedesktop icon theme), as resolved file URLs keyed like PACK_NAMES.
  let pack = null;
  const PACK_NAMES = {
    folder: ['folder'], 'folder-home': ['user-home', 'folder-home'], 'folder-desktop': ['user-desktop', 'folder-desktop'],
    'folder-documents': ['folder-documents'], 'folder-downloads': ['folder-download', 'folder-downloads'], 'folder-pictures': ['folder-pictures'],
    'folder-music': ['folder-music'], 'folder-videos': ['folder-videos'],
    'cat:image': ['image-x-generic'], 'cat:video': ['video-x-generic'], 'cat:audio': ['audio-x-generic'],
    'cat:archive': ['package-x-generic', 'application-x-archive'], 'cat:code': ['text-x-script', 'text-x-generic'],
    'cat:doc': ['x-office-document'], 'cat:sheet': ['x-office-spreadsheet'], 'cat:slides': ['x-office-presentation'],
    'cat:pdf': ['application-pdf'], 'cat:text': ['text-x-generic'], 'cat:exec': ['application-x-executable'],
    'cat:font': ['font-x-generic'], 'cat:file': ['unknown', 'text-x-generic'],
    'ext:zip': ['application-zip'], 'ext:py': ['text-x-python'], 'ext:js': ['application-javascript', 'text-x-javascript'],
    'ext:html': ['text-html'], 'ext:css': ['text-css'], 'ext:json': ['application-json'], 'ext:md': ['text-markdown', 'text-x-markdown'],
    'ext:sh': ['application-x-shellscript', 'text-x-script'], 'ext:deb': ['application-vnd.debian.binary-package', 'application-x-deb'],
    'ext:iso': ['application-x-cd-image'], 'ext:svg': ['image-svg+xml'], 'ext:mp3': ['audio-mpeg', 'audio-x-mpeg'],
    'ext:docx': ['application-vnd.openxmlformats-officedocument.wordprocessingml.document', 'x-office-document'],
    'ext:xlsx': ['application-vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'x-office-spreadsheet'],
    'ext:pptx': ['application-vnd.openxmlformats-officedocument.presentationml.presentation', 'x-office-presentation'],
    'ext:c': ['text-x-csrc'], 'ext:cpp': ['text-x-c++src'], 'ext:rs': ['text-rust', 'text-x-rust'], 'ext:go': ['text-x-go'],
    'ext:java': ['text-x-java'], 'ext:ts': ['application-typescript', 'text-x-typescript'], 'ext:exe': ['application-x-ms-dos-executable'],
  };
  function packIcon(entry, special) {
    if (!pack) return null;
    if (entry.isDir) return pack[special ? `folder-${special}` : 'folder'] || pack.folder;
    return pack[`ext:${extOf(entry.name)}`] || pack[`cat:${category(entry)}`] || pack['cat:file'];
  }

  function iconFor(entry, { big = false, special = null } = {}) {
    const cat = category(entry);
    const packed = packIcon(entry, special);
    if (packed) return `<img class="pk" src="${packed}" alt="" draggable="false">`;
    if (cat === 'folder') return folderSvg(false, special ? SPECIAL[special] : null, special);
    const color = cat === 'file' ? '#6b7280' : CATS[cat].c;
    const ext = extOf(entry.name);
    return fileSvg(color, big && ext && ext.length <= 4 ? ext.toUpperCase() : null);
  }

  window.Icons = { iconFor, line, category, typeName, extOf, folderSvg, colorFor: (cat) => (CATS[cat] ? CATS[cat].c : '#6b7280'), PACK_NAMES, setPack: (p) => { pack = p && Object.keys(p).length ? p : null; } };
})();
