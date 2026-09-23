/* Shared setup for the rules tests: one test environment per file,
   loaded with the repo's own firestore.rules and storage.rules — the same
   files deploy-rules.yml publishes, so what passes here is what ships.

   The emulators are started by ../with-emulators.mjs, which sets
   FIRESTORE_EMULATOR_HOST and FIREBASE_STORAGE_EMULATOR_HOST. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const PROJECT_ID = 'demo-semester-hq';
export const BUCKET = `gs://${PROJECT_ID}.appspot.com`;

function hostPort(envName, fallbackPort) {
  const [host, port] = (process.env[envName] || `127.0.0.1:${fallbackPort}`).split(':');
  return { host, port: Number(port) };
}

export async function makeEnv({ storage = false } = {}) {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(join(root, 'firestore.rules'), 'utf8'), ...hostPort('FIRESTORE_EMULATOR_HOST', 8080) },
    ...(storage ? { storage: { rules: readFileSync(join(root, 'storage.rules'), 'utf8'), ...hostPort('FIREBASE_STORAGE_EMULATOR_HOST', 9199) } } : {}),
  });
}

/* The people in these tests. Named, not numbered, because a failure that
   says "mallory could read alice's planner" is readable at a glance. */
export const as = (env, uid, token = {}) => env.authenticatedContext(uid, { email: `${uid}@school.edu`, email_verified: true, ...token });
export const signedOut = (env) => env.unauthenticatedContext();
