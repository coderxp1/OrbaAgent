# Server Access Architecture & Security Policy

**Target Server:** `85.215.156.241`  
**Hosting Provider:** Strato (strato.de)  
**OS Target:** Ubuntu 24.04 LTS (x86_64)

This document defines the permanent access model, credential lifecycle, and separation of duties for OrbaAgent infrastructure.

---

## 1. Access Model & Principles

1. **Zero Shared Credentials:** No shared passwords, no generic shared keys. Every human developer and automated process uses an independent ed25519 keypair.
2. **Root Login Prohibited:** The `root` user account is locked for direct remote SSH access. Post-cleanup sshd configuration strictly enforces `PermitRootLogin no`.
3. **Dedicated Deploy User:** All operational work and deployments run under a dedicated `deploy` system user with UID >= 1000.
4. **Separation of Human & CI Access:** Human developer keys and automated CI/CD keys are strictly segregated. CI keys are restricted in authorized_keys via forced commands (`command=...`) to specific deployment scripts.

---

## 2. Human Developer Access

### Key Generation
Developers generate an ed25519 keypair with high KDF rounds on their local machine:
```bash
ssh-keygen -t ed25519 -a 64 -C "dev-<name>@orbaagent" -f ~/.ssh/orbaagent_dev
```
- The private key is passphrase-protected and **never** leaves the local developer machine.
- Only the public key (`~/.ssh/orbaagent_dev.pub`) is submitted for onboarding.

### Local SSH Configuration
Developers configure `~/.ssh/config`:
```ssh
Host orba
  HostName 85.215.156.241
  User deploy
  IdentityFile ~/.ssh/orbaagent_dev
  IdentitiesOnly yes
```

### Key Lifecycle Management
- **Onboarding:** Administrator appends the developer's public key to `/home/deploy/.ssh/authorized_keys` with appropriate ownership (`deploy:deploy`) and permissions (`0600`).
- **Offboarding / Revocation:** Administrator removes the specific key line from `/home/deploy/.ssh/authorized_keys`. No other keys or services are affected.

---

## 3. Automated CI/CD Deployment Access

Automated GitHub Actions workflows deploy code using a dedicated deployment key:
1. **Dedicated Keypair:** Generated specifically for CI (`deploy-ci@orbaagent`).
2. **Secret Storage:** The private key is stored exclusively as an encrypted GitHub Actions secret: `DEPLOY_SSH_KEY`.
3. **Forced Command Restriction:** The public key in `/home/deploy/.ssh/authorized_keys` is prepended with strict SSH forced commands:
   ```text
   command="/opt/orbaagent/bin/deploy.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAAC3... deploy-ci@orbaagent
   ```
4. **Impact:** Even if the CI secret were compromised, the key cannot obtain an interactive shell, cannot forward ports, and can only execute the vetted `/opt/orbaagent/bin/deploy.sh` script.

---

## 4. SSH Daemon Hardening (`/etc/ssh/sshd_config.d/99-orba.conf`)

Following the Phase 0 cleanup and verification, the SSH daemon is hardened with:

```ini
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
KbdInteractiveAuthentication no
X11Forwarding no
MaxAuthTries 3
AllowUsers deploy
```

> [!CAUTION]
> Before restarting `sshd` after applying this configuration, test login in a secondary terminal session:
> `ssh orba 'whoami && sudo -n true'`
> Ensure connection succeeds before disconnecting your active session.

---

## 5. Sudo Privileges

- **Bootstrap Window:** During initial Phase 0 cleanup and server configuration, `deploy` has full sudo (`NOPASSWD:ALL`) in `/etc/sudoers.d/deploy`.
- **Hardened State:** Post-bootstrap, `/etc/sudoers.d/deploy` is narrowed strictly to Docker service commands, systemd unit reloads, and deployment directory permissions.

---

## 6. Open Infrastructure Items & Break-Glass Access

1. **Root Direct Access Sunsetting:**
   - Current baseline: `/etc/ssh/sshd_config.d/10-orbaagent.conf` permits root pubkey login (`PermitRootLogin prohibit-password`, `AllowUsers deploy root`) while the bootstrap, hardening, and initial edge proxy services are provisioned.
   - Target state: `root` will be removed from `AllowUsers` and `PermitRootLogin` set to `no` once a verified emergency break-glass procedure (Strato customer panel: serial/KVM console, rescue system access tested and confirmed by Paul) is operational.
2. **Unattended Upgrades Reboot Policy:**
   - `Unattended-Upgrade::Automatic-Reboot` is explicitly left unset / disabled (`false`). All host reboots must be manually scheduled, verified, and announced.
