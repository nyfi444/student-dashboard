/* ── First-week setup counts ───────────────────────────────────────
   Three anonymous counts that say whether new accounts actually get set
   up: their first class, their first deadlines (from a syllabus or an
   LMS feed), and their first study group or club (joined or started).
   Each is sent at most once per account, through diag.event, to the
   Worker's /track-event, which allowlists the names and the one label
   they may carry (source).
   Nothing about the class, the deadlines or the group goes with it.

   Only accounts that are new since the counts were switched on send
   anything. The first time the app sees a signed-in, paid account with
   the switch on (right after its data has loaded from the cloud), it
   writes a baseline into that account's own settings: counted if the
   account has no classes yet and was created, or bought its plan, in the
   last week; not counted otherwise. So turning this on doesn't make every
   existing account fire at once. The baseline and what has been sent live
   in state.settings.setupCounts, which syncs with the account, so a
   second device doesn't send them again.

   Switched off by default (FEATURES.setupCounts in js/config.js); off, it
   does nothing at all.
──────────────────────────────────────────────────────────────── */
const SETUP_COUNT_EVENTS = ['setup_class_added', 'setup_deadlines_in', 'setup_group_joined'];
const SETUP_COUNT_NEW_DAYS = 7;

function setupCountsOn() { return typeof FEATURES !== 'undefined' && !!FEATURES.setupCounts; }

// Called once a signed-in, paid account's data has loaded (js/firebase.js).
function setupCountsBaseline(user) {
  try {
    if (!setupCountsOn() || !user || !window._licensed || isEmbedded()) return;
    if (state.settings.setupCounts) return;
    const recent = (ms) => Number.isFinite(ms) && ms > 0 && Date.now() - ms <= SETUP_COUNT_NEW_DAYS * 86400000;
    const created = Date.parse(user.metadata?.creationTime || '');
    const bought = window._licenseDoc?.purchasedAt;
    const boughtMs = typeof bought?.toMillis === 'function' ? bought.toMillis() : Date.parse(bought || '');
    const isNew = (recent(created) || recent(boughtMs)) && !(state.courses || []).length;
    state.settings.setupCounts = { counted: isNew, since: todayIso(), sent: [] };
    save();
  } catch (e) { diag.warn('setup-counts', 'Could not set the setup-count baseline', e); }
}

// A setup step happened. `source` is a short label ('syllabus', 'lms',
// 'study-group', …), the only thing sent with it.
function countSetupStep(name, source = '') {
  try {
    if (!setupCountsOn() || !SETUP_COUNT_EVENTS.includes(name)) return;
    if (typeof _fbUser === 'undefined' || !_fbUser || !window._licensed || isEmbedded()) return;
    const mark = state.settings.setupCounts;
    if (!mark || !mark.counted) return;
    if (!Array.isArray(mark.sent)) mark.sent = [];
    if (mark.sent.includes(name)) return;
    mark.sent.push(name);
    save();
    diag.event(name, source ? { source } : undefined);
  } catch {} // a count is never worth an error the student sees
}
