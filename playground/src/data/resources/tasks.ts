import { action, many, namedQuery, one, resource } from "resourcekit";
import { z } from "zod";
import { comments, type Comment } from "./comments";
import { members, type Member } from "./members";

export const STATUSES = ["todo", "in_progress", "done"] as const;
export type Status = (typeof STATUSES)[number];

export const TaskSchema = z.object({
  // Defaults make these optional at `create()` call sites.
  id: z.string().default(() => crypto.randomUUID()),
  workspaceId: z.string(),
  title: z.string().min(1),
  status: z.enum(STATUSES).default("todo"),
  assigneeId: z.string().nullable().default(null),
  version: z.number().default(0),
  createdAt: z.string().default(() => new Date().toISOString()),
});
export type Task = z.infer<typeof TaskSchema>;

/** A task with its relations joined in (what the board renders). */
export type BoardTask = Task & {
  assignee: Member | null;
  comments: Comment[];
};

export const tasks = resource("tasks", {
  schema: TaskSchema,
  // Concurrent edits to the same task conflict instead of clobbering.
  version: "version",

  relations: {
    assignee: one(() => members, "assigneeId"),
    comments: many(() => comments, "taskId"),
  },

  actions: {
    // A pure patch: applied optimistically, replayable when offline.
    assign: action(
      z.object({ assigneeId: z.string().nullable() }),
      ({ input }) => ({ assigneeId: input.assigneeId }),
    ),

    // Server-only logic — clone a card in a single round trip.
    duplicate: action(z.object({}), null),
  },

  queries: {
    // A server-side aggregate. The kind of thing you compute in SQL
    // rather than syncing every row to the client just to count —
    // cached locally like any read, and refreshed by live updates.
    workload: namedQuery(
      z.object({ workspaceId: z.string() }),
      z.array(z.object({ memberId: z.string(), open: z.number() })),
    ),
  },
});
