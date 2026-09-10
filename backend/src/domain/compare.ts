import type { Hotel, HotelOffer, SearchResult, SupplierId, SupplierOutcome } from './types';

/** Supplier preference used to break exact price ties. Supplier A wins by design. */
const TIE_BREAK_ORDER: SupplierId[] = ['A', 'B'];

function supplierRank(supplier: SupplierId): number {
  const index = TIE_BREAK_ORDER.indexOf(supplier);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export function toOffers(supplier: SupplierId, hotels: Hotel[]): HotelOffer[] {
  return hotels.map((hotel) => ({ ...hotel, supplier }));
}

/**
 * Picks the cheapest offer.
 *
 * Ordering is fully deterministic so that a workflow replay (or a retry) always
 * reaches the same conclusion: price, then supplier preference (A before B),
 * then hotelId as a final stable tie-break.
 */
export function pickCheapest(offers: HotelOffer[]): HotelOffer | undefined {
  if (offers.length === 0) return undefined;
  return [...offers].sort(
    (a, b) =>
      a.price - b.price ||
      supplierRank(a.supplier) - supplierRank(b.supplier) ||
      a.hotelId.localeCompare(b.hotelId),
  )[0];
}

/**
 * Folds the per-supplier outcomes into the result the client receives.
 *
 * Rules:
 *  - at least one hotel anywhere  -> OK with the cheapest offer
 *  - every supplier failed        -> ALL_SUPPLIERS_FAILED
 *  - suppliers answered, but with no hotels -> NO_HOTELS
 */
export function summarise(outcomes: SupplierOutcome[]): SearchResult {
  const offers = outcomes.flatMap((outcome) =>
    outcome.status === 'ok' ? toOffers(outcome.supplier, outcome.hotels) : [],
  );

  const best = pickCheapest(offers);
  if (best) {
    return { status: 'OK', best, suppliers: outcomes };
  }

  const answered = outcomes.filter((o) => o.status === 'ok' || o.status === 'empty');
  if (answered.length === 0) {
    const detail = outcomes
      .map((o) => `${o.supplier}: ${'error' in o ? o.error : 'unknown error'}`)
      .join('; ');
    return {
      status: 'ALL_SUPPLIERS_FAILED',
      message: `All suppliers failed (${detail || 'no suppliers responded'})`,
      suppliers: outcomes,
    };
  }

  return { status: 'NO_HOTELS', message: 'No hotels found', suppliers: outcomes };
}
