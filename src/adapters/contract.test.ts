import { Database } from "bun:sqlite";
import { describe, test } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sourceBackboneContract } from "../testing/contract";
import { drizzleBackbone } from "./drizzle";
import { memoryBackbone } from "./memory";
import { sqliteBackbone } from "./sqlite";

describe("memory backbone fulfills the source contract", () => {
  for (const contractCase of sourceBackboneContract(async () => ({
    backbone: memoryBackbone(),
  }))) {
    test(contractCase.name, contractCase.run);
  }
});

const contractItems = sqliteTable("contract_items", {
  id: text("id").primaryKey(),
  group: text("group").notNull(),
  title: text("title").notNull(),
  score: integer("score").notNull(),
  done: integer("done", { mode: "boolean" }).notNull(),
  assigneeId: text("assignee_id"),
});

describe("drizzle backbone fulfills the source contract (bun:sqlite)", () => {
  for (const contractCase of sourceBackboneContract(async () => {
    const sqlite = new Database(":memory:");
    sqlite.run(
      `CREATE TABLE contract_items (
        id TEXT PRIMARY KEY,
        "group" TEXT NOT NULL,
        title TEXT NOT NULL,
        score INTEGER NOT NULL,
        done INTEGER NOT NULL,
        assignee_id TEXT
      )`,
    );
    return {
      backbone: drizzleBackbone(drizzle(sqlite), contractItems),
      teardown: () => sqlite.close(),
    };
  })) {
    test(contractCase.name, contractCase.run);
  }
});

describe("native bun:sqlite backbone fulfills the source contract", () => {
  for (const contractCase of sourceBackboneContract(async () => {
    // The native adapter maps columns to the schema's field names.
    const sqlite = new Database(":memory:");
    sqlite.run(
      `CREATE TABLE contract_items (
        id TEXT PRIMARY KEY,
        "group" TEXT NOT NULL,
        title TEXT NOT NULL,
        score INTEGER NOT NULL,
        done INTEGER NOT NULL,
        assigneeId TEXT
      )`,
    );
    return {
      backbone: sqliteBackbone(sqlite, "contract_items"),
      teardown: () => sqlite.close(),
    };
  })) {
    test(contractCase.name, contractCase.run);
  }
});
