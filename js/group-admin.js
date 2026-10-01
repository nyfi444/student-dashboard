/* ── Group plan admin page (group-admin.html) ─────────────────────
   Where a club, team, class, or department buys Semester HQ for its
   members and runs it: seats, the invite link, who's using a seat, who
   else can administer it, and billing. Every change goes through the
   Worker's /group/* routes (worker/src/index.js, section 9), which is the
   only thing allowed to grant anyone a plan. Deliberately standalone: the
   person running a plan may not use the planner themselves, and shouldn't
   have to get past a paywall to manage what they're paying for.
──────────────────────────────────────────────────────────────── */
const SEAT_PRICE_CENTS = 599;
const MIN_SEATS = 5;
// Self-serve stops at 50 on purpose. A 50-seat plan is already $299.50 a
// month, and a check that size deserves a conversation: a first-term rate, a
// named contact, a renewal date on the calendar. Anything bigger (and
// anything needing an invoice, a PO, a W-9, or covering a department or a
// whole campus) goes through semester-hq.com/group-pricing.html instead.
const MAX_SEATS = 50;
const GROUP_QUOTE_URL = 'https://semester-hq.com/group-pricing.html';
const PLAN_KINDS = [['club', 'Student club or organization'], ['team', 'Sports or club team'], ['chapter', 'Sorority or fraternity chapter'], ['class', 'Class or course section'], ['department', 'Academic department'], ['other', 'Something else']];

let _auth = null;
const view = { ready: false, user: null, plans: [], seat: null, planId: '', details: null, busy: false, settingUp: false };
const params = new URLSearchParams(location.search);
// Local preview: group-admin.html?preview=1 fills the page with sample data and
// never calls the Worker. Only possible on localhost / 127.0.0.1 / [::1], so it
// can never appear on the production host.
const gaPreview = params.get('preview') === '1' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const monthly = (seats) => money(seats * SEAT_PRICE_CENTS);
const fmtJoined = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };

async function api(action, body = {}) {
  if (gaPreview) return gaPreviewApi(action, body);
  const idToken = view.user ? await view.user.getIdToken() : null;
  const res = await fetch(`${WORKER_URL}/group/${action}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, idToken }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 404 && data.error === 'Not found') throw new Error('Group plans aren’t switched on yet. Email hello@semester-hq.com and we’ll set your group up.');
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again in a moment.');
  return data;
}
// Every action follows the same shape: show it working, do it, re-render.
async function act(btn, run) {
  if (view.busy) return;
  view.busy = true;
  if (btn) setBtnLoading(btn, true);
  try { await run(); }
  catch (e) { toast(e.message || 'That didn’t work', 'error', 6000); }
  finally { view.busy = false; if (btn) setBtnLoading(btn, false); render(); }
}

/* ── Loading ──────────────────────────────────────────────────── */
async function loadMine() {
  const data = await api('mine');
  view.plans = data.plans || [];
  view.seat = data.seat || null;
  if (!view.planId || !view.plans.some(p => p.id === view.planId)) {
    view.planId = params.get('plan') && view.plans.some(p => p.id === params.get('plan')) ? params.get('plan') : (view.plans[0]?.id || '');
  }
  if (view.planId) await loadDetails();
  else view.details = null;
}
async function loadDetails() {
  view.details = view.planId ? await api('details', { planId: view.planId }) : null;
}
// Stripe's webhook can land a second or two after the person does.
async function waitForActivation() {
  view.settingUp = true;
  render();
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      await loadMine();
      if (view.details?.plan?.status && view.details.plan.status !== 'pending') break;
    } catch {}
  }
  view.settingUp = false;
  history.replaceState({}, '', `${location.pathname}?plan=${encodeURIComponent(view.planId)}`);
  render();
}

/* ── Actions ──────────────────────────────────────────────────── */
function startPlan(btn) {
  const name = $('#ga-new-name').value.trim();
  const kind = $('#ga-new-kind').value;
  const seats = Number($('#ga-new-seats').value);
  if (!name) { toast('Give your group a name', 'error'); return; }
  if (seats > MAX_SEATS) { toast(`Over ${MAX_SEATS} seats we'll put a quote together for you. Opening the form…`, 'info', 5000); setTimeout(() => { location.href = GROUP_QUOTE_URL; }, 1200); return; }
  if (!(seats >= MIN_SEATS && seats <= MAX_SEATS)) { toast(`Choose between ${MIN_SEATS} and ${MAX_SEATS} seats`, 'error'); return; }
  act(btn, async () => {
    const data = await api('create-checkout', { name, kind, seats, orgCode: params.get('org') || '', planId: view.planId && view.details?.plan?.status === 'pending' ? view.planId : '', ...(linkCode() ? { via: linkCode() } : {}) });
    window.location.href = data.url;
    await new Promise(r => setTimeout(r, 4000)); // keep the button busy while the browser leaves
  });
}
function finishCheckout(btn, planId) {
  const plan = view.plans.find(p => p.id === planId);
  act(btn, async () => {
    const data = await api('create-checkout', { planId, name: plan.name, kind: plan.kind, seats: plan.requestedSeats || MIN_SEATS, ...(linkCode() ? { via: linkCode() } : {}) });
    window.location.href = data.url;
    await new Promise(r => setTimeout(r, 4000));
  });
}
function saveSeats(btn) {
  const seats = Number($('#ga-seats-input').value);
  const plan = view.details.plan;
  if (seats === plan.seats) return;
  // Growing past self-serve is a good problem: hand them the quote form
  // rather than an error from the server.
  if (seats > MAX_SEATS) {
    confirmDialog(`Plans over ${MAX_SEATS} seats we put together with you, so the rate and the term fit your group. Want to send us the details?`, () => { location.href = GROUP_QUOTE_URL; }, 'Ask for a quote');
    return;
  }
  if (seats < MIN_SEATS) { toast(`Plans start at ${MIN_SEATS} seats. Cancel the plan instead if you're down to fewer than that.`, 'error', 5000); return; }
  const change = seats > plan.seats
    ? `Add ${seats - plan.seats} seat${seats - plan.seats === 1 ? '' : 's'}? Your plan becomes ${monthly(seats)} a month, and Stripe charges the difference for the rest of this month on your next bill.`
    : `Drop to ${seats} seat${seats === 1 ? '' : 's'}? Your plan becomes ${monthly(seats)} a month, and the unused part of what you've paid comes off your next bill.`;
  confirmDialog(change, () => act(btn, async () => {
    view.details = await api('seats', { planId: plan.id, seats });
    view.plans = view.plans.map(p => p.id === plan.id ? view.details.plan : p);
    toast(`Your plan is now ${seats} seats, ${monthly(seats)} a month`, 'success', 5000);
  }), seats > plan.seats ? 'Add seats' : 'Remove seats');
}
function copyInvite(btn) {
  const url = view.details?.plan?.inviteUrl;
  if (!url) return;
  navigator.clipboard?.writeText(url).then(() => toast('Invite link copied. Share it with your members.', 'success', 4000), () => toast('Copy it from the box instead', 'info'));
}
function resetInvite(btn) {
  confirmDialog('Make a new invite link? The old one stops working right away, and anyone who already has a seat keeps it.', () => act(btn, async () => {
    view.details = await api('reset-invite', { planId: view.planId });
    toast('New invite link ready', 'success');
  }), 'New link');
}
function takeSeat(btn) {
  act(btn, async () => {
    await api('join', { planId: view.planId });
    await loadDetails();
    toast('You’re using a seat on this plan now', 'success');
  });
}
const gaMemberName = (uid) => (view.details?.members || []).find(m => m.uid === uid)?.name || '';
function removeMember(btn, uid) {
  const name = gaMemberName(uid);
  confirmDialog(`Remove ${name || 'this member'}? They lose Semester HQ Plus unless they subscribe themselves, and the seat opens up for someone else.`, () => act(btn, async () => {
    view.details = await api('remove-member', { planId: view.planId, uid });
    toast('Removed', 'success');
  }), 'Remove');
}
function setAdmin(btn, uid, admin) {
  const name = gaMemberName(uid) || 'They';
  act(btn, async () => {
    const result = await api('set-admin', { planId: view.planId, uid, admin });
    if (result.removedSelf) { toast('You’re no longer an admin of this plan', 'info', 5000); view.planId = ''; await loadMine(); return; }
    view.details = result;
    toast(admin ? `${name} can manage this plan now` : `${name} is no longer an admin`, 'success');
  });
}
function renamePlan() {
  const current = view.details?.plan?.name || '';
  openModal(`
    <div class="modal-head"><h3>Rename this plan</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="field"><label for="ga-rename-input">Group name</label>
        <input class="input" id="ga-rename-input" value="${esc(current)}" maxlength="80" autocomplete="off" onkeydown="if(event.key==='Enter'){event.preventDefault();saveRename()}"></div>
      <p class="ga-hint">Members see this name on their plan, and it goes on your Stripe receipts.</p>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="ga-rename-save" onclick="saveRename()">Save</button></div>`);
  setTimeout(() => { const i = $('#ga-rename-input'); if (i) { i.focus(); i.select(); } }, 30);
}
function saveRename() {
  const name = ($('#ga-rename-input')?.value || '').trim();
  if (!name) { toast('Give your group a name', 'error'); return; }
  if (name === view.details?.plan?.name) { closeModal(); return; }
  act($('#ga-rename-save'), async () => {
    view.details = await api('rename', { planId: view.planId, name });
    view.plans = view.plans.map(p => p.id === view.planId ? view.details.plan : p);
    closeModal();
    toast('Renamed', 'success');
  });
}
function openBilling(btn) {
  act(btn, async () => {
    const data = await api('portal', { planId: view.planId });
    window.location.href = data.url;
    await new Promise(r => setTimeout(r, 4000));
  });
}
function deletePending(btn, planId) {
  confirmDialog('Delete this unfinished plan? Nothing was charged for it.', () => act(btn, async () => {
    await api('delete-pending', { planId });
    view.planId = '';
    await loadMine();
  }), 'Delete');
}
function pickPlan(planId) {
  view.planId = planId;
  view.details = null;
  render();
  loadDetails().then(render).catch(e => toast(e.message, 'error'));
}

/* ── Rendering ────────────────────────────────────────────────── */
// Member list controls live here so typing in the search box only redraws
// the rows, not the whole page (which would drop focus).
const gaList = { q: '', sort: 'joined' };
const GA_SORTS = [['joined', 'Joined'], ['name', 'Name A to Z'], ['admins', 'Admins first']];

function render() {
  const root = $('#ga-root');
  $('#ga-account').innerHTML = view.user
    ? `${gaPreview ? `<span class="ga-preview-tag">${icon('eye', 12, 2)} Preview</span>` : ''}<span>${esc(view.user.email || '')}</span><button class="btn btn-sm" onclick="signOutOfAdmin()">Sign out</button>`
    : '';
  if (!view.ready) root.innerHTML = card(`<div class="ga-empty">Checking your session…</div>`);
  else if (!view.user) root.innerHTML = signedOutHtml();
  else if (view.settingUp) root.innerHTML = card(`<div class="ga-empty">Setting up your group plan…<div class="small muted mt-8">This usually takes a few seconds.</div></div>`);
  else if (!view.plans.length || params.get('new') === '1' && !view.planId) root.innerHTML = newPlanHtml();
  else root.innerHTML = planHtml();
  enhanceAccessibility(root);
}
const card = (inner, cls = '') => `<div class="card ga-card ${cls}">${inner}</div>`;

function signedOutHtml() {
  return `
    <div class="ga-eyebrow">Group plans</div>
    <h1 class="ga-title">Semester HQ for your whole group</h1>
    <p class="ga-lede mb-16">Cover Semester HQ for your club, team, chapter, class, or department at ${money(SEAT_PRICE_CENTS)} per member each month, instead of $7.99 each. Members join with a link and get everything: their own planner, syllabus upload, study groups, and your group's calendar.</p>
    <div class="ga-signin-grid">
    ${card(`
      <h3>Sign in to start or manage a plan</h3>
      <p class="ga-hint mb-16">Use the account you want to run the plan from. You don't need a Semester HQ subscription of your own to pay for a group.</p>
      <div id="ga-signin">
        <form onsubmit="event.preventDefault();startEmailSignIn()">
          <input class="input" type="email" id="ga-email" placeholder="you@school.edu" required autocomplete="email" style="width:100%;margin-bottom:10px;box-sizing:border-box">
          <button class="btn btn-primary" type="submit" style="width:100%">Continue with email</button>
        </form>
        <div class="login-divider" style="margin:14px 0"><span>or</span></div>
        <button class="btn" style="width:100%" onclick="startGoogleSignIn()">Continue with Google</button>
      </div>
    `)}
    ${card(`
      <h3>How group plans work</h3>
      <ol class="install-steps mt-8">
        <li class="install-step"><span class="install-num">1</span><div>Pick how many members you're covering (5 or more) and pay with a card. Many groups use their budget or dues.</div></li>
        <li class="install-step"><span class="install-num">2</span><div>Share your invite link. Each member signs in, takes a seat, and is set up instantly.</div></li>
        <li class="install-step"><span class="install-num">3</span><div>Add or remove seats whenever your roster changes. You're only billed for the seats you keep.</div></li>
      </ol>
    `)}
    </div>`;
}

function newPlanHtml() {
  const pending = view.plans.filter(p => p.status === 'pending');
  const seats = Number(params.get('seats')) || 10;
  return `
    <div class="ga-eyebrow">Group plans</div>
    <h1 class="ga-title">Start a group plan</h1>
    <p class="ga-lede mb-16">${money(SEAT_PRICE_CENTS)} per member each month, for ${MIN_SEATS} to ${MAX_SEATS} members. Cancel or change your seat count anytime. Covering more than ${MAX_SEATS}, or need an invoice or a PO? <a href="${GROUP_QUOTE_URL}">Ask for a quote</a>.</p>
    ${view.plans.length ? `<div class="ga-plan-tabs">${view.plans.map(p => `<button class="btn btn-sm" onclick="pickPlan('${p.id}')">${esc(p.name)}</button>`).join('')}</div>` : ''}
    ${card(`
      <div class="field"><label for="ga-new-name">Group name</label><input class="input" id="ga-new-name" value="${esc(params.get('name') || '')}" placeholder="Chem Club" maxlength="80"></div>
      <div class="field"><label for="ga-new-kind">What kind of group?</label><select class="select" id="ga-new-kind">${PLAN_KINDS.map(([v, l]) => `<option value="${v}" ${v === (params.get('kind') || 'club') ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label for="ga-new-seats">How many members?</label>
        <div class="ga-seats" style="border:0;padding:0;margin:0">
          <button class="btn btn-icon btn-sm" aria-label="Fewer seats" onclick="stepSeats('ga-new-seats',-1)">−</button>
          <input class="input" id="ga-new-seats" type="number" min="${MIN_SEATS}" max="${MAX_SEATS}" value="${seats}" oninput="updateNewTotal()">
          <button class="btn btn-icon btn-sm" aria-label="More seats" onclick="stepSeats('ga-new-seats',1)">+</button>
          <span class="ga-total" id="ga-new-total"><b>${monthly(seats)}</b> a month</span>
        </div>
      </div>
      <p class="ga-hint">You can change this later. Adding seats mid-month is prorated, and removing them credits your next bill.</p>
      <button class="btn btn-primary mt-16" onclick="startPlan(this)">Continue to checkout</button>
    `)}
    ${pending.length ? card(`
      <h3>Unfinished</h3>
      ${pending.map(p => `<div class="list-row"><div class="row-title">${esc(p.name)}</div><div class="row-meta">${p.requestedSeats} seats · never paid</div>
        <button class="btn btn-sm" onclick="finishCheckout(this,'${p.id}')">Finish</button>
        <button class="btn btn-sm btn-ghost" onclick="deletePending(this,'${p.id}')">Delete</button></div>`).join('')}
    `) : ''}`;
}

const gaKindLabel = (kind) => (PLAN_KINDS.find(([v]) => v === kind) || [])[1] || 'Group';
function gaStatusPill(plan) {
  if (plan.status === 'active') return plan.cancelAtPeriodEnd ? `<span class="ga-status">Ending</span>` : `<span class="ga-status">${icon('check', 11, 2.4)} Active</span>`;
  if (plan.status === 'past_due') return `<span class="ga-status">Payment problem</span>`;
  if (plan.status === 'pending') return `<span class="ga-status quiet">Not finished</span>`;
  return `<span class="ga-status quiet">Canceled</span>`;
}
// Seats ring: used over total, capped at 100% so a briefly oversubscribed
// plan never draws past the circle. The text still says the real numbers.
function gaRing(used, seats) {
  const r = 48, c = 2 * Math.PI * r;
  const pct = seats ? Math.min(1, used / seats) : 0;
  return `<div class="ga-ring" role="img" aria-label="${used} of ${seats} seats used">
    <svg viewBox="0 0 112 112" aria-hidden="true"><circle class="track" cx="56" cy="56" r="${r}"/><circle class="used" cx="56" cy="56" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - pct)).toFixed(2)}"/></svg>
    <div class="ga-ring-label"><b>${used}</b><span>of ${seats}</span></div></div>`;
}
// QR drawn locally by the vendored qrcode-generator. Black on white in every
// theme so phone cameras read it.
function gaQrSvg(url) {
  if (typeof qrcode !== 'function' || !url) return '';
  try {
    const q = qrcode(0, 'M');
    q.addData(url);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch (e) { diag.warn('group-admin', 'QR failed', e); return ''; }
}
function showInviteOnScreen() {
  const url = view.details?.plan?.inviteUrl;
  if (!url) return;
  openModal(`
    <div class="modal-head"><h3>Scan to join ${esc(view.details.plan.name)}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="ga-qr-big">${gaQrSvg(url)}</div>
      <div class="ga-qr-caption">${esc(url)}</div>
      <p class="ga-hint mt-8" style="text-align:center">Anyone who scans this and signs in takes one of your seats.</p>
    </div>`);
}

function planHtml() {
  const details = view.details;
  if (!details) return card(`<div class="ga-empty">Loading your plan…</div>`);
  const plan = details.plan;
  const members = details.members || [];
  const used = members.length;
  const qr = plan.status !== 'canceled' ? gaQrSvg(plan.inviteUrl) : '';
  if (plan.status === 'pending') {
    return `
      <div class="ga-eyebrow">Your group plan</div>
      <h1 class="ga-title">${esc(plan.name)}</h1>
      ${card(`<div class="ga-plan-meta">${gaStatusPill(plan)}</div><p class="ga-hint mt-8">This plan hasn't been paid for yet, so it has no seats.</p>
        <div class="flex-gap mt-16"><button class="btn btn-primary" onclick="finishCheckout(this,'${plan.id}')">Finish checkout</button>
        <button class="btn" onclick="deletePending(this,'${plan.id}')">Delete</button></div>`)}`;
  }
  const nextBill = plan.currentPeriodEnd ? fmtJoined(plan.currentPeriodEnd) : '';
  return `
    ${view.plans.length > 1 ? `<div class="ga-plan-tabs">${view.plans.map(p => `<button class="btn btn-sm ${p.id === view.planId ? 'btn-primary' : ''}" onclick="pickPlan('${p.id}')">${esc(p.name)}</button>`).join('')}<button class="btn btn-sm btn-ghost" onclick="view.planId='';view.details=null;render()">${icon('plus', 14)} New plan</button></div>` : ''}
    <div class="ga-eyebrow">Your group plan</div>
    <h1 class="ga-title">Seats, members and billing</h1>
    ${plan.status === 'canceled' ? `<div class="ga-notice">This plan is canceled, so its members no longer have Semester HQ Plus through it. Start a new plan to bring them back.</div>` : ''}
    ${plan.status === 'past_due' ? `<div class="ga-notice">A payment didn't go through. Your members still have access for now. Update your card under Billing to keep it that way.</div>` : ''}
    ${plan.cancelAtPeriodEnd ? `<div class="ga-notice">This plan is set to end${nextBill ? ` on ${nextBill}` : ''}. Members keep access until then. Changed your mind? Manage billing lets you keep it going.</div>` : ''}
    ${card(`
      <div class="ga-plan">
        <div>
          <div class="ga-eyebrow">${esc(gaKindLabel(plan.kind))}</div>
          <h2 class="ga-plan-name">${esc(plan.name)}</h2>
          <div class="ga-plan-meta">${gaStatusPill(plan)}<button class="btn btn-ghost btn-sm" onclick="renamePlan()">${icon('pencil', 13, 1.8)} Rename</button></div>
          ${plan.orgCode ? `<div class="ga-plan-org">Runs the plan for a club or team on Semester HQ · <a href="index.html?org=${encodeURIComponent(plan.orgCode)}&tab=admin">Open its admin page</a></div>` : ''}
        </div>
        ${gaRing(used, plan.seats)}
        <div class="ga-stats">
          <div class="ga-stat"><div class="ga-eyebrow">Seats</div><b>${used} of ${plan.seats}</b><span>${Math.max(0, plan.seats - used)} open</span></div>
          <div class="ga-stat"><div class="ga-eyebrow">Monthly</div><b>${monthly(plan.seats)}</b><span>${money(SEAT_PRICE_CENTS)} × ${plan.seats} seats</span></div>
          ${plan.cancelAtPeriodEnd
            ? `<div class="ga-stat"><div class="ga-eyebrow">Ends</div><b>${nextBill || 'Soon'}</b><span>set to cancel</span></div>`
            : nextBill ? `<div class="ga-stat"><div class="ga-eyebrow">Next bill</div><b>${nextBill}</b><span>${plan.status === 'past_due' ? 'payment due' : 'renews automatically'}</span></div>` : ''}
        </div>
        ${plan.status !== 'canceled' ? `
        <div class="ga-seats">
          <span class="ga-seats-label">Seats</span>
          <button class="btn btn-icon btn-sm" aria-label="Fewer seats" onclick="stepSeats('ga-seats-input',-1)">−</button>
          <input class="input" id="ga-seats-input" type="number" min="${MIN_SEATS}" max="${MAX_SEATS}" value="${plan.seats}" aria-label="Number of seats">
          <button class="btn btn-icon btn-sm" aria-label="More seats" onclick="stepSeats('ga-seats-input',1)">+</button>
          <button class="btn btn-sm" onclick="saveSeats(this)">Change seats</button>
        </div>
        <p class="ga-value"><b>Each member gets Plus ($7.99) for ${money(SEAT_PRICE_CENTS)}.</b> Up to ${MAX_SEATS} seats here. Outgrown that, or need an invoice or a PO? <a href="${GROUP_QUOTE_URL}">Ask for a quote</a> and we'll sort it out with you.</p>` : ''}
      </div>
    `)}
    ${plan.status !== 'canceled' ? card(`
      <div class="ga-invite">
        <div>
          <h3>Invite your members</h3>
          <p class="ga-hint">Anyone who opens this link and signs in takes one of your seats. Share it in your group chat, or put the code on a slide at your next meeting.</p>
          <div class="ga-invite-row">
            <input class="input" readonly value="${esc(plan.inviteUrl)}" aria-label="Invite link" onclick="this.select()">
            <button class="btn btn-sm" onclick="copyInvite(this)">${icon('copy', 13, 1.8)} Copy</button>
            <button class="btn btn-sm btn-ghost" onclick="resetInvite(this)">New link</button>
          </div>
          ${!details.you.hasSeat ? `<p class="ga-hint mt-16">You're running this plan without using a seat. <button class="ga-linkbtn" onclick="takeSeat(this)">Use one myself</button></p>` : ''}
        </div>
        ${qr ? `<div class="ga-qr"><div class="ga-qr-box" aria-label="QR code for the invite link" role="img">${qr}</div><button class="btn btn-sm" onclick="showInviteOnScreen()">${icon('maximize', 13, 1.8)} Show on screen</button></div>` : ''}
      </div>
    `) : ''}
    ${card(`
      <div class="ga-members-head">
        <h3>Members <span class="ga-count">${used}</span></h3>
        ${members.length ? `<div class="ga-tools">
          <div class="ga-search">${icon('search', 14, 2)}<input class="input" type="search" id="ga-search" placeholder="Search members" value="${esc(gaList.q)}" oninput="gaSetQuery(this.value)" aria-label="Search members"></div>
          <select class="select" aria-label="Sort members" onchange="gaSetSort(this.value)">${GA_SORTS.map(([v, l]) => `<option value="${v}" ${v === gaList.sort ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </div>` : ''}
      </div>
      ${members.length ? `<div class="sr-only" id="ga-results" aria-live="polite"></div>
      <div class="ga-rows" id="ga-rows" role="list" aria-label="Members">${gaRowsHtml()}</div>
      <div class="ga-members-foot">
        <label class="checkbox-row"><input type="checkbox" id="ga-csv-emails"> Include emails</label>
        <button class="btn btn-sm" onclick="exportMembersCsv()">${icon('download', 13, 1.8)} Export CSV</button>
      </div>`
      : `<div class="ga-empty">Nobody has taken a seat yet. Share your invite link above.</div>`}
    `)}
    ${card(`
      <h3>Billing</h3>
      <p class="ga-hint mb-8">Update your card, download invoices, or cancel the plan. Canceling ends Semester HQ Plus for everyone on it at the end of the period you've paid for.</p>
      <button class="btn mt-8" onclick="openBilling(this)">Manage billing</button>
    `)}`;
}
const gaInitials = (name, email) => {
  const src = (name || '').trim() || (email || '').split('@')[0] || '';
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : (parts[0]?.[1] || ''))).toUpperCase() || '?';
};
function gaVisibleMembers() {
  const members = (view.details?.members || []).slice();
  const q = gaList.q.trim().toLowerCase();
  const list = q ? members.filter(m => (m.name || '').toLowerCase().includes(q) || (m.email || '').toLowerCase().includes(q)) : members;
  const byName = (a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || '', undefined, { sensitivity: 'base' });
  const byJoined = (a, b) => new Date(a.joinedAt) - new Date(b.joinedAt);
  if (gaList.sort === 'name') list.sort(byName);
  else if (gaList.sort === 'admins') list.sort((a, b) => (b.admin ? 1 : 0) - (a.admin ? 1 : 0) || byName(a, b));
  else list.sort(byJoined);
  return list;
}
function gaRowsHtml() {
  const list = gaVisibleMembers();
  const you = view.details?.you?.uid;
  if (!list.length) return `<div class="ga-empty">No one matches “${esc(gaList.q)}”.</div>`;
  return list.map(m => `
    <div class="ga-row" role="listitem">
      <div class="ga-avatar ${m.admin ? 'is-admin' : ''}" aria-hidden="true">${esc(gaInitials(m.name, m.email))}</div>
      <div class="ga-who"><div class="ga-name"><span>${esc(m.name || 'Member')}</span>${m.uid === you ? '<span class="ga-you">(you)</span>' : ''}${m.admin ? '<span class="ga-badge">Admin</span>' : ''}</div><div class="ga-email">${esc(m.email || '')}</div></div>
      <div class="ga-joined">Joined ${esc(fmtJoined(m.joinedAt))}</div>
      <div class="ga-actions">
        <button class="btn btn-sm btn-ghost" aria-label="${m.admin ? 'Remove admin from' : 'Make admin:'} ${esc(m.name || m.email || 'member')}" onclick="setAdmin(this,'${esc(m.uid)}',${!m.admin})">${m.admin ? 'Remove admin' : 'Make admin'}</button>
        <button class="btn btn-sm btn-ghost" aria-label="Remove ${esc(m.name || m.email || 'member')}" onclick="removeMember(this,'${esc(m.uid)}')">Remove</button>
      </div>
    </div>`).join('');
}
function gaSetQuery(q) { gaList.q = q; gaRedrawRows(); }
function gaSetSort(sort) { gaList.sort = sort; gaRedrawRows(); }
// Redraws the list and tells screen readers (and the Members count) how many
// rows the search left.
function gaRedrawRows() {
  const rows = $('#ga-rows'); if (!rows) return;
  rows.innerHTML = gaRowsHtml();
  const total = (view.details?.members || []).length;
  const shown = gaVisibleMembers().length;
  const q = gaList.q.trim();
  const count = $('.ga-count'); if (count) count.textContent = q ? `${shown} of ${total}` : String(total);
  const live = $('#ga-results'); if (live) live.textContent = q ? `${shown} of ${total} members shown` : `${total} members`;
}
// Names are typed by members, so a cell that could start a spreadsheet
// formula gets an apostrophe in front, and quotes are doubled.
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
function exportMembersCsv() {
  const withEmails = !!$('#ga-csv-emails')?.checked;
  const rows = [['Name', 'Joined', 'Admin', ...(withEmails ? ['Email'] : [])]];
  gaVisibleMembers().forEach(m => rows.push([m.name || '', fmtJoined(m.joinedAt), m.admin ? 'Yes' : '', ...(withEmails ? [m.email || ''] : [])]));
  const csv = rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(view.details?.plan?.name || 'group-plan').replace(/[^\w\- ]+/g, '').trim() || 'group-plan'} members.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(withEmails ? 'Exported with emails' : 'Exported names and join dates', 'success');
}
function stepSeats(id, by) {
  const input = $('#' + id);
  input.value = Math.max(MIN_SEATS, Math.min(MAX_SEATS, (Number(input.value) || MIN_SEATS) + by));
  if (id === 'ga-new-seats') updateNewTotal();
}
function updateNewTotal() {
  const seats = Math.max(0, Number($('#ga-new-seats').value) || 0);
  $('#ga-new-total').innerHTML = `<b>${monthly(seats)}</b> a month`;
}

/* ── Local preview (localhost only) ───────────────────────────────
   group-admin.html?preview=1 fills the page with a fictional plan so the
   design can be checked without a Worker or a sign-in. Optional
   &pstate=past_due | canceled | ending | pending | empty | new picks a state.
   Every action edits the sample in memory; nothing leaves the browser. */
const GA_SAMPLE_PEOPLE = [
  ['Priya Natarajan', 'priya.n@school.edu', true], ['Marcus Webb', 'mwebb@school.edu', false], ['Sofia Delgado', 'sdelgado@school.edu', true],
  ['Ethan Cho', 'echo22@school.edu', false], ['Amara Okafor', 'aokafor@school.edu', false], ['Liam Brennan', 'lbrennan@school.edu', false],
  ['Hana Sato', 'hsato@school.edu', false], ['Jordan Ellis', 'jellis@school.edu', false], ['Noor Haddad', 'nhaddad@school.edu', false],
  ['Gabriel Rossi', 'grossi@school.edu', false], ['Maya Lindqvist', 'mlindqvist@school.edu', false], ['Tyler Banks', 'tbanks@school.edu', false],
  ['Chloe Martin', 'cmartin@school.edu', false], ['Daniel Park', 'dpark@school.edu', false], ['Isabela Ferreira', 'iferreira@school.edu', false],
  ['Owen Fitzgerald', 'ofitz@school.edu', false], ['Zara Ahmed', 'zahmed@school.edu', false], ['Kenji Watanabe', 'kwatanabe@school.edu', false],
  ['Leila Moreau', 'lmoreau@school.edu', false], ['Sam Whitaker', 'swhitaker@school.edu', false], ['Ines Carvalho', 'icarvalho@school.edu', false],
  ['Ravi Menon', 'rmenon@school.edu', false],
];
function gaSampleDetails(pstate) {
  const base = new Date(2026, 7, 24, 9, 0);
  const members = pstate === 'empty' ? [] : GA_SAMPLE_PEOPLE.map(([name, email, admin], i) => ({
    uid: `sample-${i + 1}`, name, email, admin, joinedAt: new Date(base.getTime() + i * 1000 * 60 * 60 * 31).toISOString(),
  }));
  const plan = {
    id: 'sample-plan', name: 'Chem Club', kind: 'club', seats: 25, status: 'active', cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date(2026, 9, 24).toISOString(), inviteUrl: 'https://app.semester-hq.com/?groupinvite=SAMPLE-CHEM-2026', orgCode: 'CHEM26',
  };
  if (pstate === 'past_due') plan.status = 'past_due';
  if (pstate === 'canceled') plan.status = 'canceled';
  if (pstate === 'ending') plan.cancelAtPeriodEnd = true;
  if (pstate === 'pending') { plan.status = 'pending'; plan.seats = 0; }
  return { plan, members, you: { uid: 'sample-1', hasSeat: pstate !== 'noseat' } };
}
async function gaPreviewApi(action, body) {
  await new Promise(r => setTimeout(r, 250));
  const d = view.details;
  const done = () => ({ ...d, plan: { ...d.plan } });
  switch (action) {
    case 'mine': return { plans: view.plans, seat: null };
    case 'details': return d;
    case 'seats': d.plan.seats = body.seats; return done();
    case 'rename': d.plan.name = body.name; return done();
    case 'reset-invite': d.plan.inviteUrl = `https://app.semester-hq.com/?groupinvite=SAMPLE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`; return done();
    case 'remove-member': d.members = d.members.filter(m => m.uid !== body.uid); return done();
    case 'set-admin': d.members = d.members.map(m => m.uid === body.uid ? { ...m, admin: body.admin } : m); return done();
    case 'join': d.you.hasSeat = true; return done();
    default: throw new Error(`Preview only: “${action}” would open Stripe or the Worker on the real page.`);
  }
}
function gaStartPreview() {
  const pstate = params.get('pstate') || '';
  view.ready = true;
  view.user = { email: 'you@school.edu', getIdToken: async () => 'preview' };
  if (pstate === 'new') { view.plans = []; view.details = null; render(); return; }
  view.details = gaSampleDetails(pstate);
  view.plans = [view.details.plan];
  view.planId = view.details.plan.id;
  render();
}

/* ── Sign-in ──────────────────────────────────────────────────── */
function startGoogleSignIn() {
  if (localStorage.getItem(AGE_TOS_KEY) !== '1') { showAgeGate(() => startGoogleSignIn()); return; }
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  _auth.signInWithPopup(provider).catch(e => {
    if (['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled'].includes(e.code)) return;
    toast(e.code === 'auth/popup-blocked' ? 'Your browser blocked the Google sign-in window. Try again, and allow pop-ups if it asks.' : e.code === 'auth/network-request-failed' ? 'No connection right now. Try again when you’re back online.' : 'Google sign-in didn’t finish. Try again.', 'error', 6000);
  });
}
// The link goes out through the Worker, after a Turnstile check on one
// confirm step (see js/authemail.js for why not Firebase's own email).
function startEmailSignIn() {
  const email = $('#ga-email')?.value.trim();
  if (!email) { toast('Enter your email to continue', 'error'); return; }
  if (localStorage.getItem(AGE_TOS_KEY) !== '1') { showAgeGate(() => startEmailSignIn()); return; }
  if (!TURNSTILE_SITEKEY) { sendEmailSignIn(email); return; }
  $('#ga-signin').innerHTML = `
    <p class="small mb-8">We’ll email a sign-in link to <strong>${esc(email)}</strong>.</p>
    <div data-turnstile style="margin-bottom:10px"></div>
    <button class="btn btn-primary" style="width:100%" id="ga-email-send">Send</button>
    <button class="btn btn-sm mt-8" style="width:100%" id="ga-email-back">Back</button>`;
  $('#ga-email-send').onclick = () => sendEmailSignIn(email);
  $('#ga-email-back').onclick = () => { render(); const i = $('#ga-email'); if (i) i.value = email; };
  mountTurnstile();
}
async function sendEmailSignIn(email) {
  if (TURNSTILE_SITEKEY && !turnstileToken()) { toast('Finish the verification box first, then tap Send.', 'error'); return; }
  const send = $('#ga-email-send');
  if (send) { send.disabled = true; send.textContent = 'Sending…'; }
  const result = await requestAuthEmail(_auth, 'signin', email, window.location.href);
  if (result.ok) {
    $('#ga-signin').innerHTML = `<div class="login-sent"><strong>Check your inbox.</strong>We sent a sign-in link to ${esc(email)}. Open it on this device to finish. Not there in a minute? Check Spam.</div>`;
    return;
  }
  if (send) { send.disabled = false; send.textContent = 'Send'; }
  toast(result.error, 'error', 6000);
}
function showAgeGate(resume) {
  openModal(`
    <div class="modal-head"><h3>Before you continue</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <label class="checkbox-row" style="align-items:flex-start;gap:10px">
        <input type="checkbox" id="ga-age-check" style="margin-top:2px;width:18px;height:18px;flex-shrink:0">
        <span class="small">I'm at least 13 years old, and I agree to Semester HQ's <a href="https://semester-hq.com/terms.html" target="_blank" rel="noopener">Terms of Service</a> and <a href="https://semester-hq.com/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.</span>
      </label>
    </div>
    <div class="modal-foot"><button class="btn btn-primary" onclick="confirmAgeGate()">Continue</button></div>
  `);
  window._ageResume = resume;
}
function confirmAgeGate() {
  if (!$('#ga-age-check')?.checked) { toast('Check the box to continue', 'error'); return; }
  localStorage.setItem(AGE_TOS_KEY, '1');
  closeModal();
  const resume = window._ageResume;
  window._ageResume = null;
  if (resume) resume();
}
async function completeEmailLink() {
  if (!_auth.isSignInWithEmailLink(window.location.href)) return;
  const email = localStorage.getItem(EMAIL_LINK_STORAGE_KEY) || window.prompt('Confirm the email you used to request this link:');
  if (!email) return;
  try {
    await _auth.signInWithEmailLink(email, window.location.href);
    localStorage.removeItem(EMAIL_LINK_STORAGE_KEY);
    history.replaceState({}, '', location.pathname + (params.toString() ? `?${params}` : ''));
  } catch (e) { diag.warn('group-admin', 'Sign-in link failed', e); toast('That sign-in link is invalid or expired.', 'error', 6000); }
}
function signOutOfAdmin() { if (gaPreview) { location.href = location.pathname; return; } _auth.signOut(); }

(async function init() {
  if (gaPreview) { gaStartPreview(); return; }
  if (!FB_CONFIG.apiKey || typeof firebase === 'undefined') {
    $('#ga-root').innerHTML = card('<div class="ga-empty">Sign-in isn’t available right now. Try again in a moment.</div>');
    return;
  }
  firebase.initializeApp(FB_CONFIG);
  _auth = firebase.auth();
  await completeEmailLink();
  _auth.onAuthStateChanged(async (user) => {
    view.user = user;
    view.ready = true;
    if (!user) { view.plans = []; view.details = null; view.planId = ''; render(); return; }
    try { await loadMine(); }
    catch (e) { toast(e.message || 'Could not load your plans', 'error', 6000); }
    render();
    // Straight back from Stripe: wait for the plan to come alive.
    if (params.get('checkout') === 'success' && (!view.details || view.details.plan.status === 'pending')) waitForActivation();
  });
})();
