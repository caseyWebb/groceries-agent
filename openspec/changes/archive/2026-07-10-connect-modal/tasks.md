## 1. Worker: whoami `{ profile, operator }`

- [x] 1.1 Add `packages/worker/src/deployment.ts`: `deploymentProfile(env)` (the single
      D9 accessor — constant `"self-hosted"` until band 5 re-points it) and
      `operatorConfig(env)` → `{ name, repo }` from `OPERATOR_NAME` (fallback
      `OWNER_TENANT_ID`, else null) and `MARKETPLACE_REPO` (else null).
- [x] 1.2 Add optional `OPERATOR_NAME` / `MARKETPLACE_REPO` to `src/env.ts` with doc
      comments; document both in `.dev.vars.example` (non-secret, optional).
- [x] 1.3 Extend the whoami read in `src/api/session.ts` to return
      `{ tenant, profile, operator }` through `jsonWithEtag` (contract unchanged).
- [x] 1.4 Extend the vitest whoami coverage (`test/api.test.ts`): templated shape with
      vars set, null degradation without them, `OWNER_TENANT_ID` name fallback, ETag
      behavior intact.

## 2. Deploy stamp

- [x] 2.1 Add `--var MARKETPLACE_REPO:${{ github.repository }}` to the deploy command
      in `.github/workflows/data-deploy.yml` (the `APP_BUILD` precedent — the calling
      data repo is the marketplace).

## 3. Member app: sidebar CTA + modal

- [x] 3.1 Plumb the extended whoami through the `_app.tsx` loader (offline stamp
      fallback keeps nulls — the modal degrades, never blocks the shell).
- [x] 3.2 New `packages/app/src/components/connect-claude.tsx`: the two-tab guided
      modal (mock microcopy; templated repo/name/tenant; per-step copy + "Copied"
      feedback; Claude Code Kroger step minting via
      `GET /api/profile/kroger-login-url`; footer note + Open Claude.ai).
- [x] 3.3 Sidebar CTA in `_app.tsx` (above the footer, per the mock) opening the modal.
- [x] 3.4 Port the mock's connect-modal styles (`.sb-connect*`, `.cstep*`, modal
      chrome) into `packages/ui/src/cookbook.css`, including the narrow-layout
      behavior of the CTA.

## 4. Playwright coverage

- [x] 4.1 Stamp fixture `MARKETPLACE_REPO` / `OPERATOR_NAME` vars in
      `app/visual/setup.mjs` so specs assert templated copy.
- [x] 4.2 Extend `app/visual/pages/shell.page.ts` with connect-modal helpers; add
      `app/visual/specs/connect-modal.spec.ts`: open → templated web steps + copy
      feedback → code tab commands → footer; capture review screenshots for both tabs.
- [x] 4.3 Run `aubr test:app` (web sessions: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`),
      plus `aubr typecheck` and `aubr test`.

## 5. Docs lockstep

- [x] 5.1 `docs/SELF_HOSTING.md`: the member app's Connect-to-Claude modal as the
      member-facing setup path (onboarding section), `OPERATOR_NAME`, and the
      deploy-stamped `MARKETPLACE_REPO`. Current-state wording only.
