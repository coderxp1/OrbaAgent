"""
Firewall and WireGuard verification helpers for provisioning.

This module is used both by unit tests and optionally by the provisioning
script for robust post-configuration validation without relying on fragile
shell parsing.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

PRODUCTION_IP = "85.215.156.241"
WG_IFACE = "wg-orba"
WG_HOST_ADDR = "10.77.0.2"
WG_PEER_ADDR = "10.77.0.1"
WORKER_TCP_PORT = 8190
WG_UDP_PORT = 51820


@dataclass
class UfwState:
    enabled: bool
    rules_text: str


def parse_ufw_enabled(status_text: str) -> bool:
    # Accept both 'Status: active' and 'Status: active (v6)' variants
    return bool(re.search(r"^Status:\s*active\b", status_text, flags=re.M | re.I))


def verify_udp_51820_from_production(status_text: str) -> bool:
    # We require exactly one allow rule for UDP 51820 from PRODUCTION_IP
    # Disallow any other allow rule for 51820 from Anywhere/0.0.0.0/::/0 or other IPs.
    lines = [l.strip() for l in status_text.splitlines() if l.strip()]
    allow_lines = [l for l in lines if re.search(r"\b51820\b.*\budp\b", l, re.I) and re.search(r"\ballow\b", l, re.I)]
    if not allow_lines:
        return False
    # Count specific production rule
    prod_ok = [l for l in allow_lines if PRODUCTION_IP in l]
    if len(prod_ok) != 1:
        return False
    # Ensure every allow line for 51820 mentions only the production IP
    for l in allow_lines:
        # Broad sources we disallow
        if re.search(r"\bAnywhere\b|0\.0\.0\.0/0|::/0", l):
            return False
        if PRODUCTION_IP not in l:
            return False
    return True


def verify_tcp_8190_tunnel_only(status_text: str) -> bool:
    # Only the intended tunnel route rule is allowed:
    # UFW representations:
    # - "8190/tcp (wg-orba)         ROUTE ALLOW IN  10.77.0.1 -> 10.77.0.2"
    # - "8190/tcp on wg-orba        ALLOW FWD       10.77.0.1 to 10.77.0.2"
    # - "8190/tcp (wg-orba)         ROUTE ALLOW IN  10.77.0.1"
    # - "[ 2] 8190/tcp (wg-orba)    ROUTE ALLOW IN  10.77.0.1 -> 10.77.0.2"
    # No public, Anywhere, or non-tunnel 8190 allow rules are permitted.
    lines = [l.strip() for l in status_text.splitlines() if l.strip()]
    tcp8190 = [l for l in lines if re.search(r"\b8190\b.*\btcp\b", l, re.I) and re.search(r"\ballow\b", l, re.I)]
    if not tcp8190:
        return False

    intended = []
    for l in tcp8190:
        # Strictly reject any open/public traffic
        if re.search(r"\bAnywhere\b|0\.0\.0\.0/0|::/0", l, re.I):
            return False
        # Must explicitly reference the WireGuard interface
        if not re.search(rf"\({re.escape(WG_IFACE)}\)|\bon\s+{re.escape(WG_IFACE)}\b|\b{re.escape(WG_IFACE)}\b", l, re.I):
            return False
        # Must require peer IP
        if WG_PEER_ADDR not in l:
            return False
        # Must be route / fwd / forward / in
        if not re.search(r"\b(?:ROUTE|FWD|FORWARD|IN)\b", l, re.I):
            return False
        intended.append(l)

    return len(tcp8190) == 1 and len(intended) == 1


def verify_ufw_state(status_text: str) -> bool:
    return (
        parse_ufw_enabled(status_text)
        and verify_udp_51820_from_production(status_text)
        and verify_tcp_8190_tunnel_only(status_text)
    )


def verify_wireguard_active(systemctl_text: str) -> bool:
    # Accept variations like "active (exited)" or "active (running)"
    return bool(re.search(r"\bActive:\s*active\b", systemctl_text, re.I))


def verify_wg_interface_present(ip_link_text: str) -> bool:
    # Look for wg-orba in interface listing
    return WG_IFACE in ip_link_text


def verify_wg_address(ip_addr_text: str) -> bool:
    # Ensure the interface has 10.77.0.2 assigned (IPv4); accept CIDR variants
    return bool(re.search(rf"\b{re.escape(WG_HOST_ADDR)}(?:/\d+)?\b", ip_addr_text))


def verify_all(ufw_status_text: str, systemctl_text: str, ip_link_text: str, ip_addr_text: str) -> bool:
    return (
        verify_ufw_state(ufw_status_text)
        and verify_wireguard_active(systemctl_text)
        and verify_wg_interface_present(ip_link_text)
        and verify_wg_address(ip_addr_text)
    )
