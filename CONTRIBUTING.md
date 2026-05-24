# Contributing to csszyx

Quick reference for committing to the repo. For project architecture and
deeper guides, see the README and `docs/`.

## Conventional Commits

Commits follow [Conventional Commits](https://www.conventionalcommits.org/).
The format is enforced by Cocogitto via the `commit-msg` hook.

```
<type>(<scope>): <subject>

<optional body>

<optional footer>
```

### Types

| Type       | Use for                                    | Appears in CHANGELOG |
| ---------- | ------------------------------------------ | -------------------: |
| `feat`     | New feature                                |                  Yes |
| `fix`      | Bug fix                                    |                  Yes |
| `perf`     | Performance improvement                    |                  Yes |
| `revert`   | Reverting a prior commit                   |                  Yes |
| `refactor` | Code restructuring with no behavior change |                   No |
| `test`     | Adding or fixing tests                     |                   No |
| `docs`     | Documentation only                         |                   No |
| `style`    | Formatting / whitespace                    |                   No |
| `build`    | Build system / dependencies                |                   No |
| `ci`       | CI/CD configuration                        |                   No |
| `chore`    | Maintenance, tooling, miscellaneous        |                   No |

Only `feat`, `fix`, `perf`, and `revert` end up in the user-facing CHANGELOG.
Everything else stays in git history but doesn't surface to package
consumers — release-please filters them out.

A `!` after the type or `BREAKING CHANGE:` in the footer marks a breaking
change. Under v1.0 this still bumps a minor (not major) per `0.x` semver
convention — release-please is configured with `bump-minor-pre-major: true`.

### Scopes

Scopes are **free-form** — Cocogitto doesn't validate them against a
fixed list. Use whatever describes the change clearly. The list below is
recommended for consistency, not enforced.

#### Workspace packages

| Scope            | Maps to                       |
| ---------------- | ----------------------------- |
| `csszyx`         | `packages/csszyx/` (umbrella) |
| `compiler`       | `packages/compiler/`          |
| `runtime`        | `packages/runtime/`           |
| `core`           | `packages/core/` (Rust/WASM)  |
| `types`          | `packages/types/`             |
| `unplugin`       | `packages/unplugin/`          |
| `cli`            | `packages/cli/`               |
| `vars`           | `packages/vars/`              |
| `dynamic`        | `packages/dynamic/`           |
| `mcp-server`     | `packages/mcp-server/`        |
| `vscode`         | `packages/vscode/`            |
| `vue-adapter`    | `packages/vue-adapter/`       |
| `svelte-adapter` | `packages/svelte-adapter/`    |
| `e2e`            | `packages/e2e/` (Playwright)  |

#### Cross-cutting

| Scope          | Use for                                      |
| -------------- | -------------------------------------------- |
| `ci`           | CI workflows under `.github/`                |
| `release`      | Release pipeline (release-please) tweaks     |
| `docs`         | Astro docs site (`apps/docs/`)               |
| `devcontainer` | `.devcontainer/` setup                       |
| `playground`   | Sample apps under `playground/`              |
| `deps`         | Dependency bumps when no narrower scope fits |

### Examples

```
feat(vscode): add HTML sz attribute support
fix(ci): serialize @csszyx/core build/test to avoid wasm-pack race
perf(compiler): cache property-map lookups by tier prefix
refactor(csszyx): promote browser IIFE runtime to umbrella package
chore(devcontainer): self-healing setup + build-time tool validation
test(e2e): add Playwright tests for csszyx/browser IIFE runtime
docs(guide): add CDN — Vanilla HTML guide
```

## Releases

Releases are automated via [release-please](https://github.com/googleapis/release-please).

1. Land work on `main` with conventional-commit messages.
2. release-please opens (or updates) a "release PR" titled
   `chore: release csszyx <version>` summarizing all `feat`/`fix`/`perf`
   commits since the last release.
3. Review the PR. When you merge it, the workflow:
   - Creates per-package git tags (e.g. `csszyx-0.6.0`, `@csszyx/vscode-0.6.0`)
   - Creates **one** GitHub Release for the umbrella `csszyx` package
   - Publishes 9 public packages to npm
   - The `@csszyx/vscode-<version>` tag separately triggers
     `release-vscode.yml` which publishes the extension to the VS Code
     Marketplace

You don't author CHANGELOG entries by hand. release-please derives them
from commit messages — write commit subjects accordingly.

Do not mention target versions in `feat:` or `fix:` commit subjects or
message bodies. release-please decides versions from the commit history.
If a specific version is required, use a `Release-As: x.y.z` footer.

## Local checks

```bash
pnpm lint:check               # biome + slim eslint (jsdoc + type-aware rules)
pnpm lint                     # same, auto-fix where possible
pnpm test                     # vitest + turbo orchestration
pnpm test:e2e                 # Playwright
pnpm type-check               # tsc -b across workspace project references
pnpm bench:transform-cache    # cold/warm transform-cache report; Babel-vs-oxc cost
```

Formatting is owned by Biome (including CSS as of v0.8.0); ESLint stays
for JSDoc enforcement and TypeScript type-aware rules that need full
TS inference. See `eslint.config.js` for the split.

`bench:transform-cache` writes its report under `bench/` and exits with
no side effects on the workspace — safe to run on any branch before
opening a perf PR.

Lefthook runs pre-commit checks on changed files and the commit-msg
validator. The commit-msg hook runs `scripts/verify-commit-message.sh`,
which calls `cog verify --file` and then enforces csszyx's release-please
rules.
