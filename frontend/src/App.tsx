import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react';
import { cancelSearch, searchHotels, SearchError } from './api';
import type { SearchFormValues, SearchResponse, SupplierBehaviour, SupplierOutcome } from './types';

const BEHAVIOURS: Array<{ value: SupplierBehaviour | ''; label: string }> = [
  { value: '', label: 'Default (healthy)' },
  { value: 'cheap', label: 'Discounted rates' },
  { value: 'expensive', label: 'Expensive rates' },
  { value: 'tie', label: 'Same rate as the other supplier' },
  { value: 'empty', label: 'No hotels' },
  { value: 'error', label: 'Server error (500)' },
  { value: 'flaky', label: 'Fails twice, then succeeds' },
  { value: 'slow', label: 'Slow (7s — past the 5s deadline)' },
  { value: 'timeout', label: 'Never responds' },
];

function isoDate(daysFromToday: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
}

function newSearchId(): string {
  return crypto.randomUUID();
}

const money = (price: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(price);

function SupplierRow({ outcome }: { outcome: SupplierOutcome }) {
  const detail =
    outcome.status === 'ok'
      ? `${outcome.hotels.length} hotel(s)`
      : outcome.status === 'empty'
        ? 'no hotels'
        : outcome.error;
  return (
    <li className={`supplier supplier--${outcome.status}`}>
      <strong>Supplier {outcome.supplier}</strong>
      <span className="supplier__status">{outcome.status.replace('_', ' ')}</span>
      <span className="supplier__detail">{detail}</span>
      <span className="supplier__duration">{outcome.durationMs} ms</span>
    </li>
  );
}

export function App() {
  const [values, setValues] = useState<SearchFormValues>({
    city: 'Paris',
    checkIn: isoDate(30),
    checkOut: isoDate(33),
    scenarioA: '',
    scenarioB: '',
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchIdRef = useRef<string | null>(null);

  const update = useCallback(
    <K extends keyof SearchFormValues>(key: K, value: SearchFormValues[K]) =>
      setValues((current) => ({ ...current, [key]: value })),
    [],
  );

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const searchId = newSearchId();
    searchIdRef.current = searchId;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await searchHotels(values, searchId);
      setResult(response);
      if (response.status === 'ALL_SUPPLIERS_FAILED') {
        setError(response.message ?? 'Both suppliers failed. Please try again.');
      }
    } catch (err) {
      setError(err instanceof SearchError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
      searchIdRef.current = null;
    }
  };

  const onCancel = async () => {
    if (searchIdRef.current) await cancelSearch(searchIdRef.current);
  };

  const banner = useMemo(() => {
    if (!result) return null;
    if (result.status === 'NO_HOTELS') return 'No hotels found for those dates.';
    if (result.status === 'CANCELLED') return 'Search cancelled.';
    return null;
  }, [result]);

  return (
    <main className="page">
      <h1>Hotel Rate Comparator</h1>
      <p className="subtitle">
        Queries two suppliers in parallel through a Temporal workflow and returns the cheapest rate.
      </p>

      <form className="card" onSubmit={onSubmit}>
        <label>
          City
          <input
            required
            value={values.city}
            onChange={(e) => update('city', e.target.value)}
            placeholder="e.g. Paris"
          />
        </label>

        <div className="row">
          <label>
            Check-in
            <input
              required
              type="date"
              value={values.checkIn}
              onChange={(e) => update('checkIn', e.target.value)}
            />
          </label>
          <label>
            Check-out
            <input
              required
              type="date"
              value={values.checkOut}
              onChange={(e) => update('checkOut', e.target.value)}
            />
          </label>
        </div>

        <details className="scenarios">
          <summary>Simulate supplier behaviour</summary>
          <div className="row">
            <label>
              Supplier A
              <select
                value={values.scenarioA}
                onChange={(e) => update('scenarioA', e.target.value as SupplierBehaviour | '')}
              >
                {BEHAVIOURS.map((b) => (
                  <option key={`a-${b.value}`} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Supplier B
              <select
                value={values.scenarioB}
                onChange={(e) => update('scenarioB', e.target.value as SupplierBehaviour | '')}
              >
                {BEHAVIOURS.map((b) => (
                  <option key={`b-${b.value}`} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>

        <div className="actions">
          <button type="submit" disabled={loading}>
            {loading ? 'Searching…' : 'Search hotels'}
          </button>
          {loading && (
            <button type="button" className="secondary" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {loading && <p className="status" role="status">Contacting suppliers…</p>}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {banner && <p className="status" role="status">{banner}</p>}

      {result?.status === 'OK' && result.best && (
        <section className="card result">
          <h2>Best rate</h2>
          <p className="hotel-name">{result.best.name}</p>
          <p className="price">{money(result.best.price, result.best.currency)}</p>
          <p className="meta">
            Supplier {result.best.supplier} · hotel {result.best.hotelId}
          </p>
        </section>
      )}

      {result && result.suppliers.length > 0 && (
        <section className="card">
          <h2>Supplier detail</h2>
          <ul className="suppliers">
            {result.suppliers.map((outcome) => (
              <SupplierRow key={outcome.supplier} outcome={outcome} />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
