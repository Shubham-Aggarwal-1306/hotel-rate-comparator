import express, { type Express } from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { parseSearchRequest } from './validation';
import { temporalSearchRunner, type SearchRunner } from './runner';
import type { SearchResult } from '../domain/types';

const SEARCH_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** HTTP status for each workflow outcome. */
function statusCodeFor(result: SearchResult): number {
  switch (result.status) {
    case 'ALL_SUPPLIERS_FAILED':
      return 502;
    case 'CANCELLED':
      return 200;
    default:
      return 200;
  }
}

export function createApiApp(runner: SearchRunner = temporalSearchRunner): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.post('/api/search-hotels', async (req, res) => {
    const parsed = parseSearchRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: 'Invalid search request', details: parsed.errors });
      return;
    }

    const provided = typeof req.body?.searchId === 'string' ? req.body.searchId : undefined;
    if (provided && !SEARCH_ID_RE.test(provided)) {
      res.status(400).json({
        error: 'Invalid search request',
        details: [{ field: 'searchId', message: 'searchId must match [A-Za-z0-9_-]{1,64}' }],
      });
      return;
    }
    const searchId = provided ?? randomUUID();

    try {
      const result = await runner.run(searchId, parsed.value);
      res.status(statusCodeFor(result)).json({ searchId, ...result });
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      // eslint-disable-next-line no-console
      console.error('[api] search failed', err);
      res.status(503).json({
        searchId,
        status: 'ERROR',
        error: 'Hotel search could not be completed',
        message,
      });
    }
  });

  app.delete('/api/search-hotels/:searchId', async (req, res) => {
    const { searchId } = req.params;
    if (!SEARCH_ID_RE.test(searchId)) {
      res.status(400).json({ error: 'Invalid searchId' });
      return;
    }
    try {
      const cancelled = await runner.cancel(searchId);
      res.status(cancelled ? 202 : 404).json({
        searchId,
        cancelled,
        message: cancelled ? 'Cancellation requested' : 'No running search with that id',
      });
    } catch (err) {
      res.status(503).json({ searchId, error: 'Could not cancel the search', message: (err as Error).message });
    }
  });

  return app;
}
