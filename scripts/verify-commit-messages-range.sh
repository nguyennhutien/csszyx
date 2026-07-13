#!/usr/bin/env bash
# CI backstop for commit-message policy. The lefthook commit-msg hook validates
# every message at authoring time, but a contributor can bypass it with
# --no-verify or a missing hook install. This re-runs the same policy validator
# over every non-merge commit a PR adds, so a message that release-please cannot
# parse (e.g. unbalanced or nested parentheses) is caught before merge instead
# of silently dropping the next release.
set -euo pipefail

BASE_REF="${1:?usage: verify-commit-messages-range.sh <base-ref> <head-ref>}"
HEAD_REF="${2:?usage: verify-commit-messages-range.sh <base-ref> <head-ref>}"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

failed=0
commits="$(git rev-list --no-merges "${BASE_REF}..${HEAD_REF}")"

if [ -z "$commits" ]; then
    echo "No non-merge commits in ${BASE_REF}..${HEAD_REF} — nothing to check."
    exit 0
fi

for sha in $commits; do
    git log -1 --format=%B "$sha" >"$tmp"
    if ! node scripts/validate-commit-message-policy.mjs "$tmp"; then
        echo "::error::commit ${sha} violates the commit-message policy (see above)"
        failed=1
    fi
done

exit "$failed"
