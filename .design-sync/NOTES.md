# design-sync notes — operator-admin-kit

This repo is a Cloudflare Worker (hono/jsx) + an Elm panel — **not** a React design system. This export compiles the hono/jsx operator-admin kit (`src/admin/ui/kit.tsx`) into a React bundle for claude.ai/design. `kit.tsx` is **never edited** — the conversion is a build, not a fork.

## How the build is wired (off-script package shape)

- **Entry is pre-built, not recompiled by the converter.** `node .design-sync/entry/build-entry.mjs` compiles `src/admin/ui/kit.tsx` → `.design-sync/.cache/entry/index.mjs` (React ESM, react external). A ~12-line shim (`.design-sync/entry/ds-jsx-runtime.js`) renames `class`→`className`/`for`→`htmlFor` at the JSX factory, then delegates to the real `react/jsx-runtime` (left external so the converter's `reactShim` wires it to `window.React`). Run this **before** `package-build` and **after any edit to `kit.tsx`**.
- `package-build` is pointed at that entry with `--entry .design-sync/.cache/entry/index.mjs --node-modules .ds-sync/node_modules`. `PKG_DIR` resolves to the repo root (the entry under `.design-sync/.cache/` walks up to the repo `package.json`), so `componentSrcMap` pins all 9 components to `kit.tsx` (gives the JSDoc + the `admin` group) and `dtsPropsFor` hand-writes the props (no shipped `.d.ts`).

## Gotchas (load-bearing — do not remove)

- **tsconfig `jsxImportSource: "hono/jsx"` inheritance.** The repo root `tsconfig.json` sets the hono JSX runtime, and esbuild auto-discovers the nearest tsconfig per entry. WITHOUT overrides the output is hono VNodes and every React render dies with *"Objects are not valid as a React child (keys {tag, props, key, children, isEscaped, suspendedContext})"*. Two overrides handle it, both committed:
  - `.design-sync/entry/tsconfig.empty.json` — used by `build-entry.mjs` so the entry compiles via the shim, not hono.
  - `.design-sync/previews/tsconfig.json` — pins the **preview** compile to `react-jsx` (the converter's `buildPreviews` sets `jsx: automatic` with no `jsxImportSource`, so it would otherwise inherit hono too).
- **Render check needs `DS_CHROMIUM_PATH`.** The repo pins `@playwright/test@1.61.1` (wants chromium build 1228), but the sandbox cache is build **1194**. Fix: `playwright@1.61.1` is installed into `.ds-sync/`, and validate/capture are run with `DS_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (point at whatever `chromium-<build>` the cache actually has).
- **`guidelinesGlob: []`** — without it the default `docs/*.md` glob sweeps the repo's architecture docs (ARCHITECTURE/TOOLS/SCHEMAS/SELF_HOSTING) into `guidelines/`. Those are not design guidelines; keep the glob empty.
- **`Dialog` uses `cardMode: single`** — its `.dialog-backdrop` is `position: fixed`, which overflows a grid cell.
- **`[DTS_REACT]` warning is benign** — all 9 props come from `dtsPropsFor`, so auto-extraction (which wants `@types/react` in the repo node_modules) is never used.

## Known render warns

None. Render check is clean (9/9), zero warnings at the last build.

## Re-sync risks (watch-list)

- **Rebuild the entry first** (`build-entry.mjs`) whenever `kit.tsx` changes — `package-build` bundles the pre-built entry, it does not recompile the source.
- The two tsconfig overrides above are the whole reason the bundle is React and not hono — if a card renders blank or throws the "not valid as a React child" error, check them first.
- The playwright/chromium pin (1194) is sandbox-specific; on a new machine, re-derive `DS_CHROMIUM_PATH` from the actual `/opt/pw-browsers/chromium-<build>` dir and match the `playwright` version.
- Props are hand-written in `cfg.dtsPropsFor` (kit.tsx has no shipped `.d.ts`) — if a component's props change in `kit.tsx`, update `dtsPropsFor` to match; nothing derives them automatically.

## Upload status

The first upload was **blocked in the claude.ai/code web session**: design-system authorization needs an interactive `/design-login`, unavailable headless. The bundle is complete and upload-ready at `ds-bundle/`. To finish: authorize via Claude Design's "Send to Claude Code Web" (seeds/authorizes this workspace) or run the sync from an interactive terminal, then upload per the skill's §5 sequence. `projectId` is not yet recorded (no project created).
