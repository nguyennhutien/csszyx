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
    cat > "$CODEX_WRAPPER" <<EOF
#!/usr/bin/env bash
set -euo pipefail

export CODEX_HOME="${DEV_CODEX_HOME}"
export HOST_CODEX_HOME="${HOST_CODEX_HOME}"
export IS_SANDBOX="1"

exec "${REAL_CODEX}" "\$@"
EOF

    chmod +x "$CODEX_WRAPPER"
else
    echo "[codex] WARN: Codex CLI not found at $REAL_CODEX; run mise install first."
fi

echo "[codex] Devcontainer CODEX_HOME configured at $DEV_CODEX_HOME"
