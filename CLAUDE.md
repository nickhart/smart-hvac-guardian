# CLAUDE.md — Project Instructions for Claude Code

## Pre-commit Checklist

Always run these before committing:

```bash
pnpm format          # Prettier — format all files
pnpm type-check      # tsc --noEmit
pnpm lint            # ESLint
pnpm test:coverage   # Vitest — tests + coverage thresholds
```

## Formatting (Prettier)

Config: `prettier.config.mjs`

- `printWidth: 100`, `tabWidth: 2`, `semi: true`
- `singleQuote: false`, `trailingComma: "all"`

## Linting (ESLint)

Config: `eslint.config.mjs`

- typescript-eslint recommended + prettier compat
- Unused variables are errors; prefix unused args with `_` to suppress

## Testing (Vitest)

Config: `vitest.config.ts`

- Path alias: `@/` → `src/`
- Coverage thresholds: 80% lines/statements/branches, 75% functions
- Test dirs: `tests/unit/` and `tests/integration/`, mirroring `src/` structure
- DB-dependent code excluded from coverage (queries, migrations, onboarding/auth API routes)

## Project Structure

- `api/` — Vercel Edge Runtime serverless functions
- `src/` — shared business logic, middleware, DB, providers, utils
- `web/` — React SPA (separate pnpm workspace `smart-hvac-guardian-web`)
- `tinybird/` — Tinybird datasources and pipes
- `dev/` — local dev server and E2E scenario tests

## Commit Conventions

- Imperative mood, concise first line
- Co-authored-by trailer for AI-assisted commits
- Never commit `.env`, credentials, or secrets

## Key Patterns

- **Edge Runtime compatible**: no Node.js-only APIs — use Web Crypto, `fetch`, etc.
- **Multi-tenant**: webhook endpoints at `/api/t/{tenantId}/...`
- **Encrypted secrets**: AES-256-GCM via `src/utils/crypto.ts`
- **Path alias**: `@/` → `src/`
