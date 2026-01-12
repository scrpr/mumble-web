# Repository Guidelines

## Project Structure & Module Organization
- `app/`: browser client source (UI, workers, config, localization).
- `themes/`: SCSS themes (`MetroMumbleLight/`, `MetroMumbleDark/`).
- `loc/`: translation JSON files (`en.json`, `de.json`, …).
- `patches/`: `patch-package` diffs applied on install.
- `dist/`: generated build output (gitignored; published artifact).
- `webpack.config.js`: webpack build entry points and loaders.

## Build, Test, and Development Commands
- `pnpm ci` (or `pnpm install`): install dependencies (runs `patch-package`). Avoid running npm as root.
- `pnpm run build`: bundle into `dist/`; seeds `dist/config.local.js` from `app/config.local.js` if missing.
- `pnpm run watch`: webpack rebuild on change for local development.
- Serve `dist/` with any static server, e.g. `python3 -m http.server --directory dist 8080`.

Docker (optional, see `Dockerfile`):
- `docker build -t mumble-web .`
- `docker run -p 8080:8080 -e MUMBLE_SERVER=host:64738 mumble-web`

## Coding Style & Naming Conventions
- JavaScript (ES modules) with 2-space indentation; follow the existing style in `app/*.js`.
- Prefer single quotes; keep semicolon usage consistent within a file.
- Localization uses ISO-639-1 filenames (`loc/es.json`) and nested keys (referenced as `connectdialog.title` in code).

## Testing Guidelines
- No automated test suite yet (`pnpm test` is a placeholder). Validate changes by running `pnpm run build` and doing a quick browser smoke test (connect dialog loads, audio path, theming, and any modified UI flows).

## Commit & Pull Request Guidelines
- Git history uses short, imperative, sentence-case subjects (e.g. “Update README.md”, “Fix …”, “Add …”); no strict Conventional Commits requirement.
- Keep PRs focused; include what/why/how to test, and screenshots for UI/theme changes.
- Don’t commit `dist/` or secrets; local configuration overrides belong in `dist/config.local.js`.

## Configuration & Troubleshooting
- Defaults live in `app/config.js`; override locally in `dist/config.local.js`.
- If `node-sass` fails to install on newer Node versions, use the `Dockerfile` or an older Node LTS.
