import type { SearchFormValues, SearchResponse } from './types';

/** Error carrying the message the API (or the network) reported. */
export class SearchError extends Error {}

export async function searchHotels(
  values: SearchFormValues,
  searchId: string,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const response = await fetch('/api/search-hotels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      searchId,
      city: values.city,
      checkIn: values.checkIn,
      checkOut: values.checkOut,
      scenario: { A: values.scenarioA || undefined, B: values.scenarioB || undefined },
    }),
  });

  const body = await response.json().catch(() => ({}));

  if (response.status === 400) {
    const details = (body.details ?? []) as Array<{ field: string; message: string }>;
    throw new SearchError(details.map((d) => d.message).join('. ') || 'Invalid search request');
  }
  if (!response.ok && response.status !== 502) {
    throw new SearchError(body.message ?? body.error ?? `Search failed (HTTP ${response.status})`);
  }
  return body as SearchResponse;
}

/** Asks the backend to cancel a running search; failures are non-fatal. */
export async function cancelSearch(searchId: string): Promise<void> {
  await fetch(`/api/search-hotels/${encodeURIComponent(searchId)}`, { method: 'DELETE' }).catch(
    () => undefined,
  );
}
