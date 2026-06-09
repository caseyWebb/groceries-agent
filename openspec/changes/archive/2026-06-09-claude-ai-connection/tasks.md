## 1. Pre-flight (Cloudflare)

- [x] 1.1 Confirm the only-owner Access policy's identity provider (Google / GitHub / email OTP) is usable from a phone with no cached desktop session — **verified: logged in from phone, connector authorized**
- [x] 1.2 Confirm no path collision between the Kroger `/oauth/*` Access Bypass and Access's own Managed-OAuth endpoints (e.g. `/cdn-cgi/access/*`, `/.well-known/oauth-authorization-server`). **Verified (code side):** Worker owns only `/`, `/oauth/init`, `/oauth/callback` (prefix `/oauth/` with trailing slash, index.ts:48) and `/mcp`; Access uses `/cdn-cgi/access/*` (access.ts:28) and `/.well-known/oauth-*` — disjoint namespaces. **Dashboard caveat:** ensure the Access Bypass policy is scoped to `/oauth` and does not also bypass `/.well-known/*` (Access must serve those for Claude.ai's OAuth discovery).
- [x] 1.3 In the Access app's **Advanced settings → Allowed redirect URIs**, add `https://claude.ai/api/mcp/auth_callback` (or `https://claude.ai/api/mcp/*`). Required even with DCR: the authorize endpoint validates the redirect URI against this app-level allowlist, and without it the flow is rejected pre-login with `invalid_request: Redirect URI not allowed by application configuration`. **Diagnosed live** (2026-06-09); documented in `worker/README.md`.

## 2. Connect Claude.ai

- [x] 2.1 Add a custom MCP connector in Claude.ai pointed at `https://groceries-mcp.caseywebb.xyz/mcp`
- [x] 2.2 Complete the Cloudflare Access Managed-OAuth authorization prompt; confirm the connector reaches a connected state and the grocery-mcp tools enumerate — **verified: connected after the 1.3 redirect-URI fix; tools enumerate and the in-Worker JWT re-check accepts the token**
- [x] 2.3 **Decided:** GitHub MCP connector *not* added. grocery-mcp is self-sufficient for the core menu/order/pantry flows; GitHub MCP would only be a read escape-hatch for the no-read-tool files (`stockup`, `substitutions`, `aliases`, `flyer_terms`, `skus`, `ingredients`, `feeds`) and full-text body search. **Follow-up:** promote the reads we actually want (likely `stockup` + `substitutions`) to first-class grocery-mcp tools instead. Keep writes off GitHub MCP regardless (bypasses the Worker's validation + Access gate).
- [x] 2.4 Create the "Grocery Agent" project and paste `CLAUDE.md` into project instructions — **verified: agent behaves conversationally per CLAUDE.md**

## 3. Smoke-verify from the phone — reads

- [x] 3.1 Pantry read confirmed (pantry contents returned / drove the write flow)
- [x] 3.2 Recipe reads confirmed via the rating flow (`read_recipe` / `list_recipes`)

## 4. Smoke-verify from the phone — writes (closes task 8.2)

- [x] 4.1 Say "I ran out of olive oil"; confirm `update_pantry` + `commit_changes` succeed through Access and a real commit appears in the repo — **verified after the add-name fix; commit landed. Closes deferred task 8.2.**
- [x] 4.2 `update_recipe` rating write verified (batched "rate the curry 5 stars and I'm out of butter" → `update_recipe` + `update_pantry` in one `commit_changes`, exercising the multi-file atomic-commit path)
- [x] 4.3 Commits verified in repo history; the authorized write loop is proven end-to-end.

## 5. Managed-OAuth fallback — NOT TRIGGERED

Managed OAuth + DCR worked once the app-level redirect-URI allowlist (1.3) was set. The connector authorized normally, so the `workers-oauth-provider` fallback was never needed. Left documented in `design.md` as a pre-decided contingency for the future.

- [x] 5.1 N/A — failure was a redirect-URI allowlist gap (config), not Access rejecting Claude.ai's DCR. Diagnosed and fixed via 1.3; no fallback warranted.
- [x] 5.2 N/A — Worker still served by Access Managed OAuth; no switch made.
- [x] 5.3 N/A — no re-run needed.

## 6. Capture fixes and close out

- [x] 6.1 Fixes surfaced by the live test, committed: the `update_pantry` add-name bug (`worker/src/pantry-write.ts` + tests, commit `61f636f`) and the Access allowed-redirect-URI setup step (`worker/README.md`).
- [x] 6.2 Done-when confirmed: useful phone conversation in the Grocery Agent project, with authorized writes (pantry update, recipe rating, batched multi-file commit) landing real commits through Access.
