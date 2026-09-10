import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import { catalogFor } from './catalog';
import type { Hotel, SupplierBehaviour, SupplierId } from '../domain/types';


/** Weighted behaviour mix used when chaos mode is on and no behaviour is forced. */
const CHAOS_MIX: SupplierBehaviour[] = [
  'ok', 'ok', 'ok', 'ok', 'ok', 'ok',
  'cheap', 'expensive',
  'empty', 'error', 'slow',
];

/**
 * Delays a response, but stops as soon as the caller hangs up so an abandoned
 * `slow`/`timeout` request doesn't keep a timer (or the process) alive.
 */
function delay(ms: number, req: Request): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    req.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function parseBehaviour(value: unknown): SupplierBehaviour | undefined {
  const allowed: SupplierBehaviour[] = [
    'ok', 'cheap', 'expensive', 'empty', 'error', 'slow', 'timeout', 'flaky', 'tie',
  ];
  return allowed.includes(value as SupplierBehaviour) ? (value as SupplierBehaviour) : undefined;
}

function tieCatalog(city: string): Hotel[] {
  return [{ hotelId: 'H-9999', name: `Standard Rate Hotel ${city.trim()}`, price: 199, currency: 'USD' }];
}

export interface SupplierAppOptions {
  /** When true, an unspecified behaviour is drawn at random from CHAOS_MIX. */
  chaos?: boolean;
  /** Delay used by `behavior=slow` (defaults to 7s, i.e. past the workflow deadline). */
  slowMs?: number;
  /** Delay used by `behavior=timeout` — long enough that every caller gives up first. */
  timeoutMs?: number;
  /** How many times `behavior=flaky` fails before it starts succeeding. */
  flakyFailures?: number;
}

/**
 * Builds an Express app exposing `/supplierA/hotels` and `/supplierB/hotels`.
 *
 * Behaviour is controlled per request with `?behavior=<behaviour>` so tests and
 * demos are deterministic; with `chaos` enabled unspecified requests get a
 * randomly drawn behaviour instead (delays, empties, 500s...).
 */
export function createSupplierApp(options: SupplierAppOptions = {}): Express {
  const chaos = options.chaos ?? process.env.SUPPLIER_CHAOS === '1';
  const slowMs = options.slowMs ?? Number(process.env.SUPPLIER_SLOW_MS ?? 7_000);
  const timeoutMs = options.timeoutMs ?? Number(process.env.SUPPLIER_TIMEOUT_MS ?? 60_000);
  const flakyFailures = options.flakyFailures ?? Number(process.env.SUPPLIER_FLAKY_FAILURES ?? 2);
  const app = express();
  app.use(cors());

  /** Per (supplier, flakyKey) attempt counters backing the `flaky` behaviour. */
  const flakyAttempts = new Map<string, number>();

  const handler = (supplier: SupplierId) => async (req: Request, res: Response) => {
    const city = String(req.query.city ?? '').trim();
    const checkIn = String(req.query.checkIn ?? '');
    const checkOut = String(req.query.checkOut ?? '');

    if (!city || !checkIn || !checkOut) {
      res.status(400).json({ error: 'city, checkIn and checkOut are required' });
      return;
    }

    const forced = parseBehaviour(req.query.behavior);
    const behaviour: SupplierBehaviour =
      forced ?? (chaos ? CHAOS_MIX[Math.floor(Math.random() * CHAOS_MIX.length)] : 'ok');

    switch (behaviour) {
      case 'empty':
        res.json({ supplier, hotels: [] });
        return;

      case 'error':
        res.status(500).json({ supplier, error: 'Supplier upstream failure' });
        return;

      case 'slow':
        await delay(slowMs, req);
        if (req.destroyed) return;
        res.json({ supplier, hotels: catalogFor(supplier, city) });
        return;

      case 'timeout':
        // Never answers within any sane deadline; the caller must give up.
        await delay(timeoutMs, req);
        if (req.destroyed) return;
        res.json({ supplier, hotels: catalogFor(supplier, city) });
        return;

      case 'flaky': {
        const key = `${supplier}:${req.query.flakyKey ?? city}`;
        const attempt = (flakyAttempts.get(key) ?? 0) + 1;
        flakyAttempts.set(key, attempt);
        if (attempt <= flakyFailures) {
          res.status(503).json({ supplier, error: `Transient failure (attempt ${attempt})` });
          return;
        }
        res.json({ supplier, hotels: catalogFor(supplier, city), attempt });
        return;
      }

      case 'tie':
        res.json({ supplier, hotels: tieCatalog(city) });
        return;

      case 'cheap':
        res.json({ supplier, hotels: catalogFor(supplier, city, 0.6) });
        return;

      case 'expensive':
        res.json({ supplier, hotels: catalogFor(supplier, city, 1.6) });
        return;

      case 'ok':
      default:
        res.json({ supplier, hotels: catalogFor(supplier, city) });
        return;
    }
  };

  app.get('/supplierA/hotels', handler('A'));
  app.get('/supplierB/hotels', handler('B'));
  app.post('/__test__/reset', (_req, res) => {
    flakyAttempts.clear();
    res.json({ ok: true });
  });
  app.get('/health', (_req, res) => res.json({ ok: true, chaos }));

  return app;
}
