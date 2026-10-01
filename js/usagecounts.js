/* ── Anonymous usage counts ─────────────────────────────────────────
   What Semester HQ needs to know to see whether students stick with it,
   and nothing about who they are. Every count goes through diag.event to
   the Worker's /track-event, which allowlists the names and the short
   labels below and stores no account, no address, no device id.

     account_created     once, the first time a brand-new account opens
     app_active_week     once per account per week     label: week (2026-W40)
     feature_used_week   once per feature per week     labels: week, feature,
                                                       source (week1 | later)
     return_day          came back on day 0, 2, 7, 30  labels: source (d0 …),
                                                       cohort (the week the
                                                       plan started)

   "Once" is remembered in the account's own settings (state.settings.usage),
   which sync, so a second device doesn't count the same week again.
   Paying accounts only, never the demo, never the embedded preview.
   Switched off by default (FEATURES.usageCounts in js/config.js).
──────────────────────────────────────────────────────────────── */
// The pages worth counting, by route, with the name the counts use.
const USAGE_FEATURES = {
  calendar: 'calendar', todos: 'todos', notebook: 'notebook', studytools: 'flashcards',
  exams: 'exam-prep', projects: 'projects', studygroups: 'study-groups', orgs: 'clubs', timer: 'timer',
};
// Day windows that count as "came back on day N" (days since the plan began).
const USAGE_RETURN_DAYS = { d0: [0, 0], d2: [1, 2], d7: [6, 8], d30: [28, 32] };

function usageCountsOn() {
  return typeof FEATURES !== 'undefined' && !!FEATURES.usageCounts
    && typeof _fbUser !== 'undefined' && !!_fbUser && !!window._licensed && !isEmbedded();
}

// ISO week, e.g. 2026-W40, in the student's own time zone.
function usageWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function usagePlanStart() {
  const bought = window._licenseDoc?.purchasedAt;
  const ms = typeof bought?.toMillis === 'function' ? bought.toMillis() : Date.parse(bought || '');
  return Number.isFinite(ms) ? ms : null;
}

function usageMark() {
  const u = state.settings.usage && typeof state.settings.usage === 'object' ? state.settings.usage : (state.settings.usage = {});
  if (u.week !== usageWeek()) { u.week = usageWeek(); u.active = false; u.features = []; }
  if (!Array.isArray(u.features)) u.features = [];
  if (!Array.isArray(u.returns)) u.returns = [];
  return u;
}

// Called once a paid account's data has loaded (js/firebase.js).
function usageOnLoad() {
  try {
    if (!usageCountsOn()) return;
    const u = usageMark();
    let changed = false;
    if (!u.active) { u.active = true; changed = true; diag.event('app_active_week', { week: u.week }); }
    const start = usagePlanStart();
    if (start) {
      const age = Math.floor((Date.now() - start) / 86400000);
      const cohort = usageWeek(new Date(start));
      for (const [label, [lo, hi]] of Object.entries(USAGE_RETURN_DAYS)) {
        if (age >= lo && age <= hi && !u.returns.includes(label)) {
          u.returns.push(label); changed = true;
          diag.event('return_day', { source: label, cohort });
        }
      }
    }
    if (changed) save();
  } catch (e) { diag.warn('usage-counts', 'Could not record the weekly count', e); }
}

// Called on every page change (js/app.js render).
function usageOnRoute(route) {
  try {
    const feature = USAGE_FEATURES[route];
    if (!feature || !usageCountsOn()) return;
    const u = usageMark();
    if (u.features.includes(feature)) return;
    u.features.push(feature);
    save();
    const start = usagePlanStart();
    const phase = start && Date.now() - start < 7 * 86400000 ? 'week1' : 'later';
    diag.event('feature_used_week', { week: u.week, feature, source: phase });
  } catch {}
}

// Called on sign-in for any account (paid or not): a brand-new account is
// the funnel's "account created" step. Remembered on this device only, since
// an unpaid account has no synced settings yet.
function usageAccountCreated(user) {
  try {
    if (typeof FEATURES === 'undefined' || !FEATURES.usageCounts || isEmbedded() || !user) return;
    const created = Date.parse(user.metadata?.creationTime || '');
    if (!Number.isFinite(created) || Date.now() - created > 86400000) return;
    const key = `shq_counted_new:${user.uid}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
    diag.event('account_created');
  } catch {}
}
