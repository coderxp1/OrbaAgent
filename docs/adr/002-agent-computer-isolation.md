# ADR-002: Agent Computer Isolation & Sandbox Security

**Status:** Accepted  
**Deciders:** Paul Hartmann, OrbaAgent Core Team  
**Date:** 2026-09-04  

---

## Context and Problem Statement

Autonomous AI agents in OrbaAgent execute shell commands, run interpreted scripts (Python, Node.js), interact with external APIs, and browse the web. Malicious prompts, prompt injection attacks, or compromised dependencies must never allow an agent to:
1. Escape into the host operating system.
2. Interfere with sibling agent workspaces or tenant databases.
3. Access cloud metadata endpoints (e.g., `169.254.169.254`) or internal service ports.
4. Exfiltrate sensitive environment variables or credentials.

---

## Decision Drivers

- **Defense-in-Depth:** Multiple overlapping layers of containment.
- **Strict Blast Radius Containment:** Compromise of an agent process must be fully contained within its ephemeral sandbox.
- **Auditability:** Complete network and command visibility.
- **Resource Governance:** Prevent denial-of-service via compute starvation or fork bombs.

---

## Architecture & Isolation Controls

### 1. Dedicated Container per Agent Execution Environment
Every agent session is instantiated in a discrete, single-tenant Docker container managed by `services/computer-runtime`. 
- Containers are ephemeral: spun up on demand, snapshot-capable, and destroyed upon workflow completion.

### 2. File System Security
- **Read-Only Root Filesystem:** Root filesystems are mounted read-only (`read_only: true`).
- **Ephemeral Scratch Volumes:** Only a bounded `tmpfs` volume (`/tmp`, `/workspace`) is writable, mounted with `noexec`, `nosuid`, and `nodev` where applicable.
- **Zero Host Mounts:** **No host directories or volumes may ever be mounted into an agent container.**
- **Docker Socket Forbidden:** Under no circumstances is `/var/run/docker.sock` exposed to an agent container.

### 3. Linux Kernel & Capabilities Hardening
- **Drop All Capabilities:** All default capabilities dropped (`cap_drop: [ALL]`).
- **No New Privileges:** Enforce `security_opt: [no-new-privileges:true]` to prevent privilege escalation via setuid binaries.
- **Seccomp & AppArmor:** Apply strict custom seccomp profiles blocking dangerous syscalls (`ptrace`, `bpf`, `mount`, `kexec_load`).

### 4. Resource Bounds (cgroups v2)
- **Memory Ceiling:** Hard limit (e.g., 2GB RAM + 512MB swap).
- **CPU Quotas:** Enforce CPU period/quota (e.g., max 2 cores).
- **Process / Fork-Bomb Limit:** `pids_limit` capped (e.g., max 256 PIDs).

### 5. Network Egress Control & Allowlisting
- **Isolated Sandbox Network:** Agent containers connect to an internal isolated bridge network (`agent-sandbox-net`) with `internal: false` but routing strictly through an egress gateway.
- **Zero Direct Host Network Access:** Host network mode (`network_mode: host`) is prohibited.
- **Forward Egress Proxy:** All external HTTP/HTTPS traffic must route through an egress filtering proxy (e.g., Smokescreen or Squid) configured with strict domain allowlists.
- **SSRF Prevention:** Direct routing to RFC 1918 private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) and link-local metadata endpoints (`169.254.169.254`) is blocked at iptables / proxy levels.

---

## Hardening Roadmap (Phase 2 & Multi-Tenancy)

While standard hardened Docker containers with dropped capabilities provide the Phase 1 baseline, Phase 2 will evaluate:
1. **gVisor (`runsc` runtime):** An application kernel written in Go that intercepts all application syscalls, providing strong sandboxing without VM overhead.
2. **Firecracker MicroVMs:** Hardware-accelerated KVM microVMs for untrusted multi-tenant execution requiring full kernel boundary isolation.
