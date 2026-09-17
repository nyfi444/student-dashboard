/* ── Settings: theme, account/sync, AI, grading, data, semesters ─── */
const FAQ_ITEMS = [
  { q: 'How does AI syllabus upload work?', a: 'Go to Courses → Upload syllabus and paste, upload a PDF, or upload a photo of your syllabus. Claude reads it and fills in the course name, meeting times, and assignments. You review and edit everything before it’s added. No API key needed: AI requests are proxied through a server that holds the key, so you never see or manage one.' },
  { q: 'Where is my data stored, and is it private?', a: 'Everything lives in your browser’s local storage by default. Nothing is sent anywhere unless you turn on cross-device sync or use an AI feature (which sends only the text/image you’re asking about, routed through our AI proxy, never directly to Anthropic from your browser).' },
  { q: 'How do I sync across devices?', a: 'Sign in with Google or any email under Settings → Account & Sync to turn it on. Semester HQ Plus ($7.99/month) activates sync, AI upload, and cross-device Study Groups for that account. Without it, everything still works great locally on one device.' },
  { q: 'What happens when I start a new semester?', a: 'Settings → Semester reset archives your current semester (nothing is deleted, you can still view it from the semester dropdown) and sets up a fresh one, optionally carrying over your course names and instructors as a starting point.' },
  { q: 'How do I change the colors?', a: 'Settings → Appearance (or Customize on the dashboard) has themes, each with a matching dark mode, plus page colors. Turn on Dark mode and the page colors switch to deep tints of the same colors, with light text so everything stays readable.' },
  { q: 'How do study groups work?', a: 'Start a group from Study Groups and invite classmates with its 6-character code or an invite link. Inside a group you can schedule sessions (they show up on every member’s calendar, with RSVPs), paint your weekly availability so Semester HQ can suggest the best time to meet, split up tasks with owners and due dates, chat, and share notes, flashcards, files, and links. Everyone in a group needs their own Semester HQ Plus account. Organizing a whole class, club, or team? A group plan covers all of them, see the next question.' },
  { q: 'Can I pay for my whole club, team, or class?', a: 'Yes. A group plan is $5.99 per member each month (five members or more) instead of $7.99 each. Open group-admin.html from Settings, pick how many members you\u2019re covering, and share the invite link it gives you: each person signs in, takes a seat, and gets their own full Semester HQ. Add or remove seats whenever your roster changes, and cancel anytime.' },
  { q: 'What can I share with a study group?', a: 'Notes, whole notebooks, flashcard decks, and projects each have a Share button that sends a copy to one of your groups. You can also open a group’s Resources tab to share any of those, plus files and links, without leaving the group. Members can add their own copy to their notebook, flashcards, or projects. It’s a one-time copy, not a live sync, so edits after sharing stay with whoever made them.' },
  { q: 'Can I assign tasks to people in my study group?', a: 'Yes. On a group’s Tasks tab, give each task an owner and an optional due date, and filter to just yours. Tasks assigned to you also show up on your Dashboard, and the group’s Overview shows a feed of who scheduled, shared, and finished what.' },
  { q: 'Can I add a PDF or other file to my notes?', a: 'Yes. Open a note and click Upload file. A PDF comes in as page images, so figures and handwriting look like the original. Photos come in as pictures, and Word docs, slides, spreadsheets, and text files come in as text you can edit. This doesn’t use AI, and it’s separate from syllabus upload under Courses.' },
  { q: 'What kinds of files can I upload?', a: 'PDFs, Word docs (.docx and older .doc), PowerPoint (.pptx and .ppt), Excel (.xlsx), CSV, OpenDocument, RTF, text files, web pages, and photos, including iPhone photos. Pages, Keynote, and Numbers files need to be exported first: in the app, choose File → Export To → PDF (or Excel for Numbers), then upload that.' },
  { q: 'Can I back up or move my data?', a: 'Yes. Settings → Data → Export backup downloads everything as a JSON file. Import backup on any device loads it back in and replaces what’s currently there, so it also works as a way to transfer your planner manually without sync.' },
  { q: 'I deleted something by accident. Can I get it back?', a: 'Yes. Deleting a note, course, assignment, to-do, time block, project, or flashcard deck moves it to Settings → Recently Deleted instead of erasing it right away. Restore it any time within 30 days, or delete it forever yourself.' },
];

function confirmDeleteAccount() {
  confirmDialog(
    'This cancels your subscription and permanently deletes your synced data and account. This can’t be undone. Local data in this browser is untouched. Continue?',
    async () => {
      try {
        toast('Deleting your account…', 'info', 4000);
        const result = await deleteAccountFully();
        toast(result.authDeleted ? 'Your account has been deleted.' : 'Data deleted. Email hello@semester-hq.com to finish removing your sign-in.', 'success', 5000);
      } catch (e) {
        toast('Could not delete your account: ' + e.message, 'error', 5000);
        diag.error('account', 'Account deletion failed', e);
      }
    },
    'Delete account'
  );
}

/* ── Leave a review ───────────────────────────────────────────────
   Asked here rather than on the marketing site, where visitors haven't
   used anything yet. Goes to the same place as the contact form (the
   Worker's /contact-message, category "feedback"), with the rating and
   whether it can be quoted written into the message itself. */
function reviewSettingsCard() {
  if (isEmbedded()) return '';
  const sent = state.settings.reviewSentAt;
  const rating = window._reviewRating || 0;
  if (sent && !window._reviewAgain) {
    return `
      <div class="card card-pad">
        <h3 style="font-size:15px" class="mb-8">Thanks for the review</h3>
        <p class="small muted">You sent one on ${esc(fmtDate(iso(sent), { month: 'long', day: 'numeric' }))}. It really does help.</p>
        <button class="btn btn-sm mt-8" onclick="window._reviewAgain=true;render()">Write another</button>
      </div>`;
  }
  return `
    <div class="card card-pad">
      <h3 style="font-size:15px" class="mb-8">Leave a review</h3>
      <p class="small muted mb-8">Semester HQ is made by one person. Tell me what’s working and what isn’t, and it goes straight to me.</p>
      <div class="rev-stars" role="group" aria-label="Rating">
        ${[1, 2, 3, 4, 5].map(n => `<button class="rev-star ${n <= rating ? 'on' : ''}" aria-label="${n} star${n === 1 ? '' : 's'}" aria-pressed="${n === rating}" onclick="setReviewRating(${n})">${n <= rating ? '★' : '☆'}</button>`).join('')}
        <span class="small muted" id="rev-rating-label">${rating ? `${rating} out of 5` : 'Tap to rate'}</span>
      </div>
      <textarea class="input mt-8" id="rev-text" placeholder="What’s it saved you? What’s still annoying?" style="min-height:90px"></textarea>
      ${_fbUser?.email ? '' : `<input class="input mt-8" id="rev-email" type="email" placeholder="Your email, so I can reply" autocomplete="email">`}
      <label class="checkbox-row small mt-8"><input type="checkbox" id="rev-quote"><span>You can quote this on semester-hq.com (first name only)</span></label>
      <button class="btn btn-primary btn-sm mt-8" onclick="submitReview(this)">Send</button>
    </div>`;
}
function setReviewRating(n) {
  window._reviewRating = n;
  $$('.rev-star').forEach((el, i) => { el.classList.toggle('on', i < n); el.textContent = i < n ? '★' : '☆'; el.setAttribute('aria-pressed', i + 1 === n); });
  const label = $('#rev-rating-label');
  if (label) label.textContent = `${n} out of 5`;
}
async function submitReview(btn) {
  const rating = window._reviewRating || 0;
  const text = $('#rev-text').value.trim();
  const email = (_fbUser?.email || $('#rev-email')?.value || '').trim();
  if (!rating && !text) { toast('Add a rating or a few words first', 'error'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('Add an email so I can reply', 'error'); return; }
  const quotable = !!$('#rev-quote')?.checked;
  setBtnLoading(btn, true);
  try {
    await workerPost('/contact-message', {
      category: 'feedback',
      name: state.settings.displayName || _fbUser?.displayName || '',
      email,
      message: `${rating ? `Rating: ${rating}/5\n` : ''}Can be quoted publicly: ${quotable ? 'yes' : 'no'}\n\n${text}`,
    });
    state.settings.reviewSentAt = Date.now();
    window._reviewAgain = false;
    window._reviewRating = 0;
    touch();
    toast('Sent. Thank you, genuinely.', 'success', 4000);
  } catch (e) {
    setBtnLoading(btn, false);
    toast(e.message || 'Could not send that right now', 'error', 5000);
  }
}

function pageSettings() {
  return `
    ${pageHead('Settings', 'Customize your planner')}
    <div class="settings-columns">
      ${expandable('set-appearance', 'Appearance', appearanceSettingsCard(), { max: 320 })}


      ${installSettingsCard()}

      <div class="card card-pad">
        <h3 style="font-size:15px" class="mb-8">Account & Sync</h3>
        ${_fbUser ? `
          <div class="flex-gap"><div class="avatar">${(_fbUser.displayName || _fbUser.email || '?')[0].toUpperCase()}</div><div><div style="font-weight:600">${esc(_fbUser.displayName || _fbUser.email)}</div><div class="small muted">Synced across devices. This is the default experience.</div></div></div>
          ${window._licensed && !(window._licenseDoc?.groupPaid && !window._licenseDoc?.individualPaid) ? `<button class="btn mt-16" onclick="redirectToPortal()">Manage subscription</button>` : ''}
          <button class="btn mt-16" onclick="signOutUser()">Sign out</button>
          ${checkoutEnabled() ? `<button class="btn btn-danger mt-8" onclick="confirmDeleteAccount()">Delete account</button>` : ''}
        ` : `
          <p class="small muted mb-16">${fbConfigured() ? 'Already subscribed? Sign in with the same account to pick up right where you left off. New here? Signing in creates your account automatically. Everything then syncs across devices, backups, and study groups. Any email works, not just Google. Local storage still covers offline caching and resilience underneath.' : 'Not set up on this deployment yet. The app owner needs to create a Firebase project and fill in FB_CONFIG in js/config.js (see README.md). Until then, everything is saved locally in this browser only.'}</p>
          <button class="btn btn-primary" onclick="signIn()" ${fbConfigured() ? '' : 'disabled'}>Continue with Google</button>
          <button class="btn mt-8" onclick="openEmailSignInModal()" ${fbConfigured() ? '' : 'disabled'}>Continue with email</button>
        `}
        ${typeof groupPlanSettingsHtml === 'function' ? groupPlanSettingsHtml() : ''}
      </div>

      <div class="card card-pad">
        <h3 style="font-size:15px" class="mb-8">AI <span class="ai-badge">Claude</span></h3>
        <p class="small muted mb-8">Powers syllabus upload, quick capture, and making flashcards from notes and files.</p>
        ${aiEnabled() && !aiLooksUnlocked()
          ? `<div class="flex-gap"><span class="pill" style="background:var(--surface-2);color:var(--text-dim)">${icon('lock', 12, 2)} Included with Semester HQ Plus</span></div><p class="small muted mt-8">These don’t run in the demo. ${isEmbedded() ? '' : _fbUser ? '' : '<a href="login.html">Log in</a> to use them.'}</p>`
          : aiEnabled()
          ? `<div class="flex-gap"><span class="pill" style="background:var(--accent-light);color:var(--accent)">${icon('check', 12, 2.4)} Ready to use</span></div><p class="small muted mt-8">No setup needed, just upload a syllabus from Courses.</p>`
          : `<p class="small" style="background:var(--warn-light);color:var(--warn);padding:10px 12px;border-radius:10px">Not set up on this deployment yet. The app owner needs to deploy the Cloudflare Worker proxy in <code>/worker</code> and fill in <code>WORKER_URL</code> in <code>js/config.js</code> (see <code>worker/README.md</code>).</p>`}
      </div>

      <div class="card card-pad">
        <h3 style="font-size:15px" class="mb-8">Semester</h3>
        <div class="field"><label>Viewing</label>
          <select class="select" onchange="setState({currentSemesterId:this.value})">
            ${state.semesters.map(s => `<option value="${s.id}" ${s.id === state.currentSemesterId ? 'selected' : ''}>${esc(s.name)}${s.archived ? ' (archived)' : ''}</option>`).join('')}
          </select>
        </div>
        <div class="field mt-8" style="margin-bottom:0"><label>Weekly study goal (min)</label><input class="input" type="number" value="${state.settings.weeklyStudyGoalMinutes ?? ''}" oninput="state.settings.weeklyStudyGoalMinutes=Number(this.value)||0;touch()"></div>
        <div class="flex-gap wrap mt-8">
          <button class="btn" onclick="openSemesterReset()">${icon('refresh-cw', 13, 2)} Semester reset</button>
          <button class="btn" onclick="openSemesterSetup()">${icon('sparkles', 13, 1.6)} Semester setup</button>
        </div>
      </div>

      <div class="card card-pad">
        <h3 style="font-size:15px" class="mb-8">Data</h3>
        <div class="flex-gap wrap">
          <button class="btn" onclick="exportData()">Export backup</button>
          <button class="btn" onclick="$('#hidden-file-input').click()">Import backup</button>
          <button class="btn btn-danger" onclick="resetAllData()">Erase all data</button>
        </div>
      </div>

      ${reviewSettingsCard()}

      ${expandable('set-trash', 'Recently Deleted', `<div class="card card-pad">${pageRecentlyDeleted()}</div>`, { max: 300, style: 'column-span:all' })}

      ${expandable('set-faq', 'FAQ', `
        <div class="card card-pad">
          <h3 style="font-size:15px" class="mb-8">FAQ</h3>
          <p class="small muted mb-8">Common questions about how this planner works.</p>
          ${FAQ_ITEMS.map(f => `
            <details class="faq-item">
              <summary>${esc(f.q)}</summary>
              <p class="small dim">${esc(f.a)}</p>
            </details>
          `).join('')}
          <p class="small muted mt-16">Something not working? <button class="btn btn-sm" onclick="copyDiagnostics()">Copy diagnostic info</button> and paste it into an email to <a href="mailto:hello@semester-hq.com">hello@semester-hq.com</a>. It includes what went wrong and your app version, never your planner.</p>
        </div>`, { max: 300, style: 'column-span:all' })}
    </div>
  `;
}
async function copyDiagnostics() {
  const text = await diag.summary();
  try { await navigator.clipboard.writeText(text); toast(`Copied. Your support code is ${diag.session}.`, 'success', 5000); }
  catch { openModal(`<div class="modal-head"><h3>Diagnostic info</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div><div class="modal-body"><textarea class="input" rows="12" readonly onfocus="this.select()">${esc(text)}</textarea></div>`); }
}
function pageRecentlyDeleted() {
  const items = [...(state.trash || [])].sort((a, b) => b.deletedAt - a.deletedAt);
  const rows = items.map(t => `
      <div class="list-row">
        <span class="pill" style="background:var(--surface-2);color:var(--text-dim)">${esc(TRASH_KIND_LABELS[t.kind] || t.kind)}</span>
        <div class="row-title">${esc(t.label || 'Untitled')}</div>
        <div class="row-meta">Deleted ${fmtRelativeTime(t.deletedAt)}</div>
        <button class="btn btn-sm" onclick="restoreTrashItem('${t.id}')">${icon('refresh-cw', 12, 2)} Restore</button>
        <button class="btn btn-ghost btn-icon btn-sm" aria-label="Delete permanently" onclick="permanentlyDeleteTrashItem('${t.id}')">${icon('trash', 14)}</button>
      </div>
  `).join('');
  return `
    <div class="flex-between mb-8">
      <h3 style="font-size:15px">Recently Deleted</h3>
      ${items.length ? `<button class="btn btn-ghost btn-sm" onclick="emptyTrash()">Empty trash</button>` : ''}
    </div>
    <p class="small muted mb-8">Deleted notes, courses, assignments, to-dos, time blocks, projects, and flashcard decks land here for ${TRASH_RETENTION_DAYS} days before they're gone for good.</p>
    ${items.length ? `
      <details class="settings-collapse">
        <summary>View Recently Deleted (${items.length} item${items.length === 1 ? '' : 's'})</summary>
        <div class="settings-collapse-body settings-collapse-scroll">${rows}</div>
      </details>
    ` : emptyState(icon('trash', 22, 1.4), 'Nothing deleted recently.')}
  `;
}
function toggleDark(on) { state.settings.dark = on; applyTheme(); touch(); }
function setBackgroundPreset(i) {
  state.settings.background = { ...BACKGROUND_PRESETS[i] };
  applyTheme();
  touch();
}
function setDarkBackgroundPreset(i) {
  state.settings.darkBackground = { ...BACKGROUND_PRESETS[i] };
  applyTheme();
  touch();
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `student-planner-backup-${todayIso()}.json`;
  a.click();
}
document.addEventListener('DOMContentLoaded', () => {
  $('#hidden-file-input').accept = '.json';
  $('#hidden-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      confirmDialog('Import this backup? It will replace all current data.', () => {
        state = migrate(parsed);
        save(); render();
        toast('Backup imported');
      }, 'Import');
    } catch { toast('That file isn’t a valid backup', 'error'); }
    e.target.value = '';
  });
});
function resetAllData() {
  confirmDialog('Erase everything and start fresh? This can’t be undone.', () => {
    dataStore.removeItem(storeKey); dataStore.removeItem(storeKey + '.bak');
    state = seedData(); save(); closeModal(); render();
    toast('Planner reset');
  }, 'Erase everything');
}

function openSemesterReset() {
  openModal(`
    <div class="modal-head"><h3>Semester reset</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      <p class="small muted mb-16">Archives your current semester (nothing is deleted) and sets up a new one.</p>
      <div class="field"><label>New semester name</label><input class="input" id="sw-name" placeholder="Spring Semester"></div>
      <div class="field-row">
        <div class="field"><label>Start date</label><input class="input" type="date" id="sw-start" value="${todayIso()}"></div>
        <div class="field"><label>End date</label><input class="input" type="date" id="sw-end" value="${addDays(todayIso(), 110)}"></div>
      </div>
      <div class="checkbox-row"><input type="checkbox" id="sw-carry" checked><label for="sw-carry">Carry over course names/instructors as a starting point</label></div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="runSemesterReset()">Start new semester</button></div>
  `);
}
function runSemesterReset() {
  const name = $('#sw-name').value.trim();
  if (!name) { toast('Name the new semester', 'error'); return; }
  const oldSem = state.semesters.find(s => s.id === state.currentSemesterId);
  if (oldSem) oldSem.archived = true;
  state.courses.forEach(c => { if (c.semesterId === state.currentSemesterId && c.status === 'in-progress') c.status = 'completed'; });
  const newSem = { id: uid(), name, startDate: $('#sw-start').value, endDate: $('#sw-end').value, archived: false };
  state.semesters.push(newSem);
  if ($('#sw-carry').checked) {
    activeCourses().forEach(c => {
      state.courses.push({ ...JSON.parse(JSON.stringify(c)), id: uid(), semesterId: newSem.id, status: 'in-progress' });
    });
  }
  setState({ currentSemesterId: newSem.id });
  closeModal();
  toast(`Welcome to ${name}`);
}
