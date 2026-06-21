import { MongoClient } from "mongodb";

const url = process.env.MONGO_URL ?? "mongodb://localhost:27018";

const mongo = new MongoClient(url);
await mongo.connect();

/** Comments live here - one document per comment, no schema migration. */
export const commentsCollection = mongo.db("resourcekit").collection("comments");
