/* ── Email tips: the Settings switch and what the tips can skip ─────
   Semester HQ sends a paying student a welcome and five short tips over
   their first few weeks (worker/src/onboarding.js). This file is the app's
   side of that:

   - Settings → Account & Sync has a switch for them. Receipts come
     whatever it says; the switch is for the tips.
   - Three yes/no facts go to the Worker so it can skip a tip that would be
     pointless: has at least one class, has connected a calendar feed, is
     in a study group or club. Nothing about the class, the feed or the
     group goes with them, only true or false, and only true is ever sent.
     Only while the tips could still be coming (the first six weeks after
     the plan started), never from the demo, and at most once per change.
──────────────────────────────────────────────────────────────── */
const EMAIL_PROGRESS_KEY = 'shq_email_progress';
const EMAIL_PROGRESS_WINDOW_DAYS = 42;

function emailProgressFacts() {
  return {
    hasClass: (state.courses || []).some(c => !c.sample),
    hasFeed: (state.feeds || []).length > 0,
    inGroup: (state.studyGroups || []).some(g => !g.sample) || (state.orgs || []).some(o => !o.sample),
  };
}

function emailProgressInWindow() {
  const bought = window._licenseDoc?.purchasedAt;
  const ms = typeof bought?.toMillis === 'function' ? bought.toMillis() : Date.parse(bought || '');
  if (!Number.isFinite(ms)) return !!window._licenseDoc?.groupPaid; // a seat has no purchase date of its own
  return Date.now() - ms <= EMAIL_PROGRESS_WINDOW_DAYS * 86400000;
}

let _emailProgressTimer = null;
// Called after the planner loads and after a setup step. Debounced, so a
// syllabus that adds a class and its deadlines sends one request.
function noteEmailProgress() {
  clearTimeout(_emailProgressTimer);
  _emailProgressTimer = setTimeout(sendEmailProgress, 1500);
}

async function sendEmailProgress() {
  try {
    if (typeof _fbUser === 'undefined' || !_fbUser || !window._licensed || isEmbedded() || !emailProgressInWindow()) return;
    const facts = emailProgressFacts();
    const key = `${EMAIL_PROGRESS_KEY}:${_fbUser.uid}`;
    let already = {};
    try { already = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch {}
    const fresh = Object.fromEntries(Object.entries(facts).filter(([k, v]) => v && !already[k]));
    if (!Object.keys(fresh).length) return;
    const idToken = await _fbUser.getIdToken();
    const res = await fetch(`${WORKER_URL}/account/email`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken, action: 'progress', ...fresh }),
    });
    if (res.ok) localStorage.setItem(key, JSON.stringify({ ...already, ...fresh }));
  } catch (e) { diag.warn('email-tips', 'Could not report setup progress', e); }
}

/* ── Settings ─────────────────────────────────────────────────── */
function emailSettingsHtml() {
  if (typeof _fbUser === 'undefined' || !_fbUser || !window._licensed || isEmbedded()) return '';
  return `
    <div class="mt-16" id="email-tips-setting">
      <div class="checkbox-row"><input type="checkbox" id="email-tips-toggle" onchange="setEmailTips(this)" disabled><label for="email-tips-toggle">Tips by email</label></div>
      <div class="small muted mt-4" id="email-tips-note">A few short notes in your first weeks on getting the most out of Semester HQ. Receipts always come.</div>
    </div>`;
}

// Fills in the switch whenever Settings is drawn. Asked once per page
// load; a re-render uses the answer it already has.
let _emailTipsOn = null;
async function loadEmailTipsSetting() {
  const box = document.getElementById('email-tips-toggle');
  if (!box || box.dataset.loaded) return;
  box.dataset.loaded = '1';
  if (_emailTipsOn !== null) { box.checked = _emailTipsOn; box.disabled = false; return; }
  try {
    const idToken = await _fbUser.getIdToken();
    const res = await fetch(`${WORKER_URL}/account/email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken, action: 'status' }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `status ${res.status}`);
    _emailTipsOn = data.tips !== false;
    box.checked = _emailTipsOn;
    box.disabled = false;
  } catch (e) {
    diag.warn('email-tips', 'Could not load the email setting', e);
    document.getElementById('email-tips-note')?.insertAdjacentText('beforeend', ' (Couldn’t load this right now. Try again later.)');
  }
}

async function setEmailTips(box) {
  const want = box.checked;
  box.disabled = true;
  try {
    const idToken = await _fbUser.getIdToken();
    const res = await fetch(`${WORKER_URL}/account/email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken, action: 'set', tips: want }) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `status ${res.status}`);
    _emailTipsOn = want;
    toast(want ? 'Tips by email are on.' : 'No more tips by email. Receipts still come.', 'success');
  } catch (e) {
    box.checked = !want;
    toast('Couldn’t change that right now. Try again in a moment.', 'error');
    diag.error('email-tips', 'Could not change the email setting', e);
  } finally { box.disabled = false; }
}
