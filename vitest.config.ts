import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", ".claude/**"],
    maxWorkers: "50%",
    testTimeout: 30_000,
  },
});
