/* ── Clubs & teams: files ─────────────────────────────────────────
   Loaded after js/orgs.js. Officers share, everyone opens.
──────────────────────────────────────────────────────────────── */
/* ── Files: officers share, everyone opens ─────────────────────── */
function orgFileList(o) {
  return Object.values(o.files || {}).filter(f => f && safeId(f.id) && (f.kind === 'file' || f.kind === 'link') && typeof f.title === 'string')
    .map(f => ({ ...f, title: cleanStr(f.title, 120) || 'File', name: cleanStr(f.name, 60) || 'An officer', size: Number(f.size) || 0 }))
    .sort((a, b) => (b.at || 0) - (a.at || 0));
}
// A club file shared since Oct 2026 keeps only where it lives in Storage
// (files.{id}.path). The link to it is asked for when someone opens it, and
// the Storage rules hand it only to members, so the club no longer carries a
// list of every file's permanent link. Older files carry url until the
// Worker's file-link rotation moves them to path.
const _orgFileLinks = {};   // path -> download link, this session
function orgFilePath(o, f) {
  const p = String(f.path || '');
  return p.startsWith(`orgs/${o.code}/files/`) && !p.includes('..') ? p : '';
}
function orgFileUrl(o, f) {
  const url = String(f.url || '');
  if (isHttpUrl(url)) return url;
  if (o.local && url.startsWith('data:')) return url;
  const path = orgFilePath(o, f);
  return path ? (_orgFileLinks[path] || '') : '';
}
async function orgFileStorageRef(f) {
  const st = await fbStorage();
  if (typeof f.path === 'string' && f.path.startsWith('orgs/')) return st.ref(f.path);
  return String(f.url || '').includes('firebasestorage') ? st.refFromURL(f.url) : null;
}
async function orgFileLink(path) {
  if (_orgFileLinks[path]) return _orgFileLinks[path];
  const url = await (await fbStorage()).ref(path).getDownloadURL();
  _orgFileLinks[path] = url;
  return url;
}
// The window opens inside the tap (Safari blocks one opened after a wait)
// and is pointed at the file once the link arrives.
async function openOrgFile(code, id) {
  const o = findOrg(code);
  const f = o && orgFileList(o).find(x => x.id === id);
  const path = f && orgFilePath(o, f);
  if (!path) return;
  const w = window.open('', '_blank');
  try {
    const url = await orgFileLink(path);
    if (w) { w.opener = null; w.location.href = url; } else location.href = url;
  } catch (e) {
    if (w) w.close();
    diag.warn('clubs', 'A club file didn’t open', e);
    toast('That file didn’t open. Check your connection, or ask an officer to share it again.', 'error', 5000);
  }
}
// After an officer removes someone: the Worker gives every club file a new
// token and moves older files from a stored link to a stored path, so a
// link the removed member saved stops working. Best effort; the removal
// itself has already happened.
async function orgRotateFileLinks(code) {
  if (!_fbUser || !cloudGroupsEnabled()) return;
  const o = findOrg(code);
  if (!o || !orgFileList(o).some(f => f.kind === 'file')) return;
  try {
    const idToken = await _fbUser.getIdToken();
    const res = await fetch(`${WORKER_URL}/space/rotate-files`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken, kind: 'club', code }) });
    if (!res.ok) throw new Error(`rotate-files ${res.status}`);
    Object.keys(_orgFileLinks).filter(p => p.startsWith(`orgs/${code}/`)).forEach(p => { delete _orgFileLinks[p]; _orgThumbAsked.delete(p); });
  } catch (e) { diag.warn('clubs', 'New file links after a removal didn’t go through', e); }
}
// Image thumbnails need the link up front: asked for once per image while
// the Files tab is drawn, then the tab redraws with it.
const _orgThumbAsked = new Set();
function orgAskThumb(path) {
  if (_orgThumbAsked.has(path) || _orgFileLinks[path] || !cloudGroupsEnabled()) return;
  _orgThumbAsked.add(path);
  orgFileLink(path).then(() => renderRemote()).catch(() => {});
}
// The library's item model (see js/spaces/files.js) for a club file.
function orgLibItem(o, f) {
  const path = orgFilePath(o, f);
  const url = orgFileUrl(o, f);
  if (path && !url && /\.(png|jpe?g|gif|webp|heic)$/i.test(f.fileName || '')) orgAskThumb(path);
  return { id: f.id, kind: f.kind, title: f.title, by: f.name, at: Number(f.at) || 0, url, path, fileName: typeof f.fileName === 'string' ? f.fileName : '', size: f.size, pinned: false };
}
function orgLibItems(o) { return orgFileList(o).map(f => orgLibItem(o, f)); }
// The Overview rail keeps a compact row (compact is the only form now; the
// Files tab is the gallery). Tapping the title opens the detail sheet.
function orgFileRow(o, f) {
  const it = orgLibItem(o, f);
  return libRow('club', o.code, it, orgLibPrimary(o, it, false));
}
function orgLibPrimary(o, it, sheet) {
  const cls = `btn${sheet ? ' btn-primary' : ' btn-sm'}`;
  const is = sheet ? 16 : 14;
  if (it.kind === 'file' && it.path && !it.url) return `<button type="button" class="${cls}" onclick="openOrgFile('${o.code}','${esc(it.id)}')">${icon('download', is)}Open</button>`;
  if (!it.url) return '';
  return it.kind === 'file'
    ? `<a class="${cls}" href="${esc(it.url)}" target="_blank" rel="noopener" download="${esc(it.fileName || it.title)}">${icon('download', is)}Open</a>`
    : `<a class="${cls}" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">${icon('arrow-up-right', is)}Open</a>`;
}
function orgLibMore(o, it) {
  return isOrgOfficer(o) ? [{ label: 'Remove for everyone', icon: 'trash', js: `removeOrgFile('${o.code}','${it.id}')`, danger: true }] : [];
}
function orgLibEmpty(o) {
  if (!isOrgOfficer(o)) return { icon: 'paperclip', title: 'No files yet', body: 'When officers share something, it shows up here.' };
  return {
    icon: 'paperclip', title: 'No files yet', body: 'Your constitution, the dues form, the photo drive link.',
    actions: [
      { label: 'Upload a file', icon: 'upload', onclick: `openOrgFileModal('${o.code}')`, primary: true },
      { label: 'Add a link', icon: 'link', onclick: `openOrgFileModal('${o.code}','link')`, primary: false },
    ],
  };
}
function orgFilesTab(o) { return spaceLibrary('club', o); }
// kind (optional): 'link' opens with the link field showing.
function openOrgFileModal(code, kind) {
  const o = findOrg(code);
  if (!o || !isOrgOfficer(o)) return;
  window._orgFile = { code, kind: 'file', file: null };
  const max = o.local ? GROUP_FILE_MAX_BYTES_LOCAL : GROUP_FILE_MAX_BYTES_CLOUD;
  openModal(`
    <div class="modal-head"><h3>Share with ${esc(o.name)}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
    <div class="modal-body">
      <div class="segmented mb-16" id="ofl-kind-pick" role="group" aria-label="What are you sharing?">
        <button type="button" class="active" aria-pressed="true" onclick="setOrgFileKind('file')">${icon('paperclip', 12)} A file</button>
        <button type="button" aria-pressed="false" onclick="setOrgFileKind('link')">${icon('link', 12)} A link</button>
      </div>
      <div id="ofl-file-fields">
        <div class="upload-drop" onclick="if(event.target.id!=='ofl-file-input')$('#ofl-file-input').click()" ondragover="event.preventDefault();this.classList.add('drag')" ondragleave="this.classList.remove('drag')" ondrop="event.preventDefault();this.classList.remove('drag');handleOrgFilePick(event.dataTransfer.files[0])">
          <div class="small" id="ofl-file-status">Choose a file or drop it here: a PDF, doc, spreadsheet, or image, up to ${fmtFileSize(max)}</div>
          <input type="file" id="ofl-file-input" hidden onchange="handleOrgFilePick(this.files[0])">
        </div>
      </div>
      <div id="ofl-link-fields" hidden>
        <div class="field" style="margin-bottom:0"><label for="ofl-link-url">Link</label><input class="input" id="ofl-link-url" type="url" placeholder="https://…"></div>
      </div>
      <div class="field mt-16" style="margin-bottom:0"><label for="ofl-title">Title <span class="muted">(optional)</span></label><input class="input" id="ofl-title" maxlength="120" placeholder="Dues form, Practice schedule, Photo drive…"></div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="ofl-share" onclick="saveOrgFile()">Share</button></div>
  `);  if (kind === 'link') setOrgFileKind('link');
}
function setOrgFileKind(kind) {
  window._orgFile.kind = kind;
  $('#ofl-file-fields').hidden = kind !== 'file';
  $('#ofl-link-fields').hidden = kind !== 'link';
  $$('#ofl-kind-pick button').forEach((b, i) => { const on = (i === 0) === (kind === 'file'); b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
  if (kind === 'link') setTimeout(() => $('#ofl-link-url')?.focus(), 30);
}
async function handleOrgFilePick(file) {
  const st = window._orgFile;
  const o = findOrg(st?.code);
  const input = $('#ofl-file-input');
  if (input) input.value = '';
  if (!file || !o) return;
  const max = o.local ? GROUP_FILE_MAX_BYTES_LOCAL : GROUP_FILE_MAX_BYTES_CLOUD;
  const status = $('#ofl-file-status');
  if (file.size > max) { st.file = null; if (status) status.textContent = `That file is ${fmtFileSize(file.size)}. The limit is ${fmtFileSize(max)}.`; return; }
  if (status) status.textContent = 'Reading…';
  const dataUrl = 'data:' + mimeForFile(file.name, file.type) + ';base64,' + (await fileToBase64(file));
  st.file = { name: file.name, size: file.size, dataUrl };
  if (status) status.textContent = `${file.name} (${fmtFileSize(file.size)}) is ready to share`;
}
async function saveOrgFile() {
  const st = window._orgFile;
  const o = findOrg(st?.code);
  if (!o || !isOrgOfficer(o)) return;
  if (orgFileList(o).length >= ORG_FILES_MAX) { toast(`${o.name} already has ${ORG_FILES_MAX} files. Remove an old one first.`, 'error', 5000); return; }
  // Read the form now: the duplicate question below replaces this modal, and
  // the answer comes back to a screen where these fields no longer exist.
  if ($('#ofl-title')) {
    st.title = cleanStr($('#ofl-title').value, 120);
    if (st.kind === 'link') st.linkUrl = ($('#ofl-link-url')?.value || '').trim();
  }
  // A file the club already has under this name: ask rather than posting a
  // second copy to everyone (see askAboutDuplicateFile).
  if (!st.dupOk && st.kind === 'file' && st.file) {
    const existing = findFileByName(orgFileList(o), st.title || st.file.name);
    if (existing) {
      const proceed = () => { st.dupOk = true; saveOrgFile(); };
      askAboutDuplicateFile(st.file.name, `shared with ${o.name}`, {
        onReplace: () => { removeOrgFile(o.code, existing.id, { silent: true }); proceed(); },
        onKeepBoth: proceed,
      });
      return;
    }
  }
  const id = uid();
  const base = { id, uid: myOrgUid(o), name: myGroupName(), at: Date.now() };
  const title = st.title;
  let item;
  if (st.kind === 'link') {
    const url = st.linkUrl || '';
    if (!isHttpUrl(url)) { toast('Enter a full link starting with https://', 'error'); return; }
    item = { ...base, kind: 'link', title: title || hostOf(url) || 'Link', url };
  } else {
    if (!st.file) { toast('Choose a file first', 'error'); return; }
    item = { ...base, kind: 'file', title: title || fileBaseName(st.file.name) || st.file.name, fileName: st.file.name, size: st.file.size };
  }
  const btn = $('#ofl-share');
  setBtnLoading(btn, true);
  try {
    if (item.kind === 'file') {
      if (o.local) item.url = st.file.dataUrl;
      else if (!cloudGroupsEnabled()) { setBtnLoading(btn, false, 'Share'); toast('Log in to share files.', 'error'); return; }
      else {
        item.path = `orgs/${o.code}/files/${id}-${storageSafeName(st.file.name)}`;
        _orgFileLinks[item.path] = await uploadDataUrlToStorage(item.path, st.file.dataUrl, st.file.name);   // the sharer can open it right away
      }
    }
    if (await orgWrite(o.code, { [`files.${id}`]: item })) { closeModal(); toast(`Shared “${item.title}”`); }
    else setBtnLoading(btn, false, 'Share');
  } catch (e) {
    diag.error('clubs', 'Club file upload failed', e);
    setBtnLoading(btn, false, 'Share');
    toast('Couldn’t upload that file. Check your connection and try again.', 'error', 5000);
  }
}
// silent: the caller already asked (replacing a file of the same name, say),
// so this just does it instead of stacking a second confirmation.
function removeOrgFile(code, id, { silent = false } = {}) {
  const o = findOrg(code);
  const f = o && orgFileList(o).find(x => x.id === id);
  if (!f || !isOrgOfficer(o)) return;
  const remove = async () => {
    if (!(await orgWrite(code, { [`files.${id}`]: GW_DELETE }))) return;
    if (f.kind === 'file') orgFileStorageRef(f).then(r => r?.delete()).catch(() => {});
  };
  if (silent) { remove(); return; }
  confirmDialog(`Remove “${f.title}” for everyone?`, remove, 'Remove');
}

/* ── Sample clubs (local only): a fuller Files tab ──
   Returns more files for the sample's files map, shared by `by` (an
   officer's sample key). ctx: { idOf, nameOf, now, color }. Called from
   createSampleOrg; never written to a cloud club. */
function sampleOrgLibraryFiles(key, by, { idOf, nameOf, now, color }) {
  const H = 3600000;
  const out = {};
  const add = (f, hours) => { const id = uid(); out[id] = { id, uid: idOf(by), name: nameOf(by), at: now - hours * H, ...f }; };
  const pdf = (title, lines) => { const d = libSamplePdf(title, lines); return { kind: 'file', title, fileName: `${title}.pdf`, size: d.size, url: d.dataUrl }; };
  if (key === 'club') {
    add(pdf('Club constitution', ['Article I. Name: Women in Business.', 'Article II. Purpose: career panels, networking and community.', 'Article III. Officers: President, Treasurer, Social chair.', 'Article IV. Dues: set each semester by a vote of members.']), 520);
    const flyer = libSampleImage(400, 176, (c, w, h) => {
      c.fillStyle = color || '#6E2E3A'; c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(255,255,255,.14)'; c.lineWidth = 1;
      for (let x = -h; x < w; x += 16) { c.beginPath(); c.moveTo(x, h); c.lineTo(x + h, 0); c.stroke(); }
      c.fillStyle = '#ffffff';
      c.font = '600 12px "General Sans", system-ui, sans-serif';
      c.fillText('WOMEN IN BUSINESS', 28, 46);
      c.font = '44px "Instrument Serif", Georgia, serif';
      c.fillText('Networking night', 28, 100);
      c.font = '500 14px "General Sans", system-ui, sans-serif';
      c.fillText('Business School atrium, 6:30', 28, 134);
    });
    if (flyer) add({ kind: 'file', title: 'Networking night flyer', fileName: 'Networking night flyer.jpg', size: flyer.size, url: flyer.dataUrl }, 30);
    add({ kind: 'link', title: 'Photo drive', url: 'https://drive.google.com/drive/folders/wib-photos' }, 140);
    return out;
  }
  const title = { chapter: 'Recruitment schedule', team: 'Away game packing list', honor: 'Service hours guide' }[key];
  if (title) add(pdf(title, ['Sample file for the demo.', 'Your officers share real forms, schedules and rosters here.']), 200);
  return out;
}
