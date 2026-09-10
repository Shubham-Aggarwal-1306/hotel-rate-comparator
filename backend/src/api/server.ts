import { createApiApp } from './app';
import { TASK_QUEUE, TEMPORAL_ADDRESS } from '../temporal/config';

const port = Number(process.env.API_PORT ?? 4000);

createApiApp().listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[api] listening on http://localhost:${port} ` +
      `(temporal=${TEMPORAL_ADDRESS}, taskQueue=${TASK_QUEUE})`,
  );
});
