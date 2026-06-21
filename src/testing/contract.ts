import { z } from "zod";
import {
  ResourceRegistry,
  type ExecutionContext,
  type SourceBackbone,
} from "../core/backbone";
import { resource } from "../core/resource";
import type { WhereFilter } from "../plan/filters";

/**
 * The source backbone contract: the behavior every adapter must
 * implement for the five plan operations. Run it against any backbone
 * (built-in or third-party) with the test runner of your choice:
 *
 * ```ts
 * import { describe, test } from "bun:test";
 * import { sourceBackboneContract } from "resourcekit/testing";
 *
 * describe("my backbone", () => {
 *   for (const contractCase of sourceBackboneContract(setup)) {
 *     test(contractCase.name, contractCase.run);
 *   }
 * });
 * ```
 */

export const ContractRecordSchema = z.object({
  id: z.string(),
  group: z.string(),
  title: z.string(),
  score: z.number(),
  done: z.boolean(),
  // A nullable field, so the contract can pin null-filtering behavior.
  assigneeId: z.string().nullable(),
});
export type ContractRecord = z.infer<typeof ContractRecordSchema>;

/** The resource every contract run uses. Map it to a table/store named "contract_items". */
export const contractResource = resource("contract_items", {
  schema: ContractRecordSchema,
});

export type ContractSetup = () => Promise<{
  backbone: SourceBackbone;
  teardown?: () => Promise<void> | void;
}>;

export type ContractCase = {
  name: string;
  run: () => Promise<void>;
};

/** Dependency-free assertions so the kit runs under any test runner. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

const assert = {
  equal(actual: unknown, expected: unknown): void {
    if (actual !== expected) {
      throw new Error(
        `Contract violation: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
    }
  },
  deepEqual(actual: unknown, expected: unknown): void {
    if (canonical(actual) !== canonical(expected)) {
      throw new Error(
        `Contract violation: expected ${canonical(expected)}, got ${canonical(actual)}`,
      );
    }
  },
};

const exec: ExecutionContext = {
  resources: new ResourceRegistry([contractResource]),
  ctx: undefined,
};

const records: ContractRecord[] = [
  { id: "a", group: "g1", title: "Alpha", score: 10, done: false, assigneeId: null },
  { id: "b", group: "g1", title: "Beta", score: 50, done: true, assigneeId: "u1" },
  { id: "c", group: "g2", title: "Gamma", score: 90, done: false, assigneeId: null },
];

async function withBackbone(
  setup: ContractSetup,
  run: (backbone: SourceBackbone) => Promise<void>,
): Promise<void> {
  const { backbone, teardown } = await setup();
  try {
    for (const record of records) {
      await backbone.execute(
        { type: "write", resource: "contract_items", op: "create", record },
        exec,
      );
    }
    await run(backbone);
  } finally {
    await teardown?.();
  }
}

function read(backbone: SourceBackbone, filter: WhereFilter) {
  return backbone.execute(
    { type: "read", resource: "contract_items", op: "where", filter },
    exec,
  ) as Promise<ContractRecord[]>;
}

function readOne(backbone: SourceBackbone, id: string) {
  return backbone.execute(
    { type: "read", resource: "contract_items", op: "one", id },
    exec,
  ) as Promise<ContractRecord | null>;
}

const ids = (rows: ContractRecord[]) => rows.map((row) => row.id).sort();

export function sourceBackboneContract(setup: ContractSetup): ContractCase[] {
  return [
    {
      name: "one returns a created record by identity",
      run: () =>
        withBackbone(setup, async (backbone) => {
          assert.deepEqual(await readOne(backbone, "a"), records[0]);
        }),
    },
    {
      name: "one returns null for a missing id",
      run: () =>
        withBackbone(setup, async (backbone) => {
          assert.equal(await readOne(backbone, "missing"), null);
        }),
    },
    {
      name: "where with an empty filter returns everything",
      run: () =>
        withBackbone(setup, async (backbone) => {
          assert.deepEqual(ids(await read(backbone, {})), ["a", "b", "c"]);
        }),
    },
    {
      name: "where with no matches returns an empty array (not null)",
      run: () =>
        withBackbone(setup, async (backbone) => {
          assert.deepEqual(await read(backbone, { group: "nope" }), []);
        }),
    },
    {
      name: "where filters by null (shorthand and explicit eq)",
      run: () =>
        withBackbone(setup, async (backbone) => {
          assert.deepEqual(ids(await read(backbone, { assigneeId: null })), [
            "a",
            "c",
          ]);
          assert.deepEqual(
            ids(await read(backbone, { assigneeId: { eq: null } })),
            ["a", "c"],
          );
        }),
    },
    {
      name: "where filters by equality (shorthand and explicit)",
      run: () =>
        withBackbone(setup, async (backbone) => {
          assert.deepEqual(ids(await read(backbone, { group: "g1" })), [
            "a",
            "b",
          ]);
          assert.deepEqual(ids(await read(backbone, { group: { eq: "g2" } })), [
            "c",
          ]);
          assert.deepEqual(ids(await read(backbone, { done: true })), ["b"]);
        }),
    },
    {
      name: "where filters by membership",
      run: () =>
        withBackbone(setup, async (backbone) => {
          assert.deepEqual(
            ids(await read(backbone, { id: { in: ["a", "c"] } })),
            ["a", "c"],
          );
        }),
    },
    {
      name: "where filters by range, bounds respected",
      run: () =>
        withBackbone(setup, async (backbone) => {
          assert.deepEqual(ids(await read(backbone, { score: { gt: 10 } })), [
            "b",
            "c",
          ]);
          assert.deepEqual(
            ids(await read(backbone, { score: { gte: 10, lt: 90 } })),
            ["a", "b"],
          );
          assert.deepEqual(ids(await read(backbone, { score: { lte: 10 } })), [
            "a",
          ]);
        }),
    },
    {
      name: "where combines field conditions with AND",
      run: () =>
        withBackbone(setup, async (backbone) => {
          assert.deepEqual(
            ids(await read(backbone, { group: "g1", score: { gt: 10 } })),
            ["b"],
          );
        }),
    },
    {
      name: "where supports a wire-level window (order + limit)",
      run: () =>
        withBackbone(setup, async (backbone) => {
          const rows = (await backbone.execute(
            {
              type: "read",
              resource: "contract_items",
              op: "where",
              filter: {},
              order: { field: "score", direction: "desc" },
              limit: 2,
            },
            exec,
          )) as ContractRecord[];
          assert.deepEqual(
            rows.map((row) => row.id),
            ["c", "b"],
          );
        }),
    },
    {
      name: "create returns the full canonical record",
      run: () =>
        withBackbone(setup, async (backbone) => {
          const record: ContractRecord = {
            id: "d",
            group: "g3",
            title: "Delta",
            score: 5,
            done: true,
            assigneeId: "u2",
          };
          const created = await backbone.execute(
            { type: "write", resource: "contract_items", op: "create", record },
            exec,
          );
          // Adapters own the read-back: the create result must be the
          // stored record, not the raw input or a partial.
          assert.deepEqual(created, record);
        }),
    },
    {
      name: "patch updates by identity and returns the full canonical record",
      run: () =>
        withBackbone(setup, async (backbone) => {
          const canonical = (await backbone.execute(
            {
              type: "write",
              resource: "contract_items",
              op: "patch",
              id: "a",
              patch: { title: "Alpha 2", score: 11 },
            },
            exec,
          )) as ContractRecord;
          // The whole record comes back, not just the changed fields.
          assert.deepEqual(canonical, {
            id: "a",
            group: "g1",
            title: "Alpha 2",
            score: 11,
            done: false,
            assigneeId: null,
          });
          assert.equal((await readOne(backbone, "a"))?.score, 11);
        }),
    },
    {
      name: "patch of a missing record returns null",
      run: () =>
        withBackbone(setup, async (backbone) => {
          const result = await backbone.execute(
            {
              type: "write",
              resource: "contract_items",
              op: "patch",
              id: "missing",
              patch: { title: "?" },
            },
            exec,
          );
          assert.equal(result, null);
        }),
    },
    {
      name: "delete removes by identity and is idempotent",
      run: () =>
        withBackbone(setup, async (backbone) => {
          const deletePlan = {
            type: "write",
            resource: "contract_items",
            op: "delete",
            id: "b",
          } as const;
          await backbone.execute(deletePlan, exec);
          assert.equal(await readOne(backbone, "b"), null);
          await backbone.execute(deletePlan, exec); // must not throw
          assert.deepEqual(ids(await read(backbone, {})), ["a", "c"]);
        }),
    },
  ];
}
