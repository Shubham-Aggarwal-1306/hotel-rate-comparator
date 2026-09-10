import { pickCheapest, summarise, toOffers } from '../domain/compare';
import type { Hotel, SupplierOutcome } from '../domain/types';

const hotel = (hotelId: string, price: number, name = hotelId): Hotel => ({
  hotelId,
  name,
  price,
  currency: 'USD',
});

const ok = (supplier: 'A' | 'B', hotels: Hotel[]): SupplierOutcome => ({
  supplier,
  status: 'ok',
  hotels,
  durationMs: 10,
});

const empty = (supplier: 'A' | 'B'): SupplierOutcome => ({
  supplier,
  status: 'empty',
  hotels: [],
  durationMs: 10,
});

const failed = (supplier: 'A' | 'B', error = 'boom'): SupplierOutcome => ({
  supplier,
  status: 'failed',
  error,
  durationMs: 10,
});

describe('pickCheapest', () => {
  it('returns undefined when there is nothing to compare', () => {
    expect(pickCheapest([])).toBeUndefined();
  });

  it('picks the lowest price across suppliers', () => {
    const offers = [
      ...toOffers('A', [hotel('H1', 200), hotel('H2', 150)]),
      ...toOffers('B', [hotel('H3', 120)]),
    ];
    expect(pickCheapest(offers)).toMatchObject({ hotelId: 'H3', supplier: 'B', price: 120 });
  });

  it('breaks exact ties in favour of supplier A, deterministically', () => {
    const offers = [...toOffers('B', [hotel('H1', 199)]), ...toOffers('A', [hotel('H2', 199)])];
    // Same input in the other order must give the same answer.
    const reversed = [...offers].reverse();
    expect(pickCheapest(offers)?.supplier).toBe('A');
    expect(pickCheapest(reversed)?.supplier).toBe('A');
  });

  it('falls back to hotelId when price and supplier tie', () => {
    const offers = toOffers('A', [hotel('H9', 100), hotel('H1', 100)]);
    expect(pickCheapest(offers)?.hotelId).toBe('H1');
  });
});

describe('summarise', () => {
  it('supplier A cheaper -> returns A', () => {
    const result = summarise([ok('A', [hotel('H1', 100)]), ok('B', [hotel('H2', 150)])]);
    expect(result.status).toBe('OK');
    expect(result.best).toMatchObject({ supplier: 'A', price: 100 });
  });

  it('supplier B cheaper -> returns B', () => {
    const result = summarise([ok('A', [hotel('H1', 300)]), ok('B', [hotel('H2', 150)])]);
    expect(result.best).toMatchObject({ supplier: 'B', price: 150 });
  });

  it('same rate -> picks supplier A', () => {
    const result = summarise([ok('A', [hotel('H1', 199)]), ok('B', [hotel('H1', 199)])]);
    expect(result.best).toMatchObject({ supplier: 'A', price: 199 });
  });

  it('one supplier fails -> uses the other', () => {
    const result = summarise([failed('A'), ok('B', [hotel('H2', 150)])]);
    expect(result.status).toBe('OK');
    expect(result.best?.supplier).toBe('B');
  });

  it('both fail -> ALL_SUPPLIERS_FAILED with both reasons', () => {
    const result = summarise([failed('A', 'HTTP 500'), failed('B', 'timeout')]);
    expect(result.status).toBe('ALL_SUPPLIERS_FAILED');
    expect(result.message).toContain('HTTP 500');
    expect(result.message).toContain('timeout');
    expect(result.best).toBeUndefined();
  });

  it('one empty -> uses the available result', () => {
    const result = summarise([empty('A'), ok('B', [hotel('H2', 150)])]);
    expect(result.best?.supplier).toBe('B');
  });

  it('both empty -> NO_HOTELS', () => {
    const result = summarise([empty('A'), empty('B')]);
    expect(result.status).toBe('NO_HOTELS');
    expect(result.message).toBe('No hotels found');
  });

  it('one empty and one failed -> NO_HOTELS (a supplier did answer)', () => {
    const result = summarise([empty('A'), failed('B')]);
    expect(result.status).toBe('NO_HOTELS');
  });
});
