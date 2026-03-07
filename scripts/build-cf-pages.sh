#!/usr/bin/env bash
# Build script for Cloudflare Pages.
# CF Pages does not ship Rust/cargo, so we install it before building
# the WASM core (wasm-pack requires cargo).
set -e

# Install Rust toolchain if not present
if ! command -v cargo &>/dev/null; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
        | sh -s -- -y --profile minimal --default-toolchain stable
    # shellcheck source=/dev/null
    source "$HOME/.cargo/env"
    rustup target add wasm32-unknown-unknown
fi

# Install wasm-pack if not present
if ! command -v wasm-pack &>/dev/null; then
    cargo install wasm-pack --locked
fi

pnpm turbo run build --filter=@csszyx/docs
