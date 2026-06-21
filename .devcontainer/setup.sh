#!/usr/bin/env bash
# Devcontainer post-create setup — runs ONCE after the container is created.
#
# Scope: workspace-level setup (things that depend on the bind-mounted
# /workspaces/csszyx). Tools themselves (mise, rust, wasm-pack) are baked
# into the image by the Dockerfile and validated at build time.
#
# This script is intentionally idempotent so it can also be invoked by
# healthcheck.sh as a recovery path.
set -euo pipefail

echo "[setup] Running workspace setup..."

# Install mise-managed tools per .mise.toml (node, pnpm, rust, claude-code).
# Trust the workspace config first: a freshly-created container has an empty
# mise trust store, and mise refuses to read an untrusted .mise.toml, which
# would abort this script under `set -e`.
mise trust /workspaces/csszyx/.mise.toml
mise install

# mise installs claude-code through its npm backend with --ignore-scripts, so the
# platform-native binary (downloaded as an optional dep) is never wired to the JS
# launcher and `claude` reports "native binary not installed". Run the package's
# own postinstall with a real node (the install path carries the resolved
# "latest" version, so locate it dynamically).
cc_install=$(find /root/.local/share/mise/installs/npm-anthropic-ai-claude-code \
    -path '*@anthropic-ai/claude-code/install.cjs' 2>/dev/null | head -1)
node_bin=$(ls /root/.local/share/mise/installs/node/*/bin/node 2>/dev/null | head -1)
if [ -n "$cc_install" ] && [ -n "$node_bin" ]; then
    (cd "$(dirname "$cc_install")" && "$node_bin" install.cjs) \
        || echo "[setup] WARN: claude-code native binary setup failed"
fi

# Cocogitto validates Conventional Commit messages. It is baked into new
# devcontainer images, but install it here as a recovery path for existing
# containers that predate the Dockerfile change.
if ! command -v cog >/dev/null 2>&1; then
    cargo install cocogitto --locked --version 7.0.0
fi

# Symlink the Claude project dir so its history works under both
# /Users/.../csszyx (host paths) and /workspaces/csszyx (container paths).
# A pre-existing REAL dir (left over from before this aliasing) must be
# folded into the host-keyed dir and removed first, otherwise `ln -sfn`
# nests the link inside it instead of replacing it.
host_proj=/root/.claude/projects/-Users-tiennguyen-Projects-csszyx
cont_proj=/root/.claude/projects/-workspaces-csszyx
mkdir -p "$host_proj"
if [ -d "$cont_proj" ] && [ ! -L "$cont_proj" ]; then
    cp -an "$cont_proj/." "$host_proj/" 2>/dev/null || true
    rm -rf "$cont_proj"
fi
ln -sfn "$host_proj" "$cont_proj"

# Workspace deps. CI=true to skip pnpm's interactive prompts in the
# post-create environment (no TTY).
CI=true pnpm install

# Linux-arm64 native binaries that the macOS-created lockfile doesn't carry.
# Safe to run repeatedly — the script skips already-installed binaries.
if [ -f .scripts/fix-linux-arm64-binaries.sh ]; then
    bash .scripts/fix-linux-arm64-binaries.sh
fi

echo "[setup] Done."
