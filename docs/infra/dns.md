# DNS Configuration & Verification Architecture

**Domain:** `orbaagent.dev`  
**Authoritative DNS Provider:** IONOS / 1&1 (`ns1111.ui-dns.biz`, `ns1049.ui-dns.com`, `ns1024.ui-dns.de`, `ns1100.ui-dns.org`)  
**Production Server IPv4:** `85.215.156.241`  

Because `.dev` is on the Chrome HSTS preload list, browsers force HTTPS on all connections. All services must have valid TLS certificates before web traffic can be served.

---

## Required DNS Records

| Host / Subdomain | Type | Target / Value | Purpose |
| :--- | :--- | :--- | :--- |
| `@` (apex) | `A` | `85.215.156.241` | Marketing / Landing site / Apex entrypoint |
| `www` | `A` | `85.215.156.241` | Web alias (redirects to apex or serves web) |
| `api` | `A` | `85.215.156.241` | Fastify Core Backend API |
| `app` | `A` | `85.215.156.241` | Authenticated Web Application UI |
| `auth` | `A` | `85.215.156.241` | Identity Provider / OAuth callback endpoints |
| `files` | `A` | `85.215.156.241` | MinIO S3 storage / Artifact downloads |
| `computers` | `A` | `85.215.156.241` | Agent computer live view / WebSocket gateway |
| `*.computers` | `A` | `85.215.156.241` | Per-agent sandboxed computer preview URLs |
| `status` | `A` | `85.215.156.241` | Internal status / health dashboard (future) |
| `grafana` | `A` | `85.215.156.241` | Metrics and telemetry dashboards (future) |
| `@` (CAA) | `CAA` | `0 issue "letsencrypt.org"` | Authorizes Let's Encrypt as sole certificate authority |
| `@` (SPF) | `TXT` | `"v=spf1 -all"` | Blocks email spoofing while unused (until transactional mail configured) |
| `_dmarc` | `TXT` | `"v=DMARC1; p=reject; rua=mailto:ph@klaw.at"` | Rejects unauthorized emails and sends DMARC reports |

---

## Verification Commands & Baseline Table

Run these commands from any external machine to verify DNS propagation:

```bash
# Apex and Web
dig +short orbaagent.dev A
dig +short www.orbaagent.dev A

# Application Subdomains
dig +short api.orbaagent.dev A
dig +short app.orbaagent.dev A
dig +short auth.orbaagent.dev A
dig +short files.orbaagent.dev A
dig +short computers.orbaagent.dev A
dig +short test.computers.orbaagent.dev A

# Security & Mail Records
dig +short orbaagent.dev CAA
dig +short orbaagent.dev TXT
dig +short _dmarc.orbaagent.dev TXT
```

### Verification Matrix

| Record | Expected Output | Status |
| :--- | :--- | :--- |
| `orbaagent.dev` | `85.215.156.241` | **Verified** |
| `www.orbaagent.dev` | `85.215.156.241` | **Verified** |
| `api.orbaagent.dev` | `85.215.156.241` | Pending IONOS Entry |
| `app.orbaagent.dev` | `85.215.156.241` | Pending IONOS Entry |
| `auth.orbaagent.dev` | `85.215.156.241` | Pending IONOS Entry |
| `files.orbaagent.dev` | `85.215.156.241` | Pending IONOS Entry |
| `computers.orbaagent.dev` | `85.215.156.241` | Pending IONOS Entry |
| `*.computers.orbaagent.dev` | `85.215.156.241` | Pending IONOS Entry |
| CAA Record | `0 issue "letsencrypt.org"` | Pending IONOS Entry |
| SPF Record | `"v=spf1 -all"` | Pending IONOS Entry |
| DMARC Record | `"v=DMARC1; p=reject; rua=mailto:ph@klaw.at"` | Pending IONOS Entry |

---

## TLS Issuance Strategy

1. **Staging First (`le-staging`):**
   Initial deployment uses Let's Encrypt Staging environment to validate ACME DNS-01 automation and Traefik routing without risking rate limits (5 certificates per week on production).
2. **Production Resolver (`le-prod`):**
   Once routing and DNS-01 issuance are proven, switch `CERT_RESOLVER=le-prod` in `infra/proxy/.env` on the server and reload Traefik.
3. **IONOS Developer API Integration:**
   Traefik's internal Lego client uses the IONOS DNS API token (`IONOS_API_KEY`) to create TXT challenge records (`_acme-challenge`) automatically for apex, single subdomains, and wildcards (`*.computers.orbaagent.dev`).
