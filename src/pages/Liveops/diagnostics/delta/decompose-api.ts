/**
 * Client for the LiveOps delta-decomposition endpoint (chat-service, reached via
 * the /api/chat/* proxy). Sends the active workspace + owner headers (chatHeaders)
 * plus X-Cube-Game so the proxy mints the right per-game schema, same contract as
 * the chat /load path.
 */
import { chatHeaders } from '../../../../api/chat-auth-headers';

export interface DeltaContributor {
  value: string;
  a: number;
  b: number;
  delta: number;
  pctOfSwing: number | null;
  isOther?: boolean;
}

export interface DeltaDecomposeResult {
  measure: string;
  dimension: string;
  additive: boolean;
  measureType: string;
  totalA: number;
  totalB: number;
  headlineDelta: number;
  headlinePct: number | null;
  contributors: DeltaContributor[];
  residual: number;
  bucketedCount: number;
  truncated: boolean;
  note: string;
}

export interface DeltaDecomposeRequest {
  game: string;
  measure: string;
  dimension: string;
  timeDimension: string;
  periodA: [string, string];
  periodB: [string, string];
  filters?: Array<{ member: string; operator: string; values?: string[] }>;
  topN?: number;
}

export class DeltaDecomposeError extends Error {
  constructor(message: string, readonly missingRefs?: string[]) {
    super(message);
    this.name = 'DeltaDecomposeError';
  }
}

export async function postDeltaDecompose(
  req: DeltaDecomposeRequest,
  signal?: AbortSignal,
): Promise<DeltaDecomposeResult> {
  const res = await fetch('/api/chat/liveops/delta-decompose', {
    method: 'POST',
    headers: chatHeaders({ 'Content-Type': 'application/json', 'X-Cube-Game': req.game }),
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok) {
    let detail: { error?: string; message?: string; missingRefs?: string[] } = {};
    try {
      detail = await res.json();
    } catch {
      /* non-JSON error body */
    }
    const msg =
      detail.error === 'unknown_members'
        ? `Unknown members: ${(detail.missingRefs ?? []).join(', ')}`
        : detail.message ?? detail.error ?? `Request failed (${res.status})`;
    throw new DeltaDecomposeError(msg, detail.missingRefs);
  }
  return (await res.json()) as DeltaDecomposeResult;
}
