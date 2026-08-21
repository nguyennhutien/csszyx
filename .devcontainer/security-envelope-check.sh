#!/usr/bin/env bash
# Security-envelope verification — runs LAST in postStartCommand, after
# init-firewall.sh, so the firewall has had its chance to deploy.
#
# Purpose: the repo's risk model assumes a standard devcontainer runtime
# (VS Code Dev Containers, Codespaces, Docker Desktop) where runArgs grant
# NET_ADMIN, the Dockerfile's firewall tooling exists, and init-firewall.sh
# enforces the L3/L4 egress allowlist. Some runtimes (notably Antigravity)
# silently strip those primitives — the sandbox then LOOKS configured but
# enforces nothing. This script detects that drift and shouts; it never
# blocks container start (informational by design — exit 0 always).
set -uo pipefail

DEGRADED=()

# 1. Firewall tooling baked into the image by the Dockerfile.
for pkg in iptables ipset dnsmasq; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
        DEGRADED+=("package ${pkg} not installed (image diverges from Dockerfile)")
    fi
done

# 2. NET_ADMIN capability requested via runArgs. CapEff bit 12 = cap_net_admin.
caps_hex=$(awk '/^CapEff:/ {print $2}' /proc/self/status 2>/dev/null || echo 0)
if [ $(( 0x${caps_hex} >> 12 & 1 )) -ne 1 ]; then
    DEGRADED+=("cap_net_admin absent (runArgs --cap-add stripped by the runtime)")
fi

# 3. Egress actually blocked. example.com is never on the allowlist, so a
# successful fetch means the firewall is not enforcing.
if curl -m 5 -s -o /dev/null https://example.com 2>/dev/null; then
    DEGRADED+=("egress NOT filtered (https://example.com reachable — firewall inactive)")
fi

# 4. An allowlisted endpoint must still resolve and connect. Without this
# positive control, broken DNS or fully blocked networking looks identical to
# a working deny-by-default firewall in the negative check above.
if ! curl -m 5 -s -o /dev/null https://api.github.com/zen 2>/dev/null; then
    DEGRADED+=("allowlisted egress unavailable (GitHub API cannot be reached)")
fi

if [ ${#DEGRADED[@]} -gt 0 ]; then
    echo ""
    echo "[security] ############################################################"
    echo "[security] ##  SECURITY ENVELOPE DEGRADED — sandbox is NOT enforcing  ##"
    echo "[security] ############################################################"
    for reason in "${DEGRADED[@]}"; do
        echo "[security]   - ${reason}"
    done
    echo "[security] The network sandbox this repo's risk model assumes is not"
    echo "[security] active under this runtime. Treat AI tool sessions in this"
    echo "[security] container as having unrestricted outbound network access."
    echo "[security] Mitigate by running the container with NET_ADMIN and the"
    echo "[security] firewall init script, or by treating this session as"
    echo "[security] untrusted: no credentials, no writes to shared remotes."
    echo ""
else
    echo "[security] OK — firewall tooling, NET_ADMIN, and egress filtering all verified."
fi
exit 0
