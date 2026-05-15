#!/usr/bin/env bash
# Configure Claude Code for this devcontainer only.
#
# /root/.claude is bind-mounted from the host, so modifying settings.json there
# would leak devcontainer-specific permission bypass back to the host machine.
# Mirroring the configure-codex.sh pattern, we create a container-only
# /root/.claude-devcontainer/ that symlinks all shared state (sessions, projects,
# credentials, history) back to the host but overrides settings.json with
# bypassPermissions mode. The wrapper sets CLAUDE_CONFIG_DIR so Claude reads
# the container settings — bypass is scoped to the devcontainer.
set -euo pipefail

HOST_CLAUDE_HOME="/root/.claude"
DEV_CLAUDE_HOME="${DEV_CLAUDE_HOME:-/root/.claude-devcontainer}"
CLAUDE_WRAPPER="/root/.local/bin/claude"
REAL_CLAUDE="/root/.local/share/mise/installs/node/22.22.1/bin/claude"

if [ ! -x "$REAL_CLAUDE" ]; then
    echo "[claude] WARN: Claude CLI not found at $REAL_CLAUDE; run mise install first."
    exit 0
fi

if [ ! -d "$HOST_CLAUDE_HOME" ]; then
    echo "[claude] WARN: Host Claude home not found at $HOST_CLAUDE_HOME; skipping."
    exit 0
fi

mkdir -p "$DEV_CLAUDE_HOME"

# Symlink every entry from host EXCEPT settings.json — we own settings.json
# so the host machine's Claude continues to honor its own permission policy.
shopt -s dotglob nullglob
for src in "$HOST_CLAUDE_HOME"/*; do
    name="$(basename "$src")"
    case "$name" in
        settings.json) continue ;;
        .|..) continue ;;
    esac
    dest="$DEV_CLAUDE_HOME/$name"
    if [ -L "$dest" ] || [ -e "$dest" ]; then
        rm -rf "$dest"
    fi
    ln -s "$src" "$dest"
done
shopt -u dotglob nullglob

# /root/.claude.json (project trust + user prefs) lives at $HOME, not inside
# /root/.claude/. When CLAUDE_CONFIG_DIR is set, Claude expects it at
# $CLAUDE_CONFIG_DIR/.claude.json. Symlink it back to the host file so login
# state, project trust, and tips history survive without reinitialization.
HOST_CLAUDE_JSON="/root/.claude.json"
DEV_CLAUDE_JSON="$DEV_CLAUDE_HOME/.claude.json"
if [ -f "$HOST_CLAUDE_JSON" ]; then
    if [ -L "$DEV_CLAUDE_JSON" ] || [ -e "$DEV_CLAUDE_JSON" ]; then
        rm -rf "$DEV_CLAUDE_JSON"
    fi
    ln -s "$HOST_CLAUDE_JSON" "$DEV_CLAUDE_JSON"
fi

# Container settings.json = host settings + bypass permissions mode.
# Merge with jq so user-managed keys (model, theme, permissions.allow) survive.
DEV_SETTINGS="$DEV_CLAUDE_HOME/settings.json"
HOST_SETTINGS="$HOST_CLAUDE_HOME/settings.json"

OVERLAY='{
    "permissions": ((.permissions // {}) + {"defaultMode": "bypassPermissions"}),
    "skipDangerousModePermissionPrompt": true
}'

if [ -f "$HOST_SETTINGS" ]; then
    jq ". + $OVERLAY" "$HOST_SETTINGS" > "$DEV_SETTINGS"
else
    jq -n "{} + $OVERLAY" > "$DEV_SETTINGS"
fi

# Make the devcontainer Claude env available even when Claude is launched by
# an IDE task or a fresh shell that does not go through our wrapper aliases.
# devcontainer.json also sets containerEnv, but that only applies after the
# container has been recreated; /etc/profile.d keeps attach/restart flows
# deterministic.
AI_ENV_FILE="/etc/profile.d/csszyx-ai-env.sh"
cat > "$AI_ENV_FILE" <<EOF
# csszyx devcontainer AI env. Host shells must not source this file.
export IS_SANDBOX=1
export CLAUDE_CONFIG_DIR="$DEV_CLAUDE_HOME"
export GIT_SSH_COMMAND="ssh -o IdentitiesOnly=yes -o IdentityFile=/dev/null -F /dev/null"
EOF
chmod 0644 "$AI_ENV_FILE"

# Wrapper: point Claude at the container settings dir + acknowledge sandbox
# + strip host credentials so a prompt-injected AI cannot silently git push
# or SSH-tunnel out via the developer's agent. Strip targets (audit
# 2026-05-14):
#   - SSH_AUTH_SOCK: SSH agent — would let AI use any SSH-auth git op
#   - GIT_ASKPASS / VSCODE_GIT_ASKPASS_*: VS Code git credential helpers —
#     would let AI auto-authenticate HTTPS git pushes
#   - VSCODE_IPC_HOOK_CLI: IPC socket to the VS Code/Antigravity process —
#     could expose IDE-level filesystem/extension APIs
#   - VSCODE_GIT_IPC_HANDLE: Unix socket for VS Code's git extension IPC —
#     AI could write to it to trigger git operations with the IDE's
#     stored credentials (this was the gap discovered post-Phase-3a)
# IS_SANDBOX=1 is also still exported as belt-and-suspenders: terminal-
# launched claude works even if containerEnv hasn't refreshed yet.
cat > "$CLAUDE_WRAPPER" <<EOF
#!/usr/bin/env bash
set -euo pipefail

# Defense-in-depth: re-verify no SSH private key leaked back into the
# container before launching the AI. postStartCommand only fires on
# container rebuild (Antigravity's "Reopen in Container" is an attach,
# not a restart), so this catches re-injection between rebuilds.
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
    CLAUDE_CONFIG_DIR="$DEV_CLAUDE_HOME" \\
    IS_SANDBOX=1 \\
    GIT_SSH_COMMAND="ssh -o IdentitiesOnly=yes -o IdentityFile=/dev/null -F /dev/null" \\
    GIT_CONFIG_COUNT=1 \\
    GIT_CONFIG_KEY_0=commit.gpgsign \\
    GIT_CONFIG_VALUE_0=false \\
    "$REAL_CLAUDE" "\$@"
EOF
chmod +x "$CLAUDE_WRAPPER"

# The Dockerfile sets PATH so /root/.local/bin (the wrapper) comes before
# /root/.local/share/mise/shims, but `mise activate` (run from .bashrc /
# .zshrc) re-prepends the mise shims dir on every shell startup. Without
# this override, the wrapper at /root/.local/bin/claude is shadowed by
# mise's claude shim and never runs. Append an idempotent block AFTER
# `mise activate` so the wrapper wins.
ensure_env_override() {
    local rcfile="$1"
    local marker="# csszyx-ai-env"

    if [ ! -f "$rcfile" ]; then
        return
    fi

    if grep -qF "$marker" "$rcfile"; then
        return
    fi

    cat >> "$rcfile" <<EOF

$marker
# Keep AI tools in devcontainer mode for interactive non-login shells.
export IS_SANDBOX=1
export CLAUDE_CONFIG_DIR="$DEV_CLAUDE_HOME"
export GIT_SSH_COMMAND="ssh -o IdentitiesOnly=yes -o IdentityFile=/dev/null -F /dev/null"
EOF
}

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

ensure_alias_override() {
    local rcfile="$1"
    local marker="# csszyx-ai-wrapper-alias"

    if [ ! -f "$rcfile" ]; then
        return
    fi

    if grep -qF "$marker" "$rcfile"; then
        return
    fi

    cat >> "$rcfile" <<EOF

$marker
# PATH override alone proved unreliable when the IDE re-injects mise paths
# after .bashrc finishes. Aliases resolve before PATH lookup in interactive
# shells, so keep the AI wrappers stable there too.
alias claude=/root/.local/bin/claude
alias codex=/root/.local/bin/codex
EOF
}

ensure_env_override /root/.bashrc
ensure_env_override /root/.zshrc
ensure_path_override /root/.bashrc
ensure_path_override /root/.zshrc
ensure_alias_override /root/.bashrc
ensure_alias_override /root/.zshrc

echo "[claude] Container CLAUDE_CONFIG_DIR: $DEV_CLAUDE_HOME"
echo "[claude] Shared state symlinked from $HOST_CLAUDE_HOME (settings.json overridden)"
echo "[claude] AI env exported from $AI_ENV_FILE"
echo "[claude] PATH override appended to /root/.bashrc and /root/.zshrc"
echo "[claude] Open a new terminal (or run \`exec bash\`) for changes to take effect"
