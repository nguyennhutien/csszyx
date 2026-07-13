FROM mcr.microsoft.com/devcontainers/base:ubuntu-22.04

# Install core
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
        aggregate \
        acl \
        build-essential \
        curl \
        dnsmasq \
        dnsutils \
        git \
        iproute2 \
        ipset \
        iptables \
        jq \
        libssl-dev \
        pkg-config \
        ripgrep

# mise — manages node, pnpm, and other tools via .mise.toml
RUN curl https://mise.run | sh
ENV PATH="/root/.local/bin:/root/.local/share/mise/shims:${PATH}"
RUN echo 'eval "$(mise activate bash)"' >> /root/.bashrc \
    && echo 'eval "$(mise activate zsh)"' >> /root/.zshrc

# Rust (@csszyx/core)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"
RUN cargo install wasm-pack --locked
RUN cargo install wasm-bindgen-cli --locked --version 0.2.93
RUN cargo install cocogitto --locked --version 7.0.0

# Build-time validation — fail the image build if any required tool is
# missing. Without this, a silent failure in any RUN step above would ship
# a broken image, and the runtime healthcheck (.devcontainer/healthcheck.sh)
# would have to repair it on every container start. This is the cheapest
# place to catch image-level brokenness.
RUN set -e \
    && for tool in mise cargo rustc wasm-pack wasm-bindgen cog; do \
        command -v $tool >/dev/null 2>&1 || (echo "FATAL: $tool not on PATH after Dockerfile RUN steps" && exit 1); \
    done \
    && echo "[image-build] All required tools present."

# Workspace
WORKDIR /workspaces/csszyx
