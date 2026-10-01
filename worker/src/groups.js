/* ── worker/src/groups.js ───────────────────────────────────────
   Group plans (/group/*): seats, invites, admins and the group's own
   Stripe subscription. Job 9 in index.js.
──────────────────────────────────────────────────────────────── */

import { checkoutSourceFor, cleanVia } from './checkouts.js';
import { logServerIssue } from './diagnostics.js';
import { batchGetFirestoreDocs, commitFirestore, deleteFirestoreDoc, listFirestoreCollection, parseJsonField, patchFirestoreDoc, readFirestoreDoc, readFirestoreDocWithTime, runFirestoreQuery, verifyFirebaseIdToken } from './firebase.js';
import { jsonError, jsonOk, verifiedEmailOf } from './http.js';
import { individualPaidOf } from './licensing.js';
import { startCustomerEmails } from './onboarding.js';
import { createStripePortalSession, stripeRequest } from './stripe.js';

const GROUP_SEAT_PRICE_CENTS = 599; // $5.99 per member per month, same note as above
const GROUP_MIN_SEATS = 5;
// Self-serve ceiling, enforced here because the client can't be trusted with
// it. Bigger groups, invoices, POs, and departments go through the quote form
// on the marketing site (see js/group-admin.js for the reasoning).
const GROUP_MAX_SEATS = 50;
const GROUP_KINDS = ['club', 'team', 'chapter', 'class', 'department', 'other'];

/* ── 9. Group plans ───────────────────────────────────────────────
   A club, team, chapter, class, or department buys seats for its members
   ($5.99 each per month, 5 or more) and runs them from group-admin.html.
   Stripe bills the plan's buyer for the seat count; members join with the
   plan's invite link (app.semester-hq.com/?plan=CODE) and get Plus through
   the group without paying themselves. Only this Worker writes any of it:
   - groupPlans/{planId}: name, kind, status, seats, memberCount, adminUids,
     adminsJson, inviteCode, orgCode (a linked club), Stripe ids
   - groupPlans/{planId}/members/{uid}: who holds a seat
   - groupInvites/{code}: invite code → planId
   A member's licenses/{uid} gets groupPlanId, groupName, and groupPaid next
   to individualPaid (their own subscription), and paid is true when either
   is, so the app's license check reads the same field as always. A plan
   keeps access while Stripe retries a failed payment (past_due), so one
   declined card doesn't lock out a whole team; it loses access once the
   subscription is canceled or Stripe stops retrying. */
const GROUP_INVITE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
function groupStatusFromStripe(status) {
  if (status === 'active' || status === 'trialing') return 'active';
  if (status === 'past_due') return 'past_due';
  if (status === 'incomplete') return 'pending';
  return 'canceled';
}
export function groupHasAccess(status) { return status === 'active' || status === 'past_due'; }
export function groupAdmins(plan) { const list = parseJsonField(plan.adminsJson, []); return Array.isArray(list) ? list : []; }
function groupAdminUrl(env, planId) { return new URL(`group-admin.html?plan=${encodeURIComponent(planId)}`, env.APP_URL).toString(); }
function cleanGroupText(value, max) { return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
function randomToken(length, chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') {
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), b => chars[b % chars.length]).join('');
}
function groupPlanSummary(env, plan) {
  const live = groupHasAccess(plan.status);
  return {
    id: plan.id, name: plan.name || '', kind: plan.kind || 'club', status: plan.status || 'pending',
    seats: plan.seats || 0, requestedSeats: plan.requestedSeats || 0, memberCount: plan.memberCount || 0,
    seatPriceCents: GROUP_SEAT_PRICE_CENTS, minSeats: GROUP_MIN_SEATS, maxSeats: GROUP_MAX_SEATS,
    inviteCode: live ? plan.inviteCode || '' : '',
    inviteUrl: live && plan.inviteCode ? new URL(`?plan=${plan.inviteCode}`, env.APP_URL).toString() : '',
    orgCode: plan.orgCode || '', admins: groupAdmins(plan), billedTo: groupBilledTo(plan), handoff: groupHandoffOf(plan),
    cancelAtPeriodEnd: !!plan.cancelAtPeriodEnd, currentPeriodEnd: plan.currentPeriodEnd || '', createdAt: plan.createdAt || '',
  };
}

// Who the plan is billed to. ownerUid starts as whoever bought it and only
// changes when another admin puts the plan on their own card (card-finish).
function groupBilledTo(plan) {
  const uid = plan.ownerUid || '';
  const admin = groupAdmins(plan).find(a => a.uid === uid);
  return { uid, name: plan.billingName || admin?.name || '', email: plan.billingEmail || admin?.email || '' };
}
// A handoff waiting on the new person's card: { from, fromName, to, toName, stay, at }.
function groupHandoffOf(plan) {
  const h = parseJsonField(plan.handoffJson, null);
  return h && typeof h.to === 'string' && h.to ? h : null;
}

const GROUP_ACTIONS = {
  mine: groupMine, details: groupDetails, 'create-checkout': groupCreateCheckout, seats: groupSetSeats,
  'remove-member': groupRemoveMember, 'set-admin': groupSetAdmin, rename: groupRename, 'reset-invite': groupResetInvite,
  portal: groupPortal, 'delete-pending': groupDeletePending, join: groupJoin, leave: groupLeave,
  'org-seats': groupOrgSeats, 'release-org-seat': groupReleaseOrgSeat, handoff: groupHandoff,
  'card-checkout': groupCardCheckout, 'card-finish': groupCardFinish,
};
export async function handleGroupRoute(action, request, env, origin) {
  try {
    if (!env.FIREBASE_PROJECT_ID || !env.STRIPE_SECRET_KEY || !env.APP_URL) throw new HttpError(500, 'Group plans aren’t set up on this server yet.');
    let body;
    try { body = await request.json(); } catch { throw new HttpError(400, 'Invalid JSON body'); }
    // The one public action: what an invite link is for, shown before sign-in.
    if (action === 'join-info') return jsonOk(await groupJoinInfo(env, body), env, origin);
    const run = GROUP_ACTIONS[action];
    if (!run) throw new HttpError(404, 'Not found');
    if (!body.idToken) throw new HttpError(401, 'Sign in first.');
    let user;
    try { user = await verifyFirebaseIdToken(body.idToken, env.FIREBASE_PROJECT_ID); }
    catch { throw new HttpError(401, 'Your session expired. Sign in again.'); }
    const email = verifiedEmailOf(user);
    const name = cleanGroupText(user.name, 80) || email.split('@')[0] || 'Member';
    return jsonOk(await run(env, { body, uid: user.sub, email, name }), env, origin);
  } catch (e) {
    if (e instanceof HttpError) return jsonError(e.message, e.status, env, origin, e.extra);
    console.error(`group/${action} failed`, e);
    return jsonError('Something went wrong. Try again in a moment.', 500, env, origin);
  }
}

async function loadGroupPlan(env, planId) {
  if (!/^[A-Za-z0-9]{12,40}$/.test(String(planId || ''))) throw new HttpError(404, 'That group plan wasn’t found.');
  const plan = await readFirestoreDoc(env, 'groupPlans', planId);
  if (!plan || plan.status === 'deleted') throw new HttpError(404, 'That group plan wasn’t found.');
  return { ...plan, id: planId };
}
async function loadAdminPlan(env, ctx) {
  const plan = await loadGroupPlan(env, ctx.body.planId);
  if (!(plan.adminUids || []).includes(ctx.uid)) throw new HttpError(403, 'Only this plan’s admins can do that.');
  return plan;
}
export async function groupPlansAdminedBy(env, uid) {
  const plans = await runFirestoreQuery(env, {
    from: [{ collectionId: 'groupPlans' }],
    where: { fieldFilter: { field: { fieldPath: 'adminUids' }, op: 'ARRAY_CONTAINS', value: { stringValue: uid } } },
    limit: 50,
  });
  return plans.filter(p => p.status !== 'deleted');
}
// An invite code (from the link), or a club's code when the plan was started
// for that club, so its members can take a seat from the club invite.
async function findPlanForInvite(env, { code, orgCode }) {
  if (code) {
    const clean = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.length !== 8) return null;
    const invite = await readFirestoreDoc(env, 'groupInvites', clean);
    const plan = invite?.planId ? await readFirestoreDoc(env, 'groupPlans', invite.planId) : null;
    return plan && plan.status !== 'deleted' && plan.inviteCode === clean ? { ...plan, id: invite.planId } : null;
  }
  const plan = await planForOrg(env, orgCode);
  return plan && groupHasAccess(plan.status) ? plan : null;
}
// The plan started for a club: a live one first, then one still in checkout.
async function planForOrg(env, orgCode) {
  if (!/^[A-Za-z0-9]{6}$/.test(String(orgCode || ''))) return null;
  const plans = (await runFirestoreQuery(env, {
    from: [{ collectionId: 'groupPlans' }],
    where: { fieldFilter: { field: { fieldPath: 'orgCode' }, op: 'EQUAL', value: { stringValue: String(orgCode) } } },
    limit: 10,
  })).filter(p => p.status !== 'deleted');
  return plans.find(p => groupHasAccess(p.status)) || plans.find(p => p.status === 'pending') || null;
}

async function groupMine(env, ctx) {
  const [plans, license] = await Promise.all([groupPlansAdminedBy(env, ctx.uid), readFirestoreDoc(env, 'licenses', ctx.uid)]);
  return {
    plans: plans.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(p => groupPlanSummary(env, p)),
    seat: license?.groupPlanId ? { planId: license.groupPlanId, name: license.groupName || '', active: !!license.groupPaid } : null,
    individualPaid: individualPaidOf(license),
  };
}
async function groupDetails(env, ctx) {
  const plan = await loadAdminPlan(env, ctx);
  const members = await listFirestoreCollection(env, `groupPlans/${plan.id}/members`);
  // Keeps the seat count honest if a step ever failed partway.
  if (members.length !== (plan.memberCount || 0)) {
    plan.memberCount = members.length;
    await patchFirestoreDoc(env, `groupPlans/${plan.id}`, { memberCount: members.length });
  }
  const adminUids = plan.adminUids || [];
  return {
    plan: groupPlanSummary(env, plan),
    members: members
      .map(m => ({ uid: m.id, name: m.name || '', email: m.email || '', joinedAt: m.joinedAt || '', admin: adminUids.includes(m.id) }))
      .sort((a, b) => String(a.joinedAt).localeCompare(String(b.joinedAt))),
    you: { uid: ctx.uid, hasSeat: members.some(m => m.id === ctx.uid), billed: (plan.ownerUid || '') === ctx.uid },
  };
}

async function groupCreateCheckout(env, ctx) {
  const { body } = ctx;
  const name = cleanGroupText(body.name, 80);
  if (!name) throw new HttpError(400, 'Give your group a name.');
  const kind = GROUP_KINDS.includes(body.kind) ? body.kind : 'club';
  const seats = Math.round(Number(body.seats));
  if (!(seats >= GROUP_MIN_SEATS && seats <= GROUP_MAX_SEATS)) throw new HttpError(400, `Choose between ${GROUP_MIN_SEATS} and ${GROUP_MAX_SEATS} seats.`);
  // Linking a plan to a club is for that club's officers only.
  let orgCode = '';
  if (body.orgCode) {
    const code = String(body.orgCode);
    const org = /^[A-Za-z0-9]{6}$/.test(code) ? await readFirestoreDoc(env, 'orgs', code) : null;
    if (!org || !(org.officerUids || []).includes(ctx.uid)) throw new HttpError(403, 'Only that club’s officers can start a plan for it.');
    orgCode = code;
  }
  let planId = body.planId ? String(body.planId) : '';
  if (planId) {
    const plan = await loadAdminPlan(env, ctx);
    if (plan.status !== 'pending') throw new HttpError(400, 'This plan is already set up. Change its seats from the plan page instead.');
    await patchFirestoreDoc(env, `groupPlans/${planId}`, { name, kind, requestedSeats: seats, updatedAt: new Date(), ...(orgCode ? { orgCode } : {}) });
  } else {
    const unfinished = (await groupPlansAdminedBy(env, ctx.uid)).filter(p => p.status === 'pending');
    if (unfinished.length >= 3) throw new HttpError(429, 'Finish or delete one of your unfinished plans first.');
    planId = randomToken(20);
    const now = new Date();
    await patchFirestoreDoc(env, `groupPlans/${planId}`, {
      name, kind, orgCode, status: 'pending', seats: 0, requestedSeats: seats, memberCount: 0, inviteCode: '',
      ownerUid: ctx.uid, adminUids: [ctx.uid], adminsJson: JSON.stringify([{ uid: ctx.uid, email: ctx.email, name: ctx.name }]),
      stripeCustomerId: '', stripeSubscriptionId: '', stripeItemId: '', createdAt: now, updatedAt: now,
    });
  }
  const back = groupAdminUrl(env, planId);
  const params = new URLSearchParams();
  params.set('mode', 'subscription');
  params.set('submit_type', 'subscribe');
  params.set('line_items[0][price_data][currency]', 'usd');
  params.set('line_items[0][price_data][unit_amount]', String(GROUP_SEAT_PRICE_CENTS));
  params.set('line_items[0][price_data][recurring][interval]', 'month');
  params.set('line_items[0][price_data][product_data][name]', 'Semester HQ group plan');
  params.set('line_items[0][price_data][product_data][description]', `Semester HQ Plus for each member of ${name}, billed per member each month. Add or remove seats anytime.`);
  params.set('line_items[0][price_data][product_data][images][0]', 'https://semester-hq.com/assets/icon-512.png');
  params.set('line_items[0][quantity]', String(seats));
  params.set('line_items[0][adjustable_quantity][enabled]', 'true');
  params.set('line_items[0][adjustable_quantity][minimum]', String(GROUP_MIN_SEATS));
  params.set('line_items[0][adjustable_quantity][maximum]', String(GROUP_MAX_SEATS));
  params.set('success_url', `${back}&checkout=success`);
  params.set('cancel_url', `${back}&checkout=cancel`);
  params.set('allow_promotion_codes', 'true');
  params.set('client_reference_id', ctx.uid);
  if (ctx.email) params.set('customer_email', ctx.email);
  params.set('metadata[kind]', 'group');
  params.set('metadata[planId]', planId);
  params.set('subscription_data[metadata][kind]', 'group');
  params.set('subscription_data[metadata][planId]', planId);
  params.set('subscription_data[metadata][adminUid]', ctx.uid);
  // Same labels as an individual checkout (see checkouts.js).
  const source = checkoutSourceFor({ group: true });
  params.set('metadata[source]', source);
  params.set('subscription_data[metadata][source]', source);
  const via = cleanVia(body.via);
  if (via) {
    params.set('metadata[via]', via);
    params.set('subscription_data[metadata][via]', via);
  }
  const res = await stripeRequest(env, 'POST', '/v1/checkout/sessions', params);
  if (!res.ok) throw new HttpError(502, 'Could not start checkout: ' + (res.data.error?.message || 'unknown error'));
  return { url: res.data.url, planId };
}
// Webhook: checkout finished, so the plan goes live with the seats bought.
// A plan deleted while its checkout tab was still open comes back, since
// it was paid for.
export async function activateGroupPlan(env, session) {
  const planId = session.metadata?.planId;
  const plan = planId ? await readFirestoreDoc(env, 'groupPlans', planId) : null;
  if (!plan) { await logServerIssue(env, 'group-plans', 'Group checkout for an unknown plan', null, { planId }); return; }
  const sub = session.subscription ? (await stripeRequest(env, 'GET', `/v1/subscriptions/${session.subscription}`)).data : null;
  const item = sub?.items?.data?.[0];
  const status = sub?.status ? groupStatusFromStripe(sub.status) : 'active';
  await patchFirestoreDoc(env, `groupPlans/${planId}`, {
    status, seats: item?.quantity || plan.requestedSeats || GROUP_MIN_SEATS,
    inviteCode: plan.inviteCode || await createGroupInvite(env, planId),
    stripeCustomerId: session.customer || '', stripeSubscriptionId: session.subscription || '', stripeItemId: item?.id || '',
    activatedAt: new Date(), updatedAt: new Date(),
  });
  return { name: plan.name || '', seats: item?.quantity || plan.requestedSeats || GROUP_MIN_SEATS };
}
// Webhook: renewals, seat changes made in Stripe, failed payments, cancellation.
export async function syncGroupPlan(env, sub, deleted) {
  const planId = sub.metadata?.planId;
  const plan = planId ? await readFirestoreDoc(env, 'groupPlans', planId) : null;
  if (!plan) return;
  const status = deleted ? 'canceled' : groupStatusFromStripe(sub.status);
  if (plan.status === 'pending' && status === 'pending') return;
  const item = sub.items?.data?.[0];
  const periodEnd = sub.current_period_end || item?.current_period_end;
  await patchFirestoreDoc(env, `groupPlans/${planId}`, {
    status, seats: item?.quantity ?? plan.seats ?? 0,
    stripeSubscriptionId: sub.id, stripeCustomerId: sub.customer || plan.stripeCustomerId || '', stripeItemId: item?.id || plan.stripeItemId || '',
    cancelAtPeriodEnd: !!sub.cancel_at_period_end, currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : '', updatedAt: new Date(),
    ...(groupHasAccess(status) && !plan.inviteCode ? { inviteCode: await createGroupInvite(env, planId) } : {}),
  });
  if (groupHasAccess(plan.status) !== groupHasAccess(status)) await setGroupMembersAccess(env, { ...plan, id: planId }, groupHasAccess(status));
}
async function createGroupInvite(env, planId) {
  for (let i = 0; i < 6; i++) {
    const code = randomToken(8, GROUP_INVITE_CHARS);
    if (await commitFirestore(env, [{ path: `groupInvites/${code}`, fields: { planId, createdAt: new Date() }, exists: false }])) return code;
  }
  throw new Error('Could not create an invite code');
}

async function groupJoinInfo(env, body) {
  const plan = await findPlanForInvite(env, body);
  if (!plan) throw new HttpError(404, 'That invite link isn’t valid anymore. Ask your group’s admin for a new one.');
  return { name: plan.name || '', kind: plan.kind || 'club', active: groupHasAccess(plan.status), seatsLeft: Math.max(0, (plan.seats || 0) - (plan.memberCount || 0)) };
}
async function groupJoin(env, ctx) {
  // An admin taking a seat on their own plan doesn't need the invite.
  const plan = ctx.body.planId ? await loadAdminPlan(env, ctx) : await findPlanForInvite(env, ctx.body);
  if (!plan) throw new HttpError(404, 'That invite link isn’t valid anymore. Ask your group’s admin for a new one.');
  if (!groupHasAccess(plan.status)) throw new HttpError(403, `${plan.name}’s group plan isn’t active right now. Ask the person who runs it.`);
  const license = await readFirestoreDoc(env, 'licenses', ctx.uid);
  // One group seat at a time: joining a new plan gives up the old seat.
  if (license?.groupPlanId && license.groupPlanId !== plan.id) await removeGroupMember(env, license.groupPlanId, ctx.uid);
  const added = await claimGroupSeat(env, plan.id, ctx);
  await setLicenseSeat(env, ctx.uid, license, { planId: plan.id, name: plan.name, active: true });
  // Job 13: a member welcome and the tips, the first time they take a seat.
  if (added && ctx.email) await startCustomerEmails(env, { email: ctx.email, uid: ctx.uid, plan: 'member', groupName: plan.name });
  return { joined: true, already: !added, name: plan.name, individualPaid: individualPaidOf(license) };
}
// The seat count only moves if nobody else changed the plan since it was
// read (a Firestore precondition), so two people can't take the last seat.
async function claimGroupSeat(env, planId, ctx) {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await readFirestoreDoc(env, `groupPlans/${planId}/members`, ctx.uid)) return false;
    const snap = await readFirestoreDocWithTime(env, `groupPlans/${planId}`);
    const plan = snap?.data;
    if (!plan || !groupHasAccess(plan.status)) throw new HttpError(403, 'This group plan isn’t active right now.');
    if ((plan.memberCount || 0) >= (plan.seats || 0)) throw new HttpError(409, `Every seat in ${plan.name}’s plan is taken. Ask the person who runs it to add one.`, { reason: 'full' });
    const ok = await commitFirestore(env, [
      { path: `groupPlans/${planId}`, fields: { memberCount: (plan.memberCount || 0) + 1, updatedAt: new Date() }, updateTime: snap.updateTime },
      { path: `groupPlans/${planId}/members/${ctx.uid}`, fields: { email: ctx.email, name: ctx.name, joinedAt: new Date() }, exists: false },
    ]);
    if (ok) return true;
  }
  throw new HttpError(503, 'A lot of people are joining right now. Try again in a moment.');
}
export async function removeGroupMember(env, planId, uid) {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (!(await readFirestoreDoc(env, `groupPlans/${planId}/members`, uid))) return false;
    const snap = await readFirestoreDocWithTime(env, `groupPlans/${planId}`);
    if (!snap) { await deleteFirestoreDoc(env, `groupPlans/${planId}/members`, uid); return true; }
    const ok = await commitFirestore(env, [
      { path: `groupPlans/${planId}`, fields: { memberCount: Math.max(0, (snap.data.memberCount || 0) - 1), updatedAt: new Date() }, updateTime: snap.updateTime },
      { path: `groupPlans/${planId}/members/${uid}`, remove: true },
    ]);
    if (ok) return true;
  }
  throw new HttpError(503, 'Couldn’t update the plan right now. Try again in a moment.');
}
async function setLicenseSeat(env, uid, license, { planId = '', name = '', active = false }) {
  const individualPaid = individualPaidOf(license);
  await patchFirestoreDoc(env, `licenses/${uid}`, { individualPaid, groupPlanId: planId, groupName: name, groupPaid: active, paid: individualPaid || active, updatedAt: new Date() });
}
// Turns a whole plan's seats on or off (payment recovered or failed for
// good, or a rename), a few hundred licenses per Firestore round trip.
async function setGroupMembersAccess(env, plan, active) {
  const members = await listFirestoreCollection(env, `groupPlans/${plan.id}/members`);
  for (let i = 0; i < members.length; i += 200) {
    const chunk = members.slice(i, i + 200);
    const licenses = await batchGetFirestoreDocs(env, chunk.map(m => `licenses/${m.id}`));
    const writes = chunk
      .filter(m => { const l = licenses[`licenses/${m.id}`]; return !l?.groupPlanId || l.groupPlanId === plan.id; })
      .map(m => {
        const individualPaid = individualPaidOf(licenses[`licenses/${m.id}`]);
        return { path: `licenses/${m.id}`, fields: { individualPaid, groupPlanId: plan.id, groupName: plan.name || '', groupPaid: active, paid: individualPaid || active, updatedAt: new Date() } };
      });
    if (writes.length) await commitFirestore(env, writes);
  }
}
async function groupLeave(env, ctx) {
  const license = await readFirestoreDoc(env, 'licenses', ctx.uid);
  if (!license?.groupPlanId) return { left: false, paid: individualPaidOf(license) };
  await removeGroupMember(env, license.groupPlanId, ctx.uid);
  await setLicenseSeat(env, ctx.uid, license, {});
  return { left: true, paid: individualPaidOf(license) };
}

async function groupRemoveMember(env, ctx) {
  const plan = await loadAdminPlan(env, ctx);
  const target = String(ctx.body.uid || '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(target)) throw new HttpError(400, 'Pick someone to remove.');
  await removeGroupMember(env, plan.id, target);
  const license = await readFirestoreDoc(env, 'licenses', target);
  if (license?.groupPlanId === plan.id) await setLicenseSeat(env, target, license, {});
  return groupDetails(env, ctx);
}
async function groupSetAdmin(env, ctx) {
  const plan = await loadAdminPlan(env, ctx);
  const target = String(ctx.body.uid || '');
  let admins = groupAdmins(plan);
  if (ctx.body.admin) {
    if (admins.some(a => a.uid === target)) return groupDetails(env, ctx);
    const member = /^[A-Za-z0-9_-]{1,128}$/.test(target) ? await readFirestoreDoc(env, `groupPlans/${plan.id}/members`, target) : null;
    if (!member) throw new HttpError(400, 'Only someone with a seat can be made an admin.');
    if (admins.length >= 10) throw new HttpError(400, 'A plan can have up to 10 admins.');
    admins = [...admins, { uid: target, email: member.email || '', name: member.name || '' }];
  } else {
    if (admins.length <= 1) throw new HttpError(400, 'A plan needs at least one admin.');
    // Otherwise they'd keep paying for a plan they can no longer see.
    if (target === plan.ownerUid && plan.stripeSubscriptionId && groupHasAccess(plan.status)) {
      const who = target === ctx.uid ? 'You still pay' : `${groupBilledTo(plan).name || 'They'} still pays`;
      throw new HttpError(400, `${who} for this plan. Hand it off so someone else puts it on their card first, or cancel it from Manage billing.`);
    }
    admins = admins.filter(a => a.uid !== target);
  }
  await setGroupAdmins(env, plan, admins);
  if (target === ctx.uid && !ctx.body.admin) return { removedSelf: true };
  return groupDetails(env, ctx);
}
export async function setGroupAdmins(env, plan, admins) {
  await patchFirestoreDoc(env, `groupPlans/${plan.id}`, { adminUids: admins.map(a => a.uid), adminsJson: JSON.stringify(admins), updatedAt: new Date() });
}
async function groupRename(env, ctx) {
  const plan = await loadAdminPlan(env, ctx);
  const name = cleanGroupText(ctx.body.name, 80);
  if (!name) throw new HttpError(400, 'Give your group a name.');
  await patchFirestoreDoc(env, `groupPlans/${plan.id}`, { name, updatedAt: new Date() });
  if (groupHasAccess(plan.status)) await setGroupMembersAccess(env, { ...plan, name }, true);
  return groupDetails(env, ctx);
}
async function groupResetInvite(env, ctx) {
  const plan = await loadAdminPlan(env, ctx);
  if (!groupHasAccess(plan.status)) throw new HttpError(400, 'Invite links work once the plan is active.');
  const code = await createGroupInvite(env, plan.id);
  await patchFirestoreDoc(env, `groupPlans/${plan.id}`, { inviteCode: code, updatedAt: new Date() });
  if (plan.inviteCode) await deleteFirestoreDoc(env, 'groupInvites', plan.inviteCode);
  return groupDetails(env, ctx);
}
async function groupSetSeats(env, ctx) {
  const plan = await loadAdminPlan(env, ctx);
  if (!groupHasAccess(plan.status) || !plan.stripeSubscriptionId) throw new HttpError(400, 'Seats can be changed once the plan is active.');
  const seats = Math.round(Number(ctx.body.seats));
  if (!(seats >= GROUP_MIN_SEATS && seats <= GROUP_MAX_SEATS)) throw new HttpError(400, `Choose between ${GROUP_MIN_SEATS} and ${GROUP_MAX_SEATS} seats.`);
  // Counted from the members themselves, not the running total, so a count
  // that ever drifted can't let a plan drop below the people using it.
  const memberCount = (await listFirestoreCollection(env, `groupPlans/${plan.id}/members`)).length;
  if (seats < memberCount) throw new HttpError(400, `${memberCount} ${memberCount === 1 ? 'person has a seat' : 'people have seats'}. Remove someone before going below that.`);
  let itemId = plan.stripeItemId;
  if (!itemId) itemId = (await stripeRequest(env, 'GET', `/v1/subscriptions/${plan.stripeSubscriptionId}`)).data?.items?.data?.[0]?.id;
  if (!itemId) throw new HttpError(502, 'Couldn’t find this plan’s subscription in Stripe.');
  // Stripe prorates the change onto the next bill.
  const res = await stripeRequest(env, 'POST', `/v1/subscription_items/${itemId}`, new URLSearchParams({ quantity: String(seats), proration_behavior: 'create_prorations' }));
  if (!res.ok) throw new HttpError(502, 'Stripe couldn’t change the seats: ' + (res.data.error?.message || 'unknown error'));
  await patchFirestoreDoc(env, `groupPlans/${plan.id}`, { seats, stripeItemId: itemId, updatedAt: new Date() });
  return groupDetails(env, ctx);
}
async function groupPortal(env, ctx) {
  const plan = await loadAdminPlan(env, ctx);
  if (!plan.stripeCustomerId) throw new HttpError(400, 'This plan doesn’t have billing yet. Finish checkout first.');
  try { return { url: await createStripePortalSession(env, plan.stripeCustomerId, groupAdminUrl(env, plan.id)) }; }
  catch (e) { throw new HttpError(502, 'Could not open billing: ' + e.message); }
}
// Only a plan that never finished checkout. Kept as 'deleted' rather than
// erased, so a checkout that completes afterward still finds it.
async function groupDeletePending(env, ctx) {
  const plan = await loadAdminPlan(env, ctx);
  if (plan.status !== 'pending') throw new HttpError(400, 'Only a plan that never finished checkout can be deleted. Cancel an active plan from Billing.');
  await patchFirestoreDoc(env, `groupPlans/${plan.id}`, { status: 'deleted', updatedAt: new Date() });
  return { deleted: true };
}

/* ── Clubs: who's covered, and seats that free themselves ─────────
   A plan started for a club (orgCode) is run from the club as well as
   from group-admin.html. Any officer sees which members hold a seat;
   only the plan's admins see emails or change anything. When someone
   leaves a club, or an officer removes them, the app asks for their seat
   back, so the club never pays for people who are gone and a new member
   can take it: swapping people never changes the bill. */
const SAFE_UID = /^[A-Za-z0-9_-]{1,128}$/;
async function loadOrg(env, code) {
  if (!/^[A-Za-z0-9]{6}$/.test(String(code || ''))) throw new HttpError(400, 'That club wasn’t found.');
  return readFirestoreDoc(env, 'orgs', String(code));
}
async function groupOrgSeats(env, ctx) {
  const code = String(ctx.body.orgCode || '');
  const org = await loadOrg(env, code);
  if (!org || !(org.officerUids || []).includes(ctx.uid)) throw new HttpError(403, 'Only that club’s officers can see its seats.');
  const plan = await planForOrg(env, code);
  if (!plan) return { plan: null, seatUids: [], outside: [], canManage: false };
  const members = await listFirestoreCollection(env, `groupPlans/${plan.id}/members`);
  const inClub = new Set(org.memberUids || []);
  const live = groupHasAccess(plan.status);
  return {
    plan: {
      id: plan.id, name: plan.name || '', status: plan.status || 'pending', seats: plan.seats || 0, memberCount: members.length,
      cancelAtPeriodEnd: !!plan.cancelAtPeriodEnd, orgCode: code,
      inviteUrl: live && plan.inviteCode ? new URL(`?plan=${plan.inviteCode}`, env.APP_URL).toString() : '',
      admins: groupAdmins(plan).map(a => ({ uid: a.uid, name: a.name || '' })),
      billedTo: { uid: groupBilledTo(plan).uid, name: groupBilledTo(plan).name },
      handoff: groupHandoffOf(plan),
    },
    seatUids: members.filter(m => inClub.has(m.id)).map(m => m.id),
    outside: members.filter(m => !inClub.has(m.id)).map(m => ({ uid: m.id, name: m.name || 'Member', joinedAt: m.joinedAt || '' })),
    canManage: (plan.adminUids || []).includes(ctx.uid),
  };
}
// The person themselves (after leaving), or an officer (after removing
// them). Only ever someone no longer in the club, read fresh here, so it
// can't be used to take a seat from a current member.
async function groupReleaseOrgSeat(env, ctx) {
  const code = String(ctx.body.orgCode || '');
  const target = String(ctx.body.uid || ctx.uid);
  if (!SAFE_UID.test(target)) throw new HttpError(400, 'Pick whose seat to free.');
  const org = await loadOrg(env, code);
  if (target !== ctx.uid && !(org?.officerUids || []).includes(ctx.uid)) throw new HttpError(403, 'Only that club’s officers can free someone else’s seat.');
  if ((org?.memberUids || []).includes(target)) return { released: false, reason: 'member' };
  const plan = await planForOrg(env, code);
  if (!plan) return { released: false };
  const released = await removeGroupMember(env, plan.id, target);
  const license = released || target === ctx.uid ? await readFirestoreDoc(env, 'licenses', target) : null;
  if (released && license?.groupPlanId === plan.id) await setLicenseSeat(env, target, license, {});
  // The person leaving learns whether they're still covered by their own subscription.
  return { released, ...(target === ctx.uid ? { paid: individualPaidOf(license) } : {}) };
}

/* ── Handing a plan to the next person ────────────────────────────
   Officers graduate. An admin hands the plan to someone with a seat (or,
   for a club's plan, anyone in the club): they become an admin straight
   away and are asked to put the plan on their own card. The plan, its
   seats and its members never change, so nobody notices the handoff.
   Until the new card is in, the plan stays billed to the old one, so the
   person handing off stays an admin until then even if they're stepping
   back; otherwise they'd keep paying for a plan they can't see. */
async function groupHandoff(env, ctx) {
  const plan = await loadAdminPlan(env, ctx);
  const target = String(ctx.body.uid || '');
  if (!SAFE_UID.test(target) || target === ctx.uid) throw new HttpError(400, 'Pick who takes over.');
  const seat = await readFirestoreDoc(env, `groupPlans/${plan.id}/members`, target);
  const asAdmin = groupAdmins(plan).find(a => a.uid === target);
  let person = seat ? { name: seat.name || '', email: seat.email || '' } : asAdmin ? { name: asAdmin.name || '', email: asAdmin.email || '' } : null;
  if (!person && plan.orgCode) {
    const org = await loadOrg(env, plan.orgCode).catch(() => null);
    if ((org?.memberUids || []).includes(target)) person = { name: cleanGroupText(org.people?.[target]?.name, 80), email: '' };
  }
  if (!person) throw new HttpError(400, plan.orgCode ? 'They need to be in the club, or hold a seat on this plan, first.' : 'They need a seat on this plan first.');
  let admins = groupAdmins(plan);
  const existing = admins.find(a => a.uid === target);
  if (!existing) {
    if (admins.length >= 10) throw new HttpError(400, 'A plan can have up to 10 admins. Remove one first.');
    admins = [...admins, { uid: target, email: person.email, name: person.name }];
  }
  const stay = ctx.body.stay !== false;
  const billed = (plan.ownerUid || '') === ctx.uid;
  const needsCard = !!plan.stripeCustomerId && groupHasAccess(plan.status);
  const fields = { updatedAt: new Date() };
  if (needsCard) {
    // The person paying waits for the new card; anyone else can step back now.
    fields.handoffJson = JSON.stringify({ from: ctx.uid, fromName: ctx.name, to: target, toName: person.name || existing?.name || '', stay: stay || !billed, at: new Date().toISOString() });
    if (!stay && !billed) admins = admins.filter(a => a.uid !== ctx.uid);
  } else {
    // Nothing billed yet (or any more): the role is all there is to hand on.
    fields.ownerUid = target;
    fields.handoffJson = '';
    if (!stay) admins = admins.filter(a => a.uid !== ctx.uid);
  }
  fields.adminUids = admins.map(a => a.uid);
  fields.adminsJson = JSON.stringify(admins);
  await patchFirestoreDoc(env, `groupPlans/${plan.id}`, fields);
  if (!admins.some(a => a.uid === ctx.uid)) return { removedSelf: true };
  return groupDetails(env, ctx);
}
// Stripe's own page for saving a card (Checkout in setup mode), on the
// plan's existing customer. Nothing is charged. The card becomes the
// plan's from card-finish (on return) or the webhook, whichever is first.
async function groupCardCheckout(env, ctx) {
  const plan = await loadAdminPlan(env, ctx);
  if (!plan.stripeCustomerId || !plan.stripeSubscriptionId || !groupHasAccess(plan.status)) throw new HttpError(400, 'This plan doesn’t have billing to move. Finish checkout first.');
  const back = groupAdminUrl(env, plan.id);
  const params = new URLSearchParams();
  params.set('mode', 'setup');
  params.set('customer', plan.stripeCustomerId);
  params.set('payment_method_types[0]', 'card');
  params.set('success_url', `${back}&card=done&session={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${back}&card=cancel`);
  for (const [k, v] of [['kind', 'group-card'], ['planId', plan.id], ['uid', ctx.uid]]) {
    params.set(`metadata[${k}]`, v);
    params.set(`setup_intent_data[metadata][${k}]`, v);
  }
  const res = await stripeRequest(env, 'POST', '/v1/checkout/sessions', params);
  if (!res.ok) throw new HttpError(502, 'Could not open Stripe: ' + (res.data.error?.message || 'unknown error'));
  return { url: res.data.url };
}
async function groupCardFinish(env, ctx) {
  const plan = await loadAdminPlan(env, ctx);
  const id = String(ctx.body.sessionId || '');
  if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(id)) throw new HttpError(400, 'That card change wasn’t found.');
  const res = await stripeRequest(env, 'GET', `/v1/checkout/sessions/${id}`);
  const session = res.data;
  if (!res.ok || session.metadata?.kind !== 'group-card' || session.metadata?.planId !== plan.id || session.metadata?.uid !== ctx.uid) throw new HttpError(400, 'That card change doesn’t belong to this plan.');
  if (session.status !== 'complete') throw new HttpError(400, 'The card wasn’t saved. Try again.');
  await applyGroupCard(env, plan, session, { uid: ctx.uid, email: ctx.email, name: ctx.name });
  return groupDetails(env, ctx);
}
// Webhook: checkout.session.completed for a card change.
export async function finishGroupCardFromWebhook(env, session) {
  const planId = session.metadata?.planId;
  const uid = session.metadata?.uid;
  const plan = planId ? await readFirestoreDoc(env, 'groupPlans', planId) : null;
  if (!plan || !SAFE_UID.test(String(uid || '')) || !(plan.adminUids || []).includes(uid)) return false;
  const admin = groupAdmins(plan).find(a => a.uid === uid);
  await applyGroupCard(env, { ...plan, id: planId }, session, { uid, email: admin?.email || '', name: admin?.name || '' });
  return true;
}
async function setupIntentCard(env, session) {
  const si = session.setup_intent;
  if (si && typeof si === 'object') return typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id || '';
  if (typeof si !== 'string' || !si) return '';
  const res = await stripeRequest(env, 'GET', `/v1/setup_intents/${si}`);
  return res.ok && typeof res.data.payment_method === 'string' ? res.data.payment_method : '';
}
// Same session twice (return page and webhook) is a no-op the second time.
async function applyGroupCard(env, plan, session, who) {
  if (plan.cardSessionId === session.id) return;
  if (session.customer !== plan.stripeCustomerId) throw new HttpError(400, 'That card change doesn’t belong to this plan.');
  const card = await setupIntentCard(env, session);
  if (!card) throw new HttpError(502, 'Stripe didn’t send the card back. Try again.');
  const customer = new URLSearchParams({ 'invoice_settings[default_payment_method]': card });
  if (who.email) customer.set('email', who.email);   // receipts go to the new person
  const c = await stripeRequest(env, 'POST', `/v1/customers/${plan.stripeCustomerId}`, customer);
  if (!c.ok) throw new HttpError(502, 'Stripe couldn’t switch the card: ' + (c.data.error?.message || 'unknown error'));
  if (plan.stripeSubscriptionId) {
    const s = await stripeRequest(env, 'POST', `/v1/subscriptions/${plan.stripeSubscriptionId}`, new URLSearchParams({ default_payment_method: card }));
    if (!s.ok) throw new HttpError(502, 'Stripe couldn’t switch the card: ' + (s.data.error?.message || 'unknown error'));
  }
  // The person handing off shouldn't leave their card on a plan they no
  // longer pay for. Best effort: a card left behind is never charged.
  try {
    const list = await stripeRequest(env, 'GET', `/v1/customers/${plan.stripeCustomerId}/payment_methods?limit=20`);
    for (const pm of list.data?.data || []) {
      if (pm.id !== card) await stripeRequest(env, 'POST', `/v1/payment_methods/${pm.id}/detach`, new URLSearchParams());
    }
  } catch (e) { await logServerIssue(env, 'group-plans', 'Old card not removed after a handoff', e, { planId: plan.id }); }
  const handoff = groupHandoffOf(plan);
  let admins = groupAdmins(plan).map(a => a.uid === who.uid ? { ...a, email: a.email || who.email, name: a.name || who.name } : a);
  // Stepping back: now that someone else pays, the person who handed off goes.
  if (handoff && !handoff.stay && handoff.from !== who.uid) admins = admins.filter(a => a.uid !== handoff.from);
  await patchFirestoreDoc(env, `groupPlans/${plan.id}`, {
    ownerUid: who.uid, billingName: who.name || '', billingEmail: who.email || '', cardSessionId: session.id, handoffJson: '',
    adminUids: admins.map(a => a.uid), adminsJson: JSON.stringify(admins), updatedAt: new Date(),
  });
}
