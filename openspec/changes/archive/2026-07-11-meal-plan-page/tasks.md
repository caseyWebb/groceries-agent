# Tasks

## 1. Additive backend field
- [x] 1.1 Add `course: string[]` (lowercased, `[]` default) to `CookbookHit` and `toHit` in
  `packages/worker/src/cookbook-search.ts`; assert the projection in `test/cookbook-search.test.ts`.
- [x] 1.2 Add `course?: string[]` to `Hit` in `packages/app/src/lib/data.ts`.

## 2. Meal plan page redesign (`packages/app/src/routes/_app.plan.tsx`)
- [x] 2.1 Header (PageHead + inline add combobox + "Plan my week") and the transient
  "Show empty meal slots" `role="switch"`.
- [x] 2.2 The 7-day × {breakfast,lunch,dinner} empty-slots grid: empty → "+ Add Recipe";
  filled → change-recipe title, `×N` dup badge, sides combobox, remove; day label per day,
  meal label colored via `--meal-*`.
- [x] 2.3 D26-final semantics over `usePlanOps` (ordered arrays): move-by-default; "Add again
  instead" as the ONLY `duplicate: true` path; occupied-slot → occupant `set planned_for: null`
  + toast (never a remove); beyond-horizon client partition into "Later".
- [x] 2.4 Scheduled list (day-grouped, meal-ordered), Unscheduled by meal (three headings,
  per-meal add), Projects over `meal='project'` (course-filtered add + course-derived kind).
- [x] 2.5 `from_vibe` provenance chip resolved through `useVibes` (fallback to id), reusing the
  facet/side-chip styling.
- [x] 2.6 Sides on every surface via the open-world side combobox (never `window.prompt`);
  empty state preserved.

## 3. Styling
- [x] 3.1 Port the plan classes and `--meal-*` tokens from the mockup into
  `packages/ui/src/cookbook.css`.

## 4. Tests & fixtures
- [x] 4.1 Extend `app/visual/pages/plan.page.ts` with the redesign helpers (keep the existing
  `plan-row`/`data-recipe` addressing working).
- [x] 4.2 Add `app/visual/specs/plan.spec.ts` cases: add-again → `×2` siblings persist; move
  preserves sides (no duplicate); occupied-slot → toast + occupant in Unscheduled (not deleted);
  beyond-horizon in Later, editing date pulls it in; `from_vibe` renders the phrase; project add
  → kinded row excluded from the plan badge. Each ends with `captureForReview`.
- [x] 4.3 Add the seed fixtures (`admin/visual/seed.mjs`) + mirror in `seed.d.mts`: an
  unscheduled non-dinner row, a beyond-horizon row, a `from_vibe` row, a project row, and a
  `course: ["dessert"]` corpus recipe.

## 5. Verify
- [x] 5.1 `openspec validate "meal-plan-page" --strict`, `build:app` (route tree), `typecheck`.
- [x] 5.2 `test:app -- plan smoke` passes.
