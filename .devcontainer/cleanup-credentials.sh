#!/usr/bin/env bash
# Container security health check.
#
# Policy (Option C, decided 2026-05-15 via Tier-1 council debate):
# In-container security is defense-in-depth, not the primary barrier. The real
# barrier is GitHub-side: branch protection ruleset 16158734 + CODEOWNERS +
# npm-publish environment gate. AI in container has roughly user-level access
# (gh OAuth token leak, firewall absent under Antigravity); pretending otherwise
# is theatre. Stop deleting on-disk SSH keys — let `git commit`, `git tag`,
# `git push` work without workarounds, and rely on GitHub to block code from
# reaching main / npm.
#
# This script now only warns when the host SSH agent is not forwarded — that
# warning still matters because terminal git push fails closed when no
# credential source is available (no key file + no agent).
set -euo pipefail

# Check both paths because the container runtime decides which one wins:
#   - VS Code Dev Containers: uses our remoteEnv → /tmp/host-ssh-agent.sock
#   - Antigravity: injects its own at /root/.antigravity-server/.*.sock
agent_ok=0
for sock in /tmp/host-ssh-agent.sock /root/.antigravity-server/.*-ssh-auth.sock; do
    [ -S "$sock" ] || [ -L "$sock" ] || continue
    agent_ok=1
    break
done

# Container may also have a local key file under /root/.ssh/ — that's another
# valid credential source for terminal git ops.
key_file_present=0
if [ -f /root/.ssh/id_ed25519 ] || [ -f /root/.ssh/id_rsa ] || [ -f /root/.ssh/id_ecdsa ]; then
    key_file_present=1
fi

if [ "$agent_ok" -eq 0 ] && [ "$key_file_present" -eq 0 ]; then
    cat <<'WARN'

⚠️  [cleanup-credentials] No SSH credential source available.
    Terminal `git push` will fail with "Permission denied (publickey)".

    Fix options:
    - macOS host (1-time setup):
        ssh-add --apple-use-keychain ~/.ssh/id_ed25519
        # Then Reopen in Container — agent persists via Keychain.
    - Linux host (each shell session):
        eval $(ssh-agent)
        ssh-add ~/.ssh/id_ed25519
    - Copy a key file directly to /root/.ssh/ (least preferred)

WARN
fi
