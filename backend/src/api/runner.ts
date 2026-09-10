import { WorkflowNotFoundError } from '@temporalio/client';
import { getTemporalClient } from '../temporal/client';
import { TASK_QUEUE } from '../temporal/config';
import { searchHotelsWorkflow } from '../temporal/workflows';
import type { SearchRequest, SearchResult } from '../domain/types';

/** Indirection so the HTTP layer can be tested without a Temporal server. */
export interface SearchRunner {
  run(searchId: string, request: SearchRequest): Promise<SearchResult>;
  cancel(searchId: string): Promise<boolean>;
}

export const workflowIdFor = (searchId: string): string => `hotel-search-${searchId}`;

export const temporalSearchRunner: SearchRunner = {
  async run(searchId, request) {
    const client = await getTemporalClient();
    return client.workflow.execute(searchHotelsWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId: workflowIdFor(searchId),
      args: [request],
      // Belt-and-braces guard: the workflow's own deadlines should fire well before this.
      workflowExecutionTimeout: '2 minutes',
    });
  },

  async cancel(searchId) {
    const client = await getTemporalClient();
    try {
      await client.workflow.getHandle(workflowIdFor(searchId)).cancel();
      return true;
    } catch (err) {
      if (err instanceof WorkflowNotFoundError) return false;
      throw err;
    }
  },
};
