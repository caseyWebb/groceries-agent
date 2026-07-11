# cookbook-favorites-toggle

## Why

`cookbook-unified-browse` shipped the favorites view mode fully plumbed
(`?view=favorites`: filtered favorites, hidden promoted panel, both empty states) but
deliberately rendered **no entry control** — its visual form was design-blocked
(design-requests.md #1, per CLAUDE.md's no-improvised-UI rule), and the standalone
`/favorites` route was held in place until the design landed. The design has now
arrived: the operator ran request #1 in the Claude Design project and the returned
bundle commits to form (b), a **tab row** — `All recipes` / `Favorites` between the
search bar and the filter bar, reading as a scope switch (the AND-filters stay mounted
inside it), with a heart icon that fills while active and a mono count pill carrying
the member's favorites count. This is the named follow-up change that mounts it and
retires `/favorites` behind it.

## What Changes

- **The view-mode tab row mounts at the marked drop-in point** in `_app.index.tsx`
  (the wiring was pre-named there: `Route.useSearch().view` +
  `navigate({ search: (prev) => ({ ...prev, view }) })`). Per the design bundle:
  `role="tablist"` ("Cookbook view") with two `role="tab"` buttons carrying
  `aria-selected`, a brand-color underline active state, the Favorites tab's heart
  (filled while the view is active) and its `.vt-count` mono pill — the member's
  **total** favorites count (the unfiltered overlay∩index join, the same source the
  view lists), hidden when the member has none. The searchbar's bottom margin takes
  the bundle's adjusted value (0.8rem) for the new composition.
- **`/favorites` retires into a redirect.** The route stays registered (old links and
  bookmarks keep resolving) but only redirects to `/?view=favorites`, preserving any
  other search params it was given. Its standalone page component, sidebar nav entry
  (and the nav's favorites count), page object, fixture, and smoke-registry entry are
  removed — the cookbook tab row is the one entry point.
- **CSS translated, not improvised**: the bundle's `.viewtabs` block lands in
  `packages/ui/src/cookbook.css` in the file's idiom, next to the filter-bar styles it
  composes with.
- **Playwright follows the control**: the cookbook page object gains tab locators; the
  favorites-view specs enter through the control (URL param + list + panel + heart +
  `aria-selected` asserted together); a redirect spec pins `/favorites` →
  `/?view=favorites` with params preserved; the favorites area leaves the smoke
  registry.

No Worker change: no new route (`/favorites` is SPA-internal — it was never in
`run_worker_first`), no API, no D1, no docs/ contract change. Spec deltas carry the
contract.

## Capabilities

### Modified Capabilities

- `member-app-core`: the favorites requirement's view-mode clause is updated from
  "URL-only, no control rendered, `/favorites` unchanged" to the now-rendered tab-row
  control (its designed form and behavior) plus the `/favorites` redirect and the
  sidebar entry's removal.

## Impact

- **Member app (`packages/app/`)**: `_app.index.tsx` (the tab row replaces the drop-in
  comment); `_app.favorites.tsx` (page component → `beforeLoad` redirect);
  `_app.tsx` (Favorites nav entry + its overlay-derived count removed);
  `lib/persist.ts` (one comment updated). `routeTree.gen.ts` is untouched — the route
  id survives as the redirect.
- **Shared UI (`packages/ui/`)**: `cookbook.css` gains `.viewtabs`/`.vt-count`
  translated from the design bundle; `.searchbar`'s bottom margin matches the
  bundle's adjusted composition value.
- **Tests**: app Playwright — cookbook page object + specs (tab switching, count
  pill, aria states, redirect), `favorites.page.ts`/fixture/registry entry removed.
  `packages/ui` is touched, so the admin suite runs too (no admin spec change —
  `cookbook.css` is member-app-only styling).
- **Not in scope**: any change to the favorites data model, the view mode's already-
  specced behavior (filters/panel/empty states), the promoted panel, or the
  propose/plan/vibes surfaces.
