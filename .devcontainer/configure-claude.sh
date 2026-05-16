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

# --wrapper-only flag: rebuild ONLY the /root/.local/bin/claude wrapper
# script. Skip symlinks, settings.json overlay, and rc-file edits. Use
# when Claude may be running — touching symlinks under
# /root/.claude-devcontainer/.credentials.json while Claude has the
# file open creates a race that splits the symlink into a real file
# and forces the user to re-log-in.
WRAPPER_ONLY=0
for arg in "$@"; do
    case "$arg" in
        --wrapper-only) WRAPPER_ONLY=1 ;;
    esac
done

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

if [ "$WRAPPER_ONLY" -ne 1 ]; then
    # Symlink every entry from host EXCEPT settings.json — we own
    # settings.json so the host machine's Claude continues to honor its
    # own permission policy. SAFE FOR FIRST-TIME SETUP ONLY: if Claude
    # is already running, the rm + ln -s window is a race that can split
    # .credentials.json from a symlink into a real file. Self-heal uses
    # --wrapper-only to avoid this.
    shopt -s dotglob nullglob
    for src in "$HOST_CLAUDE_HOME"/*; do
        name="$(basename "$src")"
        case "$name" in
            settings.json) continue ;;
            .|..) continue ;;
        esac
        dest="$DEV_CLAUDE_HOME/$name"
        # Skip if already a correctly-pointing symlink to avoid the race.
        if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$src" ]; then
            continue
        fi
        if [ -L "$dest" ] || [ -e "$dest" ]; then
            rm -rf "$dest"
        fi
        ln -s "$src" "$dest"
    done
    shopt -u dotglob nullglob

    # /root/.claude.json (project trust + user prefs) lives at $HOME, not
    # inside /root/.claude/. When CLAUDE_CONFIG_DIR is set, Claude expects
    # it at $CLAUDE_CONFIG_DIR/.claude.json. Symlink it back to the host
    # file so login state, project trust, and tips history survive without
    # reinitialization.
    HOST_CLAUDE_JSON="/root/.claude.json"
    DEV_CLAUDE_JSON="$DEV_CLAUDE_HOME/.claude.json"
    if [ -f "$HOST_CLAUDE_JSON" ]; then
        if ! { [ -L "$DEV_CLAUDE_JSON" ] && [ "$(readlink "$DEV_CLAUDE_JSON")" = "$HOST_CLAUDE_JSON" ]; }; then
            if [ -L "$DEV_CLAUDE_JSON" ] || [ -e "$DEV_CLAUDE_JSON" ]; then
                rm -rf "$DEV_CLAUDE_JSON"
            fi
            ln -s "$HOST_CLAUDE_JSON" "$DEV_CLAUDE_JSON"
        fi
    fi
fi

if [ "$WRAPPER_ONLY" -ne 1 ]; then
    # Container settings.json = host settings + bypass permissions mode.
    # Merge with jq so user-managed keys (model, theme, permissions.allow)
    # survive.
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
fi

# Make the devcontainer Claude env available even when Claude is launched by
# an IDE task or a fresh shell that does not go through our wrapper aliases.
# devcontainer.json also sets containerEnv, but that only applies after the
# container has been recreated; /etc/profile.d keeps attach/restart flows
# deterministic.
AI_ENV_FILE="/etc/profile.d/csszyx-ai-env.sh"
cat > "$AI_ENV_FILE" <<EOF
# csszyx devcontainer AI env. Host shells must not source this file.
#
# Only IS_SANDBOX + CLAUDE_CONFIG_DIR are exported here — they make wrapper
# bypass scenarios still safe for Claude. GIT_SSH_COMMAND stays wrapper-only:
# exporting it shell-wide would also break the developer's terminal git push.
export IS_SANDBOX=1
export CLAUDE_CONFIG_DIR="$DEV_CLAUDE_HOME"
EOF
chmod 0644 "$AI_ENV_FILE"

# Wrapper: point Claude at the container settings dir + acknowledge sandbox
# + strip a small set of env vars as defense-in-depth (Option C, 2026-05-15).
#
# Strip is symbolic-not-enforced: naive AI `git push` fails because no agent
# is in env, but AI with shell access can still read an on-disk key file or
# use the `gh` CLI's stored OAuth token to push. The real defense for `main`
# and `npm` lives on GitHub: branch protection ruleset 16158734 + CODEOWNERS
# + npm-publish environment gate. See `.agent/workflows/security-roadmap.md`
# § 2.0 for the threat-model audit and § 1 for the Option C decision.
#
# Strip targets:
#   - SSH_AUTH_SOCK / GIT_ASKPASS / VSCODE_GIT_ASKPASS_*: default-deny for
#     naive push attempts. Doesn't stop a determined AI but raises the bar.
#   - VSCODE_IPC_HOOK_CLI / VSCODE_GIT_IPC_HANDLE: prevent AI from speaking
#     to the IDE's git extension or extension-host APIs.
#
# GIT_CONFIG override sets commit.gpgsign=false for AI processes so AI commits
# land unsigned (visible in `git log --show-signature` — separates AI commits
# from human-signed commits without blocking the workflow).
cat > "$CLAUDE_WRAPPER" <<EOF
#!/usr/bin/env bash
set -euo pipefail

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
# GIT_SSH_COMMAND stays in wrapper-only — exporting shell-wide breaks
# terminal git push for the developer.
export IS_SANDBOX=1
export CLAUDE_CONFIG_DIR="$DEV_CLAUDE_HOME"
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

# Self-healing guard. The devcontainer's postStartCommand only fires when
# the container actually restarts — closing/reopening the IDE just reattaches
# without firing it. If /root/.local/bin/claude has been wiped between
# sessions (e.g. container update, manual cleanup, build script), an
# interactive shell rebuilds it on first launch via this guard.
#
# Placed at the TOP of the rc files (before everything else) so the wrapper
# exists before mise activates and shadows PATH.
ensure_self_heal() {
    local rcfile="$1"
    local marker="# csszyx-ai-self-heal"

    if [ ! -f "$rcfile" ]; then
        return
    fi

    if grep -qF "$marker" "$rcfile"; then
        return
    fi

    # Prepend (not append) so it runs before mise activate further down.
    local guard
    guard=$(cat <<'EOF'
# csszyx-ai-self-heal
# Re-create the Claude/Codex wrapper if a previous session wiped it.
# postStartCommand only fires on container restart; IDE reopen alone
# does not. This is a no-op on the fast path (single stat call).
#
# Calls --wrapper-only so we do NOT touch /root/.claude-devcontainer/
# symlinks while Claude may be running — that path is fragile because
# Claude keeps .credentials.json open and a rm + ln -s window races
# Claude's writes, splitting the symlink into a real file.
if [ ! -x /root/.local/bin/claude ] || [ ! -x /root/.local/bin/codex ]; then
    if [ -f /workspaces/csszyx/.devcontainer/configure-claude.sh ]; then
        bash /workspaces/csszyx/.devcontainer/configure-claude.sh --wrapper-only >/dev/null 2>&1
    fi
    if [ -f /workspaces/csszyx/.devcontainer/configure-codex.sh ]; then
        bash /workspaces/csszyx/.devcontainer/configure-codex.sh >/dev/null 2>&1
    fi
fi

EOF
)
    local tmp
    tmp=$(mktemp)
    printf '%s\n' "$guard" > "$tmp"
    cat "$rcfile" >> "$tmp"
    mv "$tmp" "$rcfile"
}

ensure_self_heal /root/.bashrc
ensure_self_heal /root/.zshrc

echo "[claude] Container CLAUDE_CONFIG_DIR: $DEV_CLAUDE_HOME"
echo "[claude] Shared state symlinked from $HOST_CLAUDE_HOME (settings.json overridden)"
echo "[claude] AI env exported from $AI_ENV_FILE"
echo "[claude] PATH override appended to /root/.bashrc and /root/.zshrc"
echo "[claude] Open a new terminal (or run \`exec bash\`) for changes to take effect"
