import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/.kilo/**", "**/node_modules/**", "**/dist/**", "**/.next/**"],
    projects: ["packages/*", "services/*", "apps/*"],
  },
});
