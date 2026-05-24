/**
 * CLI entry for `npm run snapshot` in chat-service.
 * Dumps the current chat.db (sessions + turns) to
 * runtime/seed/chat-snapshot.json so demos / collaborators can replay it
 * via `git pull` on a fresh machine.
 */

import { openDatabase } from '../db/migrate.js';
import { writeChatSnapshot } from '../db/snapshot-store.js';
import { config } from '../config.js';

const db = openDatabase(config.chatDbPath);
const path = writeChatSnapshot(db);
console.log(`Chat snapshot written to ${path}`);
db.close();
