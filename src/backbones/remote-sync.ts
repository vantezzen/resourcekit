import type { QueryPlan } from "../queries/query-plan";
import {
  SyncMessageSchema,
  type ServerResponse,
  type SyncMessage,
} from "../core/server.types";
import { Backbone, BackboneRole } from "../server";

/**
 * Client-side transport that syncs with the server.
 *
 * Forwards plans to the sync endpoint and writes the server's
 * response into the cache backbone. This is the authoritative
 * source — the cache backbone provides instant local reads.
 */
export class RemoteSyncBackbone extends Backbone {
  override role = BackboneRole.Source;

  constructor(private endpoint: string) {
    super();
  }

  override canSubscribe(): boolean {
    return false;
  }

  async execute(plan: QueryPlan): Promise<unknown> {
    // TODO: Batch multiple plans together if they come in quick succession (e.g. from live queries)

    const message: SyncMessage = {
      schemaVersion: "1",
      plans: [plan],
    };

    // POST the plan
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });

    // Parse the response
    const responseData = (await response.json()) as ServerResponse;
    const { ok } = responseData;
    if (!ok) {
      throw new Error("Sync failed: " + responseData.error);
    }
    const { results } = responseData;

    // Return canonical data from the server
    return results[0];
  }
}
