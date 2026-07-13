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

run healthcheck.sh

if [ "${CSSZYX_PERSONAL_DEVCONTAINER:-0}" = "1" ]; then
    run cleanup-credentials.sh

    # The private profile bind-mounts the canonical host checkout. Its portable
    # linker makes host-authored absolute symlinks resolve without copying or
    # repointing any host-owned AI configuration.
    dotfiles_ai="${DOTFILES_AI:-/work/dotfiles-ai}"
    if [ -f "$dotfiles_ai/scripts/devcontainer-link-global.sh" ]; then
        DOTFILES_AI="$dotfiles_ai" bash "$dotfiles_ai/scripts/devcontainer-link-global.sh" \
            || echo "[poststart] WARN: devcontainer-link-global.sh exited $? (continuing)"
    else
        echo "[poststart] WARN: dotfiles-ai global linker not found (skipping)"
    fi

    run configure-codex.sh
    run configure-claude.sh
fi

run init-firewall.sh
run security-envelope-check.sh

exit 0
