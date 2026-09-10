/** Domain types shared by the API, the workflow, the activities and the frontend. */

export type SupplierId = 'A' | 'B';

/** A single hotel offer as returned by a supplier. */
export interface Hotel {
  hotelId: string;
  name: string;
  /** Nightly-total price for the whole stay, in `currency`. */
  price: number;
  currency: string;
}

/** A hotel offer annotated with the supplier it came from. */
export interface HotelOffer extends Hotel {
  supplier: SupplierId;
}

export interface SearchRequest {
  city: string;
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
  /**
   * Optional forced behaviour for the mock suppliers, e.g. `{ A: 'error', B: 'ok' }`.
   * Only used to make demos and tests deterministic; ignored in "real" operation.
   */
  scenario?: Partial<Record<SupplierId, SupplierBehaviour>>;
  /**
   * Overrides the per-supplier wall-clock deadline. Used by tests and demos;
   * production callers leave it unset and get {@link SUPPLIER_DEADLINE_MS}.
   */
  supplierDeadlineMs?: number;
}

export type SupplierBehaviour =
  | 'ok'
  | 'cheap'
  | 'expensive'
  | 'empty'
  | 'error'
  | 'slow'
  | 'timeout'
  | 'flaky'
  | 'tie';

/** Outcome of talking to one supplier, recorded for observability. */
export type SupplierOutcome =
  | { supplier: SupplierId; status: 'ok'; hotels: Hotel[]; durationMs: number }
  | { supplier: SupplierId; status: 'empty'; hotels: []; durationMs: number }
  | { supplier: SupplierId; status: 'failed'; error: string; durationMs: number }
  | { supplier: SupplierId; status: 'timed_out'; error: string; durationMs: number };

export type SearchStatus = 'OK' | 'NO_HOTELS' | 'ALL_SUPPLIERS_FAILED' | 'CANCELLED';

export interface SearchResult {
  status: SearchStatus;
  /** The cheapest offer. Present only when `status === 'OK'`. */
  best?: HotelOffer;
  /** Human readable explanation, always present for non-OK statuses. */
  message?: string;
  /** Per-supplier detail — useful for the UI and for debugging. */
  suppliers: SupplierOutcome[];
}
