# Repository Guidelines

## Project Structure & Module Organization
The Bun-based entry point (`index.ts`) lives at the root for quick smoke checks, alongside `tsconfig.json` and the Bun lockfile. The production-ready trading agents reside in `legacy/`, which is a pnpm-managed workspace. Inside `legacy/`, strategy scripts (`trendV2.ts`, `maker.ts`, `bot.ts`) and the CLI live at the top level, shared helpers are under `legacy/utils/`, and exchange adapters plus tests sit in `legacy/exchanges/`. Reference environment samples are provided in `legacy/env.example`, and longer-form docs are kept in `legacy/docs/`.

## Build, Test, and Development Commands
Run `bun install` at the root to satisfy the lightweight Bun demo. Change into `legacy/` for real work: `pnpm install` bootstraps dependencies, `pnpm start` launches the default trend strategy, `pnpm maker` starts the market-making loop, `pnpm cli:start` triggers the dual-exchange hedging flow, and `pnpm test` executes the full Vitest suite. Use `pnpm aster:test` when you only need the Aster adapter checks.

## Coding Style & Naming Conventions
All code is modern TypeScript using native ES modules. Follow the existing two-space indentation, keep imports sorted from external to local, and prefer `camelCase` for variables/functions with `PascalCase` for classes and enums. Strategy files stay in the project root with descriptive verbs (for example `maker.ts`), while shared utilities belong under `legacy/utils/`. Comments should stay concise and explain non-obvious trading logic.

## Testing Guidelines
Vitest powers unit and integration checks. Place new suites beside their subjects using the `<feature>.test.ts` pattern (e.g., `legacy/exchanges/aster.test.ts`). Ensure strategies ship with coverage for order flow, risk guardrails, and websocket edge cases before opening a pull request. Run `pnpm test --watch` during development to keep feedback tight.

## Commit & Pull Request Guidelines
The repository history is empty, so adopt a lightweight Conventional Commits style (for example `feat: add hedging status panel`) to keep future changelogs clear. Commits should stay scoped to one strategy or module. Pull requests need a concise summary, reproduction or validation notes (commands run, environments touched), and screenshots or log excerpts when behavior changes. Link tracking issues or tasks to help downstream coordination.

## Environment & Secrets
Copy `legacy/env.example` to `.env` and populate API keys for Bitget and AsterDex before running live strategies. Never commit secrets; rely on local dotenv files or your deployment platform's secret manager. Rotate keys immediately if logs or configs leave the sandbox.
