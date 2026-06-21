import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { action } from "../core/action";
import { resource } from "../core/resource";
import { planKey, QueryPlanSchema } from "./plan";

/**
 * Golden fixtures for the plan IR. The IR is the sync protocol: clients
 * and servers on different versions exchange these exact shapes. If one
 * of these tests fails, you are changing the protocol - bump the sync
 * message schemaVersion and handle the old shape, don't edit the fixture.
 */

const issues = resource("issues", {
  schema: z.object({
    id: z.string(),
    workspaceId: z.string(),
    title: z.string(),
    score: z.number(),
    assigneeId: z.string().nullable(),
  }),
  actions: {
    assign: action(z.object({ userId: z.string() }), ({ input }) => ({
      assigneeId: input.userId,
    })),
  },
});

describe("plan IR golden fixtures", () => {
  test("read plans", () => {
    expect(issues.one("iss_1").plan).toEqual({
      type: "read",
      resource: "issues",
      op: "one",
      id: "iss_1",
    });

    expect(issues.where({ workspaceId: "w1", score: { gt: 10 } }).plan).toEqual(
      {
        type: "read",
        resource: "issues",
        op: "where",
        filter: { workspaceId: "w1", score: { gt: 10 } },
      },
    );
  });

  test("local refinements never leak into the wire plan", () => {
    const refined = issues
      .where({ workspaceId: "w1" })
      .filter((issue) => issue.title.includes("x"))
      .orderBy("score", "desc")
      .limit(10);

    expect(refined.plan).toEqual({
      type: "read",
      resource: "issues",
      op: "where",
      filter: { workspaceId: "w1" },
    });
    expect(
      QueryPlanSchema.parse(JSON.parse(JSON.stringify(refined.plan))),
    ).toEqual(refined.plan);
  });

  test("write plans", () => {
    const record = {
      id: "iss_2",
      workspaceId: "w1",
      title: "New",
      score: 0,
      assigneeId: null,
    };
    expect(issues.create(record)).toEqual({
      type: "write",
      resource: "issues",
      op: "create",
      record,
    });

    expect(issues.update("iss_1", { title: "Renamed" })).toEqual({
      type: "write",
      resource: "issues",
      op: "patch",
      id: "iss_1",
      patch: { title: "Renamed" },
    });

    expect(issues.delete("iss_1")).toEqual({
      type: "write",
      resource: "issues",
      op: "delete",
      id: "iss_1",
    });
  });

  test("action plans carry intent, not derived patches", () => {
    expect(issues.actions.assign("iss_1", { userId: "u1" })).toEqual({
      type: "write",
      resource: "issues",
      op: "action",
      action: "assign",
      id: "iss_1",
      input: { userId: "u1" },
    });
  });

  test("every plan round-trips through the wire schema", () => {
    const plans = [
      issues.one("a").plan,
      issues.where({ workspaceId: "w1" }).plan,
      issues.update("a", { score: 5 }),
      issues.delete("a"),
      issues.actions.assign("a", { userId: "u1" }),
    ];
    for (const plan of plans) {
      expect(QueryPlanSchema.parse(JSON.parse(JSON.stringify(plan)))).toEqual(
        plan,
      );
    }
  });
});

describe("planKey", () => {
  test("is stable across key order", () => {
    const a = planKey({
      type: "read",
      resource: "issues",
      op: "where",
      filter: { workspaceId: "w1", status: "open" },
    });
    const b = planKey({
      type: "read",
      resource: "issues",
      op: "where",
      filter: { status: "open", workspaceId: "w1" },
    });
    expect(a).toBe(b);
  });

  test("distinguishes different plans", () => {
    expect(planKey(issues.one("a").plan)).not.toBe(
      planKey(issues.one("b").plan),
    );
  });
});
