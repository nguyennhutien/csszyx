#!/usr/bin/env bash
# Mutation testing for the Rust transform engine.
#
# Coverage proves a changed line RAN under test. It cannot prove the suite
# would go RED if that line were wrong — a loose assertion scores 100% patch
# coverage and still lets a defect through. Mutation testing closes that gap
# by breaking the line on purpose and demanding a test notice.
#
#   scripts/mutants.sh diff            # mutants in the diff vs main (PR gate)
#   scripts/mutants.sh file <path>     # every mutant in one file
#   scripts/mutants.sh shard <i>/<n>   # one slice of the full run (CI matrix)
#
# ALWAYS passes --in-place. Without it cargo-mutants copies the whole
# workspace per job — ~31G here, because .pnpm-store (24G) and node_modules
# (5.7G) get copied too, and the container's overlayfs cannot reflink so the
# copy-on-write path degrades to a real copy. That fills the disk. In-place
# mutates the tracked source and restores it, so a run costs zero disk.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

CORE_PREFIX='packages/core/src'

if ! cargo mutants --version >/dev/null 2>&1; then
    echo "[mutants] cargo-mutants not installed. Run:" >&2
    echo "          cargo install cargo-mutants --locked" >&2
    exit 127
fi

# In-place mutation edits tracked files and restores them at the end. A dirty
# Rust tree makes that restore ambiguous: an interrupted run would leave the
# mutant indistinguishable from the author's own edit. Refuse up front.
#
# ALLOW_DIRTY=1 opts out, for the one loop where a dirty tree is the point:
# a mutant came back missed, you just wrote the test meant to kill it, and you
# want to re-run before committing. Recovery if that run is interrupted is
# still `git diff -- packages/core/src` — the mutant carries a
# `~ changed by cargo-mutants ~` marker.
if [ "${ALLOW_DIRTY:-0}" != "1" ] &&
    { ! git diff --quiet -- "$CORE_PREFIX" || ! git diff --cached --quiet -- "$CORE_PREFIX"; }; then
    echo "[mutants] $CORE_PREFIX has uncommitted changes." >&2
    echo "          --in-place rewrites those files; commit or stash first so an" >&2
    echo "          interrupted run cannot be mistaken for your own edit." >&2
    echo "          Verifying a just-written test? Re-run with ALLOW_DIRTY=1." >&2
    exit 1
fi

mode="${1:-diff}"
shift || true

# cargo-mutants exits non-zero for a mutant that was missed AND for one that
# timed out, and those two say opposite things. A missed mutant is a hole in
# the suite: the code was broken and every test still passed. A timeout is the
# mutant breaking a loop's advance so it never ends — a suite that hangs is a
# suite that noticed, and CI would go red on the hang alone.
#
# So the gate reads the counts rather than the exit code, and fails on missed.
# Timeouts are named on the way past instead of being waved through silently:
# the one case this forgives wrongly is a mutant that leaves behaviour correct
# but makes the suite more than the multiplier slower, which is worth a human
# glance when the list changes.
verdict() {
    # Not named `status`: that is read-only in zsh, and this file is sourced
    # by hand often enough for that to bite.
    local exit_code="$1"
    local outcomes="mutants.out/outcomes.json"

    if [ ! -f "$outcomes" ]; then
        # No report: the run failed before testing anything — a build break or
        # a red baseline. That is the exit code's own business.
        exit "$exit_code"
    fi

    local missed timeout
    missed="$(node -e 'const o=require("./mutants.out/outcomes.json");process.stdout.write(String(o.missed))')"
    timeout="$(node -e 'const o=require("./mutants.out/outcomes.json");process.stdout.write(String(o.timeout))')"

    if [ "$timeout" != "0" ]; then
        echo "[mutants] $timeout mutant(s) timed out — each one stops a loop"
        echo "          advancing, so the suite hangs rather than passing:"
        grep -E "." mutants.out/timeout.txt 2>/dev/null | sed 's/^/            /'
    fi

    if [ "$missed" != "0" ]; then
        echo "[mutants] $missed mutant(s) survived. The suite stayed green with" >&2
        echo "          the code broken; see mutants.out/missed.txt." >&2
        exit 1
    fi

    echo "[mutants] No mutant survived."
    exit 0
}

case "$mode" in
    diff)
        base="$(git merge-base HEAD main 2>/dev/null || echo '')"
        if [ -z "$base" ]; then
            echo "[mutants] No merge-base with main — cannot scope to a diff." >&2
            exit 1
        fi

        # Only the engine's own sources carry mutants worth gating on. A diff
        # touching nothing under packages/core/src has none, and cargo-mutants
        # would spend a full baseline build proving it.
        if [ -z "$(git diff --name-only "$base..HEAD" -- "$CORE_PREFIX")" ]; then
            echo "[mutants] No changes under $CORE_PREFIX — nothing to mutate."
            exit 0
        fi

        diff_file="$(mktemp)"
        trap 'rm -f "$diff_file"' EXIT
        git diff "$base..HEAD" -- "$CORE_PREFIX" >"$diff_file"

        echo "[mutants] Diff-scoped run against $(git rev-parse --short "$base")."
        cargo mutants --in-place --in-diff "$diff_file" "$@" || mutants_exit=$?
        verdict "${mutants_exit:-0}"
        ;;

    file)
        target="${1:?usage: scripts/mutants.sh file <path>}"
        shift
        echo "[mutants] Full run over $target."
        exec cargo mutants --in-place -f "$target" "$@"
        ;;

    shard)
        spec="${1:?usage: scripts/mutants.sh shard <i>/<n>}"
        shift
        echo "[mutants] Shard $spec of the full engine run."
        exec cargo mutants --in-place --shard "$spec" "$@"
        ;;

    *)
        echo "usage: scripts/mutants.sh {diff|file <path>|shard <i>/<n>}" >&2
        exit 2
        ;;
esac
