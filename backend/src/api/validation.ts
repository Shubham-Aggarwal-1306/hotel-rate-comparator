import type { SearchRequest, SupplierBehaviour } from '../domain/types';

export interface ValidationError {
  field: string;
  message: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BEHAVIOURS: SupplierBehaviour[] = [
  'ok', 'cheap', 'expensive', 'empty', 'error', 'slow', 'timeout', 'flaky', 'tie',
];

function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/** Validates and normalises the search form payload. */
export function parseSearchRequest(
  body: unknown,
): { ok: true; value: SearchRequest } | { ok: false; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const input = (body ?? {}) as Record<string, unknown>;

  const city = typeof input.city === 'string' ? input.city.trim() : '';
  if (!city) errors.push({ field: 'city', message: 'City is required' });

  const checkIn = typeof input.checkIn === 'string' ? input.checkIn.trim() : '';
  const checkOut = typeof input.checkOut === 'string' ? input.checkOut.trim() : '';

  if (!isValidDate(checkIn)) {
    errors.push({ field: 'checkIn', message: 'Check-in must be a valid YYYY-MM-DD date' });
  }
  if (!isValidDate(checkOut)) {
    errors.push({ field: 'checkOut', message: 'Check-out must be a valid YYYY-MM-DD date' });
  }
  if (isValidDate(checkIn) && isValidDate(checkOut) && checkOut <= checkIn) {
    errors.push({ field: 'checkOut', message: 'Check-out must be after check-in' });
  }

  const scenario: SearchRequest['scenario'] = {};
  const rawScenario = (input.scenario ?? {}) as Record<string, unknown>;
  for (const supplier of ['A', 'B'] as const) {
    const value = rawScenario[supplier];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' || !BEHAVIOURS.includes(value as SupplierBehaviour)) {
      errors.push({ field: `scenario.${supplier}`, message: `Unknown supplier behaviour "${String(value)}"` });
      continue;
    }
    scenario[supplier] = value as SupplierBehaviour;
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      city,
      checkIn,
      checkOut,
      ...(Object.keys(scenario).length > 0 ? { scenario } : {}),
    },
  };
}
