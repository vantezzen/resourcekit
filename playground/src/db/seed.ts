import { db } from "./client";
import { issuesTable, projectsTable } from "./schema";

await db.delete(issuesTable);
await db.delete(projectsTable);

await db.insert(projectsTable).values([
  {
    id: "proj_1",
    workspaceId: "w1",
    name: "ResourceKit",
  },
]);

await db.insert(issuesTable).values([
  {
    id: "iss_1",
    workspaceId: "w1",
    projectId: "proj_1",
    title: "Design QueryPlan",
    status: "open",
    assigneeId: null,
  },
  {
    id: "iss_2",
    workspaceId: "w1",
    projectId: "proj_1",
    title: "Build local outbox",
    status: "open",
    assigneeId: "user_1",
  },
]);

console.log("Seeded playground database");
process.exit(0);
