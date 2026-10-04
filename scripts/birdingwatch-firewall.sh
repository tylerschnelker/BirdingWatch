#!/usr/bin/env bash
# Host firewall isolation for BirdingWatch, the homelab's one internet-facing
# app (public via Cloudflare Tunnel). Containers on the `birdingwatch` Docker
# network (bridge br-birdwatch) may reach the internet -- Cloudflare's edge,
# Wikipedia, web push services -- but nothing local:
#   - INPUT: nothing on the host itself (SSH, Backrest, Personal-Finance's
#     published port on the Tailscale IP via docker-proxy, ...)
#   - FORWARD (DOCKER-USER): no private, CGNAT/Tailscale or link-local
#     destinations, which covers the LAN, Tailscale peers and every other
#     Docker network (DNAT'd published ports land on 172.16.0.0/12).
# Traffic between containers on br-birdwatch itself (app <-> cloudflared) is
# allowed. Installed root-owned at /usr/local/sbin and run by
# birdingwatch-firewall.service before docker.service; idempotent.
set -euo pipefail

BR=br-birdwatch
TAG="birdingwatch-isolation"

# Docker reuses an existing DOCKER-USER chain and never flushes it.
iptables -N DOCKER-USER 2>/dev/null || true

# Remove any previous copies of our rules (matched by comment) so re-runs
# don't stack duplicates.
for chain in INPUT DOCKER-USER; do
    while rule=$(iptables -S "$chain" | grep -m1 -- "--comment $TAG"); do
        eval "iptables ${rule/-A/-D}"
    done
done

# INPUT, inserted at the top (ahead of Tailscale's ts-input). The rules are
# inserted in reverse, so they end up in the order: allow replies, drop the rest.
iptables -I INPUT 1 -i "$BR" -m comment --comment "$TAG" -j DROP
iptables -I INPUT 1 -i "$BR" -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment "$TAG" -j ACCEPT

# DOCKER-USER (runs first in FORWARD). Same trick: insert in reverse.
for net in 169.254.0.0/16 100.64.0.0/10 192.168.0.0/16 172.16.0.0/12 10.0.0.0/8; do
    iptables -I DOCKER-USER 1 -i "$BR" -d "$net" -m comment --comment "$TAG" -j DROP
done
iptables -I DOCKER-USER 1 -i "$BR" -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment "$TAG" -j RETURN
iptables -I DOCKER-USER 1 -i "$BR" -o "$BR" -m comment --comment "$TAG" -j RETURN
