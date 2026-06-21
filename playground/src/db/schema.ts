import {
  integer,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const tasksTable = pgTable("tasks", {
  id: varchar("id", { length: 64 }).primaryKey(),
  workspaceId: varchar("workspace_id", { length: 64 }).notNull(),
  title: text("title").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("todo"),
  assigneeId: varchar("assignee_id", { length: 64 }),
  version: integer("version").notNull().default(0),
  // `mode: "string"` keeps timestamps as ISO strings end to end, matching
  // the resource schema — no Date/string juggling on either side.
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});
