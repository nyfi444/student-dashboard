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
    // Settings and a club's Officer home both show what this returns.
    .then(data => { window._groupMine = data; if (typeof render === 'function' && (state.route === 'settings' || state.route === 'orgs')) render(); })
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
      afterGroupSeatGone(result.paid);
      toast(result.paid ? 'You left the group plan. Your own subscription still covers you.' : 'You left the group plan.', 'success', 5000);
      render();
    } catch (e) { toast(e.message || 'Could not leave that plan', 'error', 5000); }
  }, 'Leave plan');
}

// This account no longer has a group seat: covered only by its own subscription, if any.
function afterGroupSeatGone(paid) {
  window._licensed = !!paid;
  if (!paid) { try { localStorage.removeItem(LICENSE_DEVICE_FLAG); } catch {} }
  if (window._licenseDoc) { window._licenseDoc.groupPaid = false; window._licenseDoc.groupName = ''; window._licenseDoc.groupPlanId = ''; }
  window._groupMine = null;
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
// An officer who doesn't run the plan still sees it (viewOnly), from the
// club's seats (orgSeats below), so nobody starts a second plan by mistake.
function orgGroupPlan(o) {
  if (!o || o.local || !_fbUser || !checkoutEnabled()) return null;
  ensureGroupMine();
  const mine = (window._groupMine?.plans || []).find(p => p.orgCode && p.orgCode === o.code);
  if (mine) return mine;
  const seats = orgSeats(o);
  return seats?.plan ? { ...seats.plan, viewOnly: true } : null;
}

/* ── Seats, seen from the club ──────────────────────────────────
   Which members hold one of the plan's seats, for any officer (the
   Worker's org-seats). Fetched once per club per app open, and again
   after anyone leaves or is removed. When someone leaves or an officer
   removes them, their seat goes back to the plan by itself
   (release-org-seat), so the next member can take it at no extra cost. */
const _orgSeatCache = {};
function orgSeats(o) {
  if (!o || o.local || !_fbUser || !checkoutEnabled() || !isOrgOfficer(o)) return null;
  const c = _orgSeatCache[o.code];
  if (c) return c.data || null;
  _orgSeatCache[o.code] = { loading: true };
  groupApi('org-seats', { orgCode: o.code })
    .then(data => { _orgSeatCache[o.code] = { data }; })
    .catch(e => { _orgSeatCache[o.code] = { data: null }; diag.warn('clubs', 'Could not load club seats', e); })
    .finally(() => { if (state.route === 'orgs') render(); });
  return null;
}
// What the Members tab needs: only for a plan that's running.
function orgSeatInfo(o) {
  const s = orgSeats(o);
  if (!s?.plan || !(s.plan.status === 'active' || s.plan.status === 'past_due')) return null;
  return { plan: s.plan, has: new Set(s.seatUids || []), outside: s.outside || [], canManage: !!s.canManage };
}
function forgetOrgSeats(code) { delete _orgSeatCache[code]; window._groupMine = null; }
// After someone leaves a club (themselves) or is removed (by an officer).
// Best effort: if it fails, the seat shows under "Holding a seat, not in
// the club" on the Members tab for a plan admin to free.
async function releaseOrgSeat(code, uid) {
  if (!_fbUser || !checkoutEnabled() || !safeId(uid)) return;
  try {
    const result = await groupApi('release-org-seat', { orgCode: code, uid });
    if (!result.released) return;
    forgetOrgSeats(code);
    if (uid === _fbUser.uid) afterGroupSeatGone(result.paid);
    if (state.route === 'orgs' || state.route === 'settings') render();
  } catch (e) { diag.warn('clubs', 'Could not free a seat', e); }
}
function freeOrgSeat(btn, code, planId, uid) {
  const name = (_orgSeatCache[code]?.data?.outside || []).find(m => m.uid === uid)?.name || 'this person';
  confirmDialog(`Free ${name}’s seat? They lose Semester HQ Plus through the plan unless they pay themselves, and the seat opens for a member.`, async () => {
    try {
      await groupApi('remove-member', { planId, uid });
      forgetOrgSeats(code);
      toast('Seat freed', 'success');
      render();
    } catch (e) { toast(e.message || 'Couldn’t free that seat', 'error', 5000); }
  }, 'Free seat');
}
// One tap from the club when every seat is taken (plan admins). Seats go
// up easily; removing them is on the plan page, for the person paying.
function addPlanSeat(btn, code, planId) {
  const p = (window._groupMine?.plans || []).find(x => x.id === planId) || _orgSeatCache[code]?.data?.plan;
  if (!p) return;
  const next = (p.seats || 0) + 1;
  if (next > ORG_PLAN_MAX_SEATS) {
    confirmDialog(`Plans over ${ORG_PLAN_MAX_SEATS} seats are put together with you, so the rate fits your group. Ask for a quote?`, () => window.open(GROUP_PRICING_URL, '_blank', 'noopener'), 'Ask for a quote');
    return;
  }
  const monthly = `$${(next * orgPlanSeatCents() / 100).toFixed(2)}`;
  const free = next <= (p.paidSeats || 0);
  confirmDialog(`Add a seat? The plan becomes ${next} seats, ${monthly} a month. ${free ? 'That seat was already paid for this month, so there’s nothing extra until the next bill.' : 'The rest of this month’s share goes on the plan’s next bill.'}`, async () => {
    try {
      await groupApi('seats', { planId, seats: next });
      forgetOrgSeats(code);
      toast('Seat added. A member can take it now.', 'success');
      render();
    } catch (e) { toast(e.message || 'Couldn’t add a seat', 'error', 5000); }
  }, 'Add a seat');
}
async function startPlanCard(btn, planId) {
  setBtnLoading(btn, true);
  try { location.href = (await groupApi('card-checkout', { planId })).url; }
  catch (e) { setBtnLoading(btn, false); toast(e.message || 'Couldn’t open Stripe', 'error', 5000); }
}
// A handoff in progress, as the club's Officer home shows it.
function orgPlanHandoffHtml(plan) {
  const h = plan.handoff;
  const me = _fbUser?.uid;
  if (!h || !me) return '';
  if (h.to === me) return `<div class="sg-callout small mb-8"><span>${icon('user-plus', 14)}</span><div style="flex:1"><span class="sg-strong">${esc(h.fromName || 'The last admin')} handed this plan to you.</span> It’s still on their card. Put it on yours and receipts come to you; members won’t notice a thing.</div>${plan.viewOnly ? '' : `<button class="btn btn-primary btn-sm" onclick="startPlanCard(this,'${esc(plan.id)}')">Put it on my card</button>`}</div>`;
  if (h.from === me) return `<div class="sg-callout small mb-8"><span>${icon('clock', 14)}</span><div>Waiting on ${esc(h.toName || 'the new admin')} to put the plan on their card. It stays on yours until then.</div></div>`;
  return `<p class="small muted mb-8">${esc(h.toName || 'A new admin')} is taking the plan over and still needs to put it on their card.</p>`;
}
/* The club Admin tab's plan section: what's paid for, how many seats are
   used, the one link members join with, and a way into the plan's own admin
   page. Officers who haven't started a plan get the pitch and the price. */
// Self-serve plans run 5 to 50 seats (the same limits as group-admin.html).
const ORG_PLAN_MIN_SEATS = 5;
const ORG_PLAN_MAX_SEATS = 50;
function orgPlanSeatCents() { return Math.round(parseFloat(String(GROUP_SEAT_PRICE).replace(/[^0-9.]/g, '')) * 100) || 0; }
// "11 members · $65.89 a month · one bill", in the officer's own numbers.
function orgPlanMath(o) {
  const count = o.memberUids?.length || 0;
  if (count > ORG_PLAN_MAX_SEATS) return { big: true, line: `Larger than ${ORG_PLAN_MAX_SEATS}? We’ll set it up with you` };
  const seats = Math.max(ORG_PLAN_MIN_SEATS, count);
  const total = (seats * orgPlanSeatCents() / 100).toFixed(2);
  return { big: false, seats, line: `${seats} ${count < ORG_PLAN_MIN_SEATS ? 'seats' : 'members'} · $${total} a month · one bill` };
}
// The pitch, for a sample and for any club without a plan. It sits right
// under the four numbers on Officer home, full width.
function orgPlanPitch(o, { actionsHtml, note }) {
  const kindWord = o.kind === 'team' ? 'team' : o.kind === 'chapter' ? 'chapter' : 'club';
  const m = orgPlanMath(o);
  const perks = [['calendar', 'Everyone’s calendar in one place'], ['check-square', 'RSVPs you can see'], ['link', 'One link to join']];
  return `<section class="card card-pad org-plan-pitch" aria-labelledby="org-plan-pitch-h">
    <div class="org-plan-pitch-main">
      <h3 class="sg-h3" id="org-plan-pitch-h">${icon('shield', 14, 1.8)} Cover your whole ${esc(kindWord)}</h3>
      <p class="org-plan-math">${esc(m.line)}</p>
      <ul class="org-plan-perks">${perks.map(([ic, t]) => `<li>${icon(ic, 14)}<span>${t}</span></li>`).join('')}</ul>
    </div>
    <div class="org-plan-pitch-act">
      <div class="flex-gap wrap">${actionsHtml(m)}</div>
      <p class="small muted">${note(m)}</p>
    </div>
  </section>`;
}
function orgPlanAdminNames(plan) {
  const names = (plan.admins || []).map(a => a.name).filter(Boolean);
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(' and ') || 'Its admins';
}
function orgPlanAdminCard(o, plan) {
  const kindWord = o.kind === 'team' ? 'team' : o.kind === 'chapter' ? 'chapter' : 'club';
  const perSeat = `${GROUP_SEAT_PRICE} per member each month`;
  // A sample club is made up, so it only ever explains the plan. It never
  // links to a checkout prefilled with a club that doesn't exist.
  if (o.sample) {
    return orgPlanPitch(o, {
      actionsHtml: () => `<a class="btn btn-primary btn-sm" href="${GROUP_PRICING_URL}" target="_blank" rel="noopener">How group pricing works</a>`,
      note: (m) => m.big ? `Plans past ${ORG_PLAN_MAX_SEATS} seats are put together with you.` : `In your own ${esc(kindWord)}: ${perSeat}, paid from your budget or dues.`,
    });
  }
  if (!checkoutEnabled()) return '';
  if (!_fbUser) {
    return orgPlanPitch(o, {
      actionsHtml: () => `<a class="btn btn-primary btn-sm" href="login.html">Log in to set it up</a>`,
      note: (m) => m.big ? `Plans past ${ORG_PLAN_MAX_SEATS} seats are put together with you.` : `${perSeat}, paid from your budget or dues.`,
    });
  }
  if (window._groupMineLoading && !window._groupMine) {
    return `<div class="card card-pad"><h3 class="sg-h3 mb-8">${icon('shield', 14, 1.8)} Covering your members</h3><p class="small muted">Checking for a group plan…</p></div>`;
  }
  if (!plan) {
    return orgPlanPitch(o, {
      actionsHtml: (m) => m.big
        ? `<a class="btn btn-primary btn-sm" href="${GROUP_PRICING_URL}" target="_blank" rel="noopener">Ask for a quote</a>`
        : `<a class="btn btn-primary btn-sm" href="${orgGroupPlanUrl(o)}">${icon('shield', 13, 1.8)} Start a plan for ${esc(o.name)}</a><a class="btn btn-sm" href="${GROUP_PRICING_URL}" target="_blank" rel="noopener">How it works</a>`,
      note: (m) => m.big ? `Tell us your size and we’ll send a rate that fits.` : `${perSeat}, paid from your budget or dues. Members claim their own seat.`,
    });
  }
  const live = plan.status === 'active' || plan.status === 'past_due';
  const statusLine = plan.status === 'active' ? `${plan.memberCount} of ${plan.seats} seats claimed`
    : plan.status === 'past_due' ? 'A payment didn’t go through. Members still have access for now.'
    : plan.status === 'pending' ? 'Not finished: the checkout was never completed.'
    : 'Canceled.';
  return `<div class="card card-pad">
    <h3 class="sg-h3 mb-8">${icon('shield', 14, 1.8)} ${esc(plan.name || o.name)} group plan</h3>
    ${plan.status === 'active' ? `<div class="org-plan-seats mb-8">
      <span class="org-plan-ring" style="--p:${plan.seats ? Math.min(100, Math.round((plan.memberCount / plan.seats) * 100)) : 0}" role="img" aria-label="${plan.memberCount} of ${plan.seats} seats claimed"><strong>${plan.memberCount}</strong></span>
      <div class="small muted">${esc(statusLine)}. Covering your members’ Semester HQ.${plan.cancelAtPeriodEnd ? ' Ends at the close of this billing period.' : ''}</div>
    </div>` : `<div class="small muted mb-8">${esc(statusLine)}${plan.cancelAtPeriodEnd ? ' Ends at the close of this billing period.' : ''}</div>`}
    ${live && plan.inviteUrl ? `<div class="field"><label for="oa-plan-link">Link members use to claim a seat</label>
      <div class="sg-invite-row"><input class="input" id="oa-plan-link" value="${esc(plan.inviteUrl)}" readonly onclick="this.select()"><button class="btn btn-primary" onclick="copyText('${esc(plan.inviteUrl)}','Seat link copied')">${icon('copy', 13, 1.8)} Copy</button></div>
      <div class="small muted mt-8">Anyone in the ${esc(kindWord)} who opens it and signs in is covered. Members can also join with the ${esc(o.name)} code.</div>
    </div>` : ''}
    ${live ? `<p class="small muted mb-8">Someone leaves the ${esc(kindWord)}? Their seat opens up for the next person on its own. Swapping people never changes the bill; only adding seats does.</p>` : ''}
    ${orgPlanHandoffHtml(plan)}
    ${live && plan.memberCount >= plan.seats ? `<p class="small sg-strong mb-8">Every seat is taken.${plan.viewOnly ? ` Ask ${esc(orgPlanAdminNames(plan))} to add one.` : ''}</p>` : ''}
    ${plan.viewOnly
      ? `<p class="small muted">${esc(orgPlanAdminNames(plan))} ${(plan.admins || []).length === 1 ? 'runs' : 'run'} the plan’s billing and seats. See who has a seat on the Members tab.</p>`
      : `<div class="flex-gap wrap">
      ${live && plan.memberCount >= plan.seats ? `<button class="btn btn-primary btn-sm" onclick="addPlanSeat(this,'${esc(o.code)}','${esc(plan.id)}')">${icon('plus', 13, 1.8)} Add a seat</button>` : ''}
      <a class="btn btn-primary btn-sm" href="${GROUP_ADMIN_PAGE}?plan=${encodeURIComponent(plan.id)}">${icon('settings', 13, 1.8)} Seats, billing and members</a>
      ${plan.status === 'pending' ? `<a class="btn btn-sm" href="${GROUP_ADMIN_PAGE}?plan=${encodeURIComponent(plan.id)}">Finish setting it up</a>` : ''}
    </div>`}
  </div>`;
}
