## MODIFIED Requirements

### Requirement: Favorites are an explicit idempotent set

The app SHALL list the member's favorites from the per-tenant overlay joined to the
cookbook index, and SHALL write favorite state as an **explicit set**
(`{ slug, favorite: boolean }`) keyed by the recipe slug — never a toggle — so an
offline-replayed mutation converges to the intended state.

Favorites SHALL render as a **cookbook view mode** (`?view=favorites`, a validated URL
search param): the organic list is replaced by the member's favorites with the global
filter state applied, the promoted panel is hidden, and the empty copy swaps — zero
favorites overall renders "No favorites yet / Tap the heart on any recipe to save it
here."; favorites that are all excluded by active filters render "None of your favorites
match these filters." with the inline "Clear filters" link.

The view mode's entry control is a **tab row** (the design-requests #1 bundle's
committed form) between the search bar and the filter bar: `role="tablist"` labeled
"Cookbook view" with two `role="tab"` buttons — "All recipes" and "Favorites" — whose
`aria-selected` reflects the active view, styled as a brand-color underline on the
active tab. The Favorites tab SHALL carry a heart icon (filled while the view is
active) and a mono count pill showing the member's **total** favorites count (the
unfiltered overlay∩index join — the same source the view lists), hidden when the member
has none. The row reads as a scope switch, not another AND-filter: the global filters
stay mounted and apply inside the favorites view. Selecting a tab SHALL write the
`view` search param (the `all` default stripped from the URL) without a full reload.

The standalone `/favorites` route SHALL redirect to the favorites view mode
(`/?view=favorites`), preserving any other search params it was given, and the sidebar
SHALL NOT carry a Favorites nav entry — the cookbook tab row is the one entry point.

#### Scenario: Replaying a favorite write converges

- **WHEN** the same favorite-set mutation is applied twice (e.g. an offline replay after
  a successful first delivery)
- **THEN** the overlay ends in the same state as after one application

#### Scenario: The favorites view mode filters favorites and hides the panel

- **WHEN** a member with favorites opens `/?view=favorites` with an active filter
- **THEN** only favorites passing the filter render, the promoted panel is absent, and
  clearing the filter shows all favorites

#### Scenario: Both favorites empty states render the specced copy

- **WHEN** the favorites view is open with zero favorites overall, or with favorites
  that all fail the active filters
- **THEN** the page renders "No favorites yet / Tap the heart on any recipe to save it
  here." in the first case and "None of your favorites match these filters." with an
  inline "Clear filters" link in the second

#### Scenario: The tab row switches the view and reflects it

- **WHEN** a member selects the Favorites tab and then the All recipes tab
- **THEN** the URL gains `view=favorites` and the list becomes the favorites with the
  promoted panel hidden, the Favorites tab showing `aria-selected="true"` and the
  filled heart — and switching back strips the param, restores the organic list and
  panel, and moves `aria-selected` to All recipes

#### Scenario: The count pill is the honest total favorites count

- **WHEN** the member has N > 0 favorites
- **THEN** the Favorites tab's pill reads N regardless of any active filters, and with
  zero favorites no pill renders

#### Scenario: /favorites redirects into the view mode

- **WHEN** a member opens `/favorites`, with or without other search params
- **THEN** they land on `/?view=favorites` with those params preserved and the
  favorites view active
