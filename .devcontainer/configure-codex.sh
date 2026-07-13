#!/usr/bin/env bash
# Configure Codex for this devcontainer only.
#
# Host/global Codex state remains mounted at /root/.codex. The container uses a
# separate CODEX_HOME so danger-full-access defaults do not leak back to the host.
set -euo pipefail

# --wrapper-only flag: rebuild only /root/.local/bin/codex. This is used by
# shell self-heal paths where Codex may already be running; avoid touching
# auth/config/state symlinks while a process could have them open.
WRAPPER_ONLY=0
for arg in "$@"; do
    case "$arg" in
        --wrapper-only) WRAPPER_ONLY=1 ;;
    esac
done

validate_path() {
    local name="$1" val="$2"
    if ! printf '%s' "$val" | grep -qE '^/[A-Za-z0-9._/-]+$'; then
        echo "[codex] FATAL: $name contains unsafe characters: $val" >&2
        exit 1
    fi
}

HOST_CODEX_HOME="${HOST_CODEX_HOME:-/root/.codex}"
DEV_CODEX_HOME="${CODEX_HOME:-/root/.codex-devcontainer}"
CODEX_WRAPPER="/root/.local/bin/codex"
REAL_CODEX="${REAL_CODEX:-}"

if [ -z "$REAL_CODEX" ]; then
    shopt -s nullglob
    for candidate in /root/.local/share/mise/installs/npm-openai-codex/*/bin/codex; do
        if [ -x "$candidate" ]; then
            REAL_CODEX="$candidate"
        fi
    done
    shopt -u nullglob
fi

if [ -z "$REAL_CODEX" ]; then
    REAL_CODEX="/root/.local/share/mise/installs/npm-openai-codex/missing/bin/codex"
fi

validate_path "HOST_CODEX_HOME" "$HOST_CODEX_HOME"
validate_path "DEV_CODEX_HOME" "$DEV_CODEX_HOME"
validate_path "REAL_CODEX" "$REAL_CODEX"

mkdir -p "$DEV_CODEX_HOME"

link_entry() {
    local src="$1"
    local dest="$2"

    if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$src" ]; then
        return
    fi

    # Atomic for files and existing symlinks. GNU ln cannot overwrite a real
    # non-empty directory with -T, so fall back to rm only for that setup case.
    if [ -d "$dest" ] && [ ! -L "$dest" ]; then
        rm -rf "$dest"
        ln -s "$src" "$dest"
    else
        ln -sfT "$src" "$dest"
    fi
}

sync_entry() {
    local name="$1"
    local src="$HOST_CODEX_HOME/$name"
    local dest="$DEV_CODEX_HOME/$name"

    if [ ! -e "$src" ]; then
        return
    fi

    link_entry "$src" "$dest"
}

sync_conversation_dir() {
    local name="$1"
    local src="$HOST_CODEX_HOME/$name"
    local dest="$DEV_CODEX_HOME/$name"

    mkdir -p "$src"

    # Preserve conversations created by an older container-local CODEX_HOME
    # before replacing it with the shared host directory.
    if [ -d "$dest" ] && [ ! -L "$dest" ]; then
        cp -an "$dest/." "$src/" 2>/dev/null || true
    fi

    link_entry "$src" "$dest"
}

if [ "$WRAPPER_ONLY" -ne 1 ]; then
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

    # `codex resume` reads rollout files from sessions/ and indexes them in the
    # versioned state database. Keep both on the host mount so the CLI and IDE
    # see one conversation store while config.toml remains container-specific.
    sync_conversation_dir sessions
    sync_conversation_dir shell_snapshots
    sync_entry history.jsonl

    shopt -s nullglob
    for state_file in "$HOST_CODEX_HOME"/state_*.sqlite*; do
        sync_entry "$(basename "$state_file")"
    done
    shopt -u nullglob
fi

CONFIG="$DEV_CODEX_HOME/config.toml"

if [ "$WRAPPER_ONLY" -ne 1 ]; then
    CONTAINER_RTK_HOOK_READY=0
    if [ -e "$HOST_CODEX_HOME/hooks/rtk-pretooluse.py" ]; then
        CONTAINER_RTK_HOOK_READY=1
    fi

    cat > "$CONFIG" <<'EOF'
# Devcontainer-only Codex permissions. The devcontainer firewall provides the
# network boundary, so local Codex can run without its own filesystem sandbox.
sandbox_mode = "danger-full-access"
approval_policy = "never"
EOF

    if [ -f "$HOST_CODEX_HOME/config.toml" ]; then
        awk \
            -v host_codex_home="$HOST_CODEX_HOME" \
            -v rewrite_rtk_hook="$CONTAINER_RTK_HOOK_READY" '
            /^[[:space:]]*(approval_policy|approvals_reviewer|sandbox_mode)[[:space:]]*=/ { next }
            rewrite_rtk_hook == 1 && /^[[:space:]]*command[[:space:]]*=.*\/Users\/[^/]+\/\.codex\/hooks\/rtk-pretooluse\.py/ {
                sub(/\/Users\/[^/]+\/\.codex\/hooks/, host_codex_home "/hooks")
            }
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
fi

if [ -x "$REAL_CODEX" ]; then
    # Mirrors the Option C wrapper from configure-claude.sh (2026-05-15).
    # See that file for the threat-model and design notes.
    cat > "$CODEX_WRAPPER" <<EOF
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
    CODEX_HOME="${DEV_CODEX_HOME}" \\
    HOST_CODEX_HOME="${HOST_CODEX_HOME}" \\
    IS_SANDBOX=1 \\
    GIT_CONFIG_COUNT=1 \\
    GIT_CONFIG_KEY_0=commit.gpgsign \\
    GIT_CONFIG_VALUE_0=false \\
    "${REAL_CODEX}" "\$@"
EOF

    chmod +x "$CODEX_WRAPPER"
else
    echo "[codex] WARN: Codex CLI not found at $REAL_CODEX; run mise install first."
fi

echo "[codex] Devcontainer CODEX_HOME configured at $DEV_CODEX_HOME"
