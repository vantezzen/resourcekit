import type { Engine } from "./engine";
import { ReadOperations, type ReadPlan } from "../queries/read-plan";
import { SyncMessageSchema, type ServerResponse } from "./server.types";
import { WriteOperations, type WritePlan } from "../queries/write-plan";

export async function handleSyncMessage<TCtx>(
  engine: Engine,
  request: Request,
  ctx: Awaited<TCtx>,
): Promise<Response> {
  const json = await request.json();
  const syncData = SyncMessageSchema.safeParse(json);
  if (!syncData.success) {
    return new Response(
      JSON.stringify({ ok: false, error: "Invalid sync message format" }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const { plans } = syncData.data;
  const results = await Promise.all(
    plans.map(async (plan) => {
      // TODO: Check authorization

      try {
        const data = ReadOperations.includes(plan.type)
          ? await engine.query(plan as ReadPlan)
          : await engine.mutate(plan as WritePlan);
        return { ok: true, data };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    }),
  );

  const response: ServerResponse = { ok: true, results };

  return new Response(JSON.stringify(response), {
    headers: { "content-type": "application/json" },
  });
}
