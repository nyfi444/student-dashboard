/* ── Notebook pictures and tables ────────────────────────────────
   Pictures go in at the caret (the Picture button, /image, paste, or a
   drop), and a click on one opens its bar: wrap text on the left, center,
   wrap on the right, full width, or delete. The frame's corner handles
   resize it. The layout is saved on the picture itself as an nb-img-*
   class and a width in percent (sanitize.js keeps both), so it looks the
   same on a phone and a laptop, and in a shared note for everyone.

   A picture is stored as a file (Firebase Storage) when the account
   syncs, so a few photos never push a note past Firestore's 1MB cap; a
   note that only lives in this browser keeps it inline.

   Tables come from the Table button's size grid or /table. While the
   caret is in a cell, a Table button sits on the table's corner with
   rows, columns, the header row and delete. Tab moves cell to cell, and
   Tab in the last cell adds a row.

   The bars live inside the notebook page (see pageNotebook), so a
   re-render or leaving the page takes them away with it.
──────────────────────────────────────────────────────────────── */
const NB_IMG_LAYOUTS = ['left', 'center', 'right', 'full'];
const NB_IMG_DEFAULT_WIDTH = 60;

function nbEditorEl() { return document.getElementById('note-editor'); }
function nbMediaSaved() {
  const editor = nbEditorEl();
  if (editor && window._nbCurrentNoteId) saveNoteContentDebounced(window._nbCurrentNoteId, editor.innerHTML);
}
// The caret in the note right now, else the last one the editor had.
function nbCurrentRange(editor) {
  const sel = window.getSelection();
  if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) return sel.getRangeAt(0);
  const saved = window._nbSavedRange;
  return saved && editor.contains(saved.startContainer) ? saved : null;
}
// The line a new block goes after: a paragraph, heading or checklist line,
// or the whole list, quote, code block or table the caret is in. Inside a
// layout's section it stays inside that section.
function nbLineBlock(node, editor) {
  let el = node && node.nodeType === 3 ? node.parentElement : node;
  let block = null;
  for (; el && el !== editor; el = el.parentElement) {
    if (/^(UL|OL|BLOCKQUOTE|PRE|TABLE)$/.test(el.tagName)) block = el;
    else if (!block && (/^(P|H[1-6])$/.test(el.tagName) || el.classList.contains('nb-todo-line'))) block = el;
    else if (el.tagName === 'DIV' && !el.classList.contains('nb-todo-line')) break;
  }
  return block;
}
function nbBlockIsEmpty(el) { return el.tagName === 'P' && !el.textContent.trim() && !el.querySelector('img, input, table, hr'); }
function nbCaretInto(el, atStart) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(!!atStart);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
  window._nbSavedRange = range.cloneRange();
}
// Puts block-level HTML under the caret's line (in place of an empty one),
// with a line to keep typing on after it. Returns the inserted elements.
function nbInsertBlock(html) {
  const editor = nbEditorEl();
  if (!editor) return [];
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const nodes = [...tpl.content.children];
  const range = nbCurrentRange(editor);
  const block = range ? nbLineBlock(range.startContainer, editor) : null;
  if (block && nbBlockIsEmpty(block)) block.replaceWith(...nodes);
  else if (block) block.after(...nodes);
  else if (range && range.startContainer !== editor) { const r = range.cloneRange(); r.collapse(false); for (const n of [...nodes].reverse()) r.insertNode(n); }
  else editor.append(...nodes);
  const last = nodes[nodes.length - 1];
  if (last && (!last.nextElementSibling || /^(TABLE|HR)$/.test(last.nextElementSibling.tagName) || last.nextElementSibling.querySelector?.('img'))) {
    const p = document.createElement('p');
    p.innerHTML = '<br>';
    last.after(p);
  }
  return nodes;
}

/* ── Pictures ── */
function nbPickPicture() {
  const editor = nbEditorEl();
  if (!editor) return;
  const r = nbCurrentRange(editor);
  if (r) window._nbSavedRange = r.cloneRange();
  // No accept= on purpose: any file goes. A picture comes in as a picture,
  // a PDF as its pages, anything else as its text.
  $('#nb-picture-input')?.click();
}
function nbPictureStoragePath(name) {
  const noteId = String(window._nbCurrentNoteId || '');
  const file = `${uid()}-${storageSafeName(name || 'picture.jpg')}`;
  if (noteId.startsWith('shared:')) return `sharedNotes/${noteId.slice(7)}/images/${file}`;
  return `users/${_fbUser.uid}/attachments/note-${file}`;
}
function nbPicturesToCloud() { return typeof _fbUser !== 'undefined' && !!_fbUser && !!window._licensed && !isEmbedded(); }
// A picture's lasting address: a Storage URL when the account syncs, or the
// data URL itself when this note only lives here. A shared note always
// syncs, so a failed upload there is an error rather than a fallback.
async function nbStorePicture(dataUrl, name) {
  const shared = String(window._nbCurrentNoteId || '').startsWith('shared:');
  if (!nbPicturesToCloud()) {
    if (shared) throw new Error('Log in to add pictures to a shared note.');
    return dataUrl;
  }
  try { return await uploadDataUrlToStorage(nbPictureStoragePath(name), dataUrl, name); }
  catch (e) {
    diag.warn('notebook', 'Picture upload failed', e);
    if (shared) throw new Error('Couldn’t upload that picture. Check your connection and try again.');
    return dataUrl;
  }
}
function nbPictureHtml(src, alt) {
  return `<p><img class="nb-img nb-img-center" src="${esc(src)}" alt="${esc(alt || '')}" style="width: ${NB_IMG_DEFAULT_WIDTH}%"></p>`;
}
async function nbAddPictures(fileList) {
  const input = $('#nb-picture-input');
  const files = Array.from(fileList || []);
  if (input) input.value = '';
  const editor = nbEditorEl();
  if (!files.length || !editor) return;
  const status = $('#nb-save-status');
  const problems = [];
  let added = 0;
  for (const file of files) {
    if (status) status.textContent = `Adding ${file.name || 'picture'}…`;
    try {
      const kind = await uploadKind(file);
      let html;
      if (kind === 'image') {
        const cloud = nbPicturesToCloud();
        const dataUrl = await imageUploadDataUrl(file, cloud ? 1800 : 1400, cloud ? 0.85 : 0.8);
        html = nbPictureHtml(await nbStorePicture(dataUrl, file.name), file.name);
      } else {
        // A PDF's pages or a document's text, the same as Upload a file.
        const body = await noteHtmlForFile(file, problems);
        html = kind === 'pdf' ? await nbStorePdfPages(body, file.name) : body;
      }
      const nodes = nbInsertBlock(html);
      const last = nodes[nodes.length - 1];
      if (last) { const next = last.nextElementSibling || last; nbCaretInto(next, true); }
      added++;
    } catch (e) { problems.push(e.message || `Couldn’t add ${file.name}.`); }
  }
  if (added) { nbTagInks(editor); nbMediaSaved(); }
  else if (status) status.textContent = 'Not added';
  if (problems.length) toast(problems.join(' '), added ? 'info' : 'error', 7000);
}
// PDF pages arrive as data URLs; in a synced note each goes to Storage.
async function nbStorePdfPages(html, name) {
  if (!nbPicturesToCloud()) return html.replace(/style="[^"]*"/g, '').replace(/<img /g, '<img class="nb-img nb-img-full" style="width: 100%" ');
  const srcs = [...html.matchAll(/src="(data:image\/[^"]+)"/g)].map(m => m[1]);
  let out = html;
  let page = 0;
  for (const src of srcs) {
    page++;
    const url = await nbStorePicture(src, `${String(name || 'document').replace(/\.pdf$/i, '')}-page-${page}.jpg`);
    out = out.replace(src, url);
  }
  return out.replace(/style="[^"]*"/g, '').replace(/<img /g, '<img class="nb-img nb-img-full" style="width: 100%" ');
}

/* The picture bar and frame */
function nbImgLayoutOf(img) { return NB_IMG_LAYOUTS.find(k => img.classList.contains(`nb-img-${k}`)) || 'center'; }
function nbImgWidthOf(img) {
  const w = parseFloat(img.style.width);
  return w > 0 && String(img.style.width).endsWith('%') ? w : null;
}
function nbSelectImage(img) {
  window._nbImg = img;
  nbHideBubble();
  $('#nb-table-btn')?.classList.remove('is-shown');
  const bar = $('#nb-img-bar');
  if (bar) {
    const layout = nbImgLayoutOf(img);
    $$('[data-img-layout]', bar).forEach(b => { const on = b.dataset.imgLayout === layout; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    bar.classList.add('is-shown');
  }
  $('#nb-img-frame')?.classList.add('is-shown');
  nbPlaceMediaBars();
}
function nbDeselectImage() {
  window._nbImg = null;
  $('#nb-img-bar')?.classList.remove('is-shown');
  $('#nb-img-frame')?.classList.remove('is-shown');
}
function nbSetImgLayout(layout) {
  const img = window._nbImg;
  if (!img || !NB_IMG_LAYOUTS.includes(layout)) return;
  img.classList.add('nb-img');
  NB_IMG_LAYOUTS.forEach(k => img.classList.toggle(`nb-img-${k}`, k === layout));
  const w = nbImgWidthOf(img);
  // Text needs room beside a wrapped picture, so it starts at 40% at most.
  if (layout === 'full') img.style.width = '100%';
  else if (layout !== 'center' && (!w || w > 50)) img.style.width = '40%';
  else if (!w || w >= 100) img.style.width = NB_IMG_DEFAULT_WIDTH + '%';
  img.removeAttribute('width'); img.removeAttribute('height');
  nbSelectImage(img);
  nbMediaSaved();
}
function nbSetImgWidth(pct) {
  const img = window._nbImg;
  if (!img) return;
  img.classList.add('nb-img');
  if (!NB_IMG_LAYOUTS.some(k => img.classList.contains(`nb-img-${k}`))) img.classList.add('nb-img-center');
  if (img.classList.contains('nb-img-full') && pct < 100) { img.classList.remove('nb-img-full'); img.classList.add('nb-img-center'); }
  img.style.width = Math.round(clamp(pct, 10, 100)) + '%';
  img.removeAttribute('width'); img.removeAttribute('height');
  nbPlaceMediaBars();
}
function nbDeleteImage() {
  const img = window._nbImg;
  if (!img) return;
  const wrap = img.parentElement;
  img.remove();
  if (wrap && wrap.tagName === 'P' && nbEditorEl()?.contains(wrap) && !wrap.textContent.trim() && !wrap.querySelector('img, input')) {
    const next = wrap.nextElementSibling;
    wrap.remove();
    if (next) nbCaretInto(next, true);
  }
  nbDeselectImage();
  nbMediaSaved();
}
function nbEditImgAlt() {
  const img = window._nbImg;
  if (!img) return;
  window._nbAltImg = img;
  openModal(`
    <div class="modal-head"><h3>Describe this picture</h3>${closeXButton()}</div>
    <div class="modal-body">
      <div class="field"><label for="nb-img-alt">Description</label><input class="input" id="nb-img-alt" maxlength="300" placeholder="Diagram of the cell cycle" value="${esc(img.getAttribute('alt') || '')}" onkeydown="if(event.key==='Enter'){event.preventDefault();nbSaveImgAlt()}"></div>
      <p class="small muted">Screen readers read this out, and it shows if the picture can’t load.</p>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="nbSaveImgAlt()">Save</button></div>
  `);
  setTimeout(() => $('#nb-img-alt')?.focus(), 30);
}
function nbSaveImgAlt() {
  const img = window._nbAltImg;
  window._nbAltImg = null;
  if (img && img.isConnected) { img.setAttribute('alt', ($('#nb-img-alt')?.value || '').trim()); nbMediaSaved(); }
  closeModal();
}
// The bars follow their picture or table through scrolling, typing and
// resizing; anything no longer on the page puts its bar away.
function nbPlaceMediaBars() {
  const img = window._nbImg;
  const bar = $('#nb-img-bar'), frame = $('#nb-img-frame');
  if (img && (!img.isConnected || !nbEditorEl()?.contains(img))) nbDeselectImage();
  else if (img && bar && frame) {
    const r = img.getBoundingClientRect();
    Object.assign(frame.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    const bw = bar.offsetWidth || 300, bh = bar.offsetHeight || 40;
    // On the picture's top edge when it is big enough to carry the bar, so
    // the text around it stays readable; otherwise just under it.
    let top = r.width >= bw + 16 && r.height >= bh * 2.5 ? Math.max(r.top + 8, 64) : r.bottom + 10;
    if (top + bh > window.innerHeight - 8) top = r.top - bh - 8;
    bar.style.left = clamp(r.left + r.width / 2 - bw / 2, 8, window.innerWidth - bw - 8) + 'px';
    bar.style.top = Math.max(8, top) + 'px';
    const pct = nbImgWidthOf(img);
    $$('[data-img-size]', bar).forEach(b => { const on = !img.classList.contains('nb-img-full') && pct === +b.dataset.imgSize; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
  }
  const cell = window._nbCell;
  const tbtn = $('#nb-table-btn');
  if (tbtn) {
    const table = cell && cell.isConnected && nbEditorEl()?.contains(cell) ? cell.closest('table') : null;
    if (!table || window._nbImg) { tbtn.classList.remove('is-shown'); if (!table) window._nbCell = null; }
    else {
      const r = table.getBoundingClientRect();
      tbtn.classList.add('is-shown');
      const w = tbtn.offsetWidth || 80;
      // Beside the table when the page has room for it, else on its corner.
      const page = $('#nb-page')?.getBoundingClientRect();
      const beside = page && r.right + w + 12 <= page.right - 8;
      tbtn.style.left = (beside ? r.right + 8 : clamp(r.right - w, 8, window.innerWidth - w - 8)) + 'px';
      tbtn.style.top = Math.max(8, beside ? r.top : r.top - (tbtn.offsetHeight || 28) - 6) + 'px';
    }
  }
}
let _nbBarsFrame = 0;
function nbPlaceMediaBarsSoon() {
  if (_nbBarsFrame) return;
  _nbBarsFrame = requestAnimationFrame(() => { _nbBarsFrame = 0; nbPlaceMediaBars(); });
}
// Dragging a corner handle. A centered picture grows from both sides, so
// it moves twice as fast; a picture on the right grows to the left.
function nbStartImgResize(e, side) {
  const img = window._nbImg;
  if (!img) return;
  e.preventDefault(); e.stopPropagation();
  const box = (img.parentElement && img.parentElement !== nbEditorEl() ? img.parentElement : nbEditorEl()).getBoundingClientRect();
  const startW = img.getBoundingClientRect().width;
  const startX = e.clientX;
  const layout = nbImgLayoutOf(img);
  const factor = layout === 'center' || layout === 'full' ? 2 : 1;
  const handle = e.currentTarget;
  try { handle.setPointerCapture(e.pointerId); } catch {}
  document.body.classList.add('nb-resizing');
  const onMove = ev => {
    const dx = (ev.clientX - startX) * (side === 'left' ? -1 : 1) * factor;
    nbSetImgWidth((startW + dx) / Math.max(1, box.width) * 100);
  };
  const onUp = () => {
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onUp);
    handle.removeEventListener('pointercancel', onUp);
    document.body.classList.remove('nb-resizing');
    nbSelectImage(img);
    nbMediaSaved();
  };
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onUp);
}
function nbMediaBarsHtml() {
  const pd = 'onmousedown="event.preventDefault()"';
  return `
    <div class="nb-img-bar" id="nb-img-bar" role="toolbar" aria-label="Picture">
      <button data-img-layout="left" ${pd} onclick="nbSetImgLayout('left')" aria-label="Wrap text, picture on the left" data-tip="Picture left, text wraps">${icon('img-left', 16)}</button>
      <button data-img-layout="center" ${pd} onclick="nbSetImgLayout('center')" aria-label="Center, no wrapping" data-tip="Centered">${icon('img-center', 16)}</button>
      <button data-img-layout="right" ${pd} onclick="nbSetImgLayout('right')" aria-label="Wrap text, picture on the right" data-tip="Picture right, text wraps">${icon('img-right', 16)}</button>
      <button data-img-layout="full" ${pd} onclick="nbSetImgLayout('full')" aria-label="Full width" data-tip="Full width">${icon('img-full', 16)}</button>
      <span class="nb-bubble-sep" aria-hidden="true"></span>
      ${[['S', 30], ['M', 50], ['L', 75]].map(([l, p]) => `<button class="nb-img-size" data-img-size="${p}" ${pd} onclick="nbSetImgWidth(${p});nbMediaSaved()" aria-label="${l === 'S' ? 'Small' : l === 'M' ? 'Medium' : 'Large'}" data-tip="${p}% wide">${l}</button>`).join('')}
      <span class="nb-bubble-sep" aria-hidden="true"></span>
      <button class="nb-img-alt-btn" ${pd} onclick="nbEditImgAlt()" aria-label="Describe the picture" data-tip="Description for screen readers">Alt</button>
      <button ${pd} onclick="nbDeleteImage()" aria-label="Delete picture" data-tip="Delete">${icon('trash', 16)}</button>
    </div>
    <div class="nb-img-frame" id="nb-img-frame" aria-hidden="true">
      <span class="nb-img-handle is-left" onpointerdown="nbStartImgResize(event,'left')"></span>
      <span class="nb-img-handle is-right" onpointerdown="nbStartImgResize(event,'right')"></span>
    </div>
    <button type="button" class="nb-table-btn" id="nb-table-btn" ${pd} onclick="openNbTableMenu(this)" aria-haspopup="menu" aria-label="Table options">${icon('table', 14)}<span>Table</span>${icon('chevron-down', 12)}</button>
    <div class="nb-table-pick menu-surface" id="nb-table-pick" role="dialog" aria-label="Table size"></div>
    <input type="file" id="nb-picture-input" multiple style="display:none" onchange="nbAddPictures(this.files)">`;
}

/* ── Tables ── */
const NB_TABLE_PICK = { rows: 6, cols: 6 };
function nbTableHtml(rows, cols) {
  const head = `<thead><tr>${'<th><br></th>'.repeat(cols)}</tr></thead>`;
  const body = rows > 1 ? `<tbody>${`<tr>${'<td><br></td>'.repeat(cols)}</tr>`.repeat(rows - 1)}</tbody>` : '';
  return `<table class="nb-table">${head}${body}</table>`;
}
function nbInsertTable(rows = 3, cols = 3) {
  closeNbTablePick();
  const nodes = nbInsertBlock(nbTableHtml(rows, cols));
  const table = nodes.find(n => n.tagName === 'TABLE');
  if (table) { const first = table.querySelector('th, td'); if (first) { nbCaretInto(first, true); window._nbCell = first; } }
  nbEditorEl()?.focus({ preventScroll: true });
  nbPlaceMediaBars();
  nbMediaSaved();
}
// The Table button opens a size grid; on a keyboard, Enter takes 3 × 3.
function openNbTablePick(anchor) {
  const pop = $('#nb-table-pick');
  const editor = nbEditorEl();
  if (!pop || !editor) return;
  if (pop.classList.contains('is-shown')) { closeNbTablePick(); return; }
  const r = nbCurrentRange(editor);
  if (r) window._nbSavedRange = r.cloneRange();
  closeNbTypePop(); closeNbColorPopover();
  const cells = [];
  for (let y = 1; y <= NB_TABLE_PICK.rows; y++) for (let x = 1; x <= NB_TABLE_PICK.cols; x++) {
    cells.push(`<button type="button" class="nb-tp-cell" data-r="${y}" data-c="${x}" aria-label="${y} rows by ${x} columns" onmouseenter="nbTablePickHover(${y},${x})" onfocus="nbTablePickHover(${y},${x})" onclick="nbInsertTable(${y},${x})"></button>`);
  }
  pop.innerHTML = `<div class="nb-tp-grid" style="grid-template-columns:repeat(${NB_TABLE_PICK.cols},1fr)">${cells.join('')}</div><div class="nb-tp-label" id="nb-tp-label">3 × 3</div>`;
  nbTablePickHover(3, 3);
  pop.classList.add('is-shown');
  const ar = anchor.getBoundingClientRect();
  const w = pop.offsetWidth || 180, h = pop.offsetHeight || 190;
  let top = ar.bottom + 8;
  if (top + h > window.innerHeight - 8) top = ar.top - h - 8;
  pop.style.left = clamp(ar.left + ar.width / 2 - w / 2, 8, window.innerWidth - w - 8) + 'px';
  pop.style.top = Math.max(8, top) + 'px';
  nbHideBubble();
  if (window.event && window.event.detail === 0) $('.nb-tp-cell[data-r="3"][data-c="3"]', pop)?.focus({ preventScroll: true });
  document.removeEventListener('mousedown', nbTablePickOutside);
  setTimeout(() => document.addEventListener('mousedown', nbTablePickOutside), 0);
}
function nbTablePickHover(r, c) {
  $$('#nb-table-pick .nb-tp-cell').forEach(b => b.classList.toggle('on', +b.dataset.r <= r && +b.dataset.c <= c));
  const label = $('#nb-tp-label');
  if (label) label.textContent = `${r} × ${c}`;
}
function nbTablePickOutside(e) {
  const pop = $('#nb-table-pick');
  if (pop && !pop.contains(e.target) && !e.target.closest?.('[data-nb-fold="table"]')) closeNbTablePick();
}
function closeNbTablePick() {
  $('#nb-table-pick')?.classList.remove('is-shown');
  document.removeEventListener('mousedown', nbTablePickOutside);
}
function nbCellAt(node) {
  const editor = nbEditorEl();
  let el = node && node.nodeType === 3 ? node.parentElement : node;
  const cell = el?.closest?.('td, th');
  // A Cornell page is laid out as a table-like grid; its shape is fixed.
  return cell && editor?.contains(cell) && !cell.closest('.nb-cornell') ? cell : null;
}
function openNbTableMenu(btn) {
  const cell = window._nbCell;
  const table = cell?.closest('table');
  if (!table) return;
  const hasHead = !!table.tHead;
  const inLayout = !!cell.closest('.nb-lab, .nb-sheet');
  openMenu(btn, `
    <button class="menu-item" onclick="nbTableOp('row-above')">${icon('plus', 16)}<span>Row above</span></button>
    <button class="menu-item" onclick="nbTableOp('row-below')">${icon('plus', 16)}<span>Row below</span></button>
    ${inLayout ? '' : `<button class="menu-item" onclick="nbTableOp('col-left')">${icon('plus', 16)}<span>Column to the left</span></button>
    <button class="menu-item" onclick="nbTableOp('col-right')">${icon('plus', 16)}<span>Column to the right</span></button>`}
    <div class="menu-sep" role="separator"></div>
    <button class="menu-item" onclick="nbTableOp('row-delete')">${icon('minus', 16)}<span>Delete row</span></button>
    ${inLayout ? '' : `<button class="menu-item" onclick="nbTableOp('col-delete')">${icon('minus', 16)}<span>Delete column</span></button>
    <div class="menu-sep" role="separator"></div>
    <button class="menu-item" onclick="nbTableOp('header')">${icon(hasHead ? 'check-square' : 'grid', 16)}<span>${hasHead ? 'Turn off the header row' : 'Make the first row a header'}</span></button>
    <button class="menu-item is-danger" onclick="nbTableOp('delete')">${icon('trash', 16)}<span>Delete table</span></button>`}
  `, { align: 'end' });
}
function nbNewCellLike(cell) {
  const c = document.createElement(cell.tagName === 'TH' ? 'th' : 'td');
  c.innerHTML = '<br>';
  return c;
}
function nbTableOp(op) {
  if (typeof closeMenu === 'function') closeMenu(false);
  const cell = window._nbCell;
  const table = cell?.closest('table');
  const editor = nbEditorEl();
  if (!table || !editor?.contains(table)) return;
  const tr = cell.parentElement;
  const col = cell.cellIndex;
  let focus = cell;
  if (op === 'row-above' || op === 'row-below') {
    const row = document.createElement('tr');
    const inHead = tr.parentElement.tagName === 'THEAD';
    const below = op === 'row-below';
    // A row added under the header row is an ordinary row.
    const like = inHead && below ? 'td' : null;
    [...tr.cells].forEach(c => { const n = like ? document.createElement('td') : nbNewCellLike(c); n.innerHTML = '<br>'; row.appendChild(n); });
    if (inHead && below) {
      let body = table.tBodies[0];
      if (!body) { body = document.createElement('tbody'); table.appendChild(body); }
      body.prepend(row);
    } else if (below) tr.after(row); else tr.before(row);
    focus = row.cells[Math.min(col, row.cells.length - 1)];
  } else if (op === 'col-left' || op === 'col-right') {
    [...table.rows].forEach(r => {
      const ref = r.cells[Math.min(col, r.cells.length - 1)];
      if (!ref) return;
      const n = nbNewCellLike(ref);
      if (op === 'col-right') ref.after(n); else ref.before(n);
      if (r === tr) focus = n;
    });
  } else if (op === 'row-delete') {
    if (table.rows.length <= 1) return nbTableOp('delete');
    const next = tr.nextElementSibling || tr.previousElementSibling || (tr.parentElement.tagName === 'THEAD' ? table.tBodies[0]?.rows[0] : table.tHead?.rows[0]);
    tr.remove();
    if (table.tHead && !table.tHead.rows.length) table.tHead.remove();
    focus = next?.cells?.[Math.min(col, next.cells.length - 1)] || table.querySelector('th, td');
  } else if (op === 'col-delete') {
    if ([...table.rows].every(r => r.cells.length <= 1)) return nbTableOp('delete');
    [...table.rows].forEach(r => { const c = r.cells[Math.min(col, r.cells.length - 1)]; if (c && r.cells.length > 1) c.remove(); });
    focus = tr.cells[Math.min(col, tr.cells.length - 1)];
  } else if (op === 'header') {
    if (table.tHead) {
      const head = table.tHead.rows[0];
      let body = table.tBodies[0];
      if (!body) { body = document.createElement('tbody'); table.appendChild(body); }
      const row = document.createElement('tr');
      [...head.cells].forEach(c => { const n = document.createElement('td'); while (c.firstChild) n.appendChild(c.firstChild); row.appendChild(n); });
      body.prepend(row);
      table.tHead.remove();
      focus = row.cells[Math.min(col, row.cells.length - 1)];
    } else {
      const first = table.rows[0];
      if (!first) return;
      const thead = document.createElement('thead');
      const row = document.createElement('tr');
      [...first.cells].forEach(c => { const n = document.createElement('th'); while (c.firstChild) n.appendChild(c.firstChild); row.appendChild(n); });
      thead.appendChild(row);
      first.remove();
      table.prepend(thead);
      focus = row.cells[Math.min(col, row.cells.length - 1)];
    }
  } else if (op === 'delete') {
    const after = table.nextElementSibling;
    const p = document.createElement('p');
    p.innerHTML = '<br>';
    if (!after || !nbBlockIsEmpty(after)) table.after(p);
    const target = after && nbBlockIsEmpty(after) ? after : p;
    table.remove();
    window._nbCell = null;
    nbCaretInto(target, true);
    editor.focus({ preventScroll: true });
    nbPlaceMediaBars();
    nbMediaSaved();
    return;
  }
  if (focus) { window._nbCell = focus; nbCaretInto(focus, false); }
  editor.focus({ preventScroll: true });
  nbPlaceMediaBars();
  nbMediaSaved();
}
// Tab and Shift+Tab move between cells; Tab in the last cell adds a row.
function nbTableTab(e) {
  if (e.key !== 'Tab' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  const sel = window.getSelection();
  const cell = sel && sel.anchorNode ? nbCellAt(sel.anchorNode) : null;
  if (!cell) return;
  e.preventDefault();
  const table = cell.closest('table');
  const cells = [...table.querySelectorAll('th, td')].filter(c => c.closest('table') === table);
  const i = cells.indexOf(cell);
  let next = cells[i + (e.shiftKey ? -1 : 1)];
  if (!next && !e.shiftKey) {
    window._nbCell = cell;
    nbTableOp('row-below');
    next = window._nbCell;
    nbCaretInto(next, true);
    return;
  }
  if (next) { window._nbCell = next; nbCaretInto(next, false); nbPlaceMediaBars(); }
}

/* ── One set of listeners for the editor's pictures and tables ── */
let _nbMediaWired = false;
function wireNbMedia() {
  nbDeselectImage();
  window._nbCell = null;
  if (_nbMediaWired) return;
  _nbMediaWired = true;
  document.addEventListener('click', e => {
    const img = e.target.closest?.('#note-editor img');
    if (img) { nbSelectImage(img); return; }
    if (!e.target.closest?.('#nb-img-bar, #nb-img-frame')) nbDeselectImage();
  });
  document.addEventListener('keydown', e => {
    if (!window._nbImg) return;
    if (e.target.closest?.('.modal')) return;
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); nbDeleteImage(); }
    else if (e.key === 'Escape') nbDeselectImage();
    else if (!e.target.closest?.('#nb-img-bar')) nbDeselectImage();
  });
  document.addEventListener('keydown', e => { if (e.target.closest?.('#note-editor')) nbTableTab(e); });
  document.addEventListener('selectionchange', () => {
    const editor = nbEditorEl();
    const sel = window.getSelection();
    if (!editor || !sel || !sel.anchorNode) return;
    if (editor.contains(sel.anchorNode)) window._nbCell = nbCellAt(sel.anchorNode);
    else if (!sel.anchorNode.parentElement?.closest?.('.menu, #nb-table-btn')) window._nbCell = null;
    nbPlaceMediaBarsSoon();
  });
  document.addEventListener('scroll', nbPlaceMediaBarsSoon, { capture: true, passive: true });
  window.addEventListener('resize', nbPlaceMediaBarsSoon);
  document.addEventListener('input', e => { if (e.target.closest?.('#note-editor')) nbPlaceMediaBarsSoon(); });
  // A picture pasted or dropped into the note.
  document.addEventListener('paste', e => {
    if (!e.target.closest?.('#note-editor')) return;
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    const editor = nbEditorEl();
    const r = editor && nbCurrentRange(editor);
    if (r) window._nbSavedRange = r.cloneRange();
    nbAddPictures(files);
  });
  document.addEventListener('dragover', e => {
    if (e.target.closest?.('#note-editor') && [...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault();
  });
  document.addEventListener('drop', e => {
    const editor = nbEditorEl();
    if (!editor || !e.target.closest?.('#note-editor')) return;
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    let range = null;
    if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(e.clientX, e.clientY);
    else if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(e.clientX, e.clientY); if (p) { range = document.createRange(); range.setStart(p.offsetNode, p.offset); range.collapse(true); } }
    if (range && editor.contains(range.startContainer)) window._nbSavedRange = range;
    nbAddPictures(files);
  });
}
