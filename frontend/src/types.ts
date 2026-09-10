/**
 * Mirror of the backend's API contract (`backend/src/domain/types.ts`).
 * Duplicated deliberately so the frontend builds without a shared build step.
 */
export type SupplierId = 'A' | 'B';

export type SupplierBehaviour =
  | 'ok' | 'cheap' | 'expensive' | 'empty' | 'error' | 'slow' | 'timeout' | 'flaky' | 'tie';

export interface HotelOffer {
  hotelId: string;
  name: string;
  price: number;
  currency: string;
  supplier: SupplierId;
}

export type SupplierOutcome =
  | { supplier: SupplierId; status: 'ok'; hotels: HotelOffer[]; durationMs: number }
  | { supplier: SupplierId; status: 'empty'; hotels: []; durationMs: number }
  | { supplier: SupplierId; status: 'failed'; error: string; durationMs: number }
  | { supplier: SupplierId; status: 'timed_out'; error: string; durationMs: number };

export interface SearchResponse {
  searchId: string;
  status: 'OK' | 'NO_HOTELS' | 'ALL_SUPPLIERS_FAILED' | 'CANCELLED';
  best?: HotelOffer;
  message?: string;
  suppliers: SupplierOutcome[];
}

export interface SearchFormValues {
  city: string;
  checkIn: string;
  checkOut: string;
  scenarioA: SupplierBehaviour | '';
  scenarioB: SupplierBehaviour | '';
}
