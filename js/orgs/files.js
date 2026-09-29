/* ── Clubs & teams: files ─────────────────────────────────────────
   Loaded after js/orgs.js. Officers share, everyone opens.
──────────────────────────────────────────────────────────────── */
/* ── Files: officers share, everyone opens ─────────────────────── */
function orgFileList(o) {
  return Object.values(o.files || {}).filter(f => f && safeId(f.id) && (f.kind === 'file' || f.kind === 'link') && typeof f.title === 'string')
    .map(f => ({ ...f, title: cleanStr(f.title, 120) || 'File', name: cleanStr(f.name, 60) || 'An officer', size: Number(f.size) || 0 }))
    .sort((a, b) => (b.at || 0) - (a.at || 0));
}
function orgFileUrl(o, f) {
  const url = String(f.url || '');
  if (isHttpUrl(url)) return url;
  return o.local && url.startsWith('data:') ? url : '';
}
function orgFileRow(o, f, { compact = false } = {}) {
  const url = orgFileUrl(o, f);
  const isFile = f.kind === 'file';
  const meta = isFile ? [fileTypeLabel(f.fileName || f.title), fmtFileSize(f.size)] : ['Link', hostOf(url)];
  if (!compact) meta.push(f.name, fmtRelativeTime(f.at));
  const open = !url ? '' : isFile
    ? `<a class="btn btn-sm" href="${esc(url)}" target="_blank" rel="noopener" download="${esc(f.fileName || f.title)}">${icon('download', 14)} Open</a>`
    : `<a class="btn btn-sm" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('link', 14)} Open</a>`;
  return `
    <div class="list-row sg-resource org-file">
      <span class="sg-res-ic">${icon(isFile ? 'paperclip' : 'link', 16)}</span>
      <div class="row-title"><div class="sg-strong">${esc(f.title)}</div><div class="row-meta">${meta.filter(Boolean).map(esc).join(' · ')}</div></div>
      ${open}
      ${!compact && isOrgOfficer(o) ? `<button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove ${esc(f.title)}" data-tip="Remove" onclick="removeOrgFile('${o.code}','${f.id}')">${icon('trash', 14)}</button>` : ''}
    </div>`;
}
function orgFilesTab(o) {
  const files = orgFileList(o);
  const officer = isOrgOfficer(o);
  return `
    <div class="sg-toolbar">
      <div class="small muted">${officer ? 'Share forms, schedules, rosters, and links with everyone.' : 'Forms, schedules, and links from your officers.'}</div>
      ${officer ? `<button class="btn btn-primary btn-sm" onclick="openOrgFileModal('${o.code}')">${icon('plus', 14)} Share a file or link</button>` : ''}
    </div>
    ${files.length ? `<div class="card card-pad">${files.map(f => orgFileRow(o, f)).join('')}</div>`
      : emptyState(icon('paperclip', 24), 'No files yet', officer ? `<button class="btn btn-sm mt-8" onclick="openOrgFileModal('${o.code}')">Share the first file</button>` : '', officer ? 'A dues form, the practice schedule, your constitution, a link to the photo drive.' : 'When officers share something, it shows up here.')}
  `;
}
function openOrgFileModal(code) {
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
  `);
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
      else item.url = await uploadDataUrlToStorage(`orgs/${o.code}/files/${id}-${storageSafeName(st.file.name)}`, st.file.dataUrl, st.file.name);
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
    if (f.kind === 'file' && String(f.url || '').includes('firebasestorage')) fbStorage().then(s => s.refFromURL(f.url).delete()).catch(() => {});
  };
  if (silent) { remove(); return; }
  confirmDialog(`Remove “${f.title}” for everyone?`, remove, 'Remove');
}

