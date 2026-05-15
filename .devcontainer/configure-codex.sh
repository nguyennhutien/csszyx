#!/usr/bin/env bash
# Configure Codex for this devcontainer only.
#
# Host/global Codex state remains mounted at /root/.codex. The container uses a
# separate CODEX_HOME so danger-full-access defaults do not leak back to the host.
set -euo pipefail

HOST_CODEX_HOME="${HOST_CODEX_HOME:-/root/.codex}"
DEV_CODEX_HOME="${CODEX_HOME:-/root/.codex-devcontainer}"
CODEX_WRAPPER="/root/.local/bin/codex"
REAL_CODEX="/root/.local/share/mise/installs/node/22.22.1/bin/codex"

mkdir -p "$DEV_CODEX_HOME"

sync_entry() {
    local name="$1"
    local src="$HOST_CODEX_HOME/$name"
    local dest="$DEV_CODEX_HOME/$name"

    if [ ! -e "$src" ]; then
        return
    fi

    rm -rf "$dest"
    ln -s "$src" "$dest"
}

for entry in \
    auth.json \
    cache \
    installation_id \
    memories \
    models_cache.json \
    skills \
    version.json; do
    sync_entry "$entry"
done

CONFIG="$DEV_CODEX_HOME/config.toml"

cat > "$CONFIG" <<'EOF'
# Devcontainer-only Codex permissions. The devcontainer firewall provides the
# network boundary, so local Codex can run without its own filesystem sandbox.
sandbox_mode = "danger-full-access"
approval_policy = "never"
EOF

if [ -f "$HOST_CODEX_HOME/config.toml" ]; then
    awk '
        /^[[:space:]]*(approval_policy|approvals_reviewer|sandbox_mode)[[:space:]]*=/ { next }
        { print }
    ' "$HOST_CODEX_HOME/config.toml" >> "$CONFIG"
fi

if ! grep -qF '[projects."/workspaces/csszyx"]' "$CONFIG"; then
    {
        echo
        echo '[projects."/workspaces/csszyx"]'
        echo 'trust_level = "trusted"'
    } >> "$CONFIG"
fi

if [ -x "$REAL_CODEX" ]; then
    # Strip host credentials so a prompt-injected AI cannot silently git push
    # or SSH-tunnel out via the developer's agent. Mirrors the Claude wrapper
    # strip set (audit 2026-05-14).
    cat > "$CODEX_WRAPPER" <<EOF
#!/usr/bin/env bash
set -euo pipefail

# Defense-in-depth: re-verify no SSH private key leaked back into the
# container before launching the AI (mirrors configure-claude.sh wrapper).
for f in /root/.ssh/id_* /home/vscode/.ssh/id_*; do
    [ -e "\$f" ] || continue
    case "\$f" in
        *.pub) continue ;;
    esac
    rm -f "\$f"
done

exec env \\
    -u SSH_AUTH_SOCK \\
    -u GIT_ASKPASS \\
    -u VSCODE_GIT_ASKPASS_NODE \\
    -u VSCODE_GIT_ASKPASS_MAIN \\
    -u VSCODE_GIT_ASKPASS_EXTRA_ARGS \\
    -u VSCODE_IPC_HOOK_CLI \\
    -u VSCODE_GIT_IPC_HANDLE \\
    CODEX_HOME="${DEV_CODEX_HOME}" \\
    HOST_CODEX_HOME="${HOST_CODEX_HOME}" \\
    IS_SANDBOX=1 \\
    GIT_SSH_COMMAND="ssh -o IdentitiesOnly=yes -o IdentityFile=/dev/null -F /dev/null" \\
    "${REAL_CODEX}" "\$@"
EOF

    chmod +x "$CODEX_WRAPPER"
else
    echo "[codex] WARN: Codex CLI not found at $REAL_CODEX; run mise install first."
fi

echo "[codex] Devcontainer CODEX_HOME configured at $DEV_CODEX_HOME"
