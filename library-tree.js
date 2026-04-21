/**
 * library-tree.js
 *
 * Generates a interactive HTML overview of a local
 * audiobook and/or e-book library directory.
 *
 * Usage:
 *   node library-tree.js "<path-to-library>"
 *
 * Example:
 *   node library-tree.js "E:\Audiobooks"
 *
 * Output:
 *   A single HTML file named after the root directory, written to the
 *   current working directory, which can be opened in any browser.
 *
 * How folders are interpreted:
 *   - Folders that contain media files directly are treated as "leaf" nodes.
 *     They are displayed as 📚 (audiobook) or 📖 (e-book) without further nesting.
 *   - All other folders are rendered as collapsible tree nodes (📦 / 📂 / 📁).
 *
 * HTML features:
 *   - Tree like overview with expand/collapse all buttons
 *   - Live search across all folder and file names
 *   - Toggle to show/hide individual files inside leaf folders
 *   - Color-coded entries: green = audio, blue = e-book
 *   - No external dependencies — works fully offline once generated
 *
 * Requirements:
 *   Node.js (any reasonably modern version, no npm install needed)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Supported file extensions ─────────────────────────────────────────

/** Audio formats recognized as audiobook files. */
const AUDIO_EXTENSIONS = new Set([
    '.mp3', '.m4a', '.m4b', '.aac', '.ogg', '.opus',
    '.flac', '.wav', '.wma', '.aiff', '.aif', '.ape',
]);

/** E-book formats recognized as ebook files. */
const EBOOK_EXTENSIONS = new Set([
    '.epub', '.pdf', '.mobi', '.azw', '.azw3',
    '.lit', '.djvu', '.fb2', '.cbz', '.cbr',
]);

// ── CLI argument handling ─────────────────────────────────────────────

const root = process.argv[2];

if (!root) {
    console.error('Usage: node library-tree.js "<path-to-library>"');
    console.error('Example: node library-tree.js "E:\\Audiobooks"');
    process.exit(1);
}

const rootPath = path.resolve(root);

if (!fs.existsSync(rootPath)) {
    console.error('Error: Directory not found: ' + rootPath);
    process.exit(1);
}

if (!fs.statSync(rootPath).isDirectory()) {
    console.error('Error: Path is not a directory: ' + rootPath);
    process.exit(1);
}

// ── Utility functions ─────────────────────────────────────────────────

/**
 * Escapes a string for safe insertion into HTML attributes and text nodes.
 * @param {string} str - Raw string to escape.
 * @returns {string} HTML-safe string.
 */
function esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Formats a byte count into a human-readable size string (KB / MB / GB).
 * @param {number} bytes - File size in bytes.
 * @returns {string} Formatted size string, e.g. "4.2 MB".
 */
function fmtSize(bytes) {
    if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
    if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
    if (bytes >= 1e3) return Math.round(bytes / 1e3) + ' KB';
    return bytes + ' B';
}

// ── Directory scanning ────────────────────────────────────────────────

/**
 * @typedef {Object} MediaFile
 * @property {string} name - Filename without extension.
 * @property {string} ext  - Uppercase extension without dot, e.g. "MP3".
 * @property {string} size - Human-readable file size, e.g. "4.2 MB".
 */

/**
 * @typedef {Object} LeafInfo
 * @property {'audio'|'ebook'|'mixed'} type - What kind of media the folder contains.
 * @property {MediaFile[]} audioFiles        - List of audio files found.
 * @property {MediaFile[]} ebookFiles        - List of e-book files found.
 */

/**
 * Scans a single directory for media files (non-recursive).
 * Returns null if the folder contains no recognized media files —
 * meaning it should be treated as a regular collapsible folder, not a leaf.
 *
 * @param {string} dirPath - Absolute path to the directory to scan.
 * @returns {LeafInfo|null}
 */
function scanLeaf(dirPath) {
    let files;
    try {
        files = fs.readdirSync(dirPath);
    } catch {
        return null;
    }

    let hasAudio = false;
    let hasEbook = false;
    const audioFiles = [];
    const ebookFiles = [];

    for (const filename of files) {
        const ext = path.extname(filename).toLowerCase();

        if (AUDIO_EXTENSIONS.has(ext)) {
            hasAudio = true;
            let size = '';
            try { size = fmtSize(fs.statSync(path.join(dirPath, filename)).size); } catch {}
            audioFiles.push({
                name: path.basename(filename, ext),
                ext:  ext.slice(1).toUpperCase(),
                size,
            });
        }

        if (EBOOK_EXTENSIONS.has(ext)) {
            hasEbook = true;
            let size = '';
            try { size = fmtSize(fs.statSync(path.join(dirPath, filename)).size); } catch {}
            ebookFiles.push({
                name: path.basename(filename, ext),
                ext:  ext.slice(1).toUpperCase(),
                size,
            });
        }
    }

    if (!hasAudio && !hasEbook) return null;

    const type = hasAudio && hasEbook ? 'mixed' : hasAudio ? 'audio' : 'ebook';
    return { type, audioFiles, ebookFiles };
}

// ── HTML tree builder ─────────────────────────────────────────────────

/**
 * Recursively builds the HTML list markup for a directory and all its subdirectories.
 *
 * Each directory is classified as either:
 *   - A **leaf folder**: directly contains media files. Rendered as a non-expandable
 *     row (📚/📖) in compact mode, or as a collapsible list of files in detail mode.
 *   - A **branch folder**: contains only subdirectories. Rendered as a collapsible
 *     <details> element with its children nested inside.
 *
 * CSS depth classes assigned per level:
 *   - depth 0 → "l0" (top-level, dark header style)
 *   - depth 1 → "l1" (series / sub-collection level)
 *   - depth 2+ → "lx" (deep nesting)
 *
 * @param {string} dirPath - Absolute path to the directory to render.
 * @param {number} depth   - Current nesting depth (0 = root children).
 * @returns {string} Raw HTML string of <li> elements.
 */
function buildHTML(dirPath, depth) {
    let entries;
    try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
        return '';
    }

    // Sort: directories first, then alphabetically (case-insensitive)
    entries.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );

    const levelClass = depth === 0 ? 'l0' : depth === 1 ? 'l1' : 'lx';
    let html = '';

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const fullPath = path.join(dirPath, entry.name);
        const leaf     = scanLeaf(fullPath);

        if (leaf) {
            // ── Leaf folder: render both compact and detail views ──────
            // The visible view is controlled by the CSS class on <body>:
            //   default          → .compact-view shown, .detail-view hidden
            //   body.show-files  → .detail-view shown, .compact-view hidden

            const icon       = leaf.type === 'audio' ? '📚' : leaf.type === 'ebook' ? '📖' : '📚📖';
            const folderName = esc(entry.name);
            const nameKey    = esc(entry.name.toLowerCase());

            // Merge audio and ebook files into one alphabetically sorted list
            const allFiles = [
                ...leaf.audioFiles.map(f => ({ ...f, kind: 'audio' })),
                ...leaf.ebookFiles.map(f => ({ ...f, kind: 'ebook' })),
            ].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

            const fileRows = allFiles.map(f => {
                const fileIcon = f.kind === 'audio' ? '🎧' : '📄';
                return (
                    `<li class="file f-${f.kind}" data-name="${esc(f.name.toLowerCase())}">` +
                        `${fileIcon} <span class="n">${esc(f.name)}</span>` +
                        `<span class="tag">${esc(f.ext)}</span>` +
                        (f.size ? `<span class="sz">${f.size}</span>` : '') +
                    `</li>`
                );
            }).join('');

            html +=
                `<li class="item leaf ${levelClass} t-${leaf.type}" data-name="${nameKey}">` +
                    // Compact view: just the folder name with icon
                    `<span class="compact-view">${icon} <span class="n">${folderName}</span></span>` +
                    // Detail view: collapsible list of individual files
                    `<details class="detail-view">` +
                        `<summary><span class="chev">▶</span>${icon} <span class="n">${folderName}</span></summary>` +
                        `<ul class="filelist">${fileRows}</ul>` +
                    `</details>` +
                `</li>`;

        } else {
            // ── Branch folder: collapsible, recurse into children ──────
            const children = buildHTML(fullPath, depth + 1);
            const icon     = depth === 0 ? '📦' : depth === 1 ? '📂' : '📁';
            const openAttr = depth === 0 ? ' open' : ''; // top-level open by default

            html +=
                `<li class="item ${levelClass}" data-name="${esc(entry.name.toLowerCase())}">` +
                    `<details${openAttr}>` +
                        `<summary><span class="chev">▶</span>${icon} <span class="n">${esc(entry.name)}</span></summary>` +
                        `<ul>${children}</ul>` +
                    `</details>` +
                `</li>`;
        }
    }

    return html;
}

// ── Generate output ───────────────────────────────────────────────────

console.log('Reading directory: ' + rootPath);
const treeHTML = buildHTML(rootPath, 0);
const libName  = path.basename(rootPath);
console.log('Building HTML...');

const html = `<!DOCTYPE html>
<html lang="en">

  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(libName)}</title>
    <link
      href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@300;400;500&display=swap"
      rel="stylesheet"
    >
    <style>

      /* ── Design tokens ─────────────────────────────────────────────── */

      :root {
        --ink:   #0e0c0a;               /* text / dark background         */
        --paper: #f5f0e8;               /* page background                */
        --p2:    #ede7d9;               /* toolbar / level-1 background   */
        --p3:    #e3dccf;               /* level-2+ background            */
        --warm:  #c8a96e;               /* accent color                   */
        --wdark: #9c7a3c;               /* accent dark (toggle active)    */
        --green: #2d5a3d;               /* audiobook entries              */
        --blue:  #2a6496;               /* e-book entries                 */
        --muted: #7a7060;               /* secondary text                 */
        --bd:    rgba(14, 12, 10, .12); /* borders                        */
        --sh:    rgba(14, 12, 10, .15); /* box shadows                    */
      }

      /* ── Reset ─────────────────────────────────────────────────────── */

      * {
        box-sizing: border-box;
        margin:     0;
        padding:    0;
      }

      body {
        font-family: 'DM Sans', sans-serif;
        background:  var(--paper);
        color:       var(--ink);
        min-height:  100vh;
      }

      /* ── Header ─────────────────────────────────────────────────────── */

      header {
        background: var(--ink);
        color:      var(--paper);
        overflow:   hidden;
        position:   relative;
      }

      /* Decorative circular outlines in the header background */
      header::before {
        content:       '';
        position:      absolute;
        top:           -40px;
        right:         -40px;
        width:         340px;
        height:        340px;
        border:        1px solid rgba(200, 169, 110, .12);
        border-radius: 50%;
      }

      header::after {
        content:       '';
        position:      absolute;
        top:           20px;
        right:         20px;
        width:         220px;
        height:        220px;
        border:        1px solid rgba(200, 169, 110, .08);
        border-radius: 50%;
      }

      .hi {
        max-width: 1100px;
        margin:    0 auto;
        padding:   48px 40px 36px;
        position:  relative;
        z-index:   1;
      }

      /* Small all-caps label above the title */
      .hl {
        font-size:      .7rem;
        font-weight:    500;
        letter-spacing: .25em;
        text-transform: uppercase;
        color:          var(--warm);
        margin-bottom:  10px;
      }

      h1 {
        font-family:   'Playfair Display', serif;
        font-size:     clamp(2rem, 5vw, 3.5rem);
        font-weight:   900;
        line-height:   1.05;
        margin-bottom: 20px;
      }

      /* Golden divider line below the title */
      .hdiv {
        width:      60px;
        height:     2px;
        background: var(--warm);
      }

      /* ── Toolbar ─────────────────────────────────────────────────────── */

      .toolbar {
        background:    var(--p2);
        border-bottom: 1px solid var(--bd);
        position:      sticky;
        top:           0;
        z-index:       50;
      }

      .ti {
        max-width:   1100px;
        margin:      0 auto;
        padding:     12px 40px;
        display:     flex;
        align-items: center;
        gap:         12px;
        flex-wrap:   wrap;
      }

      /* Search input wrapper */
      .sw {
        position:  relative;
        flex:      1;
        min-width: 200px;
        max-width: 380px;
      }

      #s {
        width:       100%;
        background:  var(--paper);
        border:      1px solid var(--bd);
        color:       var(--ink);
        padding:     8px 14px 8px 36px;
        border-radius: 6px;
        font-family: 'DM Sans', sans-serif;
        font-size:   .88rem;
        outline:     none;
        transition:  border-color .2s, box-shadow .2s;
      }

      #s:focus {
        border-color: var(--wdark);
        box-shadow:   0 0 0 3px rgba(156, 122, 60, .15);
      }

      /* Search icon inside the input */
      .si {
        position:        absolute;
        left:            11px;
        top:             50%;
        transform:       translateY(-50%);
        color:           var(--muted);
        pointer-events:  none;
      }

      .btn {
        background:    transparent;
        border:        1px solid var(--bd);
        color:         var(--muted);
        padding:       8px 14px;
        border-radius: 6px;
        cursor:        pointer;
        font-family:   'DM Sans', sans-serif;
        font-size:     .8rem;
        font-weight:   500;
        transition:    all .15s;
        white-space:   nowrap;
      }

      .btn:hover {
        background:   var(--ink);
        color:        var(--paper);
        border-color: var(--ink);
      }

      /* ── Toggle switch (show/hide individual files) ──────────────────── */

      .toggle-wrap {
        display:     flex;
        align-items: center;
        gap:         8px;
        font-size:   .8rem;
        color:       var(--muted);
        white-space: nowrap;
        cursor:      pointer;
        user-select: none;
      }

      .toggle {
        position:   relative;
        width:      36px;
        height:     20px;
        flex-shrink: 0;
      }

      .toggle input {
        opacity:  0;
        width:    0;
        height:   0;
        position: absolute;
      }

      .toggle-track {
        position:      absolute;
        inset:         0;
        background:    rgba(14, 12, 10, .15);
        border-radius: 20px;
        cursor:        pointer;
        transition:    background .2s;
      }

      .toggle input:checked + .toggle-track {
        background: var(--wdark);
      }

      /* The sliding circle inside the toggle */
      .toggle-track::after {
        content:       '';
        position:      absolute;
        left:          3px;
        top:           2px;
        width:         14px;
        height:        14px;
        background:    #fff;
        border-radius: 50%;
        transition:    transform .2s;
        box-shadow:    0 1px 3px rgba(0, 0, 0, .25);
      }

      .toggle input:checked + .toggle-track::after {
        transform: translateX(16px);
      }

      /* Search result count label */
      #rc {
        font-size:   .78rem;
        color:       var(--muted);
        margin-left: auto;
      }

      /* ── Main tree area ──────────────────────────────────────────────── */

      main {
        max-width: 1100px;
        margin:    0 auto;
        padding:   32px 40px 60px;
      }

      ul   { list-style: none; }
      .item { position: relative; }

      /* ── Level 0: top-level authors / theme folders ──────────────────── */

      .l0 {
        margin-bottom:  10px;
        border:         1px solid var(--bd);
        border-radius:  8px;
        overflow:       hidden;
        box-shadow:     0 1px 3px var(--sh);
        transition:     box-shadow .2s;
      }

      .l0:hover {
        box-shadow: 0 3px 10px var(--sh);
      }

      .l0 > details > summary,
      .l0 > .detail-view > summary {
        background:   var(--ink);
        color:        var(--paper);
        padding:      14px 20px;
        font-family:  'Playfair Display', serif;
        font-size:    1.05rem;
        font-weight:  700;
        display:      flex;
        align-items:  center;
        gap:          10px;
        cursor:       pointer;
        list-style:   none;
        user-select:  none;
        transition:   background .15s;
      }

      .l0 > details > summary:hover,
      .l0 > .detail-view > summary:hover {
        background: #1e1c18;
      }

      .l0 > details > summary::-webkit-details-marker,
      .l0 > .detail-view > summary::-webkit-details-marker {
        display: none;
      }

      .l0 > details > ul {
        background: var(--paper);
        padding:    8px 0;
      }

      /* Level-0 leaf (no <details>): same dark style as the summary */
      .l0 > .compact-view {
        background:  var(--ink);
        padding:     14px 20px;
        font-family: 'Playfair Display', serif;
        font-size:   1.05rem;
        font-weight: 700;
        color:       var(--paper);
      }

      /* Level-0 leaves always show in paper color regardless of media type */
      .l0.t-audio > .compact-view,
      .l0.t-ebook > .compact-view,
      .l0.t-mixed > .compact-view,
      .l0.t-audio > .detail-view > summary,
      .l0.t-ebook > .detail-view > summary,
      .l0.t-mixed > .detail-view > summary {
        color: var(--paper);
      }

      /* ── Level 1: series / sub-collections ──────────────────────────── */

      .l1 { border-bottom: 1px solid var(--bd); }
      .l1:last-child { border-bottom: none; }

      .l1 > details > summary,
      .l1 > .detail-view > summary {
        padding:     10px 20px 10px 32px;
        display:     flex;
        align-items: center;
        gap:         10px;
        cursor:      pointer;
        list-style:  none;
        user-select: none;
        font-weight: 500;
        font-size:   .92rem;
        transition:  background .12s;
      }

      .l1 > details > summary:hover,
      .l1 > .detail-view > summary:hover {
        background: var(--p2);
      }

      .l1 > details > summary::-webkit-details-marker,
      .l1 > .detail-view > summary::-webkit-details-marker {
        display: none;
      }

      .l1 > details > ul        { background: var(--p2); padding: 4px 0; }
      .l1 > .compact-view       { padding: 10px 20px 10px 32px; font-weight: 500; font-size: .92rem; }
      .l1 > .detail-view > .filelist { background: var(--p2); }

      /* ── Level 2+: deep nesting ──────────────────────────────────────── */

      .lx > details > summary,
      .lx > .detail-view > summary {
        padding:     8px 20px 8px 44px;
        display:     flex;
        align-items: center;
        gap:         10px;
        cursor:      pointer;
        list-style:  none;
        user-select: none;
        font-size:   .87rem;
        transition:  background .12s;
      }

      .lx > details > summary:hover,
      .lx > .detail-view > summary:hover {
        background: var(--p3);
      }

      .lx > details > summary::-webkit-details-marker,
      .lx > .detail-view > summary::-webkit-details-marker {
        display: none;
      }

      .lx > details > ul              { padding: 2px 0; }
      .lx > .compact-view             { padding: 8px 20px 8px 44px; font-size: .87rem; }
      .lx > .detail-view > .filelist  { background: var(--p3); }

      /* ── Chevron (expand/collapse indicator) ─────────────────────────── */

      .chev {
        font-size:   .6rem;
        opacity:     .5;
        transition:  transform .2s;
        flex-shrink: 0;
      }

      details[open] > summary .chev {
        transform: rotate(90deg);
      }

      /* ── Leaf folder: compact vs. detail view ────────────────────────── */

      /*
       * Each leaf folder contains two representations in the HTML:
       *   .compact-view  — just the folder name with icon (default)
       *   .detail-view   — a collapsible <details> listing individual files
       *
       * The active view is controlled by the "show-files" class on <body>,
       * toggled by the toolbar switch. No JS DOM manipulation needed.
       */

      .compact-view {
        display:     flex;
        align-items: center;
        gap:         10px;
      }

      .detail-view { display: none; }

      body.show-files .compact-view { display: none; }
      body.show-files .detail-view  { display: block; }

      /* Color-coding by media type (on light backgrounds; dark overridden above) */
      .t-audio > .compact-view,
      .t-audio > .detail-view > summary { color: var(--green); }

      .t-ebook > .compact-view,
      .t-ebook > .detail-view > summary { color: var(--blue); }

      .t-mixed > .compact-view,
      .t-mixed > .detail-view > summary { color: var(--muted); }

      .leaf:hover { background: rgba(0, 0, 0, .03); }

      /* ── Individual file rows (visible in detail mode) ───────────────── */

      .filelist { list-style: none; padding: 4px 0; }

      .file {
        display:     flex;
        align-items: center;
        gap:         8px;
        padding:     5px 20px 5px 68px;
        font-size:   .82rem;
      }

      .l1 .file { padding-left: 52px; }
      .l0 .file { padding-left: 36px; }

      .f-audio { color: var(--green); }
      .f-ebook { color: var(--blue);  }

      /* Format tag (e.g. "MP3", "EPUB") */
      .tag {
        background:    rgba(0, 0, 0, .07);
        border-radius: 3px;
        padding:       1px 5px;
        font-size:     .67rem;
        font-weight:   500;
        flex-shrink:   0;
      }

      /* File size label */
      .sz {
        font-size:   .7rem;
        color:       var(--muted);
        flex-shrink: 0;
        margin-left: auto;
      }

      /* ── Shared utilities ────────────────────────────────────────────── */

      /* Truncated name that fills available space */
      .n {
        flex:          1;
        min-width:     0;
        overflow:      hidden;
        text-overflow: ellipsis;
        white-space:   nowrap;
      }

      /* Search match highlight */
      .sm > .compact-view > .n,
      .sm > .detail-view > summary > .n {
        background:    rgba(200, 169, 110, .4);
        border-radius: 2px;
        padding:       0 3px;
      }

      .hide    { display: none !important; }

      footer {
        text-align:  center;
        padding:     20px;
        color:       var(--muted);
        font-size:   .75rem;
        border-top:  1px solid var(--bd);
      }

      @media (max-width: 600px) {
        .hi, main, .ti { padding-left: 16px; padding-right: 16px; }
      }

    </style>
  </head>

  <body>

    <header>
      <div class="hi">
        <div class="hl">Library</div>
        <h1>${esc(libName)}</h1>
        <div class="hdiv"></div>
      </div>
    </header>

    <div class="toolbar">
      <div class="ti">

        <div class="sw">
          <span class="si">🔍</span>
          <input
            id="s"
            type="text"
            placeholder="Search by author, series, title…"
            oninput="search(this.value)"
          >
        </div>

        <button class="btn" onclick="expandAll()">Expand all</button>
        <button class="btn" onclick="collapseAll()">Collapse all</button>

        <label class="toggle-wrap">
          <span class="toggle">
            <input type="checkbox" id="toggle-files" onchange="toggleFiles(this.checked)">
            <span class="toggle-track"></span>
          </span>
          Show files
        </label>

        <span id="rc"></span>

      </div>
    </div>

    <main>
      <ul id="tree">${treeHTML}</ul>
    </main>

    <footer>
      ${esc(libName)} &nbsp;·&nbsp; Generated on ${new Date().toLocaleDateString('en')} &nbsp;·&nbsp; 📚 Audiobook &nbsp; 📖 E-Book
    </footer>

    <script>

      var timer = null;

      /**
       * Switches between compact folder view and detailed file list view.
       * Achieved purely via CSS: toggling the "show-files" class on <body>.
       * @param {boolean} on - Whether to show individual files.
       */
      function toggleFiles(on) {
        document.body.classList.toggle('show-files', on);
      }

      /** Debounced entry point for the search input. */
      function search(q) {
        clearTimeout(timer);
        timer = setTimeout(function () { filter(q.trim().toLowerCase()); }, 120);
      }

      /**
       * Filters the visible tree to only show items whose name contains the query.
       * Matching items and all their ancestors are revealed; everything else is hidden.
       * Clears the filter and resets the tree when the query is empty.
       * @param {string} q - Lowercase search string.
       */
      function filter(q) {
        var all = document.querySelectorAll('.item');
        var rc  = document.getElementById('rc');

        // Clear previous highlights
        document.querySelectorAll('.sm').forEach(function (e) { e.classList.remove('sm'); });

        if (!q) {
          all.forEach(function (e) { e.classList.remove('hide'); });
          document.querySelectorAll('details').forEach(function (d) { d.open = false; });
          document.querySelectorAll('#tree > li > details').forEach(function (d) { d.open = true; });
          rc.textContent = '';
          return;
        }

        // Hide everything, then reveal matches and their ancestors
        all.forEach(function (e) { e.classList.add('hide'); });
        document.querySelectorAll('details').forEach(function (d) { d.open = false; });

        var matchCount = 0;

        all.forEach(function (item) {
          if ((item.dataset.name || '').includes(q)) {
            item.classList.remove('hide');
            item.classList.add('sm');
            matchCount++;

            // Walk up the DOM and reveal all ancestor list items, details, and uls
            var el = item.parentElement;
            while (el && el.id !== 'tree') {
              if (el.tagName === 'LI')      el.classList.remove('hide');
              if (el.tagName === 'DETAILS') el.open = true;
              if (el.tagName === 'UL')      el.classList.remove('hide');
              el = el.parentElement;
            }
          }
        });

        rc.textContent = matchCount > 0 ? matchCount + ' results' : 'No results';
      }

      /** Opens all collapsible <details> elements in the tree. */
      function expandAll() {
        document.querySelectorAll('details').forEach(function (d) { d.open = true; });
      }

      /** Closes all collapsible <details> elements in the tree. */
      function collapseAll() {
        document.querySelectorAll('details').forEach(function (d) { d.open = false; });
      }

    <\/script>

  </body>

</html>`;

const outFile = path.join(process.cwd(), libName + '.html');
fs.writeFileSync(outFile, html, 'utf8');
console.log('Done! Output written to: ' + outFile);