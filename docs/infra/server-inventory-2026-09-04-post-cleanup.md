# Post-Cleanup Server Inventory (2026-09-04)

**Target Host:** 85.215.156.241  
**Execution Timestamp:** 2026-09-05 01:28:00 UTC  
**Execution Mode:** Post-Decommission & Hardening Audit (infra/scripts/server-inventory.sh)  
**Audit Purpose:** Audit record of clean server state following AtlasLM decommissioning and server hardening. All containers, volumes, atlasdeploy user, and atlaslm directories removed.

## Pre-Cleanup vs. Post-Cleanup Comparison

| Attribute | Baseline Audit (`2026-09-04`) | Post-Cleanup Audit (`2026-09-05`) |
| :--- | :--- | :--- |
| **Docker Containers** | 7 running (AtlasLM staging) | **0 running / stopped** |
| **Docker Volumes** | 6 `atlaslm-staging_*` | **0 volumes** |
| **Non-System Users** | `atlasdeploy` (UID 1000), `deploy` (UID 1001) | **`deploy` (UID 1001) only** |
| **Sudoers Drop-ins** | `90-cloud-init-users`, `atlaslm-staging`, `deploy` | **`90-cloud-init-users`, `deploy` only** |
| **Host Listening Ports** | `22` (SSH), `80` (HTTP), `443` (HTTPS) | **`22` (SSH) only** |
| **Root Disk Used** | 19 GB | **2.8 GB** (694 GB free) |
| **Filesystem Remnants** | Present under `/srv`, `/etc`, `/usr/local/sbin` | **0 matching `*atlaslm*`** |

> [!NOTE]
> In the baseline audit, services (FastAPI on 8000, Web on 3000, Postgres on 5432, Redis on 6379) ran inside the Docker bridge network; only Traefik (80, 443) and sshd (22) were listening on host network interfaces (`0.0.0.0` / `[::]`). Post-cleanup, only sshd (22) is listening.

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
deploy (UID: 1001, GID: 1001, Home: /home/deploy, Shell: /bin/bash)

==============================================================================
>>> SUDOERS CONFIGURATION & /etc/sudoers.d
==============================================================================
total 20
drwxr-x---   2 root root 4096 Sep  5 01:17 .
drwxr-xr-x 110 root root 4096 Sep  5 01:23 ..
-r--r-----   1 root root  135 Sep  1 13:30 90-cloud-init-users
-r--r-----   1 root root 1068 Jan 29  2024 README
-r--r-----   1 root root   30 Sep  4 19:39 deploy
--- Sudoers file: /etc/sudoers.d/90-cloud-init-users ---
# Created by cloud-init v. 26.1-0ubuntu1~24.04.1 on Tue, 01 Sep 2026 13:30:35 +0000

# User rules for root
root ALL=(ALL) NOPASSWD:ALL
--- Sudoers file: /etc/sudoers.d/README ---
#
# The default /etc/sudoers file created on installation of the
# sudo  package now includes the directive:
# 
# 	@includedir /etc/sudoers.d
# 
# This will cause sudo to read and parse any files in the /etc/sudoers.d 
# directory that do not end in '~' or contain a '.' character, if it
# exists. It is not an error if the directory does not exist.
# 
# Note also, that because sudoers contents can vary widely, no attempt is 
# made to add this directive to existing sudoers files on upgrade.  Feel free
# to add the above directive to the end of your /etc/sudoers file to enable 
# this functionality for existing installations if you wish!
# Sudo versions older than 1.9.1 will only support the old syntax
# #includedir. That means that the sudo versions in Debian bullseye (11)
# and later will happily accept both @includedir and #includedir.
#
# Finally, please note that using the visudo command is the recommended way
# to update sudoers content, since it protects against many failure modes.
# See the man page for visudo and sudoers for more information.
#
--- Sudoers file: /etc/sudoers.d/deploy ---
deploy ALL=(ALL) NOPASSWD:ALL

==============================================================================
>>> RECENT LOGINS (last -a -n 30)
==============================================================================
root     pts/5        Fri Sep  4 19:52 - 22:00  (02:08)     187.15.157.38
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
root     pts/4        Thu Sep  3 02:25 - 01:17 (1+22:51)    tmux(8623).%3
root     pts/0        Thu Sep  3 02:25 - 19:19  (16:53)     187.15.157.42
root     pts/6        Wed Sep  2 21:28 - 02:23  (04:55)     187.15.157.42
root     pts/5        Wed Sep  2 21:27 - 02:25  (04:58)     187.15.157.42
root     pts/4        Wed Sep  2 21:25 - 02:25  (04:59)     187.15.157.42
root     pts/3        Wed Sep  2 21:02 - 01:17 (2+04:15)    tmux(8623).%2
root     pts/0        Wed Sep  2 21:01 - 02:25  (05:24)     187.15.157.42
root     pts/2        Wed Sep  2 20:54 - 01:17 (2+04:23)    tmux(8623).%1
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

wtmp begins Tue Sep  1 13:30:32 2026

==============================================================================
>>> HOME DIRECTORIES (/home/*)
==============================================================================
total 12
drwxr-xr-x  3 root   root   4096 Sep  5 01:17 .
drwxr-xr-x 22 root   root   4096 Sep  1 13:30 ..
drwxr-x---  4 deploy deploy 4096 Sep  4 19:56 deploy
--- Contents of /home/deploy ---
total 28
drwxr-x--- 4 deploy deploy 4096 Sep  4 19:56 .
drwxr-xr-x 3 root   root   4096 Sep  5 01:17 ..
-rw-r--r-- 1 deploy deploy  220 Mar 31  2024 .bash_logout
-rw-r--r-- 1 deploy deploy 3771 Mar 31  2024 .bashrc
drwx------ 2 deploy deploy 4096 Sep  4 19:56 .cache
-rw-r--r-- 1 deploy deploy  807 Mar 31  2024 .profile
drwx------ 2 deploy deploy 4096 Sep  4 19:39 .ssh
--- .ssh in /home/deploy ---
total 12
drwx------ 2 deploy deploy 4096 Sep  4 19:39 .
drwxr-x--- 4 deploy deploy 4096 Sep  4 19:56 ..
-rw------- 1 deploy deploy  107 Sep  4 19:39 authorized_keys

==============================================================================
>>> DOCKER CONTAINERS (ALL)
==============================================================================
CONTAINER ID   IMAGE     COMMAND   CREATED   STATUS    PORTS     NAMES

==============================================================================
>>> DOCKER IMAGES
==============================================================================
IMAGE   ID             DISK USAGE   CONTENT SIZE   EXTRA

==============================================================================
>>> DOCKER VOLUMES
==============================================================================
DRIVER    VOLUME NAME

==============================================================================
>>> DOCKER NETWORKS
==============================================================================
NETWORK ID     NAME      DRIVER    SCOPE
b19042ac8d2a   bridge    bridge    local
7b5472ba7882   host      host      local
9a28532d0900   none      null      local

==============================================================================
>>> DISCOVERED COMPOSE FILES
==============================================================================

==============================================================================
>>> REVERSE PROXY & SSL CERTS (/etc/nginx, /etc/letsencrypt)
==============================================================================

==============================================================================
>>> RUNNING SYSTEMD SERVICES (TOP 30)
==============================================================================
  UNIT                        LOAD   ACTIVE SUB     DESCRIPTION
  containerd.service          loaded active running containerd container runtime
  cron.service                loaded active running Regular background program processing daemon
  dbus.service                loaded active running D-Bus System Message Bus
  docker.service              loaded active running Docker Application Container Engine
  fail2ban.service            loaded active running Fail2Ban Service
  getty@tty1.service          loaded active running Getty on tty1
  ModemManager.service        loaded active running Modem Manager
  multipathd.service          loaded active running Device-Mapper Multipath Device Controller
  polkit.service              loaded active running Authorization Manager
  rsyslog.service             loaded active running System Logging Service
  serial-getty@ttyS0.service  loaded active running Serial Getty on ttyS0
  ssh.service                 loaded active running OpenBSD Secure Shell server
  systemd-journald.service    loaded active running Journal Service
  systemd-logind.service      loaded active running User Login Management
  systemd-networkd.service    loaded active running Network Configuration
  systemd-resolved.service    loaded active running Network Name Resolution
  systemd-timesyncd.service   loaded active running Network Time Synchronization
  systemd-udevd.service       loaded active running Rule-based Manager for Device Events and Files
  udisks2.service             loaded active running Disk Manager
  unattended-upgrades.service loaded active running Unattended Upgrades Shutdown
  user@0.service              loaded active running User Manager for UID 0
  user@1001.service           loaded active running User Manager for UID 1001

Legend: LOAD   → Reflects whether the unit definition was properly loaded.
        ACTIVE → The high-level unit activation state, i.e. generalization of SUB.
        SUB    → The low-level unit activation state, values depend on unit type.

22 loaded units listed.

==============================================================================
>>> ALL SYSTEMD TIMERS (systemctl list-timers --all)
==============================================================================
NEXT                             LEFT LAST                              PASSED UNIT                           ACTIVATES
Sat 2026-09-05 01:30:00 UTC       43s Sat 2026-09-05 01:20:04 UTC     9min ago sysstat-collect.timer          sysstat-collect.service
Sat 2026-09-05 02:39:37 UTC  1h 10min Sat 2026-09-05 01:14:18 UTC    14min ago fwupd-refresh.timer            fwupd-refresh.service
Sat 2026-09-05 06:08:07 UTC  4h 38min Fri 2026-09-04 06:34:08 UTC      18h ago apt-daily-upgrade.timer        apt-daily-upgrade.service
Sat 2026-09-05 07:02:39 UTC  5h 33min Sat 2026-09-05 01:21:08 UTC     8min ago apt-daily.timer                apt-daily.service
Sat 2026-09-05 07:34:18 UTC        6h Fri 2026-09-04 13:32:08 UTC      11h ago motd-news.timer                motd-news.service
Sat 2026-09-05 13:36:08 UTC       12h Fri 2026-09-04 13:36:08 UTC      11h ago update-notifier-download.timer update-notifier-download.service
Sat 2026-09-05 13:46:06 UTC       12h Fri 2026-09-04 13:46:06 UTC      11h ago systemd-tmpfiles-clean.timer   systemd-tmpfiles-clean.service
Sun 2026-09-06 00:00:00 UTC       22h Sat 2026-09-05 00:00:07 UTC 1h 29min ago dpkg-db-backup.timer           dpkg-db-backup.service
Sun 2026-09-06 00:00:00 UTC       22h Sat 2026-09-05 00:00:07 UTC 1h 29min ago logrotate.timer                logrotate.service
Sun 2026-09-06 00:07:00 UTC       22h Sat 2026-09-05 00:07:08 UTC 1h 22min ago sysstat-summary.timer          sysstat-summary.service
Sun 2026-09-06 03:10:33 UTC  1 day 1h Tue 2026-09-01 08:49:18 UTC            - e2scrub_all.timer              e2scrub_all.service
Sun 2026-09-06 10:34:36 UTC  1 day 9h Sat 2026-09-05 01:21:19 UTC     7min ago man-db.timer                   man-db.service
Mon 2026-09-07 00:57:55 UTC 1 day 23h Tue 2026-09-01 08:49:18 UTC            - fstrim.timer                   fstrim.service
Mon 2026-09-07 14:34:28 UTC    2 days Tue 2026-09-01 08:49:18 UTC            - update-notifier-motd.timer     update-notifier-motd.service
-                                   - -                                      - apport-autoreport.timer        apport-autoreport.service
-                                   - -                                      - snapd.snap-repair.timer        snapd.snap-repair.service
-                                   - -                                      - ua-timer.timer                 ua-timer.service

17 timers listed.

==============================================================================
>>> CRON AUDIT & SCHEDULED TASKS
==============================================================================
--- User Crontabs in /var/spool/cron/crontabs ---
total 8
drwx-wx--T 2 root crontab 4096 Mar 31  2024 .
drwxr-xr-x 3 root root    4096 Aug 26 12:54 ..
--- Root Crontab ---
No crontab for current user
--- /etc/crontab & /etc/cron.* ---
# /etc/crontab: system-wide crontab
# Unlike any other crontab you don't have to run the `crontab'
# command to install the new version when you edit this file
# and files in /etc/cron.d. These files also have username fields,
# that none of the other crontabs do.

SHELL=/bin/sh
# You can also override PATH, but by default, newer versions inherit it from the environment
#PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Example of job definition:
# .---------------- minute (0 - 59)
# |  .------------- hour (0 - 23)
# |  |  .---------- day of month (1 - 31)
# |  |  |  .------- month (1 - 12) OR jan,feb,mar,apr ...
# |  |  |  |  .---- day of week (0 - 6) (Sunday=0 or 7) OR sun,mon,tue,wed,thu,fri,sat
# |  |  |  |  |
# *  *  *  *  * user-name command to be executed
17 *	* * *	root	cd / && run-parts --report /etc/cron.hourly
25 6	* * *	root	test -x /usr/sbin/anacron || { cd / && run-parts --report /etc/cron.daily; }
47 6	* * 7	root	test -x /usr/sbin/anacron || { cd / && run-parts --report /etc/cron.weekly; }
52 6	1 * *	root	test -x /usr/sbin/anacron || { cd / && run-parts --report /etc/cron.monthly; }
#
-rw-r--r-- 1 root root 1136 Mar 31  2024 /etc/crontab

/etc/cron.d:
total 20
drwxr-xr-x   2 root root 4096 Aug 26 12:57 .
drwxr-xr-x 110 root root 4096 Sep  5 01:23 ..
-rw-r--r--   1 root root  102 Mar 31  2024 .placeholder
-rw-r--r--   1 root root  201 Apr  8  2024 e2scrub_all
-rw-r--r--   1 root root  396 Jan  9  2024 sysstat

/etc/cron.daily:
total 36
drwxr-xr-x   2 root root 4096 Aug 26 12:57 .
drwxr-xr-x 110 root root 4096 Sep  5 01:23 ..
-rw-r--r--   1 root root  102 Mar 31  2024 .placeholder
-rwxr-xr-x   1 root root  376 Jul 29 14:09 apport
-rwxr-xr-x   1 root root 1478 Mar 22  2024 apt-compat
-rwxr-xr-x   1 root root  123 Feb  5  2024 dpkg
-rwxr-xr-x   1 root root  377 Apr  8  2024 logrotate
-rwxr-xr-x   1 root root 1395 Mar 29  2024 man-db
-rwxr-xr-x   1 root root  518 Jan  9  2024 sysstat

/etc/cron.hourly:
total 12
drwxr-xr-x   2 root root 4096 Aug 26 12:54 .
drwxr-xr-x 110 root root 4096 Sep  5 01:23 ..
-rw-r--r--   1 root root  102 Mar 31  2024 .placeholder

/etc/cron.monthly:
total 12
drwxr-xr-x   2 root root 4096 Aug 26 12:54 .
drwxr-xr-x 110 root root 4096 Sep  5 01:23 ..
-rw-r--r--   1 root root  102 Mar 31  2024 .placeholder

/etc/cron.weekly:
total 16
drwxr-xr-x   2 root root 4096 Aug 26 12:57 .
drwxr-xr-x 110 root root 4096 Sep  5 01:23 ..
-rw-r--r--   1 root root  102 Mar 31  2024 .placeholder
-rwxr-xr-x   1 root root 1055 Mar 29  2024 man-db

/etc/cron.yearly:
total 12
drwxr-xr-x   2 root root 4096 Aug 26 12:54 .
drwxr-xr-x 110 root root 4096 Sep  5 01:23 ..
-rw-r--r--   1 root root  102 Mar 31  2024 .placeholder
--- Grep for ssh / rsa / hourly tasks in cron ---
/etc/cron.daily/apt-compat:41:        # A fix for shells that do not have this bash feature.

==============================================================================
>>> DATABASE DATA DIRECTORIES
==============================================================================
No mysql or postgresql data dirs in /var/lib

==============================================================================
>>> LISTENING PORTS & SERVICES
==============================================================================
Netid State  Recv-Q Send-Q                 Local Address:Port Peer Address:PortProcess                                                    
udp   UNCONN 0      0                         127.0.0.54:53        0.0.0.0:*    users:(("systemd-resolve",pid=54399,fd=16))               
udp   UNCONN 0      0                      127.0.0.53%lo:53        0.0.0.0:*    users:(("systemd-resolve",pid=54399,fd=14))               
udp   UNCONN 0      0                85.215.156.241%ens6:68        0.0.0.0:*    users:(("systemd-network",pid=54389,fd=22))               
udp   UNCONN 0      0      [fe80::1:9cff:fe13:476d]%ens6:546          [::]:*    users:(("systemd-network",pid=54389,fd=23))               
tcp   LISTEN 0      4096                   127.0.0.53%lo:53        0.0.0.0:*    users:(("systemd-resolve",pid=54399,fd=15))               
tcp   LISTEN 0      4096                      127.0.0.54:53        0.0.0.0:*    users:(("systemd-resolve",pid=54399,fd=17))               
tcp   LISTEN 0      4096                         0.0.0.0:22        0.0.0.0:*    users:(("sshd",pid=1752418,fd=3),("systemd",pid=1,fd=112))
tcp   LISTEN 0      4096                            [::]:22           [::]:*    users:(("sshd",pid=1752418,fd=4),("systemd",pid=1,fd=113))

==============================================================================
>>> FIREWALL STATUS (UFW)
==============================================================================
Status: active
Logging: on (low)
Default: deny (incoming), allow (outgoing), deny (routed)
New profiles: skip

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW IN    Anywhere                   # OrbaAgent SSH
80/tcp                     ALLOW IN    Anywhere                   # OrbaAgent HTTP
443/tcp                    ALLOW IN    Anywhere                   # OrbaAgent HTTPS
22/tcp (v6)                ALLOW IN    Anywhere (v6)              # OrbaAgent SSH
80/tcp (v6)                ALLOW IN    Anywhere (v6)              # OrbaAgent HTTP
443/tcp (v6)               ALLOW IN    Anywhere (v6)              # OrbaAgent HTTPS


==============================================================================
>>> DISK USAGE (df -h)
==============================================================================
Filesystem      Size  Used Avail Use% Mounted on
tmpfs           2.4G  1.2M  2.4G   1% /run
efivarfs        256K   17K  235K   7% /sys/firmware/efi/efivars
/dev/vda1       697G  2.8G  694G   1% /
tmpfs            12G     0   12G   0% /dev/shm
tmpfs           5.0M     0  5.0M   0% /run/lock
/dev/vda16      881M  117M  703M  15% /boot
/dev/vda15      105M  6.2M   99M   6% /boot/efi
tmpfs           2.4G   12K  2.4G   1% /run/user/0
tmpfs           2.4G   12K  2.4G   1% /run/user/1001

==============================================================================
>>> LARGEST DIRECTORIES (du top 30 depth 2)
==============================================================================
2.8G	/
2.1G	/usr
970M	/usr/lib
751M	/var
417M	/var/cache
380M	/usr/bin
311M	/usr/src
277M	/usr/share
258M	/var/lib
104M	/usr/libexec
75M	/var/log
32M	/usr/sbin
13M	/usr/include
6.9M	/etc
1.2M	/var/backups
1.1M	/etc/apparmor.d
752K	/etc/fail2ban
668K	/etc/ssh
560K	/etc/ssl
280K	/etc/vmware-tools
272K	/root
268K	/etc/cloud
200K	/etc/console-setup
168K	/root/.docker
160K	/etc/systemd
156K	/etc/lvm
148K	/etc/grub.d
124K	/etc/apt
112K	/etc/ufw
112K	/etc/init.d

==============================================================================
>>> APPLICATION ROOTS (/var/www, /opt)
==============================================================================
/opt:
total 12
drwxr-xr-x  3 root root 4096 Sep  1 13:50 .
drwxr-xr-x 22 root root 4096 Sep  1 13:30 ..
drwx--x--x  4 root root 4096 Sep  1 13:50 containerd

==============================================================================
>>> INVENTORY COMPLETE
==============================================================================
```
