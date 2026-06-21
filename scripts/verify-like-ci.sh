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
find playground packages/e2e -name '.csszyx' -type d -exec rm -rf {} + 2>/dev/null || true
rm -rf .turbo apps/docs/.astro apps/docs/dist apps/docs/.csszyx
rm -f packages/core-linux-arm64-gnu/csszyx-core.linux-arm64-gnu.node \
      packages/core-linux-x64-gnu/csszyx-core.linux-x64-gnu.node \
      packages/core-darwin-arm64/csszyx-core.darwin-arm64.node \
      packages/core-darwin-x64/csszyx-core.darwin-x64.node

echo "[verify-like-ci] Biome preflight (strict — no auto-fix, no unsafe-skip)..."
pnpm lint:fast

# Cheap generated-artefact staleness gates first — these fail in seconds and
# catch the most common drift (forgetting to regenerate a committed fixture).
echo "[verify-like-ci] Generated-artefact staleness gates (sz-key fixture, parity corpus, rust tables)..."
pnpm gen:key-tests:check
pnpm gen:parity-corpus:check
pnpm gen:rust-tables:check
pnpm check:key-corpus

echo "[verify-like-ci] Building host native engine (matches CI step)..."
env -u RUSTUP_TOOLCHAIN pnpm --filter @csszyx/core native:build -- --clean --native-engine

# The Rust gates live in a separate workflow (rust-check.yml), so a local run
# that only mirrored ci.yml would miss them — fmt, clippy -D warnings, the unit
# tests, and both parity harnesses.
echo "[verify-like-ci] Rust gates (rustfmt, clippy -D warnings, cargo test, parity harnesses)..."
(
    cd "$REPO/packages/core"
    cargo fmt --all -- --check
    cargo clippy --all-targets -- -D warnings
    cargo test
    cargo test --features native-engine transform::parser
    cargo test --features native-engine --test parity_corpus
)

echo "[verify-like-ci] Running unit tests through turbo (catches missing build deps)..."
pnpm test:unit

echo "[verify-like-ci] ESLint full repo..."
pnpm exec eslint .

echo "[verify-like-ci] Type-check..."
pnpm type-check

echo "[verify-like-ci] Corpus round-trip (fails on broken mappings, like CI)..."
pnpm corpus:check --require-no-broken

echo "[verify-like-ci] Workspace build (every playground, every package)..."
pnpm build

if [ "$SKIP_E2E" -eq 0 ]; then
    echo "[verify-like-ci] Playwright e2e (full suite — slowest step)..."
    pnpm --filter @csszyx/e2e exec playwright test
fi

echo "[verify-like-ci] All steps green. Safe to push."
