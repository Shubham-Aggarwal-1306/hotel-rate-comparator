/**
 * Pure constants shared with workflow code.
 *
 * Workflow code runs in a deterministic sandbox, so it must not read
 * `process.env` — anything the workflow needs lives here.
 */

/** Wall-clock budget for one supplier, retries included. Slower than this is cancelled. */
export const SUPPLIER_DEADLINE_MS = 5_000;

/** Cap for a single activity attempt. */
export const ACTIVITY_START_TO_CLOSE_MS = 4_500;

/** Retry policy applied to each supplier activity. */
export const SUPPLIER_RETRY = {
  initialIntervalMs: 200,
  backoffCoefficient: 1.5,
  maximumIntervalMs: 1_000,
  maximumAttempts: 3,
} as const;
