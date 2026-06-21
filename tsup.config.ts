import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "react/index": "src/react/index.tsx",
    "server/index": "src/server/index.ts",
    "adapters/drizzle/index": "src/adapters/drizzle/index.ts",
    "adapters/memory/index": "src/adapters/memory/index.ts",
    "adapters/sqlite/index": "src/adapters/sqlite/index.ts",
    "adapters/mongo/index": "src/adapters/mongo/index.ts",
    "adapters/redis/index": "src/adapters/redis/index.ts",
    "adapters/prisma/index": "src/adapters/prisma/index.ts",
    "adapters/stripe/index": "src/adapters/stripe/index.ts",
    "adapters/stripe/resources": "src/adapters/stripe/resources.ts",
    "testing/index": "src/testing/contract.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  external: ["react", "react-dom", "zod", "drizzle-orm", "debug"],
});
