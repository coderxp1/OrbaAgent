#!/usr/bin/env bash
# Robust WireGuard activation script for GPU Worker host (45.84.65.76)
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "ERROR: Must run as root" >&2; exit 1; }

echo "==> Ensuring WireGuard tools are installed..."
if ! command -v wg >/dev/null 2>&1; then
    apt-get update
    apt-get install -y wireguard-tools wireguard
fi

mkdir -p /etc/wireguard
chmod 700 /etc/wireguard

if [ ! -f /etc/wireguard/gpu_private.key ]; then
    umask 077
    wg genkey > /etc/wireguard/gpu_private.key
    wg pubkey < /etc/wireguard/gpu_private.key > /etc/wireguard/gpu_public.key
    chmod 600 /etc/wireguard/gpu_private.key /etc/wireguard/gpu_public.key
fi

GPU_PRIV=$(cat /etc/wireguard/gpu_private.key)
GPU_PUB=$(cat /etc/wireguard/gpu_public.key)

cat > /etc/wireguard/wg-orba.conf <<EOF
[Interface]
Address = 10.77.0.2/32
ListenPort = 51820
PrivateKey = ${GPU_PRIV}

PostUp = ufw route delete allow in on %i from 10.77.0.1 to 10.77.0.2 port 8190 proto tcp 2>/dev/null || true; ufw allow in on %i from 10.77.0.1 to 10.77.0.2 port 8190 proto tcp || true
PostDown = ufw delete allow in on %i from 10.77.0.1 to 10.77.0.2 port 8190 proto tcp || true

[Peer]
PublicKey = b07BYAjgGudlyesbm3ss/Rcab+jXwal8fg9Cfph7tQ4=
AllowedIPs = 10.77.0.1/32
PersistentKeepalive = 0
EOF

chmod 600 /etc/wireguard/wg-orba.conf

echo "==> Ensuring wg-quick@wg-orba service is active..."
systemctl enable wg-quick@wg-orba
systemctl restart wg-quick@wg-orba

# Wait for interface to appear (prevents race condition with subsequent wg show)
echo "==> Verifying interface state..."
for i in $(seq 1 10); do
    if ip link show wg-orba >/dev/null 2>&1; then
        break
    fi
    sleep 0.5
done

if ! ip link show wg-orba >/dev/null 2>&1; then
    echo "ERROR: Interface wg-orba was not created by wg-quick" >&2
    systemctl status wg-quick@wg-orba --no-pager -l >&2
    exit 1
fi

if ! ip addr show wg-orba | grep -q "10.77.0.2"; then
    echo "ERROR: Interface wg-orba missing expected IP 10.77.0.2" >&2
    exit 1
fi

echo "==> WireGuard interface verified up and active."
echo "GPU_HOST_PUBLIC_KEY=${GPU_PUB}"
wg show wg-orba
