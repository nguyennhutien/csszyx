FROM mcr.microsoft.com/devcontainers/base:ubuntu-22.04

# Install core
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends curl git build-essential pkg-config libssl-dev

# Node.js & PNPM
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g pnpm

# Rust (@csszyx/core)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Workspace
WORKDIR /workspaces/csszyx
