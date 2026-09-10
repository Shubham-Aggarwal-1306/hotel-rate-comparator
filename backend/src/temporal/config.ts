/** Node-side configuration (NOT imported from workflow code). */
export const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? 'hotel-search';
export const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
export const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? 'default';

/**
 * Read at call time rather than at import time so tests can point the activities
 * at an ephemeral mock-supplier port.
 */
export const suppliersBaseUrl = (): string =>
  process.env.SUPPLIERS_BASE_URL ?? 'http://localhost:4001';

/** Per-HTTP-attempt timeout inside an activity. */
export const supplierHttpTimeoutMs = (): number => {
  const parsed = Number(process.env.SUPPLIER_HTTP_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4_000;
};
