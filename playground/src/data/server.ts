import { and, eq, ne, sql } from "drizzle-orm";
import { server } from "resourcekit/server";
import { drizzleBackbone } from "resourcekit/drizzle";
import { mongoBackbone } from "resourcekit/mongo";
import { redisBackbone } from "resourcekit/redis";
import { db } from "../db/client";
import { commentsCollection } from "../db/mongo";
import { redisClient } from "../db/redis";
import { tasksTable } from "../db/schema";
import { members, resources } from "./resources";

/**
 * One typed API, three very different stores behind it - which is the
 * point. Each resource is backed by whatever fits its data:
 *
 * - `tasks`    -> Postgres (relational rows, versioned for conflicts)
 * - `comments` -> MongoDB  (a document per comment)
 * - `members`  -> Redis    (a small key-value team directory)
 *
 * The client never knows the difference; it speaks the same plans to all.
 */

/** The team. Seeded into Redis below, then served from it like any resource. */
const TEAM = [
  { id: "ada", name: "Ada Lovelace", role: "Engineer", color: "#6366f1" },
  { id: "grace", name: "Grace Hopper", role: "Admiral", color: "#db2777" },
  { id: "linus", name: "Linus Torvalds", role: "Maintainer", color: "#0d9488" },
];

/** Demo auth — in a real app this comes from your session or JWT. */
const DEMO_USER = { id: "ada", workspaceIds: ["w1"] };
type Ctx = { user: typeof DEMO_USER };

/** Declared once, enforced on every read and write of these resources. */
const inWorkspace = (ctx: Ctx) => ({
  workspaceId: { in: ctx.user.workspaceIds },
});

export const resourceServer = server(resources, {
  ctx: async (): Promise<Ctx> => ({ user: DEMO_USER }),

  resources: {
    tasks: {
      backbone: drizzleBackbone(db, tasksTable),
      access: inWorkspace,
      actions: {
        // Opaque action: arbitrary server logic with full db access.
        // The returned record lands in every client's cache.
        duplicate: async ({ record }) => {
          const copy = {
            ...record,
            id: crypto.randomUUID(),
            title: `${record.title} (copy)`,
            version: 0,
            createdAt: new Date().toISOString(),
          };
          const rows = await db.insert(tasksTable).values(copy).returning();
          return rows[0] ?? copy;
        },
      },
      queries: {
        // Open tasks per assignee, aggregated in SQL. Named queries skip
        // the automatic scope filter, so the impl checks access itself.
        workload: async ({ input, ctx }) => {
          if (!ctx.user.workspaceIds.includes(input.workspaceId)) return [];
          const rows = await db
            .select({
              memberId: tasksTable.assigneeId,
              open: sql<number>`count(*)::int`,
            })
            .from(tasksTable)
            .where(
              and(
                eq(tasksTable.workspaceId, input.workspaceId),
                ne(tasksTable.status, "done"),
              ),
            )
            .groupBy(tasksTable.assigneeId);
          return rows
            .filter((row): row is { memberId: string; open: number } =>
              Boolean(row.memberId),
            )
            .map((row) => ({ memberId: row.memberId, open: row.open }));
        },
      },
    },

    // A document per comment - Mongo stores them, the same plans read them.
    comments: {
      backbone: mongoBackbone(commentsCollection),
      access: inWorkspace,
    },

    // The team directory, in Redis. Public, so no access scope.
    members: {
      backbone: redisBackbone(redisClient),
      access: "public",
    },
  },
});

// Provision the team into Redis on boot (idempotent) - reference data
// that should always be present, written through the same write path.
const boot = resourceServer.session({ user: DEMO_USER });
await Promise.all(TEAM.map((member) => boot.mutate(members.create(member))));
