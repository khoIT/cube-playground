/**
 * Process-singleton stream-registry instance, wired with config-derived knobs.
 * Tests can build their own via `createStreamRegistry()` to keep things hermetic.
 */
import { config } from '../config.js';
import { createStreamRegistry, type StreamRegistry } from './stream-registry.js';

let instance: StreamRegistry | null = null;

export function getStreamRegistry(): StreamRegistry {
  if (!instance) {
    instance = createStreamRegistry({
      ringSize: config.streamRegistryRingSize,
      maxTurns: config.streamRegistryMaxTurns,
      ttlMs: config.streamRegistryTtlMs,
      sweepIntervalMs: config.streamRegistrySweepIntervalMs,
      maxRunningMs: config.streamRegistryMaxRunningMs,
    });
  }
  return instance;
}

/** Test-only: drop and rebuild. */
export function resetStreamRegistryForTest(): void {
  instance?.dispose();
  instance = null;
}
