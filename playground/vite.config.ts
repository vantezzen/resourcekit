import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],

  server: {
    proxy: {
      "/sync": "http://localhost:5174",
    },
  },

  resolve: {
    alias: [
      // @/ alias
      {
        find: "@",
        replacement: resolve(__dirname, "src"),
      },

      {
        find: "resourcekit/react",
        replacement: resolve(__dirname, "../src/react/index.tsx"),
      },
      {
        find: "resourcekit/server",
        replacement: resolve(__dirname, "../src/server/index.ts"),
      },
      {
        find: "resourcekit/drizzle",
        replacement: resolve(__dirname, "../src/adapters/drizzle/index.ts"),
      },
      {
        find: "resourcekit/memory",
        replacement: resolve(__dirname, "../src/adapters/memory/index.ts"),
      },
      {
        find: "resourcekit/mongo",
        replacement: resolve(__dirname, "../src/adapters/mongo/index.ts"),
      },
      {
        find: "resourcekit/redis",
        replacement: resolve(__dirname, "../src/adapters/redis/index.ts"),
      },
      {
        find: "resourcekit",
        replacement: resolve(__dirname, "../src/index.ts"),
      },
    ],
  },
});
