#!/usr/bin/env bash
# ==============================================================================
# OrbaAgent Server Hardening Script
# Target Host: 85.215.156.241
# Purpose: Idempotently harden SSH, install security upgrades, configure fail2ban,
#          configure Docker daemon, update UFW rules, and enforce UTC time sync.
# ==============================================================================

set -euo pipefail

LOG_DIR="/var/log/orbaagent"
LOG_FILE="${LOG_DIR}/harden-$(date -u +%Y%m%d).log"

mkdir -p "${LOG_DIR}"
exec > >(tee -a "${LOG_FILE}") 2>&1

echo "=============================================================================="
echo ">>> STARTING SERVER HARDENING: $(date -u)"
echo "=============================================================================="

# 1. Timezone and NTP synchronization
echo ">>> Configuring timezone to UTC and enabling systemd-timesyncd..."
timedatectl set-timezone UTC
timedatectl set-ntp true
timedatectl status

# 2. SSH Configuration Hardening
echo ">>> Writing /etc/ssh/sshd_config.d/10-orbaagent.conf..."
mkdir -p /etc/ssh/sshd_config.d
cat << 'EOF' > /etc/ssh/sshd_config.d/10-orbaagent.conf
# OrbaAgent SSH Hardening Baseline
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowUsers deploy root
X11Forwarding no
MaxAuthTries 3
LoginGraceTime 30
EOF
chmod 644 /etc/ssh/sshd_config.d/10-orbaagent.conf

echo ">>> Validating sshd configuration syntax..."
sshd -t
echo "sshd configuration syntax: OK"

echo ">>> Reloading ssh service..."
systemctl reload ssh || systemctl restart ssh
echo "ssh service reloaded successfully."

# 3. System Updates and Security Packages
echo ">>> Running apt-get update and security upgrades..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get full-upgrade -y -q
apt-get install -y -q fail2ban unattended-upgrades

# 4. Fail2ban configuration
echo ">>> Configuring fail2ban sshd jail..."
cat << 'EOF' > /etc/fail2ban/jail.d/sshd.local
[sshd]
enabled = true
port = 22
filter = sshd
maxretry = 5
bantime = 1h
findtime = 10m
EOF
systemctl restart fail2ban
systemctl enable fail2ban

# 5. Docker Configuration & Group Membership
echo ">>> Adding deploy user to docker group..."
usermod -aG docker deploy || true

echo ">>> Writing /etc/docker/daemon.json..."
mkdir -p /etc/docker
cat << 'EOF' > /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "5"
  },
  "live-restore": true
}
EOF
chmod 644 /etc/docker/daemon.json
systemctl reload docker || systemctl restart docker
echo "Docker daemon reloaded."

# 6. Firewall Configuration (UFW)
echo ">>> Updating UFW firewall rules..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw default deny routed
ufw allow 22/tcp comment 'OrbaAgent SSH'
ufw allow 80/tcp comment 'OrbaAgent HTTP'
ufw allow 443/tcp comment 'OrbaAgent HTTPS'
ufw --force enable
ufw status verbose

echo "=============================================================================="
echo ">>> SERVER HARDENING COMPLETE: $(date -u)"
echo "=============================================================================="
