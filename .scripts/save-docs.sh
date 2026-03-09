#!/usr/bin/env bash
# save-docs — Commit AI docs to internal/docs branch and push to private remote.
#
# Usage:
#   ./.scripts/save-docs.sh                      # auto message: "docs: update AI specs"
#   ./.scripts/save-docs.sh "planning: goal-7"   # custom message
#   git docs "planning: goal-7"                  # via git alias (recommended)
#
# WHY the temp-copy approach (not git stash):
#   AI files are GITIGNORED on feature/main branches, so git stash does NOT
#   protect them. git checkout internal/docs overwrites them with the branch
#   version. We snapshot to a tmpdir first, then restore from snapshot.

set -e

REPO="/workspaces/csszyx"
MSG="${1:-"docs: update AI specs"}"
CURRENT=$(git -C "$REPO" branch --show-current)
SNAP=$(mktemp -d)

# Pairs: "source-path-in-repo" "dest-name-in-snap"
# Using explicit pairs avoids cp -r nesting issues when destination exists.
declare -a SRCS=(".agent" "CLAUDE.md" ".claude" "docs/guides/ai-usage.md")

cleanup_snap() { rm -rf "$SNAP"; }
trap cleanup_snap EXIT

# ── Step 1: Snapshot current AI files ────────────────────────────────────────
echo "[docs] Snapshotting AI files..."
for p in "${SRCS[@]}"; do
    src="$REPO/$p"
    if [ -e "$src" ]; then
        mkdir -p "$SNAP/$(dirname "$p")"
        # Use /* for directories to copy contents, not the dir itself
        if [ -d "$src" ]; then
            mkdir -p "$SNAP/$p"
            cp -r "$src/." "$SNAP/$p/"
        else
            cp "$src" "$SNAP/$p"
        fi
    fi
done

# ── Step 2: Stash tracked code changes ───────────────────────────────────────
STASHED=false
if ! git -C "$REPO" diff --quiet || ! git -C "$REPO" diff --cached --quiet; then
    git -C "$REPO" stash push --message "save-docs: temp stash of code changes"
    STASHED=true
fi

# ── Step 3: Switch to internal/docs ──────────────────────────────────────────
echo "[docs] Switching to internal/docs..."
git -C "$REPO" checkout internal/docs --quiet

# ── Step 4: Restore snapshot over the branch's version ───────────────────────
for p in "${SRCS[@]}"; do
    snap_src="$SNAP/$p"
    repo_dest="$REPO/$p"
    if [ -e "$snap_src" ]; then
        if [ -d "$snap_src" ]; then
            mkdir -p "$repo_dest"
            cp -r "$snap_src/." "$repo_dest/"
        else
            mkdir -p "$(dirname "$repo_dest")"
            cp "$snap_src" "$repo_dest"
        fi
    fi
done

# ── Step 5: Stage and commit ──────────────────────────────────────────────────
git -C "$REPO" add "${SRCS[@]}" 2>/dev/null || true

if git -C "$REPO" diff --cached --quiet; then
    echo "[docs] Nothing to commit."
else
    git -C "$REPO" commit -m "$MSG"
    echo "[docs] Pushing to private remote..."
    git -C "$REPO" push private internal/docs
    echo "[docs] Pushed: $(git -C "$REPO" log -1 --oneline)"
fi

# ── Step 6: Return to original branch ────────────────────────────────────────
echo "[docs] Returning to $CURRENT..."
git -C "$REPO" checkout "$CURRENT" --quiet

# ── Step 7: Restore snapshot (git deleted AI files on checkout) ───────────────
echo "[docs] Restoring AI files to working tree..."
for p in "${SRCS[@]}"; do
    snap_src="$SNAP/$p"
    repo_dest="$REPO/$p"
    if [ -e "$snap_src" ]; then
        if [ -d "$snap_src" ]; then
            mkdir -p "$repo_dest"
            cp -r "$snap_src/." "$repo_dest/"
        else
            mkdir -p "$(dirname "$repo_dest")"
            cp "$snap_src" "$repo_dest"
        fi
    fi
done

# ── Step 8: Restore stashed code changes ──────────────────────────────────────
if [ "$STASHED" = true ]; then
    git -C "$REPO" stash pop --quiet
    echo "[docs] Restored stashed code changes."
fi

echo "[docs] Done. Back on $CURRENT."
