#!/usr/bin/env bash
# Remove any SSH private keys that may have leaked into the container image
# or overlay filesystem. The devcontainer is treated as an untrusted execution
# environment (AI agents have root + bypass-permissions inside), so any
# long-lived credential stored on disk is a compromise vector.
#
# Replacement: SSH agent forwarding from the host. Host runs ssh-agent with
# the real key; devcontainer.json mounts the agent socket; container processes
# use the forwarded agent. Container has no key files on disk.
#
# Idempotent — safe to re-run on every container start.
set -euo pipefail

SSH_DIR="/root/.ssh"

# Delete private keys (anything matching id_* without a .pub extension).
# Keep public keys, known_hosts, allowed_signers, config — those are not
# credentials and are useful to retain.
if [ -d "$SSH_DIR" ]; then
    deleted=0
    for f in "$SSH_DIR"/id_*; do
        [ -e "$f" ] || continue
        case "$f" in
            *.pub) continue ;;
        esac
        rm -f "$f"
        deleted=$((deleted + 1))
        echo "[cleanup-credentials] removed private key: $f"
    done
    [ "$deleted" -gt 0 ] && echo "[cleanup-credentials] $deleted private key(s) removed — use SSH agent forwarding from host instead"
fi

# Warn loudly if the host did not forward an SSH agent. Without the agent,
# terminal git push from inside the container will also fail — the dev needs
# to set up ssh-agent + ssh-add on the host before reopening the container.
#
# Check both paths because the container runtime decides which one wins:
#   - VS Code Dev Containers: uses our remoteEnv → /tmp/host-ssh-agent.sock
#   - Antigravity: injects its own at /root/.antigravity-server/.*.sock
agent_ok=0
for sock in /tmp/host-ssh-agent.sock /root/.antigravity-server/.*-ssh-auth.sock; do
    [ -S "$sock" ] || [ -L "$sock" ] || continue
    agent_ok=1
    break
done

if [ "$agent_ok" -eq 0 ]; then
    cat <<'WARN'

⚠️  [cleanup-credentials] SSH agent socket NOT forwarded from host.
    Terminal git push inside this container will fail until you fix this.

    On macOS host (1-time setup):
        ssh-add --apple-use-keychain ~/.ssh/id_ed25519
        # Then Reopen in Container — agent persists via Keychain.

    On Linux host (each shell session):
        eval $(ssh-agent)
        ssh-add ~/.ssh/id_ed25519
        # Then launch the IDE from this shell so SSH_AUTH_SOCK is set
        # when devcontainer.json reads ${localEnv:SSH_AUTH_SOCK}.

WARN
fi
