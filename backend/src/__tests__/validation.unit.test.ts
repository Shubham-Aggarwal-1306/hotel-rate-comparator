import { parseSearchRequest } from '../api/validation';

const valid = { city: 'Paris', checkIn: '2026-10-01', checkOut: '2026-10-04' };

describe('parseSearchRequest', () => {
  it('accepts and trims a valid payload', () => {
    const parsed = parseSearchRequest({ ...valid, city: '  Paris  ' });
    expect(parsed).toEqual({ ok: true, value: valid });
  });

  it('rejects a missing city', () => {
    const parsed = parseSearchRequest({ ...valid, city: '   ' });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors).toContainEqual({ field: 'city', message: 'City is required' });
  });

  it.each(['2026-13-01', 'tomorrow', '', '2026-02-30'])('rejects invalid date %p', (checkIn) => {
    const parsed = parseSearchRequest({ ...valid, checkIn });
    expect(parsed.ok).toBe(false);
  });

  it('rejects a check-out that is not after check-in', () => {
    const parsed = parseSearchRequest({ ...valid, checkOut: valid.checkIn });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors[0].field).toBe('checkOut');
  });

  it('keeps known supplier behaviours and rejects unknown ones', () => {
    const good = parseSearchRequest({ ...valid, scenario: { A: 'error', B: '' } });
    expect(good.ok && good.value.scenario).toEqual({ A: 'error' });

    const bad = parseSearchRequest({ ...valid, scenario: { A: 'explode' } });
    expect(bad.ok).toBe(false);
  });
});
