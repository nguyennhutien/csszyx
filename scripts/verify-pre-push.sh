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
# All steps run sequentially so Ctrl-C propagates naturally through the
# foreground process chain without needing process-group kill tricks.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# Compute the upstream ref.
upstream=""
if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
    upstream="$(git rev-parse --symbolic-full-name '@{u}')"
fi

# Collect lint-relevant files changed in the commits being pushed.
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
    echo "[pre-push] No upstream tracking ref — running full-repo lint."
else
    echo "[pre-push] Upstream: $upstream"
    echo "[pre-push] Lint scope: ${#scoped_files[@]} file(s) changed since upstream."
fi

# Step 1: lint (scoped)
echo "[pre-push] Step 1/3 — lint..."
if [ -z "$upstream" ]; then
    pnpm lint:check
elif [ "${#scoped_files[@]}" -gt 0 ]; then
    pnpm exec biome check --no-errors-on-unmatched "${scoped_files[@]}"
    pnpm exec eslint \
        --cache --cache-location node_modules/.cache/eslint \
        --no-warn-ignored \
        "${scoped_files[@]}"
else
    echo "[pre-push] lint: no source files in this push, skipping."
fi

# Step 2: type-check
echo "[pre-push] Step 2/3 — type-check..."
pnpm type-check

# Step 3: test + build
echo "[pre-push] Step 3/3 — turbo test + build..."
pnpm exec turbo run test build --filter='!@csszyx/e2e'

echo "[pre-push] All checks green."
