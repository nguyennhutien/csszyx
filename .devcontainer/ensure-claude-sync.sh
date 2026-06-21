#!/usr/bin/env bash
# Idempotent, race-safe self-heal for the Claude AI memory + conversation sync.
#
# Single source of truth, callable from anywhere — postCreate (setup.sh),
# postStart (configure-claude.sh), OR an interactive shell (the rc self-heal
# guard) — even while Claude is running. It NEVER touches .credentials.json (the
# one genuinely racy file: configure-claude.sh's symlink loop guards it behind
# --wrapper-only because a rm+ln window races Claude's open credential file). It
# ensures the four things that make the container's AI memory sync AND run
# autonomously, surviving a container rebuild or a bare IDE reopen:
#
#   1. $CLAUDE_CONFIG_DIR/projects -> /root/.claude/projects  (container-local
#      indirection; lost on rebuild, so re-created here)
#   2. projects/<container-cwd-key> -> <host-cwd-key>         (alias; lives under
#      the host mount, so it persists across rebuilds)
#   3. the claude native binary is wired (mise's npm backend installs claude-code
#      with --ignore-scripts, so the launcher placeholder is never replaced)
#   4. a container-only settings.json with bypassPermissions so AI runs without
#      permission prompts — a standalone file write, never the host's settings
#
# Fast path is a handful of stat calls; real work happens only when something is
# actually missing. Always exits 0 — a failure here must never block a shell or
# a lifecycle hook.
set -uo pipefail

DEV_CLAUDE_HOME="${CLAUDE_CONFIG_DIR:-/root/.claude-devcontainer}"
HOST_CLAUDE_HOME="/root/.claude"
HOST_WS="${HOST_WORKSPACE:-}"
CONT_WS="/workspaces/csszyx"

# 1. projects/ indirection: $DEV_CLAUDE_HOME/projects -> host projects mount.
if [ -d "$HOST_CLAUDE_HOME/projects" ]; then
    mkdir -p "$DEV_CLAUDE_HOME"
    link="$DEV_CLAUDE_HOME/projects"
    if [ ! -L "$link" ] || [ "$(readlink "$link" 2>/dev/null)" != "$HOST_CLAUDE_HOME/projects" ]; then
        # A real dir must be folded into the host store before we replace it,
        # otherwise ln nests the link inside it instead of replacing it.
        if [ -d "$link" ] && [ ! -L "$link" ]; then
            cp -an "$link/." "$HOST_CLAUDE_HOME/projects/" 2>/dev/null || true
            rm -rf "$link"
        fi
        ln -sfn -- "$HOST_CLAUDE_HOME/projects" "$link"
    fi
fi

# 2. cwd-key alias. Claude keys each project dir by cwd, so the container
#    (/workspaces/csszyx) and the host resolve to different subdirs. A RELATIVE
#    symlink under the shared projects/ dir makes both read/write ONE store and
#    resolves identically from host and container.
if [ -n "$HOST_WS" ] && [ -d "$HOST_CLAUDE_HOME/projects" ]; then
    case "$HOST_WS" in
        /[A-Za-z0-9._/-]*) : ;;
        *) HOST_WS="" ;;  # reject unsafe paths rather than sed them into a link
    esac
fi
if [ -n "$HOST_WS" ] && [ -d "$HOST_CLAUDE_HOME/projects" ]; then
    host_key="$(printf '%s' "$HOST_WS" | sed 's#/#-#g')"
    cont_key="$(printf '%s' "$CONT_WS" | sed 's#/#-#g')"
    proj="$HOST_CLAUDE_HOME/projects"
    if [ "$host_key" != "$cont_key" ]; then
        mkdir -p "$proj/$host_key"
        if [ -d "$proj/$cont_key" ] && [ ! -L "$proj/$cont_key" ]; then
            cp -an "$proj/$cont_key/." "$proj/$host_key/" 2>/dev/null || true
            rm -rf "$proj/$cont_key"
        fi
        if [ ! -L "$proj/$cont_key" ] || [ "$(readlink "$proj/$cont_key" 2>/dev/null)" != "$host_key" ]; then
            ln -sfn -- "$host_key" "$proj/$cont_key"
        fi
    fi
fi

# 3. claude native binary wiring. mise installs claude-code via its npm backend
#    with --ignore-scripts, so install.cjs never runs to copy the native binary
#    over the launcher placeholder bin/claude.exe. The placeholder is tiny; the
#    real binary is hundreds of MB — size is a cheap, reliable discriminator.
cc_install="$(find /root/.local/share/mise/installs/npm-anthropic-ai-claude-code \
    -path '*@anthropic-ai/claude-code/install.cjs' 2>/dev/null | head -1)"
if [ -n "$cc_install" ]; then
    ccdir="$(dirname "$cc_install")"
    exe="$ccdir/bin/claude.exe"
    if [ ! -e "$exe" ] || [ "$(stat -c%s "$exe" 2>/dev/null || echo 0)" -lt 4096 ]; then
        node_bin="$(ls /root/.local/share/mise/installs/node/*/bin/node 2>/dev/null | head -1)"
        if [ -n "$node_bin" ]; then
            echo "[sync] wiring claude native binary (install.cjs)..."
            (cd "$ccdir" && "$node_bin" install.cjs) >/dev/null 2>&1 || true
        fi
    fi
fi

# 4. Container-only settings.json with bypassPermissions, so the AI runs without
#    permission prompts (autonomous). This is a standalone file under
#    $CLAUDE_CONFIG_DIR — it is NOT the host's settings.json (which keeps its own
#    permission policy), so the bypass never leaks to the host machine. Written
#    only when the bypass key is absent, so it is a no-op on the fast path.
dev_settings="$DEV_CLAUDE_HOME/settings.json"
if ! grep -q '"defaultMode"[[:space:]]*:[[:space:]]*"bypassPermissions"' "$dev_settings" 2>/dev/null; then
    overlay='{"permissions": ((.permissions // {}) + {"defaultMode": "bypassPermissions"}), "skipDangerousModePermissionPrompt": true}'
    mkdir -p "$DEV_CLAUDE_HOME"
    tmp="$(mktemp)"
    if [ -f "$HOST_CLAUDE_HOME/settings.json" ]; then
        jq ". + $overlay" "$HOST_CLAUDE_HOME/settings.json" > "$tmp" 2>/dev/null && mv "$tmp" "$dev_settings"
    else
        jq -n "{} + $overlay" > "$tmp" 2>/dev/null && mv "$tmp" "$dev_settings"
    fi
    rm -f "$tmp" 2>/dev/null || true
fi

exit 0
