/* ── worker/src/groups.js ───────────────────────────────────────
   Group plans (/group/*): seats, invites, admins and the group's own
   Stripe subscription. Job 9 in index.js.
──────────────────────────────────────────────────────────────── */

import { logServerIssue } from './diagnostics.js';
import { batchGetFirestoreDocs, commitFirestore, deleteFirestoreDoc, listFirestoreCollection, parseJsonField, patchFirestoreDoc, readFirestoreDoc, readFirestoreDocWithTime, runFirestoreQuery, verifyFirebaseIdToken } from './firebase.js';
import { jsonError, jsonOk, verifiedEmailOf } from './http.js';
import { individualPaidOf } from './licensing.js';
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
    orgCode: plan.orgCode || '', admins: groupAdmins(plan),
    cancelAtPeriodEnd: !!plan.cancelAtPeriodEnd, currentPeriodEnd: plan.currentPeriodEnd || '', createdAt: plan.createdAt || '',
  };
}

const GROUP_ACTIONS = {
  mine: groupMine, details: groupDetails, 'create-checkout': groupCreateCheckout, seats: groupSetSeats,
  'remove-member': groupRemoveMember, 'set-admin': groupSetAdmin, rename: groupRename, 'reset-invite': groupResetInvite,
  portal: groupPortal, 'delete-pending': groupDeletePending, join: groupJoin, leave: groupLeave,
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
  if (/^[A-Za-z0-9]{6}$/.test(String(orgCode || ''))) {
    const plans = await runFirestoreQuery(env, {
      from: [{ collectionId: 'groupPlans' }],
      where: { fieldFilter: { field: { fieldPath: 'orgCode' }, op: 'EQUAL', value: { stringValue: String(orgCode) } } },
      limit: 10,
    });
    return plans.find(p => groupHasAccess(p.status)) || null;
  }
  return null;
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
    you: { uid: ctx.uid, hasSeat: members.some(m => m.id === ctx.uid) },
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
