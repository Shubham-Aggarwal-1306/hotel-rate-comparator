import request from 'supertest';
import { createApiApp } from '../api/app';
import type { SearchRunner } from '../api/runner';
import type { SearchRequest, SearchResult } from '../domain/types';

const body = { city: 'Paris', checkIn: '2026-10-01', checkOut: '2026-10-04' };

const okResult: SearchResult = {
  status: 'OK',
  best: { hotelId: 'H1', name: 'Grand Central', price: 120, currency: 'USD', supplier: 'A' },
  suppliers: [{ supplier: 'A', status: 'ok', hotels: [], durationMs: 5 }],
};

function stubRunner(overrides: Partial<SearchRunner> = {}): SearchRunner & {
  calls: Array<{ searchId: string; request: SearchRequest }>;
} {
  const calls: Array<{ searchId: string; request: SearchRequest }> = [];
  return {
    calls,
    async run(searchId, req) {
      calls.push({ searchId, request: req });
      return okResult;
    },
    async cancel() {
      return true;
    },
    ...overrides,
  };
}

describe('POST /api/search-hotels', () => {
  it('returns the cheapest offer with the search id', async () => {
    const runner = stubRunner();
    const res = await request(createApiApp(runner)).post('/api/search-hotels').send(body).expect(200);

    expect(res.body).toMatchObject({ status: 'OK', best: { supplier: 'A', price: 120 } });
    expect(res.body.searchId).toEqual(expect.any(String));
    expect(runner.calls[0].request).toEqual(body);
  });

  it('passes a caller-supplied searchId through to the runner', async () => {
    const runner = stubRunner();
    await request(createApiApp(runner))
      .post('/api/search-hotels')
      .send({ ...body, searchId: 'my-search-1' })
      .expect(200);
    expect(runner.calls[0].searchId).toBe('my-search-1');
  });

  it('rejects an invalid payload with 400 and field details', async () => {
    const res = await request(createApiApp(stubRunner()))
      .post('/api/search-hotels')
      .send({ city: '', checkIn: 'nope', checkOut: '2026-10-04' })
      .expect(400);
    expect(res.body.details.map((d: { field: string }) => d.field)).toEqual(
      expect.arrayContaining(['city', 'checkIn']),
    );
  });

  it('rejects a malformed searchId', async () => {
    await request(createApiApp(stubRunner()))
      .post('/api/search-hotels')
      .send({ ...body, searchId: 'bad id!' })
      .expect(400);
  });

  it('maps a total supplier outage to 502', async () => {
    const runner = stubRunner({
      async run() {
        return { status: 'ALL_SUPPLIERS_FAILED', message: 'All suppliers failed', suppliers: [] };
      },
    });
    const res = await request(createApiApp(runner)).post('/api/search-hotels').send(body).expect(502);
    expect(res.body.message).toMatch(/All suppliers failed/);
  });

  it('returns 200 and NO_HOTELS when nothing is available', async () => {
    const runner = stubRunner({
      async run() {
        return { status: 'NO_HOTELS', message: 'No hotels found', suppliers: [] };
      },
    });
    const res = await request(createApiApp(runner)).post('/api/search-hotels').send(body).expect(200);
    expect(res.body).toMatchObject({ status: 'NO_HOTELS', message: 'No hotels found' });
  });

  it('returns 503 when Temporal is unreachable', async () => {
    const runner = stubRunner({
      async run() {
        throw new Error('Connection refused: localhost:7233');
      },
    });
    const res = await request(createApiApp(runner)).post('/api/search-hotels').send(body).expect(503);
    expect(res.body.error).toMatch(/could not be completed/i);
  });
});

describe('DELETE /api/search-hotels/:searchId', () => {
  it('accepts a cancellation for a running search', async () => {
    const res = await request(createApiApp(stubRunner())).delete('/api/search-hotels/abc123').expect(202);
    expect(res.body).toMatchObject({ searchId: 'abc123', cancelled: true });
  });

  it('returns 404 when there is no such running search', async () => {
    const runner = stubRunner({
      async cancel() {
        return false;
      },
    });
    await request(createApiApp(runner)).delete('/api/search-hotels/abc123').expect(404);
  });

  it('rejects a malformed searchId', async () => {
    await request(createApiApp(stubRunner())).delete('/api/search-hotels/bad%20id!').expect(400);
  });
});
