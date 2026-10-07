#!/usr/bin/env python3
"""CLI: Verify UFW and WireGuard resulting state on the host.

Use real command outputs by default; optionally accept file paths for testing:
  python -m orba_gpu.fw_wg_verify_cli \
    --ufw-status-file path/to/ufw_status.txt \
    --systemctl-file path/to/systemctl.txt \
    --ip-link-file path/to/ip_link.txt \
    --ip-addr-file path/to/ip_addr.txt

Flags:
  --ufw-only: Verify only firewall invariants
  --wg-only:  Verify only WireGuard invariants

Exit codes:
  0 = OK (all invariants satisfied)
  2 = Verification failed (invariant violation)
  3 = Unexpected error (e.g., command missing)
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from . import fw_wg_verify as v


def _read_text_from_file(p: str | None) -> str | None:
    if not p:
        return None
    return Path(p).read_text(encoding="utf-8", errors="ignore")


def _run(cmd: list[str]) -> str:
    return subprocess.check_output(cmd, text=True, stderr=subprocess.STDOUT)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Verify firewall and WireGuard state")
    ap.add_argument("--ufw-status-file", help="Path to file containing 'ufw status' output")
    ap.add_argument("--systemctl-file", help="Path to file containing 'systemctl status' output")
    ap.add_argument("--ip-link-file", help="Path to file containing 'ip link show' output")
    ap.add_argument("--ip-addr-file", help="Path to file containing 'ip addr show' output")
    ap.add_argument("--ufw-only", action="store_true", help="Only verify firewall rules")
    ap.add_argument("--wg-only", action="store_true", help="Only verify WireGuard state")
    ns = ap.parse_args(argv)

    check_ufw = not ns.wg_only
    check_wg = not ns.ufw_only

    try:
        if check_ufw:
            ufw_status = _read_text_from_file(ns.ufw_status_file) or _run(["ufw", "status", "numbered"])
            if not v.verify_ufw_state(ufw_status):
                print("FAIL: UFW verification failed (security invariants violated)", file=sys.stderr)
                return 2
            print("OK: UFW firewall verification passed (tunnel-only rules enforced)")

        if check_wg:
            systemctl_text = _read_text_from_file(ns.systemctl_file) or _run(["systemctl", "status", f"wg-quick@{v.WG_IFACE}"])
            ip_link_text = _read_text_from_file(ns.ip_link_file) or _run(["ip", "link", "show", v.WG_IFACE])
            ip_addr_text = _read_text_from_file(ns.ip_addr_file) or _run(["ip", "addr", "show", v.WG_IFACE])

            if not v.verify_wireguard_active(systemctl_text):
                print("FAIL: WireGuard service not active", file=sys.stderr)
                return 2
            if not v.verify_wg_interface_present(ip_link_text):
                print("FAIL: WireGuard interface missing", file=sys.stderr)
                return 2
            if not v.verify_wg_address(ip_addr_text):
                print("FAIL: WireGuard address missing or incorrect", file=sys.stderr)
                return 2
            print("OK: WireGuard verification passed (active and assigned 10.77.0.2)")

        return 0
    except subprocess.CalledProcessError as exc:
        print(f"COMMAND FAILED: {exc}", file=sys.stderr)
        return 3
    except Exception as exc:  # noqa: BLE001
        print(f"UNEXPECTED ERROR: {exc}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
