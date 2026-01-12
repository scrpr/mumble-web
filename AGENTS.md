# Repository Guidelines

## Project Structure & Module Organization
`mumble-web` is a pnpm workspace with two main apps:

- `apps/web/`: Next.js UI (static export). Routes live in `apps/web/app/`; shared client code in `apps/web/src/`; UI primitives in `apps/web/components/ui/`; assets in `apps/web/public/`.
- `apps/gateway/`: Node.js WebSocket gateway to Mumble servers. Source in `apps/gateway/src/`; build output in `apps/gateway/dist/`; server whitelist in `apps/gateway/config/`.

Generated outputs (do not commit): `apps/web/.next/`, `apps/web/out/`, `apps/gateway/dist/`, root `dist/`.

## Build, Test, and Development Commands
- `pnpm install`: install workspace dependencies (pnpm version is pinned in `package.json`).
- `pnpm dev`: run Next.js dev server (`http://localhost:3000`) and gateway (`ws://localhost:64737/ws`).
- `pnpm build`: build both apps (Next build/export + gateway `tsc`).
- `pnpm start`: start the gateway (serves static `apps/web/out` and `/ws`).
- Per-app: `pnpm -C apps/web dev` / `pnpm -C apps/gateway dev`.

## Coding Style & Naming Conventions
- TypeScript `strict` is required; keep changes type-safe and avoid `any`.
- Formatting: 2-space indentation; single quotes; prefer small, testable functions.
- Naming: files in kebab-case (e.g. `voice-protocol.ts`, `metrics-panel.tsx`); React components PascalCase; hooks `useX`.

## Testing Guidelines
- No dedicated test runner yet—treat `pnpm build` as the baseline check.
- For behavior changes, include a quick smoke-test note (connect flow, audio, `/healthz`, `/ws`).

## Commit & Pull Request Guidelines
- Follow existing Conventional Commit-style subjects: `feat:`, `fix:`, `chore:`, `docs:`.
- PRs should include: summary, how to test, screenshots for UI changes, and any config/env var notes.

## Security & Configuration Tips
- Keep `apps/gateway/config/servers.json` local (copy from `servers.example.json`); don’t commit internal hosts or credentials.
- Production defaults: keep the whitelist minimal and avoid disabling TLS verification (`tls.rejectUnauthorized: false`) outside dev.
- Useful env vars: `PORT`, `WEB_ROOT`, `NEXT_PUBLIC_GATEWAY_WS_URL`, `COOP_COEP=1`.

## Agent-Specific Instructions
- Prefer semantic search before edits and keep diffs focused.
- Avoid checking in generated artifacts or dependency installs unless the task requires it.
