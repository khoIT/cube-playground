/**
 * CLI entry for `npm run snapshot`.
 * Dumps the current SQLite state to server/data/seed/segments-snapshot.json
 * so demos can be replayed via `git pull` on a fresh machine.
 */

import { writeSnapshot } from '../db/snapshot-store.js';
import { closeDb } from '../db/sqlite.js';

const path = writeSnapshot();
console.log(`Snapshot written to ${path}`);
closeDb();
