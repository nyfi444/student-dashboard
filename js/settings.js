/* ── Settings: theme, account/sync, AI, grading, data, semesters ─── */
const FAQ_ITEMS = [
  { q: 'How does AI syllabus upload work?', a: 'Add a Claude API key under Settings → AI, then go to Courses → Upload syllabus and paste, upload a PDF, or upload a photo of your syllabus. Claude reads it and fills in the course name, meeting times, grading breakdown, and assignments — you review and edit everything before it’s added.' },
  { q: 'Where is my data stored — is it private?', a: 'Everything lives in your browser’s local storage by default, including your Claude API key, which never leaves this device. Nothing is sent anywhere unless you turn on cross-device sync or use an AI feature (which sends only the text/image you’re asking about to Claude).' },
  { q: 'How do I sync across devices?', a: 'Sync uses Firebase and needs to be configured once by adding a Firebase project to FB_CONFIG in js/firebase.js. Once that’s done, sign in with Google from Settings → Account to keep this planner in sync everywhere you’re signed in.' },
  { q: 'What happens when I start a new semester?', a: 'Settings → Semester reset wizard archives your current semester (nothing is deleted — you can still view it from the semester dropdown) and sets up a fresh one, optionally carrying over your course names and instructors as a starting point.' },
  { q: 'What does Dark mode do?', a: 'Dark mode (Settings → Appearance) switches the whole planner to a black background with white text. It’s the only theme option — everything else stays black and white either way.' },
  { q: 'How do Study Group codes work?', a: 'Creating a group generates a short share code; anyone who enters that code under Study Groups → Join with code sees the same shared session calendar. Cross-device joining needs sync configured (see above) — until then, groups still work fine on one device.' },
  { q: 'Can I back up or move my data?', a: 'Yes — Settings → Data → Export backup downloads everything as a JSON file. Import backup on any device loads it back in and replaces what’s currently there, so it also works as a way to transfer your planner manually without sync.' },
];

function pageSettings() {
  return `
    ${pageHead('Settings', 'Customize your planner')}
    <div class="grid grid-2" style="align-items:start">
      <div class="card card-pad">
        <h3 style="font-size:15px" class="mb-8">Appearance</h3>
        <p class="small muted mb-8">Black and white throughout — dark mode just inverts it.</p>
        <div class="checkbox-row"><input type="checkbox" id="st-dark" ${state.settings.dark ? 'checked' : ''} onchange="toggleDark(this.checked)"><label for="st-dark">Dark mode</label></div>
        <div class="field mt-16"><label>Display name</label><input class="input" value="${esc(state.settings.displayName)}" oninput="state.settings.displayName=this.value" onchange="touch()"></div>
      </div>

      <div class="card card-pad">
        <h3 style="font-size:15px" class="mb-8">Account & Sync</h3>
        ${_fbUser ? `
          <div class="flex-gap"><div class="avatar">${(_fbUser.displayName || _fbUser.email || '?')[0].toUpperCase()}</div><div><div style="font-weight:600">${esc(_fbUser.displayName || _fbUser.email)}</div><div class="small muted">Synced across devices</div></div></div>
          <button class="btn mt-16" onclick="signOutUser()">Sign out</button>
        ` : `
          <p class="small muted mb-16">${fbConfigured() ? 'Sign in to keep your planner synced across devices.' : 'Sync isn’t configured yet — fill in FB_CONFIG in js/firebase.js with a Firebase project to enable sign-in and cross-device sync. Until then, everything is saved locally in this browser.'}</p>
          <button class="btn btn-primary" onclick="signIn()" ${fbConfigured() ? '' : 'disabled'}>Sign in with Google</button>
        `}
      </div>

      <div class="card card-pad">
        <h3 style="font-size:15px" class="mb-8">AI <span class="ai-badge">Claude</span></h3>
        <p class="small muted mb-8">Powers syllabus and assignment auto-fill from uploaded documents. Your key is stored only in this browser.</p>
        <div class="field"><label>Claude API key</label><input class="input" type="password" id="st-key" value="${esc(state.settings.aiApiKey)}" placeholder="sk-ant-…" onchange="setAiKey(this.value)"></div>
        <p class="small muted">Get a key at <span style="text-decoration:underline">console.anthropic.com</span>.</p>
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
        <button class="btn mt-8" onclick="openSemesterResetWizard()">${icon('refresh-cw', 13, 2)} Semester reset wizard</button>
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
function toggleDark(on) { state.settings.dark = on; applyTheme(); touch(); }
function applyTheme() {
  document.documentElement.classList.toggle('dark', state.settings.dark);
}

function setAiKey(v) { state.settings.aiApiKey = v.trim(); save(); toast('API key saved'); }

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
    <div class="modal-head"><h3>Semester reset wizard</h3><button class="close-x" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
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
  const newSem = { id: uid(), name, startDate: $('#sw-start').value, endDate: $('#sw-end').value, archived: false };
  state.semesters.push(newSem);
  if ($('#sw-carry').checked) {
    activeCourses().forEach(c => {
      state.courses.push({ ...JSON.parse(JSON.stringify(c)), id: uid(), semesterId: newSem.id, gradingBreakdown: c.gradingBreakdown.map(g => ({ ...g, id: uid() })), finalGradeOverride: null });
    });
  }
  setState({ currentSemesterId: newSem.id });
  closeModal();
  toast(`Welcome to ${name}`);
}
