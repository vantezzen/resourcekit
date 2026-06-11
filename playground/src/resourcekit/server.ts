import { drizzleBackbone } from "resourcekit/drizzle";
import { issues } from "./resources";
import { db } from "../db/client";
import { issuesTable } from "../db/schema";
import { resourceEngine } from "./engine";

export const resourceServer = resourceEngine.server({
  ctx: async () => ({
    db,
    auth: {
      can: () => true,
    },
  }),

  backbones: [drizzleBackbone(issues, db, issuesTable)],
});
