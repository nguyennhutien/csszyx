#!/usr/bin/env bash
# Pre-push verification — scoped to changed files, skips non-source pushes.
#
# Runs sequentially so Ctrl-C propagates naturally. Early-exits when
# the push contains only non-source files (workflow configs, docs,
# markdown, agent files) since lint/tsc/test add zero signal there.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# ── Skip for non-code branches/remotes ───────────────────────────────
# Pre-push hook receives "local_ref local_sha remote_ref remote_sha"
# lines on stdin. If all refs being pushed are non-code branches
# (internal/docs), skip verification entirely.
push_refs=""
while read -r local_ref _local_sha _remote_ref _remote_sha; do
    push_refs="${push_refs}${local_ref}"$'\n'
done
if [ -n "$push_refs" ] && ! printf '%s' "$push_refs" | grep -qvE '^refs/heads/internal/'; then
    echo "[pre-push] Only internal/* branches being pushed — skipping verification."
    exit 0
fi

# ── Compute upstream + changed files ──────────────────────────────────
upstream=""
if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
    upstream="$(git rev-parse --symbolic-full-name '@{u}')"
fi

all_changed=()
source_files=()
lint_files=()

if [ -n "$upstream" ]; then
    while IFS= read -r f; do
        [ -f "$f" ] || continue
        all_changed+=("$f")
        case "$f" in
            # Build scripts and config — not application source
            */scripts/*.mjs|*/scripts/*.ts|build.rs|*/build.rs) ;;
            # Application source that affects build output
            *.ts|*.tsx|*.js|*.jsx|*.cjs|*.mjs|*.rs)
                source_files+=("$f")
                ;;&
            *.ts|*.tsx|*.js|*.jsx|*.cjs|*.mjs|*.json|*.jsonc|*.json5|*.css)
                lint_files+=("$f")
                ;;
        esac
    done < <(git diff --name-only --diff-filter=AMR "$upstream..HEAD")
fi

# ── Early exit: no source files → nothing to verify ──────────────────
if [ -n "$upstream" ] && [ "${#source_files[@]}" -eq 0 ]; then
    echo "[pre-push] No source files changed (${#all_changed[@]} non-source files). Skipping."
    exit 0
fi

if [ -z "$upstream" ]; then
    echo "[pre-push] No upstream (new branch) — type-check only."
    pnpm type-check
    echo "[pre-push] Type-check green. Full CI runs after PR creation."
    exit 0
fi

echo "[pre-push] ${#source_files[@]} source file(s), ${#lint_files[@]} lint-relevant file(s)."

# ── Step 1: lint (scoped to changed files) ────────────────────────────
echo "[pre-push] Step 1/3 — lint..."
if [ "${#lint_files[@]}" -gt 0 ]; then
    pnpm exec biome check --no-errors-on-unmatched "${lint_files[@]}"
    pnpm exec eslint \
        --cache --cache-location node_modules/.cache/eslint \
        --no-warn-ignored \
        "${lint_files[@]}"
else
    echo "[pre-push] lint: no lint-relevant files, skipping."
fi

# ── Step 2: type-check (incremental, ~1-2s with warm cache) ──────────
echo "[pre-push] Step 2/3 — type-check..."
pnpm type-check

# ── Step 3: test + build (turbo incremental, cache-aware) ────────────
echo "[pre-push] Step 3/3 — turbo test + build..."
pnpm exec turbo run test build --filter='!@csszyx/e2e'

echo "[pre-push] All checks green."
