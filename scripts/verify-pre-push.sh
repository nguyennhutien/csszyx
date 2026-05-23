#!/usr/bin/env bash
# Pre-push verification mirroring the CI lint/type/test/build jobs.
#
# Scope: only the commits being pushed. Files in prior commits are already
# on the remote and have already passed CI, so re-linting the whole repo
# at every push wastes wall time. The upstream-vs-HEAD diff narrows the
# lint surface to the actual delta. Type-check and the turbo test+build
# pipeline stay workspace-wide because tsc -b and turbo are already
# incremental — they skip clean projects on their own. Falling back to a
# full lint only happens when no upstream ref is configured (first push
# of a new branch) so the very first sync still gets a complete check.
#
# Signal handling: a process-group trap on INT/TERM/EXIT kills every
# child (pnpm, biome, eslint, tsc, turbo, turbo daemon, sub-processes)
# so Ctrl-C from the terminal cancels the whole pre-push, not just the
# bash shell. Without this, background `&` jobs detach from the parent's
# signal group and Ctrl-C leaves them running.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# Kill the entire process group on exit/interrupt so background jobs do
# not survive a Ctrl-C. The double-trap pattern guarantees the EXIT trap
# also runs when INT/TERM fire so we always send the group kill.
cleanup() {
    local exit_code=$?
    trap '' INT TERM EXIT
    # Negative pgid → group kill. Suppress errors when the group is
    # already gone.
    kill -- -$$ 2>/dev/null || true
    exit "$exit_code"
}
trap cleanup INT TERM EXIT

# Compute the upstream ref. Lefthook's pre-push hook fires with the
# branch about to be pushed already checked out, so @{u} resolves to
# the matching remote tracking branch when one exists. Brand-new
# branches have no upstream yet — that case falls through to a
# full-repo lint below.
upstream=""
if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
    upstream="$(git rev-parse --symbolic-full-name '@{u}')"
fi

# Collect lint-relevant files added/modified/renamed in the commits
# being pushed. Excludes deletions (no file to lint) and binary blobs
# (biome/eslint skip them anyway but the array stays tidy).
scoped_files=()
if [ -n "$upstream" ]; then
    while IFS= read -r f; do
        case "$f" in
            *.ts|*.tsx|*.js|*.jsx|*.cjs|*.mjs|*.json|*.jsonc|*.json5|*.css)
                [ -f "$f" ] && scoped_files+=("$f")
                ;;
        esac
    done < <(git diff --name-only --diff-filter=AMR "$upstream..HEAD")
fi

if [ -z "$upstream" ]; then
    echo "[verify:pre-push] No upstream tracking ref — running full-repo lint."
else
    echo "[verify:pre-push] Upstream: $upstream"
    echo "[verify:pre-push] Lint scope: ${#scoped_files[@]} file(s) changed since upstream."
fi

# Step 1: lint + type-check in parallel.
# - When upstream exists and the diff has lint-relevant files, biome and
#   eslint run against just those files (fast).
# - When upstream exists but the diff is non-source (docs/agent/etc),
#   the lint step is a no-op.
# - When upstream is unset (first push of a new branch), fall back to
#   the full lint:check script.
# Type-check is always tsc -b, which is already incremental.

run_lint() {
    if [ -z "$upstream" ]; then
        pnpm lint:check
        return $?
    fi
    if [ "${#scoped_files[@]}" -eq 0 ]; then
        echo "[verify:pre-push] lint: no source files in this push, skipping."
        return 0
    fi
    pnpm exec biome check --no-errors-on-unmatched "${scoped_files[@]}"
    pnpm exec eslint \
        --cache --cache-location node_modules/.cache/eslint \
        --no-warn-ignored \
        "${scoped_files[@]}"
}

echo "[verify:pre-push] Step 1/2 — lint (scoped) + type-check (parallel)..."
{
    run_lint 2>&1 | sed 's/^/  [lint] /'
    exit "${PIPESTATUS[0]}"
} &
LINT_PID=$!

{
    pnpm type-check 2>&1 | sed 's/^/  [tsc]  /'
    exit "${PIPESTATUS[0]}"
} &
TSC_PID=$!

# wait -n returns when ANY job exits. If the first to finish failed,
# kill the other and exit early instead of waiting it out. This is the
# fail-fast path that also makes the hook responsive to Ctrl-C: a
# signal that interrupts wait propagates to the trap above which then
# kills the group.
set +e
wait -n "$LINT_PID" "$TSC_PID"
FIRST_EXIT=$?
if [ "$FIRST_EXIT" -ne 0 ]; then
    kill "$LINT_PID" "$TSC_PID" 2>/dev/null || true
    echo "[verify:pre-push] First parallel job failed (exit=$FIRST_EXIT)." >&2
    exit "$FIRST_EXIT"
fi
wait "$LINT_PID" 2>/dev/null
LINT_EXIT=$?
wait "$TSC_PID" 2>/dev/null
TSC_EXIT=$?
set -e
if [ "$LINT_EXIT" -ne 0 ] || [ "$TSC_EXIT" -ne 0 ]; then
    echo "[verify:pre-push] lint exit=$LINT_EXIT, tsc exit=$TSC_EXIT" >&2
    exit 1
fi

echo "[verify:pre-push] Step 2/2 — turbo test + build (single graph, deduped ^build)..."
# Single turbo invocation lets the scheduler share the `^build` task
# between the test and build pipelines instead of running it twice.
# Turbo is already incremental so unchanged projects skip on cache hit.
pnpm exec turbo run test build --filter='!@csszyx/e2e'

echo "[verify:pre-push] All checks green."
