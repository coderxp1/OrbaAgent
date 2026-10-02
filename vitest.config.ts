import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "services/*/src/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", ".kilo/**"],
  },
  resolve: {
    alias: {
      "@orbaagent/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
      "@orbaagent/model-gateway": path.resolve(__dirname, "services/model-gateway/src/index.ts"),
    },
  },
});
