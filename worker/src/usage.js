/* ── worker/src/usage.js ────────────────────────────────────────
   What the AI features cost: after every successful AI call (ai.js),
   the tokens it used are added to aiUsage/{YYYY-MM-DD}, per feature and
   per model, with Firestore's own counters so two calls landing at once
   can't lose one another. The business summary reads the last 30 days
   back as calls, tokens, and an estimated cost in cents.

   It must never slow or break a student's request: the write runs after
   the reply is on its way (ctx.waitUntil), and every failure is caught
   and only logged. A lost count is a slightly low number on a dashboard;
   a thrown error here would be a syllabus that didn't load.

   The doc is written only by this Worker's service account, so it needs
   no Firestore rule (clients can't read or write it at all).
──────────────────────────────────────────────────────────────── */

import { batchGetFirestoreDocs, commitFirestore } from './firebase.js';

/* Prices in US dollars per million tokens, one place for all of them.
   Source: Anthropic's model pricing as listed in the Claude API reference
   (claude-api skill, model table cached 2026-06-24), checked 2026-09-23.
   input/output are the listed prices. cacheRead is the documented 0.1x of
   input and cacheWrite the documented 1.25x of input for the 5-minute
   cache the app uses (js/ai.js), not separate line items, so check those
   two against the pricing page when it matters. A model missing here, or
   a null, makes its cost estimate null rather than a guess. */
export const AI_PRICING = {
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
};

// The features the app tags its AI calls with (callClaude's `feature` in
// js/ai.js). Anything else, including no tag, counts as 'untagged', so a
// caller can't grow this doc with made-up names.
const AI_USAGE_FEATURES = ['syllabus', 'assignments', 'project-plan', 'capture', 'career', 'flashcards', 'exam-topics'];
const AI_USAGE_COUNTERS = ['calls', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'];
const AI_USAGE_DAYS = 30;

export function aiUsageFeature(value) {
  return AI_USAGE_FEATURES.includes(value) ? value : 'untagged';
}

// A field path segment Firestore will accept: plain identifiers as they are,
// anything else (model ids have dashes) in backticks.
function usagePathSegment(s) {
  return /^[A-Za-z_][A-Za-z_0-9]*$/.test(s) ? s : '`' + String(s).replace(/[`\\]/g, '\\$&') + '`';
}

// The counter increments one call adds, keyed by Firestore field path.
export function aiUsageIncrements(feature, model, usage) {
  const n = (v) => Math.max(0, Math.min(Math.round(Number(v) || 0), 10_000_000));
  const counts = {
    calls: 1,
    inputTokens: n(usage?.input_tokens),
    outputTokens: n(usage?.output_tokens),
    cacheReadTokens: n(usage?.cache_read_input_tokens),
    cacheWriteTokens: n(usage?.cache_creation_input_tokens),
  };
  const f = usagePathSegment(feature), m = usagePathSegment(model);
  const out = {};
  for (const [k, v] of Object.entries(counts)) {
    if (!v) continue;
    out[`byFeature.${f}.${k}`] = v;
    out[`byModel.${m}.${k}`] = v;
    // Feature by model as well, so a feature that uses two models (the
    // syllabus: Sonnet, and Opus for scans) is priced at the right rates.
    out[`byFeatureModel.${f}.${m}.${k}`] = v;
  }
  return out;
}

export async function recordAiUsage(env, { feature, model, usage, now = Date.now() }) {
  try {
    if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) return false;
    const day = new Date(now).toISOString().slice(0, 10);
    return await commitFirestore(env, [{ path: `aiUsage/${day}`, fields: { date: day }, increments: aiUsageIncrements(aiUsageFeature(feature), model, usage) }]);
  } catch (e) {
    console.error('AI usage not recorded', e?.message);
    return false;
  }
}

// Called by the AI proxy with the upstream reply's text. Reads the usage out
// of it and hands the write to waitUntil, so the reply isn't held for it.
// Never throws.
export function noteAiUsage(env, ctx, { feature, model, text }) {
  try {
    let usage = null;
    try { usage = JSON.parse(text)?.usage || null; } catch {}
    if (!usage || typeof usage !== 'object') return;
    const job = recordAiUsage(env, { feature, model, usage });
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(job);
  } catch (e) {
    console.error('AI usage not recorded', e?.message);
  }
}

/* ── The last 30 days, for the business summary ──────────────────── */
export async function fetchAiUsageSummary(env, now = Date.now()) {
  const paths = [];
  for (let i = 0; i < AI_USAGE_DAYS; i++) paths.push(`aiUsage/${new Date(now - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}`);
  const docs = await batchGetFirestoreDocs(env, paths);
  return summarizeAiUsage(Object.values(docs).filter(Boolean));
}

export function summarizeAiUsage(docs) {
  const blank = () => Object.fromEntries(AI_USAGE_COUNTERS.map(k => [k, 0]));
  const add = (into, from) => { for (const k of AI_USAGE_COUNTERS) into[k] += Number(from?.[k]) || 0; };
  const byFeature = {}, byModel = {}, featureModel = {};
  for (const doc of docs) {
    for (const [f, c] of Object.entries(doc.byFeature || {})) add(byFeature[f] || (byFeature[f] = blank()), c);
    for (const [m, c] of Object.entries(doc.byModel || {})) add(byModel[m] || (byModel[m] = blank()), c);
    for (const [f, models] of Object.entries(doc.byFeatureModel || {})) {
      for (const [m, c] of Object.entries(models || {})) {
        const fm = featureModel[f] || (featureModel[f] = {});
        add(fm[m] || (fm[m] = blank()), c);
      }
    }
  }
  for (const [m, c] of Object.entries(byModel)) c.estCents = aiCostCents(m, c);
  for (const [f, c] of Object.entries(byFeature)) {
    const parts = Object.entries(featureModel[f] || {}).map(([m, fc]) => aiCostCents(m, fc));
    c.estCents = parts.length && parts.every(x => x !== null) ? roundCents(parts.reduce((a, b) => a + b, 0)) : null;
  }
  const modelCosts = Object.values(byModel).map(c => c.estCents);
  const totalEstCents = modelCosts.length && modelCosts.every(x => x !== null) ? roundCents(modelCosts.reduce((a, b) => a + b, 0)) : (modelCosts.length ? null : 0);
  return { days: AI_USAGE_DAYS, byFeature, byModel, totalEstCents };
}

// Estimated cents for one model's counts, or null when a price it needs
// isn't known.
export function aiCostCents(model, c) {
  const p = AI_PRICING[model];
  const parts = [['inputTokens', 'input'], ['outputTokens', 'output'], ['cacheReadTokens', 'cacheRead'], ['cacheWriteTokens', 'cacheWrite']];
  let dollars = 0;
  for (const [count, price] of parts) {
    const tokens = Number(c?.[count]) || 0;
    if (!tokens) continue;
    if (!p || typeof p[price] !== 'number') return null;
    dollars += (tokens / 1_000_000) * p[price];
  }
  return roundCents(dollars * 100);
}
function roundCents(x) { return Math.round(x * 100) / 100; }
