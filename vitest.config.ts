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
      exclude: [
        "src/**/index.ts",
        "**/*.test.ts",
        "src/lib/tinybird.ts",
        "src/handlers/dependencies.ts",
        "src/providers/tinybird/**",
        "src/providers/types.ts",
        "src/providers/yolink/types.ts",
        "src/db/client.ts",
        "src/db/queries/**",
        "src/migration/**",
        "api/onboarding/**",
        "api/auth/**",
        "api/settings/**",
      ],
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 80,
        statements: 80,
      },
    },
  },
});
