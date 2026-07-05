#!/usr/bin/env bash
# postStartCommand runner. Runs each start-up step in order but INDEPENDENTLY:
# one step failing must not block the rest. The old `A && B && C` chain meant a
# single early failure (e.g. configure-codex tripping over an untrusted mise
# config) silently skipped everything after it — including the Claude memory
# sync (configure-claude.sh) and the self-heal (healthcheck.sh). Order is
# preserved (firewall before the envelope check that verifies it); failures are
# logged but never fatal.
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"

run() {
    local script="$1"
    if [ -f "$DIR/$script" ]; then
        bash "$DIR/$script" || echo "[poststart] WARN: $script exited $? (continuing)"
    else
        echo "[poststart] WARN: $script not found (skipping)"
    fi
}

run cleanup-credentials.sh
run healthcheck.sh
run configure-codex.sh
run configure-claude.sh
run init-firewall.sh
run security-envelope-check.sh

exit 0
