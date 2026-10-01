// Renders every customer email (worker/src/emails.js) to HTML and text files,
// so they can be opened in a browser, screenshotted, or pasted for review.
//
//   node tools/render-emails.mjs <out-dir> [--images <base-url>]
//
// --images points the product pictures somewhere else, e.g. a local copy of
// the site's assets/email/ folder before those files are live.
import vm from 'node:vm';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadWorkerSource } from '../tests/worker-source.mjs';

const out = process.argv[2];
if (!out) { console.error('Usage: node tools/render-emails.mjs <out-dir> [--images <base-url>]'); process.exit(1); }
const i = process.argv.indexOf('--images');
const imageBase = i > -1 ? process.argv[i + 1] : undefined;

const box = { console, crypto, URL, URLSearchParams, TextEncoder, TextDecoder, Response, Request, Headers };
box.globalThis = box;
vm.createContext(box);
vm.runInContext(loadWorkerSource().source, box);

mkdirSync(out, { recursive: true });
const ctx = {
  appUrl: 'https://app.semester-hq.com/',
  prefsUrl: 'https://app.semester-hq.com/email-preferences.html?e=example&t=example',
  unsubscribeUrl: 'https://app.semester-hq.com/email-preferences.html?e=example&t=example&off=1',
  startedAt: new Date(), priceCents: 799, groupName: 'Chem Club', seats: 12, seatCents: 599,
  ...(imageBase ? { imageBase } : {}),
};
const keys = ['receipt', 'welcome', 'syllabus', 'calendar', 'canvas', 'groups', 'habit', 'group-receipt', 'group-welcome', 'member-welcome'];
for (const key of keys) {
  const r = box.renderEmail(key, ctx);
  writeFileSync(join(out, `${key}.html`), r.html);
  writeFileSync(join(out, `${key}.txt`), `Subject: ${r.subject}\n\n${r.text}`);
}
console.log(`${keys.length} emails written to ${out}`);
