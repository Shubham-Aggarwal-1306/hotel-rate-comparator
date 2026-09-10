import { Client, Connection } from '@temporalio/client';
import { TEMPORAL_ADDRESS, TEMPORAL_NAMESPACE } from './config';

let clientPromise: Promise<Client> | undefined;

/** Lazily creates (and reuses) a single Temporal client for the API process. */
export async function getTemporalClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
      return new Client({ connection, namespace: TEMPORAL_NAMESPACE });
    })().catch((err) => {
      clientPromise = undefined; // allow a later request to retry the connection
      throw err;
    });
  }
  return clientPromise;
}
