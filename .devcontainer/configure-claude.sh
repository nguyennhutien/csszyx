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

# The Dockerfile sets PATH so /root/.local/bin (the wrapper) comes before
# /root/.local/share/mise/shims, but `mise activate` (run from .bashrc /
# .zshrc) re-prepends the mise shims dir on every shell startup. Without
# this override, the wrapper at /root/.local/bin/claude is shadowed by
# mise's claude shim and never runs — meaning the --dangerously-skip-
# permissions flag is never injected and Claude prompts for every action.
# Append an idempotent block AFTER `mise activate` so the wrapper wins.
ensure_path_override() {
    local rcfile="$1"
    local marker="# csszyx-claude-wrapper-path"

    if [ ! -f "$rcfile" ]; then
        return
    fi

    if grep -qF "$marker" "$rcfile"; then
        return
    fi

    cat >> "$rcfile" <<EOF

$marker
# Restore /root/.local/bin priority after \`mise activate\` so the
# Claude wrapper at /root/.local/bin/claude shadows mise's claude shim.
case ":\$PATH:" in
    *":/root/.local/bin:"*)
        # Already first — strip and re-prepend to guarantee priority.
        PATH=":\$PATH:"
        PATH="\${PATH//:\\/root\\/.local\\/bin:/:}"
        PATH="\${PATH#:}"
        PATH="\${PATH%:}"
        ;;
esac
export PATH="/root/.local/bin:\$PATH"
EOF
}

ensure_path_override /root/.bashrc
ensure_path_override /root/.zshrc

echo "[claude] Devcontainer wrapper configured: claude -> vscode + --dangerously-skip-permissions"
echo "[claude] PATH override appended to /root/.bashrc and /root/.zshrc"
echo "[claude] Open a new terminal (or run \`exec bash\`) for changes to take effect"
