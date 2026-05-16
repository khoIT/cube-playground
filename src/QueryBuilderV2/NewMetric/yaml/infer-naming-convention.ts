/**
 * Infer naming convention from a list of peer measure names.
 * Rules:
 *   - Majority match /^[a-z][a-z0-9_]*$/ (no uppercase) → 'snake'
 *   - Majority match /^[a-z][a-zA-Z0-9]*$/ AND contain at least one uppercase → 'camel'
 *   - Tie or empty → 'snake'
 */

const SNAKE_RE = /^[a-z][a-z0-9_]*$/;
// camelCase: starts lowercase, only alphanum, contains ≥1 uppercase
const CAMEL_RE = /^[a-z][a-zA-Z0-9]*$/;

function isSnake(name: string): boolean {
  return SNAKE_RE.test(name);
}

function isCamel(name: string): boolean {
  return CAMEL_RE.test(name) && /[A-Z]/.test(name);
}

export function inferConvention(peers: string[]): 'snake' | 'camel' {
  if (peers.length === 0) return 'snake';

  let snakeCount = 0;
  let camelCount = 0;

  for (const p of peers) {
    if (isSnake(p)) snakeCount++;
    else if (isCamel(p)) camelCount++;
  }

  if (camelCount > snakeCount) return 'camel';
  return 'snake';
}

/**
 * Convert a snake_case identifier to camelCase.
 * e.g. "total_revenue" → "totalRevenue"
 */
export function snakeToCamel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
}

/**
 * Adapt a draft name to match the inferred convention.
 * Does not modify names that already match the target convention.
 */
export function adaptName(name: string, convention: 'snake' | 'camel'): string {
  if (convention === 'camel') {
    // Already camelCase (contains uppercase, no underscores): leave as-is
    if (/[A-Z]/.test(name) && !name.includes('_')) return name;
    // snake_case input → convert
    if (SNAKE_RE.test(name)) return snakeToCamel(name);
    // Fallback: return unchanged
    return name;
  }
  // snake convention: leave as-is (validate() already enforces snake_case)
  return name;
}
