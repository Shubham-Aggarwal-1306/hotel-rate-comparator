import fs from 'node:fs';
import path from 'node:path';
import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities';
import { suppliersBaseUrl, TASK_QUEUE, TEMPORAL_ADDRESS, TEMPORAL_NAMESPACE } from './config';

/** Resolves to the TypeScript source under tsx, or the compiled file under dist/. */
function resolveWorkflowsPath(): string {
  const tsPath = path.join(__dirname, 'workflows.ts');
  return fs.existsSync(tsPath) ? tsPath : path.join(__dirname, 'workflows.js');
}

async function run(): Promise<void> {
  const workflowsPath = resolveWorkflowsPath();
  const connection = await NativeConnection.connect({ address: TEMPORAL_ADDRESS });
  try {
    const worker = await Worker.create({
      connection,
      namespace: TEMPORAL_NAMESPACE,
      taskQueue: TASK_QUEUE,
      workflowsPath,
      activities,
    });
    // eslint-disable-next-line no-console
    console.log(
      `[worker] polling task queue "${TASK_QUEUE}" on ${TEMPORAL_ADDRESS} ` +
        `(suppliers at ${suppliersBaseUrl()})`,
    );
    await worker.run();
  } finally {
    await connection.close();
  }
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[worker] fatal error', err);
  process.exit(1);
});
