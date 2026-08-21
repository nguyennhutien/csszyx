#!/usr/bin/env bash
# Run the same pipeline GitHub Actions runs on PR #28-style PRs, on a clean
# local checkout. The goal is to catch divergence between local "everything
# green" and CI failures by wiping the artefacts CI does not have (dist/,
# .turbo, .csszyx caches, host native addon) before each step.
#
# Why this exists: PR #28's first three pushes each passed every local check
# I ran (biome, vitest, type-check, manual transform output), then failed CI
# on issues that were masked by cached state — Biome's --write skipping
# unsafe fixes silently, turbo's missing @csszyx/types build edge masked by
# leftover dist/, csszyx transform cache holding stale Rust output across an
# engine update, etc. The reproducer below has caught every one of those.
#
# Usage:
#   bash scripts/verify-like-ci.sh          # full mirror (~3-5 min)
#   bash scripts/verify-like-ci.sh --no-e2e # skip the slowest step
#
# Re-runs pnpm install if your branch changed package.json. Otherwise relies
# on the existing node_modules — installing fresh is what CI does but costs
# ~30s and is rarely the source of divergence locally.

set -euo pipefail

SKIP_E2E=0
for arg in "$@"; do
    case "$arg" in
        --no-e2e) SKIP_E2E=1 ;;
        *)
            echo "[verify-like-ci] unknown flag: $arg" >&2
            exit 2
            ;;
    esac
done

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

echo "[verify-like-ci] Wiping cached build artefacts so turbo and vitest start fresh..."
find packages apps playground -name dist -type d -not -path '*/node_modules/*' -exec rm -rf {} + 2>/dev/null || true
find packages -name .tsout -type d -not -path '*/node_modules/*' -exec rm -rf {} + 2>/dev/null || true
find playground packages/e2e -name '.csszyx' -type d -exec rm -rf {} + 2>/dev/null || true
rm -rf .turbo apps/docs/.astro apps/docs/dist apps/docs/.csszyx
# The devcontainer mounts this repository at a different path, and target/ is the
# same directory on disk for both. Objects built in one environment stay behind,
# and llvm-cov folds them into the next run's report — mixing two source roots
# into one coverage number and then failing on a path that does not exist here.
# A clean tree costs about 25 seconds, and the native build below rebuilds anyway.
rm -rf target/llvm-cov-target
# Next's build caches carry the absolute paths of whichever environment wrote
# them, and they share this directory with the devcontainer for the same reason
# target/ does. A cache written under the container's root sends Turbopack
# looking for the Next package at a path this environment does not have, and it
# aborts the dev server mid-suite with "Next.js package not found" — surfacing
# as an e2e failure that reruns do not clear. CI never has these caches at all,
# so removing them is what the mirror is for.
find playground apps -maxdepth 2 -name '.next*' -type d -not -path '*/node_modules/*' -exec rm -rf {} + 2>/dev/null || true

echo "[verify-like-ci] Tracked symlink guard..."
pnpm check:tracked-symlinks

echo "[verify-like-ci] Raw NUL byte guard (binary-flipped source files)..."
pnpm check:no-nul-bytes

echo "[verify-like-ci] Checking the documented warning messages still exist in source..."
pnpm check:warning-docs

echo "[verify-like-ci] Checking every warning message has a reference entry..."
pnpm check:undocumented-warnings

echo "[verify-like-ci] Biome preflight (strict — no auto-fix, no unsafe-skip)..."
pnpm lint:fast

# The repository's own tooling — the generators, the release-please config, the
# workflow helper scripts — is tested like anything else, and CI runs those
# suites in jobs this mirror did not reproduce. A generator whose test broke
# therefore reached CI green from here, which is the divergence this script
# exists to prevent. They cost under a second in total.
echo "[verify-like-ci] Repository tooling suites (generators, release config, workflow helpers)..."
pnpm test:scripts
node .github/scripts/validate-release-please-config.mjs
node --test scripts/validate-commit-message-policy.test.mjs
node --test scripts/napi-pin.test.mjs
node --test .github/scripts/publish-workspace.test.mjs
node --test .github/scripts/detect-pkg-code-changes.test.mjs
node --test .github/scripts/detect-lock-code-changes.test.mjs
node packages/core/scripts/validate-native-packages.mjs

# Cheap generated-artefact staleness gates first — these fail in seconds and
# catch the most common drift (forgetting to regenerate a committed fixture).
echo "[verify-like-ci] Generated-artefact staleness gates (sz-key fixture, parity corpus, rust tables)..."
pnpm gen:key-tests:check
pnpm gen:parity-corpus:check
pnpm gen:rust-tables:check
pnpm gen:reverse-map:check
pnpm gen:migrate-golden:check
pnpm gen:sz-fallback-matrix:check
pnpm gen:sz-allowlist:check
pnpm gen:box-role:check
pnpm gen:llms:check
pnpm check:key-corpus
# Derives the var-hostile key list from the pinned Tailwind rather than trusting
# the hand-written one. A Tailwind upgrade that adds an arbitrary-value form for
# one of these keys must take it off the list, or csszyx keeps dropping a class
# that would now work.
pnpm check:var-hostile-keys
pnpm check:szcn-collision-blocklist

# Builds the addon, loads it the way a consumer does, and removes it again —
# it owns a whole CI job, so it cleans up after itself. That last part is why
# it runs BEFORE the shared build below rather than after: run afterwards, it
# deletes the artifact every later stage resolves, and they fail claiming the
# platform package was never installed. Catches a binding that compiles
# without being loadable, which no check further down would notice.
echo "[verify-like-ci] Native engine smoke (builds, loads and removes its own addon)..."
env -u RUSTUP_TOOLCHAIN pnpm --filter @csszyx/core native:engine:smoke

echo "[verify-like-ci] Building host native engine (matches CI step)..."
# `--clean` resolves the current platform before deleting its output. Do not
# pre-delete every platform package: host and devcontainer share this worktree.
env -u RUSTUP_TOOLCHAIN pnpm --filter @csszyx/core native:build -- --clean --native-engine

# The Rust gates live in a separate workflow (rust-check.yml), so a local run
# that only mirrored ci.yml would miss them. Clippy must run under EVERY feature
# set CI uses, or a lint that only trips under a non-default feature stays
# invisible until CI: the default build, `native-engine` (transform engine in
# engine.rs), and `native` (the napi/FFI binding in native.rs, checked by
# check-native.mjs — e.g. a redundant clone there is default-clippy-invisible).
echo "[verify-like-ci] Rust gates (rustfmt, clippy x3 feature sets, native check, cargo test, parity harnesses)..."
(
    cd "$REPO/packages/core"
    cargo fmt --all -- --check
    cargo clippy --all-targets -- -D warnings
    cargo clippy --features native-engine --all-targets -- -D warnings
    node scripts/check-native.mjs
    cargo test
    # Full native-engine run: inline tests of every gated module plus every
    # integration binary (parity corpuses, sz_fallback_parity,
    # parser_panic_fuzz). Name filters proved unsafe here — they silently
    # skip gated tests that don't match, and CI stays green.
    cargo test --features native-engine
)

echo "[verify-like-ci] Running unit tests through turbo (catches missing build deps)..."
pnpm test:unit

echo "[verify-like-ci] ESLint full repo..."
pnpm exec eslint .

# ReDoS gate. Separate from the main ESLint pass because recheck's per-regex
# analysis is slow and runs on a dedicated config; it catches the polynomial /
# search-position class that neither eslint-plugin-regexp rule detects and that
# only CodeQL flagged before. Kept local so it fails here, not first in CI.
echo "[verify-like-ci] ReDoS gate (recheck)..."
pnpm lint:redos

echo "[verify-like-ci] Type-check..."
pnpm type-check

echo "[verify-like-ci] Corpus round-trip (fails on broken mappings, like CI)..."
pnpm corpus:check --require-no-broken

# Ask the installed Tailwind whether every class the mapping emits actually
# produces CSS. A mapping that emits a name Tailwind no longer serves styles
# nothing, silently — the failure csszyx exists to prevent.
echo "[verify-like-ci] Emitted-class oracle (dead classes vs real Tailwind)..."
pnpm check:emitted-classes

echo "[verify-like-ci] Workspace build (every playground, every package)..."
pnpm build

# After the build for the same reason the size gate is: several suites spawn
# the CLI from `dist`, and without it they fail to import and the run reports
# about half the real coverage — which the global thresholds then reject, in a
# way that reads as a coverage regression rather than a missing build.
echo "[verify-like-ci] TypeScript coverage (mirrors the Coverage workflow)..."
pnpm test:coverage

# AFTER the TypeScript pass, in the order the Coverage workflow uses. Both
# write into `coverage/`, and vitest cleans that directory before it writes, so
# running rust first means its report is deleted by the pass that follows it.
# The gate below then sees one report where it expects two and calls every
# changed Rust line unmeasured.
echo "[verify-like-ci] Rust coverage gate (mirrors the Coverage workflow)..."
pnpm cov:rust

# The third report the patch gate reads, and the one the Coverage workflow
# uploads alongside the other two. vitest never runs ts-plugin's node-script
# suites, so without this the gate reads whatever `packages/ts-plugin/coverage`
# happened to hold — a stale file passes as coverage, which is how a pull
# request went green here and then reported missing lines upstream.
echo "[verify-like-ci] ts-plugin coverage (c8 — mirrors the Coverage workflow)..."
pnpm --filter @csszyx/ts-plugin test:coverage

# All three reports exist by now, so the diff can be compared against them.
# Codecov reports exactly this on the pull request, and nothing here reproduced
# it — an untested changed line was only ever discovered after a push.
echo "[verify-like-ci] Patch coverage (changed lines against all coverage reports)..."
pnpm check:patch-coverage

# Sonar rejects new code above a cognitive-complexity of 15 and is the only
# thing that was checking it, which means the first report of an over-complex
# function arrived after a push. Scoped to changed files for the same reason
# Sonar scopes to new code: the existing tree has functions above the line, and
# a repo-wide gate would fail every run until that backlog is cleared.
echo "[verify-like-ci] Cognitive complexity of changed files (mirrors Sonar)..."
node scripts/check-changed-complexity.mjs

echo "[verify-like-ci] Duplication on changed lines (mirrors Sonar)..."
node scripts/check-changed-duplication.mjs

# Runs after the build on purpose: the gate measures built dist output, and a
# missing dist fails it rather than passing it.
echo "[verify-like-ci] Package size gate (user-shipped gzip budgets)..."
pnpm check:package-size

echo "[verify-like-ci] Wasm-lane smoke (real vite build through both engine artifacts)..."
bash scripts/smoke-wasm-lane.sh

if [ "$SKIP_E2E" -eq 0 ]; then
    echo "[verify-like-ci] Playwright e2e (full suite — slowest step)..."
    pnpm --filter @csszyx/e2e exec playwright test
fi

echo "[verify-like-ci] All steps green. Safe to push."
