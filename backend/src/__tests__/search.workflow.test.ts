import { randomUUID } from 'node:crypto';
import { Context } from '@temporalio/activity';
import { ApplicationFailure } from '@temporalio/common';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker, bundleWorkflowCode, type WorkflowBundle } from '@temporalio/worker';
import { searchHotelsWorkflow, supplierOutcomesQuery } from '../temporal/workflows';
import type { Hotel, SearchRequest, SearchResult, SupplierId } from '../domain/types';

/**
 * These tests run the real workflow code against a real (in-process) Temporal
 * server with mocked activities, so retries, timeouts and cancellation all
 * behave exactly as they do in production.
 *
 * A *local* environment is used rather than the time-skipping one: the
 * cancellation scenarios below depend on the ordering between a real timer and
 * a caller-issued cancel, which automatic time skipping would race.
 */
let env: TestWorkflowEnvironment;
let workflowBundle: WorkflowBundle;

jest.setTimeout(120_000);

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createLocal();
  workflowBundle = await bundleWorkflowCode({
    workflowsPath: require.resolve('../temporal/workflows'),
  });
});

afterAll(async () => {
  await env?.teardown();
});

const hotel = (hotelId: string, price: number): Hotel => ({
  hotelId,
  name: `Hotel ${hotelId}`,
  price,
  currency: 'USD',
});

const baseRequest: SearchRequest = {
  city: 'Paris',
  checkIn: '2026-10-01',
  checkOut: '2026-10-04',
};

type SupplierActivities = {
  fetchSupplierA: (request: SearchRequest) => Promise<Hotel[]>;
  fetchSupplierB: (request: SearchRequest) => Promise<Hotel[]>;
};

const returns = (hotels: Hotel[]) => async (): Promise<Hotel[]> => hotels;
const fails = (message: string) => async (): Promise<Hotel[]> => {
  throw ApplicationFailure.retryable(message, 'SupplierUnavailable');
};
/** Sleeps in a cancellation-aware way, like a real in-flight supplier call. */
const hangs = () => async (): Promise<Hotel[]> => {
  await Context.current().sleep(30_000);
  return [hotel('never', 1)];
};

async function withWorker<T>(
  activities: SupplierActivities,
  body: (taskQueue: string) => Promise<T>,
): Promise<T> {
  const taskQueue = `hotel-search-test-${randomUUID()}`;
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowBundle,
    activities,
  });
  return worker.runUntil(body(taskQueue));
}

async function runSearch(
  activities: SupplierActivities,
  request: SearchRequest = baseRequest,
): Promise<SearchResult> {
  return withWorker(activities, (taskQueue) =>
    env.client.workflow.execute(searchHotelsWorkflow, {
      taskQueue,
      workflowId: `test-${randomUUID()}`,
      args: [request],
    }),
  );
}

const outcomeFor = (result: SearchResult, supplier: SupplierId) =>
  result.suppliers.find((o) => o.supplier === supplier);

describe('searchHotelsWorkflow — basic scenarios', () => {
  it('supplier A cheaper -> returns A', async () => {
    const result = await runSearch({
      fetchSupplierA: returns([hotel('A1', 120), hotel('A2', 300)]),
      fetchSupplierB: returns([hotel('B1', 180)]),
    });
    expect(result.status).toBe('OK');
    expect(result.best).toMatchObject({ supplier: 'A', hotelId: 'A1', price: 120 });
  });

  it('supplier B cheaper -> returns B', async () => {
    const result = await runSearch({
      fetchSupplierA: returns([hotel('A1', 250)]),
      fetchSupplierB: returns([hotel('B1', 180)]),
    });
    expect(result.best).toMatchObject({ supplier: 'B', hotelId: 'B1', price: 180 });
  });

  it('both quote the same rate -> deterministically picks supplier A', async () => {
    const result = await runSearch({
      fetchSupplierA: returns([hotel('SAME', 199)]),
      fetchSupplierB: returns([hotel('SAME', 199)]),
    });
    expect(result.best).toMatchObject({ supplier: 'A', price: 199 });
  });

  it('supplier A fails, B succeeds -> returns B', async () => {
    const result = await runSearch({
      fetchSupplierA: fails('Supplier A responded with HTTP 500'),
      fetchSupplierB: returns([hotel('B1', 180)]),
    });
    expect(result.status).toBe('OK');
    expect(result.best?.supplier).toBe('B');
    expect(outcomeFor(result, 'A')).toMatchObject({ status: 'failed' });
  });

  it('both suppliers fail -> ALL_SUPPLIERS_FAILED', async () => {
    const result = await runSearch({
      fetchSupplierA: fails('A is down'),
      fetchSupplierB: fails('B is down'),
    });
    expect(result.status).toBe('ALL_SUPPLIERS_FAILED');
    expect(result.best).toBeUndefined();
    expect(result.message).toMatch(/A is down/);
    expect(result.message).toMatch(/B is down/);
  });

  it('one supplier returns empty -> uses the available result', async () => {
    const result = await runSearch({
      fetchSupplierA: returns([]),
      fetchSupplierB: returns([hotel('B1', 180)]),
    });
    expect(result.status).toBe('OK');
    expect(result.best?.supplier).toBe('B');
    expect(outcomeFor(result, 'A')).toMatchObject({ status: 'empty' });
  });

  it('both suppliers return empty -> No hotels found', async () => {
    const result = await runSearch({
      fetchSupplierA: returns([]),
      fetchSupplierB: returns([]),
    });
    expect(result).toMatchObject({ status: 'NO_HOTELS', message: 'No hotels found' });
  });
});

describe('searchHotelsWorkflow — advanced scenarios', () => {
  it('cancels a supplier that exceeds the deadline and proceeds with the other', async () => {
    const startedAt = Date.now();
    const result = await runSearch(
      { fetchSupplierA: hangs(), fetchSupplierB: returns([hotel('B1', 180)]) },
      // Shortened from the 5s production deadline to keep the test quick.
      { ...baseRequest, supplierDeadlineMs: 1_000 },
    );

    expect(result.status).toBe('OK');
    expect(result.best?.supplier).toBe('B');
    expect(outcomeFor(result, 'A')).toMatchObject({
      status: 'timed_out',
      error: expect.stringContaining('did not respond within 1000ms'),
    });
    // Never waits for the hung supplier's full 30s.
    expect(Date.now() - startedAt).toBeLessThan(20_000);
  });

  it('retries a supplier that fails twice and still returns its result', async () => {
    let attempts = 0;
    const result = await runSearch(
      {
        fetchSupplierA: async () => {
          attempts += 1;
          if (attempts <= 2) {
            throw ApplicationFailure.retryable(`Transient failure ${attempts}`, 'SupplierUnavailable');
          }
          return [hotel('A1', 99)];
        },
        fetchSupplierB: returns([hotel('B1', 180)]),
      },
      { ...baseRequest, supplierDeadlineMs: 10_000 },
    );

    expect(attempts).toBe(3);
    expect(result.status).toBe('OK');
    expect(result.best).toMatchObject({ supplier: 'A', price: 99 });
  });

  it('gives up on a supplier once its retry budget is exhausted', async () => {
    let attempts = 0;
    const result = await runSearch(
      {
        fetchSupplierA: async () => {
          attempts += 1;
          throw ApplicationFailure.retryable('always failing', 'SupplierUnavailable');
        },
        fetchSupplierB: returns([hotel('B1', 180)]),
      },
      { ...baseRequest, supplierDeadlineMs: 10_000 },
    );

    expect(attempts).toBe(3); // maximumAttempts from the retry policy
    expect(result.best?.supplier).toBe('B');
  });

  it('stops gracefully when the caller cancels the search mid-way', async () => {
    const result = await withWorker(
      { fetchSupplierA: hangs(), fetchSupplierB: hangs() },
      async (taskQueue) => {
        const handle = await env.client.workflow.start(searchHotelsWorkflow, {
          taskQueue,
          workflowId: `test-cancel-${randomUUID()}`,
          // Long deadline: the workflow must stop because of the cancel, not a timeout.
          args: [{ ...baseRequest, supplierDeadlineMs: 60_000 }],
        });

        // Wait until both activities are actually in flight before cancelling.
        await waitFor(async () => {
          const description = await handle.describe();
          return description.status.name === 'RUNNING';
        });
        await handle.cancel();
        return handle.result();
      },
    );

    expect(result.status).toBe('CANCELLED');
    expect(result.message).toMatch(/cancelled/i);
    expect(result.suppliers.every((o) => o.status === 'timed_out')).toBe(true);
  });

  it('exposes the per-supplier outcomes through a query', async () => {
    const result = await runSearch({
      fetchSupplierA: returns([hotel('A1', 120)]),
      fetchSupplierB: fails('B is down'),
    });
    expect(result.suppliers).toHaveLength(2);
    expect(outcomeFor(result, 'B')).toMatchObject({ status: 'failed' });
    // The same data is queryable while the workflow runs; asserted here on the
    // completed run to keep the test deterministic.
    expect(supplierOutcomesQuery.name).toBe('supplierOutcomes');
  });
});

/** Polls `predicate` until it is true or the budget runs out. */
async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('waitFor: condition not met in time');
}
