/* ── Spaces: the public preview ─────────────────────────────────────
   What someone holding a code sees before joining a study group or a
   club, at studyGroups/{code}/public/preview and orgs/{code}/public/preview.
   The group or club itself is readable by its members only (firestore.rules),
   so the join screens read this small document instead: the name, a short
   description, the color, the course (groups) or kind and school (clubs),
   how many members there are, and the next session or event's title and
   date. No names, faces, files, RSVPs or chat.

   Who writes it: any member of a study group, the officers of a club, and
   the Worker's daily job, which fills in any that are missing and keeps the
   member count true. This file writes it from each live snapshot, and only
   when what it would write differs from what it last wrote this session.
   The rules refuse a member count that isn't the real one.

   spacePreviewOf(kind, data) -> the preview (data is the raw document)
   spacePreviewKeep(kind, code, data, meta)  after a snapshot; writes if changed
   spaceLookup(kind, code) -> { data, from }
     from 'preview'  the preview (data is a preview)
          'doc'      the space itself: a space made before previews existed,
                     read the way the rules allowed until October 2026
          'hidden'   there may be a space, but nothing about it is readable:
                     the join screen shows the code alone
          'none'     no space uses this code
   spacePreviewIsPreview(data) -> true for a preview, false for a full doc
   spacePreviewRemove(kind, code)  when the space is deleted
──────────────────────────────────────────────────────────────── */
const SPACE_PREVIEW_COLL = { group: 'studyGroups', club: 'orgs' };
const _spacePreviewSent = {};   // `${kind}:${code}` -> the JSON last written this session

function spacePreviewRef(kind, code) {
  return _fbDb.collection(SPACE_PREVIEW_COLL[kind]).doc(code).collection('public').doc('preview');
}
function spacePreviewIsPreview(data) { return !!data && data.v === 1 && typeof data.memberCount === 'number' && !('memberUids' in data); }

function spacePreviewOf(kind, data) {
  const code = data.code;
  const out = { v: 1, name: cleanStr(data.name, 120) || (kind === 'club' ? 'Club' : 'Study group'), memberCount: Array.isArray(data.memberUids) ? data.memberUids.length : 0, next: null };
  const desc = cleanStr(data.description, 200);
  if (desc) out.description = desc;
  let next = null;
  if (kind === 'group') {
    const g = normalizeGroup({ ...data, code });
    const color = groupColor(g);
    if (HEX_COLOR.test(color || '')) out.color = color;
    const course = cleanStr(data.courseLabel, 80);
    if (course) out.courseLabel = course;
    next = upcomingSessions(g)[0] || null;
  } else {
    if (HEX_COLOR.test(data.color || '')) out.color = data.color;
    const kindKey = cleanStr(data.kind, 20);
    if (kindKey) out.kind = kindKey;
    const school = cleanStr(data.school, 120);
    if (school) out.school = school;
    const o = { ...data, code, local: false, people: data.people || {}, memberUids: data.memberUids || [], officerUids: data.officerUids || [], events: data.events || {}, rsvp: data.rsvp || {} };
    next = upcomingOrgEvents(o)[0] || null;
  }
  if (next && /^\d{4}-\d{2}-\d{2}$/.test(next.date || '')) {
    out.next = { title: cleanStr(next.title, 120) || (kind === 'club' ? 'Event' : 'Session'), date: next.date };
    if (/^\d{2}:\d{2}$/.test(next.start || '')) out.next.start = next.start;
  }
  return out;
}

// meta: { fromCache, pending } from the snapshot, so a stale offline copy
// never overwrites a fresher preview.
function spacePreviewKeep(kind, code, data, meta = {}) {
  if (!_fbUser || !_fbDb || !data || meta.fromCache || meta.pending) return;
  const me = _fbUser.uid;
  if (!(data.memberUids || []).includes(me)) return;
  if (kind === 'club' && !(data.officerUids || []).includes(me)) return;
  const preview = spacePreviewOf(kind, { ...data, code });
  const key = `${kind}:${code}`;
  const json = JSON.stringify(preview);
  if (_spacePreviewSent[key] === json) return;
  _spacePreviewSent[key] = json;
  spacePreviewRef(kind, code).set({ ...preview, updatedAt: Date.now() }).catch(e => {
    delete _spacePreviewSent[key];
    // Refused only while the rules that allow it aren't published yet; nothing to report.
    if (e?.code !== 'permission-denied') diag.warn('spaces', 'The join preview wasn’t saved', e);
  });
}

async function spaceLookup(kind, code) {
  try {
    const snap = await spacePreviewRef(kind, code).get();
    if (snap.exists) return { data: snap.data(), from: 'preview' };
  } catch (e) {
    if (e?.code !== 'permission-denied') throw e;
  }
  try {
    const snap = await _fbDb.collection(SPACE_PREVIEW_COLL[kind]).doc(code).get();
    return snap.exists ? { data: snap.data(), from: 'doc' } : { data: null, from: 'none' };
  } catch (e) {
    if (e?.code === 'permission-denied') return { data: null, from: 'hidden' };
    throw e;
  }
}

function spacePreviewRemove(kind, code) {
  delete _spacePreviewSent[`${kind}:${code}`];
  return spacePreviewRef(kind, code).delete().catch(() => {});
}

// A space's listener was refused: either this person was removed, or the
// space was deleted (its owner deletes the preview with it). The preview is
// readable by anyone signed in, so it tells the two apart.
async function spaceGoneOrRemoved(kind, code) {
  const entry = kind === 'club' ? orgEntry(code) : groupEntry(code);
  if (!entry?.cloud) return;
  let deleted = false;
  try { deleted = !(await spacePreviewRef(kind, code).get()).exists; } catch {}
  const what = entry.name || (kind === 'club' ? 'a club' : 'a group');
  const message = deleted ? `“${what}” was deleted.` : `You’re no longer a member of “${what}”.`;
  if (kind === 'club') dropOrgEntry(code, message); else dropGroupEntry(code, message);
}

/* ── Remove, with the choice to block ─────────────────────────────
   blocked.{uid} = { name, at } on the group or club. The rules refuse a
   join from anyone in it; only a study group's owner, or a club's officers,
   change it. Unblocking is in the space's settings (spaceBlockedHtml). */
function spaceRemoveDialog({ name, spaceName, canBlock, onRemove }) {
  openModal(`
    <div class="modal-head"><h3>Remove ${esc(name)}?</h3>${closeXButton()}</div>
    <div class="modal-body">
      <p style="font-size:14px">${esc(name)} leaves ${esc(spaceName)} and stops seeing it.</p>
      ${canBlock ? `<label class="checkbox-row small mt-8"><input type="checkbox" id="rm-block"><span>Block from rejoining with the code</span></label>
      <p class="small muted mt-4">Without this, they can join again if they still have the code. You can unblock them later in settings.</p>` : ''}
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-danger" id="rm-yes">Remove</button></div>
  `);
  $('#rm-yes').onclick = () => { const block = !!$('#rm-block')?.checked; closeModal(); onRemove(block); };
}
function spaceBlockOp(uidToBlock, name) { return { [`blocked.${uidToBlock}`]: { name: cleanStr(name, 60) || 'Someone', at: Date.now() } }; }
function spaceBlockedList(space) {
  return Object.entries(space?.blocked || {}).filter(([u, b]) => safeId(u) && b && typeof b === 'object')
    .map(([u, b]) => ({ uid: u, name: cleanStr(b.name, 60) || 'Someone', at: Number(b.at) || 0 }))
    .sort((a, b) => b.at - a.at);
}
function spaceBlockedHtml(kind, space, canManage) {
  const list = spaceBlockedList(space);
  if (!list.length || !canManage) return '';
  return `
    <div class="divider"></div>
    <div class="small dim mb-8" style="font-weight:600">Blocked from rejoining (${list.length})</div>
    ${list.map(b => `
      <div class="sg-person">
        <div class="row-title small">${esc(b.name)}${b.at ? ` <span class="muted">· ${esc(fmtRelativeTime(b.at))}</span>` : ''}</div>
        <button class="btn btn-ghost btn-sm" onclick="spaceUnblock('${kind}','${space.code}','${esc(b.uid)}')" aria-label="Unblock ${esc(b.name)}">Unblock</button>
      </div>`).join('')}`;
}
async function spaceUnblock(kind, code, uidToUnblock) {
  if (!safeId(uidToUnblock)) return;
  const write = kind === 'club' ? orgWrite : groupWrite;
  if (await write(code, { [`blocked.${uidToUnblock}`]: GW_DELETE })) {
    toast('Unblocked. They can join again with the code.');
    if (kind === 'club') openOrgSettingsModal(code); else openGroupSettingsModal(code);
  }
}
