# Pre-Cleanup Server Inventory (Baseline: 2026-09-04)

**Target Host:** `85.215.156.241`  
**Hosting Provider:** Strato (strato.de)  
**Execution Timestamp:** 2026-09-04 20:39:00 UTC  
**Execution Mode:** Read-Only Audit (`infra/scripts/server-inventory.sh`)  
**Audit Purpose:** Pre-decommission baseline record of all running workloads, storage, services, users, and crontabs prior to Phase 0 cleanup.

---

```text
==============================================================================
>>> OS RELEASE & KERNEL
==============================================================================
PRETTY_NAME="Ubuntu 24.04.4 LTS"
NAME="Ubuntu"
VERSION_ID="24.04"
VERSION="24.04.4 LTS (Noble Numbat)"
VERSION_CODENAME=noble
ID=ubuntu
ID_LIKE=debian
HOME_URL="https://www.ubuntu.com/"
SUPPORT_URL="https://help.ubuntu.com/"
BUG_REPORT_URL="https://bugs.launchpad.net/ubuntu/"
PRIVACY_POLICY_URL="https://www.ubuntu.com/legal/terms-and-policies/privacy-policy"
UBUNTU_CODENAME=noble
LOGO=ubuntu-logo
6.8.0-138-generic

==============================================================================
>>> LOCAL NON-SYSTEM USERS (UID >= 1000)
==============================================================================
nobody (UID: 65534, GID: 65534, Home: /nonexistent, Shell: /usr/sbin/nologin)
atlasdeploy (UID: 1000, GID: 1000, Home: /home/atlasdeploy, Shell: /bin/bash)
deploy (UID: 1001, GID: 1001, Home: /home/deploy, Shell: /bin/bash)

==============================================================================
>>> SUDOERS CONFIGURATION & /etc/sudoers.d
==============================================================================
total 24
drwxr-x---   2 root root 4096 Sep  4 19:39 .
drwxr-xr-x 111 root root 4096 Sep  4 19:39 ..
-r--r-----   1 root root  135 Sep  1 13:30 90-cloud-init-users
-r--r-----   1 root root 1068 Jan 29  2024 README
-r--r-----   1 root root  539 Sep  1 18:12 atlaslm-staging
-r--r-----   1 root root   30 Sep  4 19:39 deploy
--- Sudoers file: /etc/sudoers.d/90-cloud-init-users ---
root ALL=(ALL) NOPASSWD:ALL
--- Sudoers file: /etc/sudoers.d/atlaslm-staging ---
atlasdeploy ALL=(root) NOPASSWD: /usr/local/sbin/atlaslmctl staging deploy *, /usr/local/sbin/atlaslmctl staging rollback *, /usr/local/sbin/atlaslmctl staging status, /usr/local/sbin/atlaslmctl staging logs
--- Sudoers file: /etc/sudoers.d/deploy ---
deploy ALL=(ALL) NOPASSWD:ALL

==============================================================================
>>> RECENT LOGINS (last -a -n 30)
==============================================================================
root     pts/5        Fri Sep  4 19:52   still logged in    187.15.157.38
root     pts/5        Fri Sep  4 19:39 - 19:52  (00:12)     187.15.157.38
root     pts/0        Fri Sep  4 16:04 - 19:52  (03:48)     187.15.157.38
root     pts/0        Thu Sep  3 19:32 - 02:41  (07:08)     187.15.157.42
root     pts/0        Thu Sep  3 19:32 - 19:32  (00:00)     187.15.157.42
root     pts/0        Thu Sep  3 19:25 - 19:25  (00:00)     187.15.157.42
root     pts/0        Thu Sep  3 19:24 - 19:25  (00:00)     187.15.157.42
root     pts/0        Thu Sep  3 19:23 - 19:24  (00:00)     187.15.157.42
root     pts/0        Thu Sep  3 19:22 - 19:23  (00:01)     187.15.157.42
root     pts/0        Thu Sep  3 19:21 - 19:22  (00:00)     187.15.157.42
root     pts/0        Thu Sep  3 19:21 - 19:21  (00:00)     187.15.157.42
root     pts/5        Thu Sep  3 19:19 - 19:20  (00:01)     187.15.157.42
root     pts/4        Thu Sep  3 02:25   still logged in    tmux(8623).%3
root     pts/0        Thu Sep  3 02:25 - 19:19  (16:53)     187.15.157.42
root     pts/6        Wed Sep  2 21:28 - 02:23  (04:55)     187.15.157.42
root     pts/5        Wed Sep  2 21:27 - 02:25  (04:58)     187.15.157.42
root     pts/4        Wed Sep  2 21:25 - 02:25  (04:59)     187.15.157.42
root     pts/3        Wed Sep  2 21:02   still logged in    tmux(8623).%2
root     pts/0        Wed Sep  2 21:01 - 02:25  (05:24)     187.15.157.42
root     pts/2        Wed Sep  2 20:54   still logged in    tmux(8623).%1
root     pts/0        Wed Sep  2 19:41 - 21:01  (01:19)     187.15.157.42
root     pts/0        Wed Sep  2 19:38 - 19:41  (00:02)     187.15.157.42
root     pts/0        Wed Sep  2 18:59 - 19:15  (00:15)     187.15.157.42
root     pts/0        Wed Sep  2 17:53 - 18:39  (00:45)     187.15.157.42
root     pts/23       Wed Sep  2 14:31 - 16:43  (02:12)     181.199.46.128
root     pts/22       Wed Sep  2 14:30 - 16:43  (02:13)     181.199.46.128
root     pts/21       Wed Sep  2 14:28 - 16:43  (02:14)     181.199.46.128
root     pts/20       Wed Sep  2 14:28 - 16:43  (02:15)     181.199.46.128
root     pts/19       Wed Sep  2 13:58 - 16:13  (02:14)     181.199.46.128
root     pts/18       Wed Sep  2 13:57 - 16:13  (02:15)     181.199.46.128

==============================================================================
>>> HOME DIRECTORIES (/home/*)
==============================================================================
total 16
drwxr-xr-x  4 root        root        4096 Sep  4 19:39 .
drwxr-xr-x 22 root        root        4096 Sep  1 13:30 ..
drwxr-x---  4 atlasdeploy atlasdeploy 4096 Sep  1 13:56 atlasdeploy
drwxr-x---  4 deploy      deploy      4096 Sep  4 19:56 deploy
--- Contents of /home/atlasdeploy ---
-rw------- 1 atlasdeploy atlasdeploy authorized_keys [REDACTED]
--- Contents of /home/deploy ---
-rw------- 1 deploy deploy authorized_keys [REDACTED]

==============================================================================
>>> DOCKER CONTAINERS (ALL)
==============================================================================
CONTAINER ID   IMAGE                                                               COMMAND                                                         CREATED        STATUS                    PORTS                                                                                             NAMES
d0577eb492de   caddy:2.8-alpine                                                    "caddy run --config /etc/caddy/Caddyfile --adapter caddyfile"   25 hours ago   Up 25 hours (unhealthy)   0.0.0.0:80->80/tcp, [::]:80->80/tcp, 0.0.0.0:443->443/tcp, [::]:443->443/tcp, 443/udp, 2019/tcp   atlaslm-staging-caddy-1
6f6dca2e29e4   atlaslm-staging-backend:bcc1d2c83c139850e41dc206630f9f381e9a8cea    "python -m app.worker"                                          25 hours ago   Up 25 hours (healthy)     8000/tcp                                                                                          atlaslm-staging-worker-1
44dd8e2a2013   atlaslm-staging-frontend:bcc1d2c83c139850e41dc206630f9f381e9a8cea   "docker-entrypoint.sh npm run start"                            25 hours ago   Up 25 hours (healthy)     3000/tcp                                                                                          atlaslm-staging-frontend-1
645ace7402a3   atlaslm-staging-mastra:bcc1d2c83c139850e41dc206630f9f381e9a8cea     "docker-entrypoint.sh node dist/index.js"                       25 hours ago   Up 25 hours (healthy)     8110/tcp                                                                                          atlaslm-staging-mastra-1
f996429c6065   atlaslm-staging-backend:bcc1d2c83c139850e41dc206630f9f381e9a8cea    "uvicorn app.main:app --host 0.0.0.0 --port 8000"               25 hours ago   Up 25 hours (healthy)     8000/tcp                                                                                          atlaslm-staging-backend-1
e8eb613eaa48   pgvector/pgvector:pg16                                              "docker-entrypoint.sh postgres"                                 25 hours ago   Up 25 hours (healthy)     5432/tcp                                                                                          atlaslm-staging-postgres-1
7a162352f7a5   redis:7-alpine                                                      "docker-entrypoint.sh redis-server"                             2 days ago     Up 2 days (healthy)       6379/tcp                                                                                          atlaslm-staging-redis-1

==============================================================================
>>> DOCKER VOLUMES
==============================================================================
DRIVER    VOLUME NAME
local     atlaslm-staging_atlaslm_staging_audio
local     atlaslm-staging_atlaslm_staging_caddy_config
local     atlaslm-staging_atlaslm_staging_caddy_data
local     atlaslm-staging_atlaslm_staging_media
local     atlaslm-staging_atlaslm_staging_pgdata
local     atlaslm-staging_atlaslm_staging_redis

==============================================================================
>>> ALL SYSTEMD TIMERS (systemctl list-timers --all)
==============================================================================
sysstat-collect.timer          sysstat-collect.service
fwupd-refresh.timer            fwupd-refresh.service
dpkg-db-backup.timer           dpkg-db-backup.service
logrotate.timer                logrotate.service
sysstat-summary.timer          sysstat-summary.service
man-db.timer                   man-db.service
apt-daily.timer                apt-daily.service
apt-daily-upgrade.timer        apt-daily-upgrade.service
motd-news.timer                motd-news.service
update-notifier-download.timer update-notifier-download.service
systemd-tmpfiles-clean.timer   systemd-tmpfiles-clean.service
e2scrub_all.timer              e2scrub_all.service
fstrim.timer                   fstrim.service
update-notifier-motd.timer     update-notifier-motd.service

==============================================================================
>>> CRON AUDIT & SCHEDULED TASKS
==============================================================================
--- User Crontabs in /var/spool/cron/crontabs ---
No user crontabs found.
--- Root Crontab ---
No crontab for current user
--- Grep for ssh / rsa / hourly tasks in cron ---
/etc/cron.daily/apt-compat:41:        # A fix for shells that do not have this bash feature.
No rogue scheduled jobs found.

==============================================================================
>>> LISTENING PORTS & SERVICES
==============================================================================
tcp   LISTEN 0      4096                         0.0.0.0:80        0.0.0.0:*    users:(("docker-proxy",pid=1318767,fd=8))                
tcp   LISTEN 0      4096                         0.0.0.0:22        0.0.0.0:*    users:(("sshd",pid=1752418,fd=3),("systemd",pid=1,fd=79))
tcp   LISTEN 0      4096                         0.0.0.0:443       0.0.0.0:*    users:(("docker-proxy",pid=1318789,fd=8))                

==============================================================================
>>> FIREWALL STATUS (UFW)
==============================================================================
Status: active
To                         Action      From
--                         ------      ----
22/tcp                     ALLOW IN    Anywhere                   # SSH
80/tcp                     ALLOW IN    Anywhere                   # AtlasLM HTTP
443/tcp                    ALLOW IN    Anywhere                   # AtlasLM HTTPS

==============================================================================
>>> DISK USAGE (df -h)
==============================================================================
/dev/vda1       697G   19G  679G   3% /
```
