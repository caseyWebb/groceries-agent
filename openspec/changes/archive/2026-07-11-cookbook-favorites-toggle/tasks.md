## 1. Member app — the view-mode tab row (packages/app + packages/ui)

- [x] 1.1 `packages/ui/src/cookbook.css`: translate the design bundle's `.viewtabs`
  block into the file's idiom — the tab row (bottom hairline, stretch alignment), the
  tab buttons (appearance reset, `-1px` overlap, brand underline + `font-weight: 600`
  on `[aria-selected="true"]`, hover foreground), the 0.98rem heart sizing, and the
  `.vt-count` mono pill (brand-tinted while its tab is active). Set `.searchbar`'s
  bottom margin to the bundle's 0.8rem.
- [x] 1.2 `packages/app/src/routes/_app.index.tsx`: replace the marked drop-in comment
  with the tab row per the bundle's markup — `role="tablist"` (`aria-label="Cookbook
  view"`), two `role="tab"` buttons with `aria-selected` bound to `view`, "All
  recipes" / "Favorites" labels, the heart icon (`IconHeartFill` while the favorites
  view is active, `IconHeart` otherwise), and the `.vt-count` pill showing the
  member's total favorites (`favHits.length` — the unfiltered overlay∩index join),
  rendered only when > 0. Selecting a tab navigates with
  `search: (prev) => ({ ...prev, view })` (default stripped by the middleware).

## 2. /favorites retirement

- [x] 2.1 `packages/app/src/routes/_app.favorites.tsx`: drop the page component; the
  route keeps its id and only `beforeLoad`-redirects to `/` with
  `{ ...search, view: "favorites" }` so any other params ride along.
- [x] 2.2 `packages/app/src/routes/_app.tsx`: remove the Favorites NAV entry, its
  `favorites` count (and the now-unused `useOverlay` subscription + `IconHeart`
  import — rows subscribe to the overlay themselves).
- [x] 2.3 `packages/app/src/lib/persist.ts`: update the overlay comment ("the
  cookbook/favorites pages") to the current shape (the cookbook page + its favorites
  view).

## 3. Playwright coverage (app/visual)

- [x] 3.1 `pages/cookbook.page.ts`: tab-row locators — the tablist, each tab by
  accessible name, the count pill — and an `openView()` helper clicking a tab.
- [x] 3.2 Delete `pages/favorites.page.ts`; drop its fixture (`fixtures.ts`) and its
  smoke-registry entry (`registry.ts`).
- [x] 3.3 `specs/cookbook.spec.ts`: enter the favorites view through the control —
  tab click updates the URL (`view=favorites`), swaps the list, hides the promoted
  panel, flips `aria-selected` and the heart fill; switching back to "All recipes"
  strips the param and restores the panel/list. Count pill: reflects the favorites
  count independent of active filters, absent at zero favorites. New redirect spec:
  `/favorites` (with an extra param) lands on `/?view=favorites` with the param
  preserved and the Favorites tab selected. Re-point the former favorites-page spec
  at the view mode; refresh review screenshots.
- [x] 3.4 Run `aubr test:app` (web: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`),
  `aubr test:admin` (packages/ui touched), `aubr typecheck`, `aubr test`; surface the
  screenshots.
