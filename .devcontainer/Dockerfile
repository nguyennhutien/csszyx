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
#
# Pinned deliberately. mise ships CalVer (year.month.patch), so a release that
# changes internals carries no major-version signal, and this line only re-runs
# when the image is rebuilt — an unpinned installer therefore turns any rebuild
# into an unannounced tool upgrade. 2026.8.x replaced the npm backend with a
# pnpm-style store, relocating every `npm:` tool's executable and breaking the
# scripts under .devcontainer/ that resolve those paths. Bump this on purpose,
# then rebuild and verify, rather than discovering the change mid-task.
RUN curl https://mise.run | MISE_VERSION=v2026.8.1 sh
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
