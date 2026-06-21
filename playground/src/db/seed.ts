import { db } from "./client";
import { commentsCollection } from "./mongo";
import { tasksTable } from "./schema";

// Tasks -> Postgres.
await db.delete(tasksTable);
await db.insert(tasksTable).values([
  {
    id: "t1",
    workspaceId: "w1",
    title: "Design the QueryPlan IR",
    status: "done",
    assigneeId: "ada",
  },
  {
    id: "t2",
    workspaceId: "w1",
    title: "Build the local cache + outbox",
    status: "in_progress",
    assigneeId: "ada",
  },
  {
    id: "t3",
    workspaceId: "w1",
    title: "Optimistic write pipeline",
    status: "in_progress",
    assigneeId: "linus",
  },
  {
    id: "t4",
    workspaceId: "w1",
    title: "Offline replay on reconnect",
    status: "todo",
    assigneeId: "grace",
  },
  {
    id: "t5",
    workspaceId: "w1",
    title: "Relations & local joins",
    status: "todo",
    assigneeId: null,
  },
  {
    id: "t6",
    workspaceId: "w1",
    title: "Live updates over SSE",
    status: "todo",
    assigneeId: "grace",
  },
  {
    id: "t7",
    workspaceId: "w1",
    title: "Write the docs site",
    status: "todo",
    assigneeId: null,
  },
]);

// Comments -> MongoDB (a document each).
await commentsCollection.deleteMany({});
await commentsCollection.insertMany([
  {
    id: "c1",
    workspaceId: "w1",
    taskId: "t2",
    authorId: "linus",
    body: "Snapshot + overlay is holding up nicely.",
    createdAt: new Date().toISOString(),
  },
  {
    id: "c2",
    workspaceId: "w1",
    taskId: "t2",
    authorId: "grace",
    body: "Let's make sure rejected writes revert cleanly.",
    createdAt: new Date().toISOString(),
  },
  {
    id: "c3",
    workspaceId: "w1",
    taskId: "t4",
    authorId: "ada",
    body: "Replays should preserve order.",
    createdAt: new Date().toISOString(),
  },
]);

// Members live in Redis - the server provisions them on boot, so there's
// nothing to seed here.

console.log("Seeded Postgres (tasks) and MongoDB (comments).");
process.exit(0);
