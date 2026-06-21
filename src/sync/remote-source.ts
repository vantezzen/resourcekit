import { SourceBackbone, type ExecutionContext } from "../core/backbone";
import { debug } from "../debug";
import { errorFromWire, ResourceKitError } from "../errors";
import type { QueryPlan } from "../plan/plan";
import type { Transport } from "./transport";

type Settler = {
  plan: QueryPlan;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

/**
 * The client's authoritative source: forwards plans to the sync
 * endpoint. Plans issued in the same tick are coalesced into a single
 * batched message, so a screen mounting a dozen live queries costs one
 * request.
 */
export class RemoteSourceBackbone extends SourceBackbone {
  private batch: Settler[] = [];

  constructor(private readonly transport: Transport) {
    super();
  }

  canFulfill(plan: QueryPlan, exec: ExecutionContext): boolean {
    // The server decides what it serves; any registered resource may try.
    return exec.resources.has(plan.resource);
  }

  execute(plan: QueryPlan, _exec: ExecutionContext): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.batch.push({ plan, resolve, reject });
      // A macrotask window (not a microtask): async bookkeeping between
      // two logically-simultaneous plans must not split the batch.
      if (this.batch.length === 1) setTimeout(() => this.flush(), 0);
    });
  }

  private async flush(): Promise<void> {
    const batch = this.batch;
    this.batch = [];
    if (batch.length === 0) return;

    debug.sync(
      "sending %d plan(s): %s",
      batch.length,
      batch
        .map((entry) => `${entry.plan.op} ${entry.plan.resource}`)
        .join(", "),
    );
    try {
      const response = await this.transport({
        schemaVersion: "1",
        plans: batch.map((entry) => entry.plan),
      });

      if (!response.ok) {
        const error = errorFromWire(
          response.error.code,
          response.error.message,
        );
        for (const entry of batch) entry.reject(error);
        return;
      }

      batch.forEach((entry, index) => {
        const result = response.results[index];
        if (!result) {
          entry.reject(
            new ResourceKitError(
              "internal",
              "Sync response is missing a result for a submitted plan.",
            ),
          );
        } else if (result.ok) {
          entry.resolve(result.data);
        } else {
          entry.reject(errorFromWire(result.error.code, result.error.message));
        }
      });
    } catch (error) {
      for (const entry of batch) entry.reject(error);
    }
  }
}
