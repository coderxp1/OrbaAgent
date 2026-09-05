# Repository Branch Protection & Ruleset Configuration

This document specifies the required GitHub Ruleset settings for `phartmann80/OrbaAgent` on the `main` branch.

Branch rulesets cannot be created programmatically from an untrusted pull request. Repository owner `@phartmann80` must configure these settings in GitHub repository settings.

---

## Configuration Checklist (GitHub UI)

Navigate to:  
**Repository Settings** → **Rules** → **Rulesets** → **New branch ruleset**

### 1. General
- [ ] **Ruleset Name:** `main-branch-protection`
- [ ] **Enforcement status:** `Active`

### 2. Target Branches
- [ ] Click **Add target** → **Include default branch** (targets `main`)

### 3. Branch Protections
- [ ] **Restrict deletions:** Enabled (prevents accidental branch deletion)
- [ ] **Block force pushes:** Enabled (preserves linear git history and audit trail)
- [ ] **Require a pull request before merging:** Enabled
  - [ ] **Required approvals:** `1`
  - [ ] **Dismiss stale pull request approvals when new commits are pushed:** Enabled
  - [ ] **Require review from Code Owners:** Enabled
  - [ ] **Require conversation resolution before merging:** Enabled
- [ ] **Require status checks to pass:** Enabled
  - [ ] **Require branches to be up to date before merging:** Enabled
  - [ ] **Required status checks:**
    - `lint` (Biome code formatting & linting)
    - `typecheck` (TypeScript strict type check)
    - `test` (Vitest unit tests)
    - `docker-build` (Docker container buildability validation)
    - `secret-scan` (Gitleaks automated detection)
    - `crlf-check` (Strict shell script LF line ending check)

---

## Verification
Once applied, submit a screenshot of the Ruleset configuration page to the project tracker as evidence.
