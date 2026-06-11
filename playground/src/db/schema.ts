import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const issuesTable = pgTable("issues", {
  id: varchar("id", { length: 64 }).primaryKey(),
  workspaceId: varchar("workspace_id", { length: 64 }).notNull(),
  projectId: varchar("project_id", { length: 64 }).notNull(),
  title: text("title").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("open"),
  assigneeId: varchar("assignee_id", { length: 64 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectsTable = pgTable("projects", {
  id: varchar("id", { length: 64 }).primaryKey(),
  workspaceId: varchar("workspace_id", { length: 64 }).notNull(),
  name: text("name").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
