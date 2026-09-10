import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MockActivityEnvironment } from '@temporalio/testing';
import { createSupplierApp } from '../suppliers/app';
import { fetchSupplierA, fetchSupplierB } from '../temporal/activities';
import type { Hotel, SearchRequest } from '../domain/types';

const request: SearchRequest = { city: 'Paris', checkIn: '2026-10-01', checkOut: '2026-10-04' };

const withScenario = (scenario: SearchRequest['scenario']): SearchRequest => ({ ...request, scenario });

let server: Server;
let previousBaseUrl: string | undefined;

/** Assign or clear an env var — assigning `undefined` would store the string "undefined". */
function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeAll(async () => {
  const app = createSupplierApp({ chaos: false, slowMs: 2_000, flakyFailures: 2 });
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  previousBaseUrl = process.env.SUPPLIERS_BASE_URL;
  process.env.SUPPLIERS_BASE_URL = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  setEnv('SUPPLIERS_BASE_URL', previousBaseUrl);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  delete process.env.SUPPLIER_HTTP_TIMEOUT_MS;
});

describe('supplier activities', () => {
  it('fetches hotels from supplier A', async () => {
    const env = new MockActivityEnvironment();
    const hotels = (await env.run(fetchSupplierA, request)) as Hotel[];
    expect(hotels.length).toBeGreaterThan(0);
    expect(hotels[0]).toHaveProperty('price');
  });

  it('fetches hotels from supplier B', async () => {
    const env = new MockActivityEnvironment();
    const hotels = (await env.run(fetchSupplierB, request)) as Hotel[];
    expect(hotels.length).toBeGreaterThan(0);
  });

  it('returns an empty array when the supplier has no inventory', async () => {
    const env = new MockActivityEnvironment();
    const hotels = (await env.run(fetchSupplierA, withScenario({ A: 'empty' }))) as Hotel[];
    expect(hotels).toEqual([]);
  });

  it('throws a retryable failure on a supplier 500', async () => {
    const env = new MockActivityEnvironment();
    await expect(env.run(fetchSupplierA, withScenario({ A: 'error' }))).rejects.toThrow(
      /HTTP 500/,
    );
  });

  it('aborts the HTTP call once the per-attempt timeout elapses', async () => {
    process.env.SUPPLIER_HTTP_TIMEOUT_MS = '150';
    const env = new MockActivityEnvironment();
    await expect(env.run(fetchSupplierA, withScenario({ A: 'slow' }))).rejects.toThrow(
      /timed out after 150ms/,
    );
  });

  it('aborts the in-flight request when the activity is cancelled', async () => {
    const env = new MockActivityEnvironment();
    const pending = env.run(fetchSupplierB, withScenario({ B: 'slow' }));
    setTimeout(() => env.cancel(), 50);
    await expect(pending).rejects.toThrow();
  });
});
