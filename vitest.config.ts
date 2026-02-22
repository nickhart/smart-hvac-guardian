import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  test: {
    globals: true,
    environment: "node",
    exclude: ["web/**", "node_modules/**", ".pnpm-store/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "api/**/*.ts"],
      exclude: ["src/**/index.ts", "**/*.test.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
