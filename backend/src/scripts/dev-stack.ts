/**
 * One-command dev stack for reviewers who don't have the Temporal CLI installed.
 *
 * Boots an in-process Temporal dev server (the same binary the SDK uses for
 * tests), the mock suppliers, a worker and the API — all in one process.
 * For real development prefer the separate `dev:*` scripts plus
 * `npm run temporal:dev`, which also gives you the Temporal Web UI.
 */
import path from 'node:path';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { createApiApp } from '../api/app';
import { createSupplierApp } from '../suppliers/app';
import * as activities from '../temporal/activities';
import { TASK_QUEUE } from '../temporal/config';

const SUPPLIERS_PORT = Number(process.env.SUPPLIERS_PORT ?? 4001);
const API_PORT = Number(process.env.API_PORT ?? 4000);
const TEMPORAL_PORT = Number(process.env.TEMPORAL_PORT ?? 7233);

async function main(): Promise<void> {
  process.env.SUPPLIERS_BASE_URL ??= `http://localhost:${SUPPLIERS_PORT}`;
  process.env.TEMPORAL_ADDRESS ??= `localhost:${TEMPORAL_PORT}`;

  createSupplierApp().listen(SUPPLIERS_PORT, () =>
    console.log(`[suppliers] http://localhost:${SUPPLIERS_PORT}`),
  );

  const env = await TestWorkflowEnvironment.createLocal({
    server: { port: TEMPORAL_PORT },
  });
  console.log(`[temporal] dev server on localhost:${TEMPORAL_PORT}`);

  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: path.join(__dirname, '..', 'temporal', 'workflows.ts'),
    activities,
  });
  console.log(`[worker] polling "${TASK_QUEUE}"`);

  createApiApp().listen(API_PORT, () => console.log(`[api] http://localhost:${API_PORT}`));

  const shutdown = async () => {
    worker.shutdown();
    await env.teardown();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await worker.run();
}

main().catch((err) => {
  console.error('[dev-stack] fatal error', err);
  process.exit(1);
});
