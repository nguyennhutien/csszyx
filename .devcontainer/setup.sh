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
mise install

# Cocogitto validates Conventional Commit messages. It is baked into new
# devcontainer images, but install it here as a recovery path for existing
# containers that predate the Dockerfile change.
if ! command -v cog >/dev/null 2>&1; then
    cargo install cocogitto --locked --version 7.0.0
fi

# Symlink the Claude project dir so its history works under both
# /Users/.../csszyx (host paths) and /workspaces/csszyx (container paths).
ln -sfn /root/.claude/projects/-Users-tiennguyen-Projects-csszyx \
        /root/.claude/projects/-workspaces-csszyx

# Workspace deps. CI=true to skip pnpm's interactive prompts in the
# post-create environment (no TTY).
CI=true pnpm install

# Linux-arm64 native binaries that the macOS-created lockfile doesn't carry.
# Safe to run repeatedly — the script skips already-installed binaries.
if [ -f .scripts/fix-linux-arm64-binaries.sh ]; then
    bash .scripts/fix-linux-arm64-binaries.sh
fi

echo "[setup] Done."
