# Contributing

## Prerequisites

- **Node** ≥ 20
- **pnpm** 9.15.0 (pinned via `packageManager`; `corepack enable` will activate it)
- **Git** with submodule support

## Setup

```bash
git clone --recurse-submodules <repo>
cd editrix

# 1. Build the vendored estella SDK first — it's a `file:` dep, so pnpm
#    won't build it for us, but editrix packages pull types from its dist.
cd vendor/estella/sdk && npm ci && npm run build && cd ../../..

# 2. Install the editrix workspace and build everything.
pnpm install
pnpm build
```

If you forgot `--recurse-submodules`:

```bash
git submodule update --init --recursive
```

When the estella submodule bumps, re-run its `npm run build` before
`pnpm build` — editrix's TS layer reads `vendor/estella/sdk/dist/*.d.ts`
directly.

## Run the editor

```bash
pnpm dev             # == pnpm --filter @editrix/game-editor start
```

That runs `npm run build && electron src/main.cjs`. For incremental work, re-run
`pnpm --filter @editrix/game-editor build` after changes to renderer/launcher code,
then relaunch Electron.

## Common scripts

| Command             | Purpose                                                         |
| ------------------- | --------------------------------------------------------------- |
| `pnpm build`        | Turbo-cached build of all packages + app                        |
| `pnpm test`         | Run vitest across all packages                                  |
| `pnpm test:watch`   | Watch mode                                                      |
| `pnpm typecheck`    | Run `tsc --noEmit` for the app (packages typecheck via `build`) |
| `pnpm lint`         | ESLint over `packages/*/src` + `apps/*/src`                     |
| `pnpm lint:fix`     | ESLint with `--fix`                                             |
| `pnpm format`       | Prettier write                                                  |
| `pnpm format:check` | Prettier check (used by CI)                                     |
| `pnpm clean`        | Remove `dist/` + `*.tsbuildinfo`                                |

## Conventions

- **Code style** — see `CONVENTIONS.md` (file layout, interface prefixes, import order).
- **Architecture** — see `CLAUDE.md` (package graph, dependency direction).
- **Commit messages** — no AI attribution footers; write as the human author.
- **Design docs** — working drafts under `docs/` or `vendor/estella/docs/` are not
  committed unless explicitly asked.

## Submitting changes

1. Create a branch from `master`.
2. Ensure `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm format:check` all pass
   (CI runs the same).
3. Keep the scope tight — no drive-by refactors in feature PRs.
4. For changes touching `vendor/estella`, commit that submodule separately and
   bump the pointer in a dedicated `chore: submodule bump` commit.

## Troubleshooting

- **`tsc` errors about references not found** — run `pnpm build` once; packages
  use `composite: true` and need upstream declarations emitted before downstream
  packages can resolve them.
- **Line-ending noise on Windows** — make sure `core.autocrlf` is `false` (or
  `input`); the repo's `.gitattributes` pins LF.
- **Electron fails to start** — rebuild first (`pnpm --filter @editrix/game-editor build`)
  and check that `wasm/` assets are present (run `pnpm --filter @editrix/game-editor build:wasm`
  if you have the native toolchain).
