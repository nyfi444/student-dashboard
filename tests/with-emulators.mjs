/* ── Runs a command with the Firebase emulators up ─────────────────
   The rules tests and the signed-in browser tests run against a local
   copy of Firebase — Auth, Firestore and Storage — loaded with this
   repo's own firestore.rules and storage.rules. Nothing touches the real
   project: the project id is demo-semester-hq, which the Firebase CLI
   treats as offline-only by design.

   The Firestore emulator is a Java program. This finds a Java runtime so
   `npm test` just works: $JAVA_HOME if set, then `java` on the PATH, then
   a JDK unpacked under ~/.local/share (where one was installed for this
   machine). If there is none, it says so instead of failing somewhere
   inside the Firebase CLI.

   The emulator ports live in the repo root firebase.json, next to the
   rules they load; the deploy workflow ignores that block.

   Usage:  node with-emulators.mjs <emulators> -- <command...>
           node with-emulators.mjs auth,firestore,storage -- playwright test
──────────────────────────────────────────────────────────────── */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
if (sep < 1 || sep === argv.length - 1) {
  console.error('usage: node with-emulators.mjs <emulators> -- <command...>');
  process.exit(2);
}
const only = argv[0];
const command = argv.slice(sep + 1).join(' ');

function findJavaHome() {
  if (process.env.JAVA_HOME && existsSync(join(process.env.JAVA_HOME, 'bin', 'java'))) return process.env.JAVA_HOME;
  if (spawnSync('java', ['-version'], { stdio: 'ignore' }).status === 0) return null; // already on PATH
  const base = join(homedir(), '.local', 'share');
  if (existsSync(base)) {
    for (const d of readdirSync(base).filter(n => /^jdk-\d/.test(n)).sort().reverse()) {
      for (const home of [join(base, d, 'Contents', 'Home'), join(base, d)]) {
        if (existsSync(join(home, 'bin', 'java'))) return home;
      }
    }
  }
  return undefined;
}

const javaHome = findJavaHome();
if (javaHome === undefined) {
  console.error('The Firestore emulator needs Java 11 or newer, and none was found.\n' +
    'Set JAVA_HOME, put `java` on your PATH, or unpack a JDK under ~/.local/share.');
  process.exit(1);
}
const env = { ...process.env };
if (javaHome) {
  env.JAVA_HOME = javaHome;
  env.PATH = `${join(javaHome, 'bin')}:${env.PATH}`;
}
const firebase = join(here, 'node_modules', '.bin', 'firebase');
const result = spawnSync(firebase, [
  'emulators:exec', '--config', join(here, '..', 'firebase.json'), '--project', 'demo-semester-hq', '--only', only, command,
], { stdio: 'inherit', env, cwd: here });
process.exit(result.status ?? 1);
