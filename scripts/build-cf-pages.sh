#!/usr/bin/env bash
# Build script for Cloudflare Pages.
# CF Pages does not ship Rust/cargo, so we install it before building
# the WASM core (wasm-pack requires cargo).
#
# Keep the wasm-pack / wasm-bindgen-cli versions in sync with
# .github/workflows/ci.yml (wasm-pack 0.14.0, wasm-bindgen-cli =0.2.93).
# The @csszyx/core build script runs `wasm-pack --mode no-install`, so
# wasm-bindgen-cli MUST be on PATH before the build kicks in — otherwise
# wasm-pack errors with "Not able to find or install a local wasm-bindgen".
set -e

# Install Rust toolchain if not present
if ! command -v cargo &>/dev/null; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
        | sh -s -- -y --profile minimal --default-toolchain stable
    # shellcheck source=/dev/null
    source "$HOME/.cargo/env"
fi

# Ensure the wasm target is installed (a noop when already present)
rustup target add wasm32-unknown-unknown

# Install wasm-pack if not present
if ! command -v wasm-pack &>/dev/null; then
    cargo install wasm-pack --locked --version 0.14.0
fi

# Pre-install wasm-bindgen-cli so wasm-pack --mode no-install can find
# it on PATH. Version must match the wasm-bindgen library pin in
# packages/core/Cargo.toml.
if ! command -v wasm-bindgen &>/dev/null; then
    cargo install wasm-bindgen-cli --locked --version 0.2.93
fi

pnpm turbo run build --filter=@csszyx/docs
