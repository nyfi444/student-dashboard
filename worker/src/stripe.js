/* ── worker/src/stripe.js ───────────────────────────────────────
   Talking to Stripe: the REST client, webhook signature checks, and the
   billing-portal setup that checkout, licensing and groups all share.
──────────────────────────────────────────────────────────────── */

import { logServerIssue } from './diagnostics.js';
import { timingSafeEqual } from './http.js';

// A customer can only open the portal once it has a configuration. One is
// made here the first time Stripe says there isn't one (the account never
// saved its customer portal settings), then reused.
export async function createStripePortalSession(env, customer, returnUrl) {
  const open = (configuration) => {
    const params = new URLSearchParams({ customer, return_url: returnUrl });
    if (configuration) params.set('configuration', configuration);
    return stripeRequest(env, 'POST', '/v1/billing_portal/sessions', params);
  };
  let res = await open();
  if (!res.ok && /configuration/i.test(res.data.error?.message || '')) {
    const configuration = await ensurePortalConfiguration(env);
    if (configuration) res = await open(configuration);
  }
  if (!res.ok) throw new Error(res.data.error?.message || 'unknown error');
  return res.data.url;
}
async function ensurePortalConfiguration(env) {
  const list = await stripeRequest(env, 'GET', '/v1/billing_portal/configurations?active=true&limit=10');
  const configs = list.data?.data || [];
  const existing = configs.find(c => c.is_default) || configs[0];
  if (existing) return existing.id;
  const params = new URLSearchParams();
  params.set('business_profile[headline]', 'Manage your Semester HQ plan');
  params.set('business_profile[privacy_policy_url]', 'https://semester-hq.com/privacy.html');
  params.set('business_profile[terms_of_service_url]', 'https://semester-hq.com/terms.html');
  params.set('features[payment_method_update][enabled]', 'true');
  params.set('features[invoice_history][enabled]', 'true');
  params.set('features[customer_update][enabled]', 'true');
  params.append('features[customer_update][allowed_updates][]', 'email');
  params.append('features[customer_update][allowed_updates][]', 'address');
  params.set('features[subscription_cancel][enabled]', 'true');
  params.set('features[subscription_cancel][mode]', 'at_period_end');
  params.set('metadata[created_by]', 'semester-hq-worker');
  const created = await stripeRequest(env, 'POST', '/v1/billing_portal/configurations', params);
  if (!created.ok) await logServerIssue(env, 'checkout', 'Could not create a portal configuration', null, { stripe: created.data.error?.message || '' });
  return created.ok ? created.data.id : '';
}
export async function findStripeCustomerByEmail(env, email) {
  const variants = [...new Set([email.trim(), email.trim().toLowerCase()])];
  for (const variant of variants) {
    const res = await stripeRequest(env, 'GET', `/v1/customers?limit=10&email=${encodeURIComponent(variant)}&expand[]=data.subscriptions`);
    const customers = res.ok ? res.data.data || [] : [];
    const withSubscription = customers.find(c => (c.subscriptions?.data || []).length);
    if (withSubscription || customers[0]) return (withSubscription || customers[0]).id;
  }
  return '';
}
export async function stripeGetJson(env, path) {
  const res = await fetch(`https://api.stripe.com${path}`, { headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Stripe returned ${res.status}`);
  return data;
}

/* ── Stripe signature verification ───────────────────────────── */
export async function verifyStripeSignature(rawBody, sigHeader, secret) {
  // The header can carry more than one v1 signature while a webhook secret
  // is being rotated; any one of them matching is a valid delivery.
  let timestamp = '';
  const signatures = [];
  for (const part of String(sigHeader).split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === 't' && !timestamp) timestamp = v;
    else if (k === 'v1' && v) signatures.push(v);
  }
  if (!timestamp || !signatures.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false; // 5 min replay window

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const computed = [...new Uint8Array(sigBuf)].map(b => b.toString(16).padStart(2, '0')).join('');
  return signatures.some(sig => timingSafeEqual(computed, sig));
}

export async function stripeRequest(env, method, path, params) {
  const res = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(params ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: params ? params.toString() : undefined,
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}
