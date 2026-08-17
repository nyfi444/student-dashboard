/* ── Settings: theme, account/sync, AI, grading, data, semesters ─── */
const BACKGROUND_PRESETS = [
  { type: 'solid', color1: '#ffffff', color2: '#eef0fb', angle: 135, label: 'White' },
  { type: 'solid', color1: '#f7f6fb', color2: '#eef0fb', angle: 135, label: 'Soft lavender' },
  { type: 'solid', color1: '#fdf6f0', color2: '#eef0fb', angle: 135, label: 'Cream' },
  { type: 'solid', color1: '#f0f7f4', color2: '#eef0fb', angle: 135, label: 'Mint' },
  { type: 'solid', color1: '#f0f5fb', color2: '#eef0fb', angle: 135, label: 'Sky' },
  { type: 'gradient', color1: '#ffffff', color2: '#ece9fb', angle: 135, label: 'White → Lavender' },
  { type: 'gradient', color1: '#fef6f8', color2: '#eef4ff', angle: 135, label: 'Blush → Sky' },
  { type: 'gradient', color1: '#f4fbf6', color2: '#eef2fb', angle: 135, label: 'Mint → Periwinkle' },
];
function bgCssValue(bg) { return bg.type === 'gradient' ? `linear-gradient(${bg.angle}deg, ${bg.color1}, ${bg.color2})` : bg.color1; }
function bgMatchesPreset(bg, p) { return bg.type === p.type && bg.color1 === p.color1 && (bg.type !== 'gradient' || (bg.color2 === p.color2 && bg.angle === p.angle)); }

function pageSettings() {
  return `
    ${pageHead('Settings', 'Customize your planner')}
    <div class="grid grid-2" style="align-items:start">
      <div class="card card-pad">
        <h3 style="font-size:15px" class="mb-8">Appearance</h3>
        <div class="field"><label>Accent color</label>
          <div class="swatch-grid">${ACCENTS.map(a => `<div class="swatch ${a.hex === state.settings.accent ? 'active' : ''}" style="background:${a.hex}" title="${a.name}" onclick="setAccent('${a.hex}')">${a.hex === state.settings.accent ? checkGlyph(true) : ''}</div>`).join('')}</div>
        </div>
        <div class="checkbox-row mt-16"><input type="checkbox" id="st-dark" ${state.settings.dark ? 'checked' : ''} onchange="toggleDark(this.checked)"><label for="st-dark">Dark mode</label></div>
        <div class="field mt-16"><label>Display name</label><input class="input" value="${esc(state.settings.displayName)}" oninput="state.settings.displayName=this.value" onchange="touch()"></div>
      </div>

      <div class="card card-pad">
        <h3 style="font-size:15px" class="mb-8">Background</h3>
        <div class="bg-preview mb-16" style="background:${bgCssValue(state.settings.background)}"></div>
        <div class="field"><label>Quick presets</label>
          <div class="flex-gap wrap">
            ${BACKGROUND_PRESETS.map((p, i) => `<div class="bg-preset ${bgMatchesPreset(state.settings.background, p) ? 'active' : ''}" style="background:${bgCssValue(p)}" title="${esc(p.label)}" onclick="setBackgroundPreset(${i})"></div>`).join('')}
          </div>
        </div>
        <button class="btn btn-sm mt-8" onclick="openBackgroundModal()">${icon('sparkles', 13, 1.6)} Custom color or gradient</button>
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
        <p class="small muted mb-8">Powers syllabus auto-fill, AI flashcards, and study guides. Your key is stored only in this browser.</p>
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
    </div>
  `;
}
function setAccent(hex) {
  state.settings.accent = hex;
  applyTheme();
  touch();
}
function toggleDark(on) { state.settings.dark = on; applyTheme(); touch(); }
function applyTheme() {
  document.documentElement.classList.toggle('dark', state.settings.dark);
  document.documentElement.style.setProperty('--accent', state.settings.accent);
  document.documentElement.style.setProperty('--accent-light', lighten(state.settings.accent, state.settings.dark ? -60 : 150));
  document.documentElement.style.setProperty('--accent-dark', lighten(state.settings.accent, -30));
  if (state.settings.dark) document.documentElement.style.removeProperty('--bg');
  else document.documentElement.style.setProperty('--bg', bgCssValue(state.settings.background));
}

function setBackgroundPreset(i) {
  state.settings.background = { ...BACKGROUND_PRESETS[i] };
  applyTheme();
  touch();
}

function openBackgroundModal() {
  window._bgDraft = JSON.parse(JSON.stringify(state.settings.background));
  renderBackgroundModal();
}
function renderBackgroundModal() {
  const bg = _bgDraft;
  openModal(`
    <div class="modal-head"><h3>Custom background</h3><button class="close-x" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="bg-preview mb-16" id="bg-modal-preview" style="background:${bgCssValue(bg)}"></div>
      <div class="segmented mb-16">
        <button class="${bg.type === 'solid' ? 'active' : ''}" onclick="_bgDraft.type='solid';renderBackgroundModal()">Solid</button>
        <button class="${bg.type === 'gradient' ? 'active' : ''}" onclick="_bgDraft.type='gradient';renderBackgroundModal()">Gradient</button>
      </div>
      <div class="grid ${bg.type === 'gradient' ? 'grid-2' : ''}">
        <div class="field"><label>${bg.type === 'gradient' ? 'Color 1' : 'Color'}</label>${colorWheelHtml('bgw1', bg.color1)}</div>
        ${bg.type === 'gradient' ? `<div class="field"><label>Color 2</label>${colorWheelHtml('bgw2', bg.color2)}</div>` : ''}
      </div>
      ${bg.type === 'gradient' ? `<div class="field mt-8"><label>Angle (${bg.angle}°)</label><input type="range" style="width:100%" min="0" max="360" value="${bg.angle}" oninput="_bgDraft.angle=Number(this.value);refreshBgModalVisuals()"></div>` : ''}
      <button class="btn btn-sm mt-8" onclick="resetBackgroundToWhite()">Reset to white</button>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="applyBackgroundDraft()">Apply</button>
    </div>
  `, { wide: true });
  wireColorWheel('bgw1', () => _bgDraft.color1, (hex) => { _bgDraft.color1 = hex; refreshBgModalVisuals(); });
  if (bg.type === 'gradient') wireColorWheel('bgw2', () => _bgDraft.color2, (hex) => { _bgDraft.color2 = hex; refreshBgModalVisuals(); });
}
function refreshBgModalVisuals() {
  const preview = $('#bg-modal-preview');
  if (preview) preview.style.background = bgCssValue(_bgDraft);
}
function resetBackgroundToWhite() {
  _bgDraft = { type: 'solid', color1: '#ffffff', color2: '#eef0fb', angle: 135 };
  renderBackgroundModal();
}
function applyBackgroundDraft() {
  state.settings.background = _bgDraft;
  applyTheme();
  touch();
  closeModal();
  toast('Background updated');
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
