#!/usr/bin/env bash
# Pre-push verification mirroring the CI lint/type/test/build jobs.
#
# Layout:
#   1. Run `lint:check` and `type-check` in parallel — both are read-only,
#      use disjoint tool chains (biome+eslint vs tsc), and account for the
#      bulk of the pre-push wait when run serially.
#   2. After both succeed, dispatch test + build to a single turbo command.
#      Turbo deduplicates the `^build` dependency between the two and runs
#      what it can in parallel internally, which is faster than chaining
#      `pnpm test:unit && pnpm build` (the chained form would build once
#      for tests, then re-walk the graph for the build task).
#
# Bypass `git push --no-verify` for WIP pushes that intentionally do not
# need to pass CI (e.g. backups to a private mirror remote).

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

echo "[verify:pre-push] Step 1/2 — lint:check + type-check (parallel)..."
# Pipe each background job's output to a labelled prefix so failures are
# attributable. trap+wait propagates any non-zero exit from either job.
{
    pnpm lint:check 2>&1 | sed 's/^/  [lint] /' &
    LINT_PID=$!
    pnpm type-check 2>&1 | sed 's/^/  [tsc]  /' &
    TSC_PID=$!
    wait "$LINT_PID"
    LINT_EXIT=$?
    wait "$TSC_PID"
    TSC_EXIT=$?
    if [ "$LINT_EXIT" -ne 0 ] || [ "$TSC_EXIT" -ne 0 ]; then
        echo "[verify:pre-push] lint exit=$LINT_EXIT, tsc exit=$TSC_EXIT" >&2
        exit 1
    fi
}

echo "[verify:pre-push] Step 2/2 — turbo test + build (single graph, deduped ^build)..."
# Single turbo invocation lets the scheduler share the `^build` task
# between the test and build pipelines instead of running it twice.
pnpm exec turbo run test build --filter='!@csszyx/e2e'

echo "[verify:pre-push] All checks green."
