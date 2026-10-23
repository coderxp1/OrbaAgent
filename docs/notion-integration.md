# Notion integration — design notes: webhooks evaluation & Workers readiness

Companion to the implementation on `feat/notion-integration`
(`services/agent-runtime/src/connectors/notionClient.ts`,
`NotionServiceTool`, web OAuth/token plumbing). Status as of
2026-10-22: the API-backed tool and connection flow are implemented
and unit-tested with a stubbed API. No live workspace has been
connected yet, and nothing here is deployed.

## What is implemented

- Actions: `search`, `get_page` (properties + block content),
  `query_database`, `create_page` (page or database parent),
  `update_page`. The workflow families from the blueprint — project
  tracking, knowledge-base retrieval, CRM synchronization, report
  generation — are compositions of these five; no separate machinery.
- Auth: internal integration token (`NOTION_API_TOKEN`, server env or
  per-request context) or public-integration OAuth (web routes,
  HttpOnly cookie). Status is only reported "connected" after the
  token is verified against `GET /v1/users/me` (web connections
  route) or a real API call succeeds (tool path). A token's mere
  presence is never treated as proof.
- Scoping: Notion's own model does the enforcement — the API only
  sees objects shared with the integration. `object_not_found`
  (returned for unshared objects, deliberately indistinguishable
  from nonexistent ones) is surfaced with that explanation.
- Secrets: tokens are registered with `SecretManager` for log
  redaction and never appear in tool output (regression-tested).
  Known architectural gap, stated plainly: like the existing GitHub
  connection, tokens live in an HttpOnly cookie / server env — this
  codebase has no encrypted per-user credential store yet. Building
  one is a separate blueprint decision, not a Notion-specific fix.

## Webhooks — evaluation (not implemented)

Notion's webhook support is recent and still maturing. Evaluation
against Orba's needs:

- **Mechanism.** Subscriptions are created per integration (Notion's
  settings/API), events are POSTed to an HTTPS endpoint, and the
  subscription is confirmed via a verification-token handshake.
  Event families cover page/database content changes, comments and
  deletions — enough for "sync my project tracker" and "watch this
  knowledge base" automations.
- **Fit.** Orba's shape would be:
  `apps/web/src/app/api/webhooks/notion/route.ts` (public, signature/
  verification-token checked, fast 200, no work inline) → enqueue an
  internal event → the agent runtime reacts through the *same*
  `notion_service` actions (fetch the changed object, diff, act).
  Dedupe on event id is mandatory (Notion retries), and events carry
  ids only — content is always re-fetched with the user's own token,
  which keeps permission scoping intact.
- **Risks / unknowns to verify before building:** event delivery is
  best-effort (a periodic reconciliation poll via `search` with
  `last_edited_time` is the safety net); subscription management API
  coverage has changed across Notion API versions; payload schemas
  must be pinned against the `Notion-Version` in use.
- **Recommendation.** Defer implementation until (1) a live workspace
  is connected through the shipped token/OAuth path and (2) one
  concrete automation (e.g. CRM sync on database-row update) is
  chosen as the pilot. The endpoint sketch above adds no new
  machinery when that happens.

## Notion Workers — readiness

Notion Workers are Notion-hosted functions that run inside Notion's
own surface (buttons, automations, synced surfaces). The connector
was deliberately shaped so Workers can be added without redesign:

- The client (`notionClient.ts`) is transport-only and the tool
  surface is action-based with plain JSON in/out — the same contract
  a Worker would call over HTTP if Orba exposes it, or mirror if a
  Worker calls Notion directly and reports results back.
- No Orba-side state is hidden in the tool (tokens resolve per
  execution), so a Worker-triggered run and a chat-triggered run take
  the identical path.
- A Worker makes sense where the trigger lives *inside* Notion (a
  button on a page, a database automation) and the action is small.
  It does not replace the agent runtime: multi-step workflows,
  cross-system sync and verification stay in Orba, with the Worker as
  an optional entry point. Revisit when Notion's Workers surface and
  its auth model for calling external services are confirmed against
  a real use case.

## Required user-side authorization (for a live connection)

1. Create an integration at notion.so/my-integrations — internal
   (fastest) with read/insert/update content capabilities, or a
   public integration for OAuth — and share the intended pages and
   databases with it.
2. Provide the token (or OAuth client id/secret) via the secure
   vault so it can be set as `NOTION_API_TOKEN` (or
   `NOTION_CLIENT_ID`/`NOTION_CLIENT_SECRET`/`NOTION_REDIRECT_URI`)
   on the server — never via chat.
3. Production deployment follows the normal approval path; this
   branch is not deployed.

## Live connection status (2026-10-22, via the authorized Notion session)

Tested live against the workspace owner's Notion account through the
authorized hosted-MCP session (identity verified: workspace
"Hartmann's Space", user Hartmann). These are genuinely authenticated
live results — distinct from the code/unit tests above:

- **Session capabilities.** The session exposes 66 content tools
  (search, fetch, create/update/delete pages, databases, comments,
  files, calendar, teams/users). It exposes **no** tool to create or
  manage integrations/connections, mint API tokens, or create/manage
  Notion Workers. Integration creation remains an owner action in
  Notion's UI; this session cannot substitute for it.
- **Authenticated read:** `notion-get-self` returned the workspace and
  user identity; `notion-search` executed live (0 results for "Orba"
  — no pre-existing Orba content in the workspace).
- **Controlled write + read-back:** created the page "Orba Integration
  Smoke Test — 2026-10-22 (safe to delete)" (id
  401d9515-ee79-8113-bcdf-e36af8059b92) with a unique marker
  (ORBA-SMOKE-20261022), fetched it back, and verified title, marker
  and body text all present. Create + read are therefore proven live.
- **Cleanup:** the test page was moved to Trash via the connector's
  approval flow (completed 2026-10-22, after two approval expiries
  and one runtime restart interrupted earlier attempts; the page's
  live state was re-verified before the successful delete). No other
  workspace content was created or modified at any point.
- **Orba token path: LIVE-VERIFIED (2026-10-23)** through Orba's own
  `NotionServiceTool` with the owner's internal-integration token:
  `GET /v1/users/me` returned the integration's bot in the owner's
  workspace; the tool's `search` found the shared
  `Custom Q&A Agent Home` page, `get_page` read it, `create_page`
  created a temporary page beneath it, and a second `get_page` read
  it back with its content verified. The temporary page was then
  archived via the API (`archived`/`in_trash` confirmed on re-read).
  Operational lesson, observed live: integration secrets are
  single-current — regenerating a secret invalidates the previous
  value immediately (a working token began returning 401 after a
  regeneration), so the value configured in any environment must be
  the current one and rotations must be coordinated. Production
  enablement is still pending: `NOTION_API_TOKEN` in the deployed
  app's environment plus a deploy of this branch (not yet done). No
  public integration was created — per direction, a public
  integration is only for a future multi-customer install decision.
- **Workers verdict:** not needed now. No implemented workflow has a
  trigger that lives inside Notion, and the session cannot manage
  Workers anyway; the Orba runtime remains the execution path. The
  Workers-ready seam in the design above stays as the future option.
