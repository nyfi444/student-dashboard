/* ── The Worker, as one script, for the tests that reach inside it ──
   worker/src is split into modules by job (see the map in index.js), and
   Wrangler bundles them into one script on deploy. The Worker tests need
   the same thing for a different reason: they swap out single functions
   — readFirestoreDoc, verifyFirebaseIdToken — to fake Firestore and auth,
   and then run a real route handler that calls them.

   Real ES module imports can't be swapped from outside; an imported
   binding is fixed at link time. A plain script can: every top-level
   function lands on the global object and each call looks it up there,
   so replacing sandbox.readFirestoreDoc changes what every caller gets.
   That is the whole reason this exists, and it's the same approach
   tests/run.mjs already takes with the app's js/*.js files.

   So: read every module, drop the import lines and the `export` keywords,
   join them, and turn the default export into globalThis.__worker. The
   modules are written so that this is safe — single-line imports only,
   and nothing at the top level that runs code across a module boundary.
   The checks below fail loudly if that ever stops being true, rather
   than letting a test quietly run something other than what deploys.
──────────────────────────────────────────────────────────────── */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'worker/src');

export function loadWorkerSource() {
  // index.js last, so the default export is the tail of the script, as it
  // is the tail of the dependency graph.
  const files = readdirSync(srcDir).filter(f => f.endsWith('.js')).sort((a, b) =>
    (a === 'index.js') - (b === 'index.js') || a.localeCompare(b));

  const parts = files.map((file) => {
    const text = readFileSync(join(srcDir, file), 'utf8')
      .replace(/^import \{[^}]*\} from '\.\/[\w-]+\.js';$/gm, '')
      .replace(/^export (async function|function|class|const|let) /gm, '$1 ')
      .replace(/^export default \{/m, 'globalThis.__worker = {');
    const leftover = text.split('\n').find(l => /^(import|export)\b/.test(l));
    if (leftover) {
      throw new Error(`worker/src/${file} has an import or export the test loader can't flatten:\n  ${leftover}\n` +
        'Keep imports on one line as `import { a, b } from \'./x.js\';` and exports as `export function` / `export class` / `export const`.');
    }
    return `/* ── ${file} ── */\n${text}`;
  });
  return { source: parts.join('\n;\n'), files };
}
