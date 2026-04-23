FROM mcr.microsoft.com/devcontainers/base:ubuntu-22.04

# Install core
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends curl git build-essential pkg-config libssl-dev

# mise — manages node, pnpm, and other tools via .mise.toml
RUN curl https://mise.run | sh
ENV PATH="/root/.local/bin:/root/.local/share/mise/shims:${PATH}"
RUN echo 'eval "$(mise activate bash)"' >> /root/.bashrc

# Rust (@csszyx/core)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"
RUN cargo install wasm-pack --locked

# Workspace
WORKDIR /workspaces/csszyx
