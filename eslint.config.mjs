import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/", "web/dist/", "node_modules/", "coverage/"] },
  tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Promise-safety rules need type information, so they are scoped to the
    // files tsconfig.json covers. An un-awaited promise in an edge handler can
    // be dropped when the function returns — that silently lost analytics
    // events until it was caught by hand in review.
    files: ["src/**/*.ts", "api/**/*.ts", "tests/**/*.ts", "dev/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
);
