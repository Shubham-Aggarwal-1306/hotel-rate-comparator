import { Context } from '@temporalio/activity';
import { ApplicationFailure } from '@temporalio/common';
import { suppliersBaseUrl, supplierHttpTimeoutMs } from './config';
import type { Hotel, SearchRequest, SupplierId } from '../domain/types';

const PATHS: Record<SupplierId, string> = {
  A: '/supplierA/hotels',
  B: '/supplierB/hotels',
};

function buildUrl(supplier: SupplierId, request: SearchRequest): string {
  const url = new URL(PATHS[supplier], suppliersBaseUrl());
  url.searchParams.set('city', request.city);
  url.searchParams.set('checkIn', request.checkIn);
  url.searchParams.set('checkOut', request.checkOut);
  const behaviour = request.scenario?.[supplier];
  if (behaviour) url.searchParams.set('behavior', behaviour);
  return url.toString();
}

/**
 * Calls one supplier over HTTP.
 *
 * Aborts on either the per-attempt HTTP timeout or activity cancellation (which
 * is what lets the workflow abandon a slow supplier). Any failure is thrown as a
 * retryable ApplicationFailure so Temporal's retry policy applies; a malformed
 * payload is non-retryable because retrying cannot fix it.
 */
async function fetchFromSupplier(supplier: SupplierId, request: SearchRequest): Promise<Hotel[]> {
  const controller = new AbortController();
  const httpTimeoutMs = supplierHttpTimeoutMs();
  const timer = setTimeout(() => controller.abort(), httpTimeoutMs);

  // Propagate Temporal activity cancellation into the in-flight HTTP request.
  const onCancel = () => controller.abort();
  const cancellationSignal = Context.current().cancellationSignal;
  cancellationSignal.addEventListener('abort', onCancel, { once: true });

  try {
    const response = await fetch(buildUrl(supplier, request), { signal: controller.signal });

    if (!response.ok) {
      throw ApplicationFailure.retryable(
        `Supplier ${supplier} responded with HTTP ${response.status}`,
        'SupplierHttpError',
      );
    }

    const body = (await response.json()) as { hotels?: unknown };
    if (!Array.isArray(body.hotels)) {
      throw ApplicationFailure.nonRetryable(
        `Supplier ${supplier} returned a malformed payload`,
        'SupplierProtocolError',
      );
    }
    return body.hotels as Hotel[];
  } catch (err) {
    if (err instanceof ApplicationFailure) throw err;
    if (cancellationSignal.aborted) throw err; // let Temporal see the cancellation
    const reason = (err as Error)?.name === 'AbortError'
      ? `timed out after ${httpTimeoutMs}ms`
      : ((err as Error)?.message ?? String(err));
    throw ApplicationFailure.retryable(`Supplier ${supplier} request failed: ${reason}`, 'SupplierUnavailable');
  } finally {
    clearTimeout(timer);
    cancellationSignal.removeEventListener('abort', onCancel);
  }
}

export async function fetchSupplierA(request: SearchRequest): Promise<Hotel[]> {
  return fetchFromSupplier('A', request);
}

export async function fetchSupplierB(request: SearchRequest): Promise<Hotel[]> {
  return fetchFromSupplier('B', request);
}
