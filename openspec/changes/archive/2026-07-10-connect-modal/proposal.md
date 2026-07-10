# Connect-to-Claude guided modal

## Why

Getting a member's Claude connected to yamp today means the operator hand-delivering a
prose checklist (marketplace slug, plugin install, connector consent, invite code) over
chat — the member app itself never explains the one setup flow every member must
complete. The product mockup (product-specs/pages/14-connect-to-claude.md) specs a
guided modal over the EXISTING distribution/connect flow: a sidebar CTA opening
templated, copyable steps for both Claude.ai and Claude Code. It is pure guided UI —
zero new backend writes — and it is band 7a's sibling per D25(3), safe to land any
time.

The steps must be templated from deployment config (operator repo/name — never
hardcoded), so the whoami read gains `{ profile, operator }` (00-overview Appendix A):
`operator` feeds the modal's copy, and `profile` is the D9 deployment-profile signal
member surfaces will gate on.

## What Changes

- **Whoami (`GET /api/session`) gains `{ profile, operator }`.** `profile` is the D9
  deployment profile (`"self-hosted" | "saas"`), resolved through a single new
  Worker-side accessor (`src/deployment.ts`). The D9 flag channel does not exist yet
  (band 5 delivers it), so the accessor returns the constant `"self-hosted"` — every
  live deployment is one — and is the ONE re-point site when band 5 decides the flag
  channel; no env var is claimed now, so nothing preempts that decision. `operator` is
  `{ name, repo }`: the display name from a new optional `OPERATOR_NAME` var (falling
  back to `OWNER_TENANT_ID`, else `null`) and the plugin-marketplace repo slug from a
  new optional `MARKETPLACE_REPO` var (else `null`). Both non-secret.
- **The operator deploy stamps `MARKETPLACE_REPO` automatically.** The reusable
  `data-deploy.yml` adds `--var MARKETPLACE_REPO:${{ github.repository }}` to the
  deploy (the `APP_BUILD` precedent): the calling data repo IS the marketplace, so the
  slug needs zero operator setup and cannot drift. Local dev sets it in `.dev.vars` if
  wanted; unset degrades to generic copy.
- **The app shell's sidebar gains the "Connect to Claude.ai" CTA + modal**
  (`packages/app`): two tabs of numbered steps templated from whoami's operator config
  and the member's own tenant id, copyable commands with per-step "Copied" feedback,
  and the invite-code footer + "Open Claude.ai" (claude.ai/new, new tab). Styling is
  the mockup's, ported into the shared design CSS.

## Resolved open questions (pages/14 §2)

1. **The Claude.ai tab has no Kroger step — confirmed intentional.** On the
   conversational surface Kroger consent is agent-initiated (`kroger_login_url` mints
   the personal link in chat and the agent confirms linkage) — the blessed flow
   docs/SELF_HOSTING.md already teaches. A static modal step would route members around
   the agent for a flow the agent owns; the mockup's omission stands.
2. **The mock's `?tenant=` Kroger step is stale mechanism — corrected per D5.** The
   shipped `/oauth/init` accepts only a single-use `nonce` minted from an authenticated
   context (`src/oauth.ts`; the cross-tenant token-binding fix) — `?tenant=` is dead,
   and a short-TTL single-use link cannot be a static copyable command at all. The
   Claude Code tab's optional Kroger step keeps the mock's EXPERIENCE (an optional
   fourth step) but re-mechanizes it onto the existing session-gated
   `GET /api/profile/kroger-login-url` (the same endpoint the grocery order flow uses):
   the step's action mints the member's personal consent link and opens it. D5 classes
   the mock as experience contract, never mechanism.
3. **The Claude Code auth step names the real command.** The mock's `/authorize` is not
   a Claude Code command; the step ships as `/mcp` (Claude Code's connector-auth
   surface) with copy covering both live approval paths: the cross-device approval from
   this signed-in web app (the passkey flow), or the invite code while grace allows.
4. **How whoami reports `profile` today**: the constant accessor above — trivially
   re-pointable, claims no flag channel.

## Capabilities

### Modified Capabilities

- `member-app-core`: two ADDED requirements — the whoami `{ profile, operator }`
  extension, and the sidebar Connect-to-Claude guided modal.

## Impact

- **Worker (`packages/worker/src/`)**: new `deployment.ts` (profile accessor + operator
  config); `env.ts` gains optional `OPERATOR_NAME` / `MARKETPLACE_REPO`;
  `api/session.ts` whoami returns the extended payload (same `jsonWithEtag` contract).
  No new route — `/api/*` is already in `run_worker_first`; no wrangler.jsonc change;
  no D1/KV/schema change; no MCP tool change (docs/TOOLS.md untouched).
- **Deploy**: `.github/workflows/data-deploy.yml` deploy command stamps
  `MARKETPLACE_REPO` (command-line `--var`, like `APP_BUILD` — no merge-allowlist
  interaction).
- **Member app (`packages/app/`)**: `_app.tsx` loader plumbs the extended whoami;
  sidebar CTA + new modal component; ported modal/step CSS in
  `packages/ui/src/cookbook.css`.
- **Tests**: vitest whoami assertions extended (templated + degraded shapes); app
  Playwright suite gains a connect-modal spec + shell page-object helpers, with the
  harness stamping fixture `MARKETPLACE_REPO`/`OPERATOR_NAME` vars.
- **Docs (lockstep)**: `docs/SELF_HOSTING.md` (the modal as the member-facing setup
  path, `OPERATOR_NAME`, the auto-stamped `MARKETPLACE_REPO`); `.dev.vars.example`.
  No ARCHITECTURE/SCHEMAS impact (no data-shape or architectural change).
