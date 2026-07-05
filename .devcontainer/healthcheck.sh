#!/usr/bin/env bash
# Devcontainer post-start healthcheck — runs EVERY time the container starts
# (including after a Docker crash that left the container in a degraded state).
#
# Strategy: detect, repair, log LOUDLY. If anything had to be repaired, the
# container start log shows exactly what — so a Dockerfile/image-cache bug is
# never silently masked. Repair must remain idempotent and cheap (~200ms when
# nothing is broken).
set -uo pipefail

REPAIRED=()
MISSING=()

echo "[health] Checking container state..."

# Layer 1: mise binary (lives at /root/.local/bin/mise per Dockerfile).
# Repair: re-run the official installer. Side effect: PATH is already set
# by Dockerfile ENV, so the binary becomes visible to the same process.
if ! command -v mise >/dev/null 2>&1; then
    echo "[health] WARN: mise missing — reinstalling..."
    curl -fsSL https://mise.run | sh || {
        echo "[health] ERROR: mise reinstall failed (network?). Aborting health check."
        exit 0
    }
    export PATH="/root/.local/bin:$PATH"
    REPAIRED+=("mise")
fi

# Layer 1.5: ensure shell rc files have mise activation. Independent of whether
# mise binary is currently present — fixes the case where image was built from
# an older Dockerfile that didn't include the activation line, so new terminals
# (bash or zsh) never auto-activate even after mise is reinstalled.
ensure_activation() {
    local rcfile=$1
    local shell=$2
    if [ -f "$rcfile" ] && ! grep -qF "mise activate ${shell}" "$rcfile"; then
        echo "eval \"\$(mise activate ${shell})\"" >> "$rcfile"
        echo "[health] Added mise activation to $rcfile"
        REPAIRED+=("${shell}-activation")
    fi
}
ensure_activation /root/.bashrc bash
ensure_activation /root/.zshrc zsh

# Layer 2: mise-managed tools (node, pnpm, rust, AI CLIs per .mise.toml).
# `mise install` is idempotent and fast when everything is already present.
MISE_LIST_JSON="$(mise list --json 2>/dev/null || printf '{}')"
if ! jq -e '
    any(."npm:@anthropic-ai/claude-code"[]?; .installed == true and .active == true)
    and any(."npm:@openai/codex"[]?; .installed == true and .active == true)
' <<< "$MISE_LIST_JSON" >/dev/null; then
    echo "[health] WARN: mise tools incomplete — running 'mise install'..."
    if mise install; then
        REPAIRED+=("mise-tools")
    else
        echo "[health] ERROR: 'mise install' failed."
        MISSING+=("mise-tools")
    fi
fi

# Layer 3: verify each runtime tool actually resolves on PATH.
for tool in node pnpm cargo wasm-pack claude codex; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        MISSING+=("$tool")
    fi
done

# Summary line — always printed so the container start log carries proof
# the healthcheck ran.
if [ ${#MISSING[@]} -gt 0 ]; then
    echo "[health] FAIL: still missing after repair: ${MISSING[*]}"
    echo "[health]       Investigate Dockerfile / .mise.toml. Manual fix may be required."
    exit 0  # Exit 0 to avoid blocking container start — user sees the warning instead.
elif [ ${#REPAIRED[@]} -gt 0 ]; then
    echo "[health] REPAIRED: ${REPAIRED[*]}"
    echo "[health]           Image was missing tools that should have been baked in."
    echo "[health]           Consider rebuilding the dev container image."
else
    echo "[health] OK — all required tools present."
fi
