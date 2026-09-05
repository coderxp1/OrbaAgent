#!/usr/bin/env bash
# ==============================================================================
# OrbaAgent Server Hardening Script
# Target Host: 85.215.156.241
# Purpose: Idempotently harden SSH, install security upgrades, configure fail2ban,
#          configure Docker daemon, update UFW rules, and enforce UTC time sync.
#          Uses strict change-detection (cmp -s) to avoid unnecessary service reloads.
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
echo ">>> Checking timezone and NTP synchronization..."
CURRENT_TZ=$(timedatectl show -p Timezone --value 2>/dev/null || true)
NTP_ACTIVE=$(timedatectl show -p NTP --value 2>/dev/null || true)
if [ "${CURRENT_TZ}" = "UTC" ] && [ "${NTP_ACTIVE}" = "yes" ]; then
  echo "Timezone (UTC) and NTP synchronization are unchanged."
else
  echo "Configuring timezone to UTC and enabling systemd-timesyncd..."
  timedatectl set-timezone UTC
  timedatectl set-ntp true
fi

# 2. SSH Configuration Hardening
echo ">>> Checking SSH configuration..."
mkdir -p /etc/ssh/sshd_config.d
TMP_SSH=$(mktemp)
cat << 'EOF' > "${TMP_SSH}"
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

if cmp -s "${TMP_SSH}" /etc/ssh/sshd_config.d/10-orbaagent.conf 2>/dev/null; then
  echo "/etc/ssh/sshd_config.d/10-orbaagent.conf is unchanged."
  rm -f "${TMP_SSH}"
else
  echo "Updating /etc/ssh/sshd_config.d/10-orbaagent.conf..."
  mv "${TMP_SSH}" /etc/ssh/sshd_config.d/10-orbaagent.conf
  chmod 644 /etc/ssh/sshd_config.d/10-orbaagent.conf
  echo "Validating sshd configuration syntax..."
  sshd -t
  echo "sshd configuration syntax: OK. Reloading ssh service..."
  systemctl reload ssh || systemctl restart ssh
  echo "ssh service reloaded successfully."
fi

# 3. System Updates and Security Packages
echo ">>> Checking system packages and security upgrades..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
UPGRADABLE=$(apt list --upgradable 2>/dev/null | grep -v "Listing..." || true)
if [ -n "${UPGRADABLE}" ]; then
  echo "Applying pending system upgrades..."
  apt-get full-upgrade -y -q
else
  echo "System packages are up to date (unchanged)."
fi

# Ensure required packages are installed
if ! dpkg -s fail2ban unattended-upgrades >/dev/null 2>&1; then
  echo "Installing fail2ban and unattended-upgrades..."
  apt-get install -y -q fail2ban unattended-upgrades
else
  echo "Required security packages (fail2ban, unattended-upgrades) are already installed (unchanged)."
fi

# 4. Fail2ban configuration
echo ">>> Checking fail2ban sshd jail..."
TMP_F2B=$(mktemp)
cat << 'EOF' > "${TMP_F2B}"
[sshd]
enabled = true
port = 22
filter = sshd
maxretry = 5
bantime = 1h
findtime = 10m
EOF

if cmp -s "${TMP_F2B}" /etc/fail2ban/jail.d/sshd.local 2>/dev/null; then
  echo "/etc/fail2ban/jail.d/sshd.local is unchanged."
  rm -f "${TMP_F2B}"
else
  echo "Updating /etc/fail2ban/jail.d/sshd.local..."
  mv "${TMP_F2B}" /etc/fail2ban/jail.d/sshd.local
  systemctl restart fail2ban
  echo "fail2ban restarted."
fi

if ! systemctl is-enabled fail2ban >/dev/null 2>&1; then
  systemctl enable fail2ban
fi

# 5. Docker Configuration & Group Membership
echo ">>> Checking Docker configuration and group membership..."
if id -nG deploy 2>/dev/null | grep -qw "docker"; then
  echo "User deploy is already in docker group (unchanged)."
else
  echo "Adding deploy user to docker group..."
  usermod -aG docker deploy
fi

mkdir -p /etc/docker
TMP_DOCKER=$(mktemp)
cat << 'EOF' > "${TMP_DOCKER}"
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "5"
  },
  "live-restore": true
}
EOF

if cmp -s "${TMP_DOCKER}" /etc/docker/daemon.json 2>/dev/null; then
  echo "/etc/docker/daemon.json is unchanged."
  rm -f "${TMP_DOCKER}"
else
  echo "Updating /etc/docker/daemon.json..."
  mv "${TMP_DOCKER}" /etc/docker/daemon.json
  chmod 644 /etc/docker/daemon.json
  systemctl reload docker || systemctl restart docker
  echo "Docker daemon reloaded."
fi

# 6. Firewall Configuration (UFW)
echo ">>> Checking UFW firewall rules..."
UFW_STATUS=$(ufw status verbose 2>/dev/null || true)
if echo "${UFW_STATUS}" | grep -q "22/tcp.*ALLOW IN.*OrbaAgent SSH" && \
   echo "${UFW_STATUS}" | grep -q "80/tcp.*ALLOW IN.*OrbaAgent HTTP" && \
   echo "${UFW_STATUS}" | grep -q "443/tcp.*ALLOW IN.*OrbaAgent HTTPS" && \
   echo "${UFW_STATUS}" | grep -q "Default: deny (incoming)"; then
  echo "UFW rules are already configured and active (unchanged)."
else
  echo "Applying UFW firewall rules..."
  ufw default deny incoming
  ufw default allow outgoing
  ufw default deny routed
  ufw allow 22/tcp comment 'OrbaAgent SSH'
  ufw allow 80/tcp comment 'OrbaAgent HTTP'
  ufw allow 443/tcp comment 'OrbaAgent HTTPS'
  ufw --force enable
  ufw status verbose
fi

echo "=============================================================================="
echo ">>> SERVER HARDENING COMPLETE: $(date -u)"
echo "=============================================================================="
