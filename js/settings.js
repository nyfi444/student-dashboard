/* ── Settings: theme, account/sync, AI, grading, data, semesters ─── */
const FAQ_ITEMS = [
  { q: 'How does AI syllabus upload work?', a: 'Go to Courses → Upload syllabus and paste, upload a PDF, or upload a photo of your syllabus. Claude reads it and fills in the course name, meeting times, grading breakdown, and assignments — you review and edit everything before it’s added. No API key needed — AI requests are proxied through a server that holds the key, so you never see or manage one.' },
  { q: 'Where is my data stored — is it private?', a: 'Everything lives in your browser’s local storage by default. Nothing is sent anywhere unless you turn on cross-device sync or use an AI feature (which sends only the text/image you’re asking about, routed through our AI proxy, never directly to Anthropic from your browser).' },
  { q: 'How do I sync across devices?', a: 'Sync is the default experience once it’s set up — first launch prompts you to sign up with Google, and everything syncs automatically from then on. The app owner sets this up once by adding a Firebase project to FB_CONFIG in js/firebase.js (see README.md); until they do, the planner runs local-only on this device.' },
  { q: 'What happens when I start a new semester?', a: 'Settings → Semester reset archives your current semester (nothing is deleted — you can still view it from the semester dropdown) and sets up a fresh one, optionally carrying over your course names and instructors as a starting point.' },
  { q: 'What does Dark mode do?', a: 'Dark mode (Settings → Appearance) switches the whole planner to a black background with white text. In light mode, text stays black and you can pick a soft background preset from Settings → Background — no custom colors, so it never clashes with the app.' },
  { q: 'How do Study Group codes work?', a: 'Creating a group generates a short share code; anyone who enters that code under Study Groups → Join with code sees the same shared session calendar. Cross-device joining needs sync configured (see above) — until then, groups still work fine on one device.' },
  { q: 'Can I back up or move my data?', a: 'Yes — Settings → Data → Export backup downloads everything as a JSON file. Import backup on any device loads it back in and replaces what’s currently there, so it also works as a way to transfer your planner manually without sync.' },
  { q: 'I deleted something by accident — can I get it back?', a: 'Yes — deleting a note, course, assignment, to-do, time block, project, or flashcard deck moves it to Settings → Recently Deleted instead of erasing it right away. Restore it any time within 30 days, or delete it forever yourself.' },
];

function pageSettings() {
  return `
    ${pageHead('Settings', 'Customize your planner')}
    <div class="grid grid-2" style="align-items:start">
      <div class="card card-pad">
        <h3 style="font-size:15px" class="mb-8">Appearance</h3>
        <div class="checkbox-row"><input type="checkbox" id="st-dark" ${state.settings.dark ? 'checked' : ''} onchange="toggleDark(this.checked)"><label for="st-dark">Dark mode</label></div>
        <div class="field mt-16"><label>Display name</label><input class="input" value="${esc(state.settings.displayName)}" oninput="state.settings.displayName=this.value" onchange="touch()"></div>
      </div>

      <div class="card card-pad">
        <h3 style="font-size:15px" class="mb-8">Background</h3>
        <p class="small muted mb-8">${state.settings.dark ? 'Background presets apply in light mode — dark mode has its own fixed background.' : 'Changes the page background behind the sidebar and content. Text stays controlled by the Dark mode toggle above, so it always stays legible no matter which background you pick.'}</p>
        <div class="bg-preview mb-16" style="background:${bgCssValue(state.settings.background)}"></div>
        <div class="field mb-0"><label>Presets</label>
          <div class="flex-gap wrap">
            ${BACKGROUND_PRESETS.map((p, i) => `<div class="bg-preset ${bgMatchesPreset(state.settings.background, p) ? 'active' : ''}" style="background:${bgCssValue(p)}" title="${esc(p.label)}" onclick="setBackgroundPreset(${i})"></div>`).join('')}
          </div>
        </div>
      </div>

      <div class="card card-pad">
        <h3 style="font-size:15px" class="mb-8">Account & Sync</h3>
        ${_fbUser ? `
          <div class="flex-gap"><div class="avatar">${(_fbUser.displayName || _fbUser.email || '?')[0].toUpperCase()}</div><div><div style="font-weight:600">${esc(_fbUser.displayName || _fbUser.email)}</div><div class="small muted">Synced across devices — this is the default experience.</div></div></div>
          <button class="btn mt-16" onclick="signOutUser()">Sign out</button>
        ` : `
          <p class="small muted mb-16">${fbConfigured() ? 'Create an account and everything syncs automatically — new devices, backups, and study groups all just work. Local storage still covers offline caching and resilience underneath.' : 'Not set up on this deployment yet. The app owner needs to create a Firebase project and fill in FB_CONFIG in js/firebase.js — see README.md. Until then, everything is saved locally in this browser only.'}</p>
          <button class="btn btn-primary" onclick="signIn()" ${fbConfigured() ? '' : 'disabled'}>Sign up with Google</button>
        `}
      </div>

      <div class="card card-pad">
        <h3 style="font-size:15px" class="mb-8">AI <span class="ai-badge">Claude</span></h3>
        <p class="small muted mb-8">Powers syllabus and assignment auto-fill from uploaded documents.</p>
        ${aiEnabled()
          ? `<div class="flex-gap"><span class="pill" style="background:var(--accent-light);color:var(--accent)">${icon('check', 12, 2.4)} Ready to use</span></div><p class="small muted mt-8">No setup needed — just upload a syllabus from Courses.</p>`
          : `<p class="small" style="background:var(--warn-light);color:var(--warn);padding:10px 12px;border-radius:10px">Not set up on this deployment yet. The app owner needs to deploy the Cloudflare Worker proxy in <code>/worker</code> and fill in <code>AI_PROXY_URL</code> in <code>js/ai.js</code> — see <code>worker/README.md</code>.</p>`}
      </div>

      <div class="card card-pad">
        <h3 style="font-size:15px" class="mb-8">Grading</h3>
        <div class="field"><label>GPA display</label>
          <div class="segmented"><button class="${state.settings.gradeScale === '4.0' ? 'active' : ''}" onclick="setGradeScale('4.0')">4.0 scale</button><button class="${state.settings.gradeScale === 'percentage' ? 'active' : ''}" onclick="setGradeScale('percentage')">Percentage</button></div>
        </div>
      </div>

      <div class="card card-pad">
        <h3 style="font-size:15px" class="mb-8">Semester</h3>
        <div class="field"><label>Viewing</label>
          <select class="select" onchange="setState({currentSemesterId:this.value})">
            ${state.semesters.map(s => `<option value="${s.id}" ${s.id === state.currentSemesterId ? 'selected' : ''}>${esc(s.name)}${s.archived ? ' (archived)' : ''}</option>`).join('')}
          </select>
        </div>
        <div class="field-row mt-8">
          <div class="field" style="margin-bottom:0"><label>Target GPA</label><input class="input" type="number" step="0.1" value="${currentSemester()?.targetGPA ?? ''}" oninput="setCurrentSemesterTargetGPA(this.value)"></div>
          <div class="field" style="margin-bottom:0"><label>Weekly study goal (min)</label><input class="input" type="number" value="${state.settings.weeklyStudyGoalMinutes ?? ''}" oninput="state.settings.weeklyStudyGoalMinutes=Number(this.value)||0;touch()"></div>
        </div>
        <div class="flex-gap wrap mt-8">
          <button class="btn" onclick="openSemesterResetWizard()">${icon('refresh-cw', 13, 2)} Semester reset</button>
          <button class="btn" onclick="openSemesterSetupWizard()">${icon('sparkles', 13, 1.6)} Semester setup</button>
        </div>
      </div>

      <div class="card card-pad">
        <h3 style="font-size:15px" class="mb-8">Degree</h3>
        <p class="small muted mb-8">Track progress across all semesters, not just this one.</p>
        <div class="field" style="margin-bottom:0"><label>Total credits needed to graduate</label><input class="input" type="number" value="${state.settings.degreeTotalCredits ?? ''}" oninput="state.settings.degreeTotalCredits=Number(this.value)||0;touch()"></div>
      </div>

      <div class="card card-pad">
        <h3 style="font-size:15px" class="mb-8">Data</h3>
        <div class="flex-gap wrap">
          <button class="btn" onclick="exportData()">Export backup</button>
          <button class="btn" onclick="$('#hidden-file-input').click()">Import backup</button>
          <button class="btn btn-danger" onclick="resetAllData()">Erase all data</button>
        </div>
      </div>

      <div class="card card-pad" style="grid-column:1/-1">
        ${pageRecentlyDeleted()}
      </div>

      <div class="card card-pad" style="grid-column:1/-1">
        <h3 style="font-size:15px" class="mb-8">FAQ</h3>
        <p class="small muted mb-8">Common questions about how this planner works.</p>
        ${FAQ_ITEMS.map(f => `
          <details class="faq-item">
            <summary>${esc(f.q)}</summary>
            <p class="small dim">${esc(f.a)}</p>
          </details>
        `).join('')}
      </div>
    </div>
  `;
}
function pageRecentlyDeleted() {
  const items = [...(state.trash || [])].sort((a, b) => b.deletedAt - a.deletedAt);
  return `
    <div class="flex-between mb-8">
      <h3 style="font-size:15px">Recently Deleted</h3>
      ${items.length ? `<button class="btn btn-ghost btn-sm" onclick="emptyTrash()">Empty trash</button>` : ''}
    </div>
    <p class="small muted mb-8">Deleted notes, courses, assignments, to-dos, time blocks, projects, and flashcard decks land here for ${TRASH_RETENTION_DAYS} days before they're gone for good.</p>
    ${items.length ? items.map(t => `
      <div class="list-row">
        <span class="pill" style="background:var(--surface-2);color:var(--text-dim)">${esc(TRASH_KIND_LABELS[t.kind] || t.kind)}</span>
        <div class="row-title">${esc(t.label || 'Untitled')}</div>
        <div class="row-meta">Deleted ${fmtRelativeTime(t.deletedAt)}</div>
        <button class="btn btn-sm" onclick="restoreTrashItem('${t.id}')">${icon('refresh-cw', 12, 2)} Restore</button>
        <button class="btn btn-ghost btn-icon btn-sm" onclick="permanentlyDeleteTrashItem('${t.id}')">${icon('trash', 14)}</button>
      </div>
    `).join('') : emptyState(icon('trash', 22, 1.4), 'Nothing deleted recently.')}
  `;
}
function toggleDark(on) { state.settings.dark = on; applyTheme(); touch(); }
function applyTheme() {
  document.documentElement.classList.toggle('dark', state.settings.dark);
  if (state.settings.dark) {
    document.documentElement.style.removeProperty('--bg');
  } else {
    document.documentElement.style.setProperty('--bg', bgCssValue(state.settings.background));
  }
}

function setBackgroundPreset(i) {
  state.settings.background = { ...BACKGROUND_PRESETS[i] };
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
    localStorage.removeItem(storeKey); localStorage.removeItem(storeKey + '.bak');
    state = seedData(); save(); closeModal(); render();
    toast('Planner reset');
  }, 'Erase everything');
}

function openSemesterResetWizard() {
  openModal(`
    <div class="modal-head"><h3>Semester reset</h3><button class="close-x" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
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
      state.courses.push({ ...JSON.parse(JSON.stringify(c)), id: uid(), semesterId: newSem.id, status: 'in-progress', gradingBreakdown: c.gradingBreakdown.map(g => ({ ...g, id: uid() })), finalGradeOverride: null });
    });
  }
  setState({ currentSemesterId: newSem.id });
  closeModal();
  toast(`Welcome to ${name}`);
}
