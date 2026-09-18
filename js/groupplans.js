/* ── Group plans, member side ──────────────────────────────────────
   A club, team, or department can cover Semester HQ for its members
   ($5.99 per member per month, bought and run from group-admin.html).
   This is what a member sees: an invite link (app.semester-hq.com/?plan=CODE)
   is remembered until they're signed in, then their seat is claimed and the
   app unlocks the same way a subscription would. Settings says where their
   plan comes from, and links to the admin page for anyone who runs one.
   Everything here asks the Worker; the app can't grant itself a plan.
──────────────────────────────────────────────────────────────── */
const PENDING_PLAN_KEY = 'shq_pending_plan';
const GROUP_ADMIN_PAGE = 'group-admin.html';
const GROUP_SEAT_PRICE = '$5.99';

function capturePlanParam() {
  const params = new URLSearchParams(location.search);
  const code = (params.get('plan') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!params.has('plan')) return;
  params.delete('plan');
  history.replaceState({}, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash);
  if (code.length === 8 && !isEmbedded()) try { localStorage.setItem(PENDING_PLAN_KEY, JSON.stringify({ code, at: Date.now() })); } catch {}
}
function pendingPlanCode() {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_PLAN_KEY) || 'null');
    return p?.code && Date.now() - p.at < 14 * 86400000 ? p.code : null;
  } catch { return null; }
}
function clearPendingPlan() {
  try { localStorage.removeItem(PENDING_PLAN_KEY); } catch {}
  window._planInvite = null;
}

async function workerPost(path, body) {
  const res = await fetch(`${CHECKOUT_PROXY_URL}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || 'Something went wrong. Try again in a moment.');
    error.reason = data.reason;
    error.status = res.status;
    throw error;
  }
  return data;
}
async function groupApi(action, body = {}) {
  if (!_fbUser) throw new Error('Sign in first.');
  return workerPost(`/group/${action}`, { ...body, idToken: await _fbUser.getIdToken() });
}

/* ── Claiming a seat ──────────────────────────────────────────── */
// Runs as part of the license check (see resolveLicenseStatus), so someone
// who follows an invite link and signs in is simply in.
async function claimGroupSeat({ announce = true } = {}) {
  const code = pendingPlanCode();
  const orgCode = code ? null : (typeof pendingOrgCode === 'function' ? pendingOrgCode() : null);
  if ((!code && !orgCode) || !_fbUser || !checkoutEnabled()) return null;
  try {
    const result = await groupApi('join', code ? { code } : { orgCode });
    clearPendingPlan();
    try { localStorage.setItem(LICENSE_DEVICE_FLAG, '1'); } catch {}
    if (announce) {
      toast(`You’re in. ${result.name} covers your Semester HQ.`, 'success', 5000);
      if (result.individualPaid) setTimeout(() => openDoubleBillingModal(result.name), 900);
    }
    return result;
  } catch (e) {
    // A link that's no longer good is forgotten rather than retried forever.
    if (e.status === 404 || e.status === 403 || e.reason === 'full') clearPendingPlan();
    if (announce && code) toast(e.message, 'error', 6000);
    return null;
  }
}
// Someone who already pays for themselves shouldn't quietly pay twice.
function openDoubleBillingModal(groupName) {
  openModal(`
    <div class="modal-head"><h3>You’re covered twice</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <p class="small">${esc(groupName)} now covers your Semester HQ, and you still have your own $7.99/month subscription.</p>
      <p class="small muted mt-8">Cancel your own subscription so you’re not paying for both. You keep everything: your plan stays active through ${esc(groupName)}.</p>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Later</button>
      <button class="btn btn-primary" onclick="closeModal();redirectToPortal()">Cancel my subscription</button>
    </div>
  `);
}
// What an invite link is for, so the sign-in screen can name the group.
async function loadPlanInvite() {
  const code = pendingPlanCode();
  const orgCode = code ? null : (typeof pendingOrgCode === 'function' ? pendingOrgCode() : null);
  if ((!code && !orgCode) || !checkoutEnabled()) return;
  const key = code || `org:${orgCode}`;
  if (window._planInvite?.key === key) return;
  window._planInvite = { key, loading: true };
  try {
    const info = await workerPost('/group/join-info', code ? { code } : { orgCode });
    window._planInvite = { key, ...info };
  } catch (e) {
    window._planInvite = { key, error: e.message, missing: true };
  }
  if (typeof render === 'function') render();
}
// The card at the top of the paywall when someone arrives on an invite.
function planInviteCard() {
  const invite = window._planInvite;
  if (!invite || invite.loading || invite.missing || !invite.active) return '';
  const full = invite.seatsLeft <= 0;
  return `
    <div class="sg-callout small mb-16" style="text-align:left">
      <span>${icon('users', 15, 1.8)}</span>
      <div>
        <span class="sg-strong">${esc(invite.name)} covers Semester HQ for its members.</span>
        <div class="muted">${full ? 'Every seat is taken right now. Ask whoever runs the plan to add one.' : 'Claim your seat and everything unlocks, with nothing to pay.'}</div>
        ${full ? '' : `<button class="btn btn-primary btn-sm mt-8" onclick="claimSeatFromPaywall(this)">Claim my seat</button>`}
      </div>
    </div>`;
}
async function claimSeatFromPaywall(btn) {
  setBtnLoading(btn, true);
  const result = await claimGroupSeat();
  if (!result) { setBtnLoading(btn, false); return; }
  window._licensed = true;
  window._licenseChecked = true;
  if (typeof enablePersistentStorage === 'function') enablePersistentStorage();
  await cloudPull();
  render();
}

/* ── Settings: where this plan comes from ─────────────────────── */
// Loaded once per app open, only for a signed-in account, since it's a
// network call and most people don't run a group plan.
function ensureGroupMine() {
  if (!_fbUser || !checkoutEnabled() || window._groupMine || window._groupMineLoading) return;
  window._groupMineLoading = true;
  groupApi('mine')
    .then(data => { window._groupMine = data; if (typeof render === 'function' && state.route === 'settings') render(); })
    .catch(() => { window._groupMine = { plans: [], seat: null, error: true }; })
    .finally(() => { window._groupMineLoading = false; });
}
function groupPlanSettingsHtml() {
  if (!_fbUser || !checkoutEnabled()) return '';
  ensureGroupMine();
  const license = window._licenseDoc || {};
  const mine = window._groupMine || {};
  const seat = license.groupPaid ? { name: license.groupName || 'your group' } : mine.seat?.active ? mine.seat : null;
  const plans = mine.plans || [];
  return `
    <div class="mt-16" style="border-top:1px solid var(--border);padding-top:14px">
      <div class="small sg-strong mb-8">Plan</div>
      ${seat
        ? `<p class="small muted">Covered by <strong>${esc(seat.name)}</strong>’s group plan, so you’re not billed for Semester HQ.</p>
           <button class="btn btn-sm mt-8" onclick="confirmLeaveGroupPlan('${esc(seat.name)}')">Leave this group plan</button>`
        : `<p class="small muted">Semester HQ Plus, $7.99/month on this account.</p>`}
      ${plans.length ? `
        <div class="small sg-strong mt-16 mb-8">Group plans you run</div>
        ${plans.map(p => `
          <div class="list-row">
            <div class="row-title">${esc(p.name)}</div>
            <div class="row-meta">${p.status === 'active' ? `${p.memberCount} of ${p.seats} seats` : p.status === 'pending' ? 'Not finished' : p.status === 'past_due' ? 'Payment problem' : 'Canceled'}</div>
            <a class="btn btn-sm" href="${GROUP_ADMIN_PAGE}?plan=${encodeURIComponent(p.id)}">Manage</a>
          </div>`).join('')}`
        : `<p class="small muted mt-8">Covering Semester HQ for a club, team, or class? <a href="${GROUP_ADMIN_PAGE}">Start a group plan</a> at ${GROUP_SEAT_PRICE} per member each month.</p>`}
    </div>`;
}
function confirmLeaveGroupPlan(name) {
  confirmDialog(`Leave ${name}’s group plan? You’ll lose Semester HQ Plus on this account unless you subscribe yourself. Your planner stays on this device either way.`, async () => {
    try {
      const result = await groupApi('leave');
      window._licensed = !!result.paid;
      if (!result.paid) { try { localStorage.removeItem(LICENSE_DEVICE_FLAG); } catch {} }
      if (window._licenseDoc) { window._licenseDoc.groupPaid = false; window._licenseDoc.groupName = ''; }
      window._groupMine = null;
      toast(result.paid ? 'You left the group plan. Your own subscription still covers you.' : 'You left the group plan.', 'success', 5000);
      render();
    } catch (e) { toast(e.message || 'Could not leave that plan', 'error', 5000); }
  }, 'Leave plan');
}

/* ── Clubs & Teams: an officer covering their members ─────────── */
function orgGroupPlanUrl(o) {
  const params = new URLSearchParams({ new: '1', name: o.name || '', kind: ORG_PLAN_KINDS[o.kind] || 'club' });
  if (!o.local && o.code) params.set('org', o.code);
  return `${GROUP_ADMIN_PAGE}?${params}`;
}
const ORG_PLAN_KINDS = { club: 'club', team: 'team', chapter: 'chapter', org: 'club' };

// The group plan (if any) that this club's officer set up for it. Plans carry
// the club's code, so a club page can show its own plan rather than making an
// officer go hunting through Settings for it.
function orgGroupPlan(o) {
  if (!o || o.local || !_fbUser || !checkoutEnabled()) return null;
  ensureGroupMine();
  return (window._groupMine?.plans || []).find(p => p.orgCode && p.orgCode === o.code) || null;
}
/* The club Admin tab's plan section: what's paid for, how many seats are
   used, the one link members join with, and a way into the plan's own admin
   page. Officers who haven't started a plan get the pitch and the price. */
function orgPlanAdminCard(o, plan) {
  if (!checkoutEnabled()) return '';
  const kindWord = o.kind === 'team' ? 'team' : o.kind === 'chapter' ? 'chapter' : 'club';
  if (!_fbUser) {
    return `<div class="card card-pad">
      <h3 class="sg-h3 mb-8">${icon('shield', 14, 1.8)} Covering your members</h3>
      <p class="small muted">A group plan covers every member's Semester HQ for ${GROUP_SEAT_PRICE} each a month, paid from your budget or dues. <a href="login.html">Log in</a> to set one up.</p>
    </div>`;
  }
  if (window._groupMineLoading && !window._groupMine) {
    return `<div class="card card-pad"><h3 class="sg-h3 mb-8">${icon('shield', 14, 1.8)} Covering your members</h3><p class="small muted">Checking for a group plan…</p></div>`;
  }
  if (!plan) {
    return `<div class="card card-pad">
      <h3 class="sg-h3 mb-8">${icon('shield', 14, 1.8)} Covering your members</h3>
      <p class="small muted mb-8">Every member needs Semester HQ for your events and files to reach them. A group plan pays for all of them at ${GROUP_SEAT_PRICE} per member each month, in one bill you can put through your budget or dues, and members claim their own seat from a single link.</p>
      <div class="flex-gap wrap">
        <a class="btn btn-primary btn-sm" href="${orgGroupPlanUrl(o)}">${icon('shield', 13, 1.8)} Start a plan for ${esc(o.name)}</a>
        <a class="btn btn-sm" href="${GROUP_PRICING_URL}" target="_blank" rel="noopener">How group pricing works</a>
      </div>
    </div>`;
  }
  const live = plan.status === 'active' || plan.status === 'past_due';
  const statusLine = plan.status === 'active' ? `${plan.memberCount} of ${plan.seats} seats claimed`
    : plan.status === 'past_due' ? 'A payment didn’t go through. Members still have access for now.'
    : plan.status === 'pending' ? 'Not finished: the checkout was never completed.'
    : 'Canceled.';
  return `<div class="card card-pad">
    <h3 class="sg-h3 mb-8">${icon('shield', 14, 1.8)} ${esc(plan.name || o.name)} group plan</h3>
    <div class="small muted mb-8">${esc(statusLine)}${plan.cancelAtPeriodEnd ? ' Ends at the close of this billing period.' : ''}</div>
    ${plan.status === 'active' ? `<div class="progress mb-8"><div style="width:${plan.seats ? Math.min(100, Math.round((plan.memberCount / plan.seats) * 100)) : 0}%"></div></div>` : ''}
    ${live && plan.inviteUrl ? `<div class="field"><label for="oa-plan-link">Link members use to claim a seat</label>
      <div class="sg-invite-row"><input class="input" id="oa-plan-link" value="${esc(plan.inviteUrl)}" readonly onclick="this.select()"><button class="btn btn-primary" onclick="copyText('${esc(plan.inviteUrl)}','Seat link copied')">${icon('copy', 13, 1.8)} Copy</button></div>
      <div class="small muted mt-8">Anyone in the ${esc(kindWord)} who opens it and signs in is covered. Members can also join with the ${esc(o.name)} code.</div>
    </div>` : ''}
    <div class="flex-gap wrap">
      <a class="btn btn-primary btn-sm" href="${GROUP_ADMIN_PAGE}?plan=${encodeURIComponent(plan.id)}">${icon('settings', 13, 1.8)} Seats, billing and members</a>
      ${plan.status === 'pending' ? `<a class="btn btn-sm" href="${GROUP_ADMIN_PAGE}?plan=${encodeURIComponent(plan.id)}">Finish setting it up</a>` : ''}
    </div>
  </div>`;
}
