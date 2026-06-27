## 1. Worker — tool catalog + invocation API

- [ ] 1.1 Add an in-memory MCP invocation helper (in `src/admin.ts` or a new `src/admin-tools.ts`): given `env` + a resolved `Tenant`, build `buildServer(env, tenant)`, link `InMemoryTransport.createLinkedPair()`, connect a `Client`, and expose `listTools()` and `callTool({ name, arguments })`. Connect + close per call (stateless, matching `/mcp`); map a transport/connect failure to a structured `upstream_unavailable`.
- [ ] 1.2 Route `GET /admin/api/tools`: resolve the `acting-as` tenant via `resolveTenant(env, id, directoryFromEnv(env))` (reuse the `unauthorized`/`not_found` mapping), list tools, and return `{ tools: [{ name, description, inputSchema }] }` from the live `tools/list`.
- [ ] 1.3 Route `POST /admin/api/tools/<name>`: read `{ tenant, arguments }`, resolve the tenant, `callTool`, and return the tool's structured result **or structured error verbatim** (a tool-level structured error is `200` data, not a `500`); reserve non-200 for resolution/validation/transport failures via `statusFor`.
- [ ] 1.4 Wire both routes into `routeAdminApi`/`handleAdmin` alongside the `tenants` routes, under the same Access gate and the same `ToolError → statusFor` serialization.

## 2. Worker — SPA shell fallback for client routes

- [ ] 2.1 In `handleAdmin`, for a GET that is neither an `/admin/api/*` route nor a real built asset, serve the SPA shell by **fetching** `index.html` from `ASSETS` and returning it `200` (do not rewrite to `/admin/index.html` — it re-enters `run_worker_first` and loops, per the existing comment). Preserve today's `/admin` trailing-slash + real-asset behavior.
- [ ] 2.2 Confirm `/admin/api/*` never falls through to the shell (an unknown API route stays a structured `not_found`, not HTML).

## 3. Admin SPA — shell + routing (`Browser.application`)

- [ ] 3.1 Convert `admin/src/Main.elm` to `Browser.application` (`onUrlRequest`/`onUrlChange`, hold `Nav.Key`); add a `Route` type (`AdminArea AdminRoute | DevArea DevRoute`) parsed by `Url.Parser`, and render the top-level Admin/Dev nav.
- [ ] 3.2 Model the current page as a `Page` union whose variant **owns its sub-model**; a route change swaps `Page`. Keep `update`/`view` exhaustive (no `_ ->` swallowing a page), per `admin/CLAUDE.md`.
- [ ] 3.3 Extract the onboard+members UI into `Admin/Members.elm` essentially unchanged (its `Model`/`Msg`/`update`/`view` + the `/admin/api/tenants` HTTP), mounted under the Admin area. No behavior change to onboard/rotate/revoke/list.
- [ ] 3.4 Factor shared bits as needed (`Route` module; an `Api`/decoders helper; the `Tenant`/member-id decoder reused by the persona selector).

## 4. Admin SPA — the tool console (Dev area)

- [ ] 4.1 `Dev/ToolConsole.elm`: model the workbench as `NoPersona | Acting Tenant DevPage` so "invoke with no persona" is unrepresentable; a persona selector fed by the member list (`/admin/api/tenants`).
- [ ] 4.2 Fetch the catalog from `GET /admin/api/tools?tenant=<persona>` as `WebData`; render the tool list with each tool's description and its input schema shown **read-only**.
- [ ] 4.3 Raw-JSON arguments textarea + Run; `POST /admin/api/tools/<name>` with `{ tenant, arguments }`; render the structured result/error as `RemoteData` (the failure carries its type — no `Bool`+`Maybe String`).
- [ ] 4.4 Persistent "acting as `<member>`" banner whenever a tool is runnable; require a confirm-before-run for a real member; a `test-`/`sandbox-` persona bypasses the confirm.
- [ ] 4.5 Deep-link: `/admin/dev/tools/<tool>` selects that tool; honor an optional `?as=<id>` to initialize the persona (best-effort in v1).

## 5. Build + docs

- [ ] 5.1 `aubr build:admin` to regenerate the committed `admin/dist/` (needs `package.elm-lang.org`; if unreachable, land source and leave the rebuild to CI per `admin/CLAUDE.md` — do not commit a stale bundle). `aubr build:admin --check` to confirm no drift.
- [ ] 5.2 `docs/SELF_HOSTING.md`: document the operator dev console (the Admin/Dev split, "acting as" a member, the tool console) **and** the trust note — the console lets the operator read any member's domain data and fire write tools as that member.
- [ ] 5.3 `docs/ARCHITECTURE.md`: note the admin surface now also invokes the tool surface in-process (in-memory transport, same `buildServer` path) as a dev/ops console; confirm `docs/TOOLS.md` needs **no** change (the console reads the live `tools/list`; no tool contract changes).

## 6. Tests + verify

- [ ] 6.1 Worker (`test/admin*.test.ts`): `GET /admin/api/tools` returns the catalog for a fake tenant; `POST` invoke returns a tool's structured result; a tool's structured error is returned as data (not 500); unknown tool → `not_found`-class; absent/non-allowlisted `acting-as` tenant → `unauthorized`-class; with no Access config the tools routes respond `404`.
- [ ] 6.2 Worker: the SPA-shell fallback serves `index.html` for an unmatched `/admin/*` GET and never for `/admin/api/*`.
- [ ] 6.3 Elm: the `Route` parser round-trips the Admin/Dev routes; tests cover the `Workbench` `NoPersona` vs `Acting` branches and the `test-`persona confirm-bypass (the "no persona ⇒ no invoke" guarantee is compile-enforced by the union).
- [ ] 6.4 `aubr typecheck` + `aubr test` + `aubr test:tooling` green. Manual smoke under `wrangler dev` with `ADMIN_DEV_BYPASS=1`: list tools, run a read tool as a persona, observe a structured error from a Kroger tool on an unlinked persona. (Manual smoke NEEDS local `wrangler dev` + local D1; external tools additionally need dev Kroger/GitHub secrets.)
