import type { Hotel, SupplierId } from '../domain/types';

/**
 * Deterministic mock inventory. Both suppliers sell overlapping hotels at
 * different prices so that "A cheaper" / "B cheaper" / "same price" are all
 * reachable through the behaviour switches below.
 */
const BASE: Record<SupplierId, Hotel[]> = {
  A: [
    { hotelId: 'H-1001', name: 'Grand Central Hotel', price: 180, currency: 'USD' },
    { hotelId: 'H-1002', name: 'Riverside Inn', price: 145, currency: 'USD' },
    { hotelId: 'H-1003', name: 'Sunset Suites', price: 220, currency: 'USD' },
  ],
  B: [
    { hotelId: 'H-1001', name: 'Grand Central Hotel', price: 175, currency: 'USD' },
    { hotelId: 'H-2002', name: 'Harbour View Lodge', price: 155, currency: 'USD' },
    { hotelId: 'H-2003', name: 'City Garden Hotel', price: 210, currency: 'USD' },
  ],
};

/** Cheap, stable per-city jitter so different cities return different prices. */
function cityOffset(city: string): number {
  let hash = 0;
  for (const char of city.trim().toLowerCase()) {
    hash = (hash * 31 + char.charCodeAt(0)) % 997;
  }
  return hash % 40; // 0..39
}

export function catalogFor(supplier: SupplierId, city: string, priceFactor = 1): Hotel[] {
  const offset = cityOffset(city);
  return BASE[supplier].map((hotel) => ({
    ...hotel,
    name: `${hotel.name} ${city.trim()}`,
    price: Math.round((hotel.price + offset) * priceFactor),
  }));
}
