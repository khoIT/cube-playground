/**
 * Boot-time crash surface for chat-service.
 *
 * Imported FIRST in index.ts so its process.on() handlers are wired up
 * before any other module evaluates. That matters because failures like
 * `required('ANTHROPIC_API_KEY')` in config.ts throw during the import
 * graph evaluation — before any try/catch in start() can run.
 *
 * Why synchronous fs.writeSync to fd 2 and not console.error / pino:
 *   On Windows, chat-service runs under
 *     concurrently -> npm -> tsx watch -> node
 *   Every layer pipes stderr. console.error and pino write asynchronously,
 *   so when the process exits abruptly the buffered output can vanish
 *   between the inner node and the outer terminal. fs.writeSync(2, ...)
 *   uses the OS write() syscall directly and survives abrupt exit.
 *
 * A copy is also appended to runtime/boot-error.log so the failure can
 * still be inspected after the terminal has scrolled or been closed.
 */

import { writeSync, appendFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = resolve(__dirname, '..', 'runtime', 'boot-error.log');

function writeLogSync(msg: string): void {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    appendFileSync(LOG_PATH, msg);
  } catch {
    // best-effort — never crash the crash handler
  }
}

function writeStderrSync(msg: string): void {
  try {
    writeSync(2, msg);
  } catch {
    // best-effort
  }
}

function fatal(label: string, err: unknown): void {
  const stamp = new Date().toISOString();
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  const port = process.env.PORT ?? '3005';
  const hint = detail.includes('EADDRINUSE')
    ? `[chat-service] Hint: port ${port} already in use. On Windows the killed-orphan\n` +
      `  socket can linger in TIME_WAIT for a few seconds. Recovery:\n` +
      `    powershell "Get-NetTCPConnection -LocalPort ${port} | Select OwningProcess"\n` +
      `    taskkill /F /PID <pid>\n` +
      `  then re-run npm run chat:dev (or dev:all).\n`
    : '';
  const formatted = `\n[chat-service] ${stamp} FATAL ${label}\n${detail}\n${hint}`;
  writeStderrSync(formatted);
  writeLogSync(formatted);
  process.exit(1);
}

process.on('uncaughtException', (err) => fatal('uncaughtException', err));
process.on('unhandledRejection', (err) => fatal('unhandledRejection', err));

// Synchronous early-boot marker — guarantees at least one line of output
// reaches the terminal before any import statement can throw silently.
writeStderrSync(`[chat-service] booting (pid=${process.pid})\n`);

export {};
