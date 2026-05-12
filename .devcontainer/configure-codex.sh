#!/usr/bin/env bash
# Configure Codex for this devcontainer only.
#
# Host/global Codex state remains mounted at /root/.codex. The container uses a
# separate CODEX_HOME so full-access defaults do not leak back to the host.
set -euo pipefail

HOST_CODEX_HOME="${HOST_CODEX_HOME:-/root/.codex}"
DEV_CODEX_HOME="${CODEX_HOME:-/root/.codex-devcontainer}"

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

echo "[codex] Devcontainer CODEX_HOME configured at $DEV_CODEX_HOME"
