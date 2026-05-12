#!/usr/bin/env bash
# Configure Claude Code for this devcontainer only.
#
# Claude Code rejects --dangerously-skip-permissions when launched as root.
# This repo keeps remoteUser=root for existing tooling, so the container-local
# wrapper below re-execs Claude as the non-root vscode user and adds the flag.
set -euo pipefail

WORKSPACE="${WORKSPACE:-/workspaces/csszyx}"
CLAUDE_WRAPPER="/root/.local/bin/claude"
REAL_CLAUDE="/root/.local/share/mise/installs/node/22.22.1/bin/claude"

if ! id vscode >/dev/null 2>&1; then
    echo "[claude] ERROR: expected non-root user 'vscode' to exist."
    exit 1
fi

if [ ! -x "$REAL_CLAUDE" ]; then
    echo "[claude] WARN: Claude CLI not found at $REAL_CLAUDE; run mise install first."
    exit 0
fi

# Allow the vscode user to traverse root-owned mise paths used by the wrapper.
chmod 711 /root

mkdir -p /home/vscode
chown vscode:vscode /home/vscode

if [ -d /home/vscode/.claude ]; then
    chown -R vscode:vscode /home/vscode/.claude 2>/dev/null || true
fi

if command -v setfacl >/dev/null 2>&1 && [ -d "$WORKSPACE" ]; then
    setfacl -R -m u:vscode:rwX "$WORKSPACE" 2>/dev/null || true
    find "$WORKSPACE" -type d -exec setfacl -m d:u:vscode:rwX {} + 2>/dev/null || true
fi

cat > "$CLAUDE_WRAPPER" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

REAL_CLAUDE="/root/.local/share/mise/installs/node/22.22.1/bin/claude"
CLAUDE_ARGS=("--dangerously-skip-permissions")

for arg in "$@"; do
    if [ "$arg" = "--dangerously-skip-permissions" ]; then
        CLAUDE_ARGS=()
        break
    fi
done

if [ "$(id -u)" -eq 0 ] && [ "${IS_SANDBOX:-}" = "1" ]; then
    exec runuser -u vscode -- env \
        HOME=/home/vscode \
        CLAUDE_CONFIG_DIR=/home/vscode/.claude \
        IS_SANDBOX="${IS_SANDBOX:-1}" \
        PATH="/root/.local/bin:/root/.local/share/mise/shims:/root/.local/share/mise/installs/node/22.22.1/bin:/usr/local/bin:/usr/bin:/bin" \
        "$REAL_CLAUDE" "${CLAUDE_ARGS[@]}" "$@"
fi

exec "$REAL_CLAUDE" "${CLAUDE_ARGS[@]}" "$@"
EOF

chmod +x "$CLAUDE_WRAPPER"

echo "[claude] Devcontainer wrapper configured: claude -> vscode + --dangerously-skip-permissions"
