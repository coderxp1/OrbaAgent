import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "services/*/src/**/*.test.ts",
      // Route-handler tests for the web app. These exercise the real handler
      // functions via the standard Request/Response API rather than a running
      // Next.js server.
      "apps/web/src/**/*.test.ts",
    ],
    exclude: ["node_modules/**", "dist/**", ".kilo/**"],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      "@orbaagent/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
      "@orbaagent/model-gateway": path.resolve(__dirname, "services/model-gateway/src/index.ts"),
      "@": path.resolve(__dirname, "apps/web/src"),
    },
  },
});
