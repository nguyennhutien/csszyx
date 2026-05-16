#!/usr/bin/env bash
# Validate a commit message with Cocogitto plus csszyx release-please rules.
set -euo pipefail

MSG_FILE="${1:-}"

if [ -z "$MSG_FILE" ] || [ ! -f "$MSG_FILE" ]; then
    echo "usage: scripts/verify-commit-message.sh <commit-msg-file>" >&2
    exit 2
fi

if ! command -v cog >/dev/null 2>&1; then
    cat >&2 <<'EOF'
error: Cocogitto (`cog`) is required for commit message validation.

Install it with:
  cargo install cocogitto --locked --version 7.0.0

Then retry the commit.
EOF
    exit 127
fi

cog verify --file "$MSG_FILE"

node scripts/validate-commit-message-policy.mjs "$MSG_FILE"
