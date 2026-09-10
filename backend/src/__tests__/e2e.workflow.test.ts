import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker, bundleWorkflowCode, type WorkflowBundle } from '@temporalio/worker';
import { createSupplierApp } from '../suppliers/app';
import * as activities from '../temporal/activities';
import { searchHotelsWorkflow } from '../temporal/workflows';
import type { SearchRequest, SearchResult } from '../domain/types';

/**
 * End-to-end: real workflow + real activities + the real mock supplier HTTP API,
 * on an in-process Temporal server. Nothing is stubbed except the suppliers'
 * behaviour, which is forced per request.
 */
let env: TestWorkflowEnvironment;
let workflowBundle: WorkflowBundle;
let suppliers: Server;
let previousBaseUrl: string | undefined;

jest.setTimeout(120_000);

beforeAll(async () => {
  suppliers = await new Promise<Server>((resolve) => {
    const s = createSupplierApp({ chaos: false, slowMs: 10_000 }).listen(0, () => resolve(s));
  });
  previousBaseUrl = process.env.SUPPLIERS_BASE_URL;
  process.env.SUPPLIERS_BASE_URL = `http://127.0.0.1:${(suppliers.address() as AddressInfo).port}`;

  env = await TestWorkflowEnvironment.createLocal();
  workflowBundle = await bundleWorkflowCode({
    workflowsPath: require.resolve('../temporal/workflows'),
  });
});

afterAll(async () => {
  if (previousBaseUrl === undefined) delete process.env.SUPPLIERS_BASE_URL;
  else process.env.SUPPLIERS_BASE_URL = previousBaseUrl;
  await env?.teardown();
  await new Promise<void>((resolve) => suppliers.close(() => resolve()));
});

const request = (overrides: Partial<SearchRequest> = {}): SearchRequest => ({
  city: 'Paris',
  checkIn: '2026-10-01',
  checkOut: '2026-10-04',
  ...overrides,
});

async function search(req: SearchRequest): Promise<SearchResult> {
  const taskQueue = `hotel-search-e2e-${randomUUID()}`;
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowBundle,
    activities,
  });
  return worker.runUntil(
    env.client.workflow.execute(searchHotelsWorkflow, {
      taskQueue,
      workflowId: `e2e-${randomUUID()}`,
      args: [req],
    }),
  );
}

describe('end-to-end search against the mock suppliers', () => {
  it('returns the cheapest offer across both suppliers', async () => {
    const result = await search(request());
    expect(result.status).toBe('OK');
    expect(result.best).toBeDefined();

    const cheapestSeen = Math.min(
      ...result.suppliers.flatMap((o) => (o.status === 'ok' ? o.hotels.map((h) => h.price) : [])),
    );
    expect(result.best!.price).toBe(cheapestSeen);
  });

  it('prefers supplier B when B discounts its inventory', async () => {
    const result = await search(request({ scenario: { B: 'cheap' } }));
    expect(result.best?.supplier).toBe('B');
  });

  it('falls back to supplier B when supplier A returns 500s', async () => {
    const result = await search(request({ scenario: { A: 'error' } }));
    expect(result.status).toBe('OK');
    expect(result.best?.supplier).toBe('B');
    expect(result.suppliers.find((o) => o.supplier === 'A')).toMatchObject({ status: 'failed' });
  });

  it('reports No hotels found when both suppliers are empty', async () => {
    const result = await search(request({ scenario: { A: 'empty', B: 'empty' } }));
    expect(result).toMatchObject({ status: 'NO_HOTELS', message: 'No hotels found' });
  });

  it('reports a total outage when both suppliers are down', async () => {
    const result = await search(request({ scenario: { A: 'error', B: 'error' } }));
    expect(result.status).toBe('ALL_SUPPLIERS_FAILED');
    expect(result.message).toMatch(/HTTP 500/);
  });

  it('abandons a supplier that is slower than the deadline', async () => {
    const result = await search(request({ scenario: { A: 'slow' }, supplierDeadlineMs: 1_000 }));
    expect(result.status).toBe('OK');
    expect(result.best?.supplier).toBe('B');
    expect(result.suppliers.find((o) => o.supplier === 'A')).toMatchObject({ status: 'timed_out' });
  });

  it('recovers from a supplier that fails twice before succeeding', async () => {
    const result = await search(
      request({ city: `Flaky-${randomUUID()}`, scenario: { A: 'flaky' }, supplierDeadlineMs: 10_000 }),
    );
    expect(result.status).toBe('OK');
    expect(result.suppliers.find((o) => o.supplier === 'A')).toMatchObject({ status: 'ok' });
  });
});
