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

# Install project tools for every contributor. The private personal profile sets
# CSSZYX_PERSONAL_DEVCONTAINER=1 and additionally installs the AI CLIs declared
# in .mise.toml; the public profile must not provision user-specific tooling.
# Trust the workspace config first: a freshly-created container has an empty
# mise trust store, and mise refuses to read an untrusted .mise.toml, which
# would abort this script under `set -e`.
mise trust /workspaces/csszyx/.mise.toml
if [ "${CSSZYX_PERSONAL_DEVCONTAINER:-0}" = "1" ]; then
    mise install
else
    mise install node pnpm rust cargo:cocogitto
fi

if [ "${CSSZYX_PERSONAL_DEVCONTAINER:-0}" = "1" ]; then
    # Wire the Claude native binary and establish host/container memory sync
    # only when the private profile has explicitly mounted that host state.
    bash /workspaces/csszyx/.devcontainer/ensure-claude-sync.sh || true
fi

# Cocogitto validates Conventional Commit messages. It is baked into new
# devcontainer images, but install it here as a recovery path for existing
# containers that predate the Dockerfile change.
if ! command -v cog >/dev/null 2>&1; then
    cargo install cocogitto --locked --version 7.0.0
fi

# Workspace deps. CI=true to skip pnpm's interactive prompts in the
# post-create environment (no TTY).
CI=true pnpm install

# Linux-arm64 native binaries that the macOS-created lockfile doesn't carry.
# Safe to run repeatedly — the script skips already-installed binaries.
if [ -f .scripts/fix-linux-arm64-binaries.sh ]; then
    bash .scripts/fix-linux-arm64-binaries.sh
fi

echo "[setup] Done."
