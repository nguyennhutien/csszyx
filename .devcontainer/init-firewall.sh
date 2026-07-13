#!/usr/bin/env bash
# Restrict devcontainer egress to the services CSSzyx actually needs.
#
# Threat model: if an AI/tooling process is tricked by prompt injection into
# fetching or exfiltrating data, outbound traffic should fail unless the target
# is part of the normal development toolchain. This is not a sandbox boundary;
# it is a low-friction network guardrail for day-to-day repo work.
set -euo pipefail
IFS=$'\n\t'

IPSET_NAME="csszyx-allowed-egress"
DNSMASQ_CONF="/etc/dnsmasq.d/csszyx-egress.conf"
DNSMASQ_PID="/run/csszyx-dnsmasq.pid"

require_cmd() {
    local cmd="$1"
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "ERROR: missing required command: $cmd"
        exit 1
    fi
}

add_ip() {
    local ip="$1"
    if [[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
        ipset add "$IPSET_NAME" "$ip" -exist
        return
    fi

    echo "ERROR: invalid IPv4 address: $ip"
    exit 1
}

add_cidr() {
    local cidr="$1"
    if [[ "$cidr" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$ ]]; then
        ipset add "$IPSET_NAME" "$cidr" -exist
        return
    fi

    echo "ERROR: invalid IPv4 CIDR: $cidr"
    exit 1
}

prime_domain() {
    local domain="$1"
    echo "Resolving $domain..."

    local ips
    ips="$(dig +short A "$domain" | awk '/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ { print }' | sort -u)"
    if [ -z "$ips" ]; then
        echo "  no IPv4 A record found; wildcard will still apply to subdomains"
        return
    fi

    while read -r ip; do
        echo "  allowing $ip"
        add_ip "$ip"
    done <<< "$ips"
}

write_dnsmasq_config() {
    local upstream_dns="$1"
    shift
    local domains=("$@")

    mkdir -p "$(dirname "$DNSMASQ_CONF")"
    {
        echo "no-resolv"
        echo "server=$upstream_dns"
        echo "listen-address=127.0.0.1"
        echo "bind-interfaces"
        echo "cache-size=1000"

        for domain in "${domains[@]}"; do
            # dnsmasq's /domain/ syntax matches the bare domain and all
            # subdomains, which is the wildcard behavior we want.
            echo "ipset=/$domain/$IPSET_NAME"
        done
    } > "$DNSMASQ_CONF"
}

start_dnsmasq() {
    if [ -f "$DNSMASQ_PID" ]; then
        kill "$(cat "$DNSMASQ_PID")" 2>/dev/null || true
        rm -f "$DNSMASQ_PID"
    fi

    dnsmasq --conf-file="$DNSMASQ_CONF" --pid-file="$DNSMASQ_PID"
    printf 'nameserver 127.0.0.1\noptions ndots:0\n' > /etc/resolv.conf
}

require_cmd aggregate
require_cmd curl
require_cmd dig
require_cmd dnsmasq
require_cmd ip
require_cmd ipset
require_cmd iptables
require_cmd iptables-save
require_cmd jq

# Docker Desktop and Linux Docker do not necessarily expose the same resolver.
# Capture Docker's resolver before replacing resolv.conf with local dnsmasq.
UPSTREAM_DNS="$(awk '/^nameserver[[:space:]]+/ { print $2; exit }' /etc/resolv.conf)"
if [[ ! "$UPSTREAM_DNS" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || [ "$UPSTREAM_DNS" = "127.0.0.1" ]; then
    echo "ERROR: unable to identify Docker's upstream DNS resolver"
    exit 1
fi
echo "[firewall] Using Docker DNS resolver: $UPSTREAM_DNS"

# Docker owns its network plumbing. This script owns only the filter table.
echo "[firewall] Resetting and flushing existing filter rules..."
iptables -P INPUT ACCEPT
iptables -P FORWARD ACCEPT
iptables -P OUTPUT ACCEPT
iptables -F
iptables -X
ipset destroy "$IPSET_NAME" 2>/dev/null || true

echo "[firewall] Creating allowlist ipset..."
ipset create "$IPSET_NAME" hash:net

echo "[firewall] Loading GitHub-owned IPv4 ranges..."
github_meta="$(curl -fsSL https://api.github.com/meta)"
if ! jq -e '.web and .api and .git and .packages' >/dev/null <<< "$github_meta"; then
    echo "ERROR: GitHub meta response missing required fields"
    exit 1
fi

while read -r cidr; do
    echo "  allowing GitHub range $cidr"
    add_cidr "$cidr"
done < <(jq -r '(.web + .api + .git + .packages)[]' <<< "$github_meta" | grep -E '^[0-9.]*/[0-9]+$' | aggregate -q)

# Repo/tooling suffixes. Each entry allows the bare domain and all subdomains
# through dnsmasq-backed ipset updates. Keep this list tight: add domains only
# when a normal csszyx workflow needs them and the destination is trusted.
CORE_WILDCARD_DOMAINS=(
    # CSSzyx
    csszyx.com

    # Node, pnpm, npm native binary restores
    npmjs.org
    nodejs.org
    mise.run

    # Rust, cargo, wasm-pack, wasm-bindgen
    rustup.rs
    rust-lang.org
    crates.io

    # GitHub downloads and private AI-docs remote
    github.com
    githubusercontent.com
    ghcr.io

    # Playwright browser/dependency installs used by @csszyx/e2e
    azureedge.net
    playwright.dev

    # Ubuntu package metadata if Playwright --with-deps or manual apt is needed
    ubuntu.com

    # VS Code server/extensions inside the devcontainer
    visualstudio.com
    windows.net

    # AI tools explicitly used in this environment
    openai.com
    chatgpt.com
    anthropic.com
    claude.com
    claude.ai
    googleapis.com
    google.com
    gstatic.com
    statsig.com

    # Error reporting used by installed tooling
    sentry.io
)

if [ -n "${CSSZYX_FIREWALL_EXTRA_DOMAINS:-}" ]; then
    echo "[firewall] Loading CSSZYX_FIREWALL_EXTRA_DOMAINS..."
    while read -r domain; do
        [ -z "$domain" ] && continue
        CORE_WILDCARD_DOMAINS+=("$domain")
    done < <(tr ', ' '\n\n' <<< "$CSSZYX_FIREWALL_EXTRA_DOMAINS" | sed '/^$/d' | sort -u)
fi

mapfile -t CORE_WILDCARD_DOMAINS < <(printf '%s\n' "${CORE_WILDCARD_DOMAINS[@]}" | sed 's/^\*\.//' | sort -u)

echo "[firewall] Starting DNS wildcard allowlist resolver..."
write_dnsmasq_config "$UPSTREAM_DNS" "${CORE_WILDCARD_DOMAINS[@]}"
start_dnsmasq

for domain in "${CORE_WILDCARD_DOMAINS[@]}"; do
    prime_domain "$domain"
done

HOST_IP="$(ip route | awk '/default/ { print $3; exit }')"
if [ -z "$HOST_IP" ]; then
    echo "ERROR: failed to detect Docker host IP"
    exit 1
fi

HOST_NETWORK="$(sed 's/\.[0-9]*$/.0\/24/' <<< "$HOST_IP")"
echo "[firewall] Allowing Docker host network: $HOST_NETWORK"

iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

iptables -A OUTPUT -d "$UPSTREAM_DNS" -p udp --dport 53 -j ACCEPT
iptables -A INPUT -s "$UPSTREAM_DNS" -p udp --sport 53 -j ACCEPT
iptables -A OUTPUT -d "$UPSTREAM_DNS" -p tcp --dport 53 -j ACCEPT
iptables -A INPUT -s "$UPSTREAM_DNS" -p tcp --sport 53 -j ACCEPT

iptables -A OUTPUT -p tcp --dport 22 -j ACCEPT
iptables -A INPUT -p tcp --sport 22 -m state --state ESTABLISHED -j ACCEPT

iptables -A INPUT -s "$HOST_NETWORK" -j ACCEPT
iptables -A OUTPUT -d "$HOST_NETWORK" -j ACCEPT

iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m set --match-set "$IPSET_NAME" dst -j ACCEPT
iptables -A OUTPUT -j REJECT --reject-with icmp-admin-prohibited

echo "[firewall] Verifying blocked arbitrary egress..."
if curl --connect-timeout 5 -fsSL https://example.com >/dev/null 2>&1; then
    echo "ERROR: firewall verification failed; example.com was reachable"
    exit 1
fi

echo "[firewall] Verifying allowed development endpoints..."
for url in \
    https://api.github.com/zen \
    https://registry.npmjs.org/pnpm \
    https://api.openai.com; do
    if ! curl --connect-timeout 5 -sS -o /dev/null "$url"; then
        echo "ERROR: firewall verification failed; unable to reach $url"
        exit 1
    fi
done

echo "[firewall] Firewall configuration complete."
