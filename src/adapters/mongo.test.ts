import { describe, test } from "bun:test";
import { sourceBackboneContract } from "../testing/contract";
import { mongoBackbone, type MongoCollection } from "./mongo";

/**
 * Runs the full conformance suite against a real MongoDB, when one is
 * available. Point it at an instance and run the suite:
 *
 * ```sh
 * MONGO_URL=mongodb://localhost:27017 bun test src/adapters/mongo.test.ts
 * ```
 *
 * Without `MONGO_URL` the suite is skipped (the `mongodb` driver is an
 * optional peer - it's imported lazily, only when the suite runs).
 */
const url = process.env.MONGO_URL;
const suite = url ? describe : describe.skip;

suite("mongo backbone fulfills the source contract", () => {
  for (const contractCase of sourceBackboneContract(async () => {
    // Non-literal specifier so TypeScript doesn't require `mongodb` to be
    // installed for the rest of the suite to typecheck.
    const driver = "mongodb";
    const { MongoClient } = (await import(driver)) as {
      MongoClient: new (url: string) => {
        connect(): Promise<unknown>;
        db(name: string): { collection(name: string): unknown };
        close(): Promise<void>;
      };
    };
    const client = new MongoClient(url!);
    await client.connect();
    const collection = client
      .db("resourcekit_contract")
      .collection("contract_items") as unknown as MongoCollection & {
      deleteMany(filter: Record<string, unknown>): Promise<unknown>;
    };
    await collection.deleteMany({});
    return {
      backbone: mongoBackbone(collection),
      teardown: async () => {
        await collection.deleteMany({});
        await client.close();
      },
    };
  })) {
    test(contractCase.name, contractCase.run);
  }
});
