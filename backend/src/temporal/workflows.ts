import {
  CancellationScope,
  defineQuery,
  isCancellation,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow';
import type * as activities from './activities';
import { summarise } from '../domain/compare';
import { ACTIVITY_START_TO_CLOSE_MS, SUPPLIER_DEADLINE_MS, SUPPLIER_RETRY } from './constants';
import type { SearchRequest, SearchResult, SupplierId, SupplierOutcome } from '../domain/types';

const { fetchSupplierA, fetchSupplierB } = proxyActivities<typeof activities>({
  startToCloseTimeout: ACTIVITY_START_TO_CLOSE_MS,
  retry: {
    initialInterval: SUPPLIER_RETRY.initialIntervalMs,
    backoffCoefficient: SUPPLIER_RETRY.backoffCoefficient,
    maximumInterval: SUPPLIER_RETRY.maximumIntervalMs,
    maximumAttempts: SUPPLIER_RETRY.maximumAttempts,
  },
});

/**
 * Unwraps Temporal's failure chain (ActivityFailure -> ApplicationFailure -> ...)
 * down to the innermost message, which is the one that says what the supplier
 * actually did wrong.
 */
function describeError(err: unknown): string {
  let current: unknown = err;
  let message = '';
  while (current instanceof Error) {
    if (current.message) message = current.message;
    current = current.cause;
  }
  return message || String(err);
}

/** Lets the API (or Temporal UI) inspect what each supplier has answered so far. */
export const supplierOutcomesQuery = defineQuery<SupplierOutcome[]>('supplierOutcomes');

/**
 * Fetches rates from both suppliers in parallel and returns the cheapest offer.
 *
 * Failure handling is per supplier: each call gets its own retry policy and its
 * own 5s wall-clock deadline enforced by a cancellation scope, so one slow or
 * broken supplier can never hold up the other. The workflow itself only fails
 * for unexpected (non-supplier) errors — supplier problems are reported through
 * the returned status.
 */
export async function searchHotelsWorkflow(request: SearchRequest): Promise<SearchResult> {
  const outcomes: SupplierOutcome[] = [];
  setHandler(supplierOutcomesQuery, () => outcomes);

  // Records an external cancellation (`client.cancel()`) so we can distinguish it
  // from the per-supplier deadline, which cancels a child scope only.
  let cancelledByCaller = false;
  CancellationScope.current().cancelRequested.catch(() => {
    cancelledByCaller = true;
  });

  const deadlineMs = request.supplierDeadlineMs ?? SUPPLIER_DEADLINE_MS;

  const callSupplier = async (supplier: SupplierId): Promise<SupplierOutcome> => {
    const startedAt = Date.now();
    const activity = supplier === 'A' ? fetchSupplierA : fetchSupplierB;
    try {
      // Cancels the activity (and stops retrying) once the deadline elapses.
      const hotels = await CancellationScope.withTimeout(deadlineMs, () =>
        activity(request),
      );
      const durationMs = Date.now() - startedAt;
      return hotels.length === 0
        ? { supplier, status: 'empty', hotels: [], durationMs }
        : { supplier, status: 'ok', hotels, durationMs };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      if (isCancellation(err)) {
        return {
          supplier,
          status: 'timed_out',
          error: cancelledByCaller
            ? 'Cancelled: the search was cancelled by the caller'
            : `Cancelled: supplier did not respond within ${deadlineMs}ms`,
          durationMs,
        };
      }
      return { supplier, status: 'failed', error: describeError(err), durationMs };
    }
  };

  const settled = await Promise.all([callSupplier('A'), callSupplier('B')]);
  outcomes.push(...settled);

  if (cancelledByCaller) {
    // Graceful stop: report the cancellation instead of failing the workflow.
    return { status: 'CANCELLED', message: 'Search cancelled by the caller', suppliers: outcomes };
  }

  return summarise(outcomes);
}
