# note-visibility-tiers — tasks

## 1. Pre-implementation serial checks (band order)

- [ ] 1.1 Confirm `deployment-profiles-and-visibility-lens` and `households-friends-and-people-page` have landed (merged) — this change consumes `src/visibility.ts`'s friend-seam provider filled with the real `friendships` subquery, the lens gate on `read_recipe_notes`/notes `/api`/`/cookbook/<slug>`, and the members handle UX. Re-verify the seam provider's name/signature against the landed code.
- [ ] 1.2 Pin the migration number: expected `0061` (0059 = lens, 0060 expected = households). Take the **next free** number under `packages/worker/migrations/d1/` at implementation time; do not duplicate (0018/0045/0047 history).
- [ ] 1.3 Rebase check on the `recipe-notes` spec: if `recipe-detail-tweaks` (band 2, tag-UI delta) has archived since planning, re-copy this change's MODIFIED blocks onto the then-current living text (tier edits and tag-UI edits touch different sentences). Same re-verification for the `shared-corpus` and `data-read-tools` blocks against the lens change's archived text, and `member-app-core` against its current text.
- [ ] 1.4 Check the `/api` notes routes' author stamp (`packages/worker/src/api/cookbook.ts`): if the identity-split implementation already stamps `tenant.member`, task 4.3 is a no-op; either way report the observed state to the main thread.
- [ ] 1.5 Lens-review carry-in: note WRITE paths (`add_recipe_note`, POST/PATCH notes `/api`) currently accept any slug with no visibility check — a note written against an out-of-lens slug succeeds identically to a nonexistent one (not a read oracle, but it would surface once the recipe enters the lens). Decide deliberately in this change: gate note writes on `isVisible(member viewer, slug)` (recommended — a member should only annotate recipes they can see; keep the response indistinguishable from the nonexistent-slug case) or record acceptance with rationale in the spec delta.

## 2. Migration and storage layer

- [ ] 2.1 Write `packages/worker/migrations/d1/00NN_note_tiers.sql` (number from 1.2): `ALTER TABLE recipe_notes ADD COLUMN tier TEXT CHECK (tier IN ('public','friends','private'));` + NULL-guarded backfill `UPDATE recipe_notes SET tier = CASE WHEN private = 1 THEN 'private' ELSE 'friends' END WHERE tier IS NULL;`. Apply locally (`npx wrangler d1 migrations apply DB --local`) and verify the mapping on seeded rows.
- [ ] 2.2 In `packages/worker/src/corpus-db.ts`: introduce the effective-tier expression (`COALESCE(tier, CASE WHEN private = 1 THEN 'private' ELSE 'friends' END)`) and switch the **recipe-notes** read to the tiered predicate — own notes (`author = :member`, every tier), `public`, and `friends` gated by profile/self-household/friend-seam via `m.tenant` from a `LEFT JOIN members m ON m.id = n.author`; return `handle` as `COALESCE(m.handle, n.author)` and `tier`. Reuse the lens module's friend-seam provider — no second friendship enumeration. The `store_notes` arm keeps the old `private = 0 OR author = ?` predicate untouched.
- [ ] 2.3 Add the anonymous notes read (tier-scoped in SQL: `<effTier> = 'public'` only) for the cookbook page.
- [ ] 2.4 Dual-write on insert/update: writes set `tier` AND `private = (tier = 'private') ? 1 : 0` so a rolled-back Worker never widens a private note's audience; note identity (`id`, `created_at` addressing, author self-scoping) unchanged.
- [ ] 2.5 Worker unit tests over the real migration chain: pure-mapping backfill counts; NULL-tier row heals via COALESCE; dual-write invariant (`private` always consistent with `tier`).

## 3. MCP tool contract (`packages/worker/src/notes-tools.ts`)

- [ ] 3.1 `add_recipe_note`: add `tier: z.enum(["public","friends","private"]).optional()` (default `friends`); keep `private` as the deprecated alias (`true`→private, `false`→friends; `tier` wins on conflict); return `{ slug, author, created_at, tier }`.
- [ ] 3.2 `update_recipe_note`: same `tier`/alias params; passing `tier` re-tiers the note; return shape as 3.1. `remove_recipe_note` unchanged.
- [ ] 3.3 `read_recipe_notes`: notes entries become `{ author, handle, created_at, body, tags, tier, private }` with `private` derived (`tier === 'private'`, documented deprecated); `favorites` unchanged.
- [ ] 3.4 Tool descriptions own the guarantees (ownership test): tier meanings, friends = author household + friend households (everyone under self-hosted), public bounded by the recipe's lens incl. the anonymous surface rule, private = author-only, default friends, live retroactivity, alias deprecation.
- [ ] 3.5 Worker tests: tier visibility matrix (own / same-household / friend-household / non-friend / anonymous × public / friends / private × both profiles); retroactivity (insert friendship row → next read reveals; delete → hides; re-tier → immediate); another member's private note never returned; lens `not_found` indistinguishability preserved; stale-plugin alias behavior.

## 4. Member `/api` surface (`packages/worker/src/api/cookbook.ts` + typed client)

- [ ] 4.1 POST/PATCH accept `tier` (enum-validated) with the same legacy `private` alias rule; identity key `(author, slug, client-minted created_at)` and D15 class (b) semantics unchanged — tier rides the existing registered note mutations (no `member-app-offline` change).
- [ ] 4.2 GET returns `tier` + `handle` per note and `anonymously_visible: boolean` for the recipe (one `isVisible(anonymous, slug)` point query).
- [ ] 4.3 Unify author stamping on `tenant.member` across the four notes routes (per 1.4 — may be a no-op).
- [ ] 4.4 Update `packages/app` typed client / `NoteRow` (`lib/data`) and note mutation defaults (`lib/mutations`) for the tier field; community/own split keys off tier semantics server-side data (own = `author === member`), not the removed client-side `!n.private` filter.
- [ ] 4.5 API tests: tier round-trip on POST/PATCH; alias mapping; GET tier filtering per viewer; `anonymously_visible` in both profiles.

## 5. Composer and note list UI (`packages/app/src/routes/_app.recipe.$slug.tsx`)

- [ ] 5.1 Replace the `.note-priv` checkbox with `SegmentedControl` (from `packages/ui`) — Public / Friends / Private, Friends pre-selected — plus the one-line per-tier description; wire the conditional Public copy off `anonymously_visible`. Stay visually aligned with the Time-filter treatment (design request #9; local design authorized — see design.md Context).
- [ ] 5.2 Tier indicator chips on rendered notes: lock = Private (replaces `note-priv-badge`), globe = Public, Friends unmarked; community notes show author handle + tag chips.
- [ ] 5.3 `OwnNote` edit state: same segmented control seeded with the note's tier; PATCH sends `tier` alongside `body`.
- [ ] 5.4 Extend `packages/worker/app/visual/pages/recipe.page.ts` (`addNote` gains `tier`; helpers for chips/descriptions) and `app/visual/specs/cookbook.spec.ts`: add per tier, conditional Public copy, edit-state re-tier, chip rendering, community-note handle attribution. Run `aubr test:app`.

## 6. Anonymous cookbook surface (`packages/worker/src/cookbook.ts`)

- [ ] 6.1 Add the public-notes section to the recipe page: rendered only when the recipe is anonymously visible and ≥1 public note exists; handle-attributed; bodies through the existing raw-HTML-dropping `marked` renderer; tags/handles as text; CSP untouched; no new route (`/cookbook*` already `run_worker_first`).
- [ ] 6.2 Tests: public note renders; friends/private notes absent (assert the anonymous query is tier-scoped, not post-filtered); script-bearing note body renders inert; a public note on a non-anonymously-visible recipe produces no page at all (lens 404 unchanged).
- [ ] 6.3 Threat pass over the new anonymous exposure (member-authored content newly rendered to anonymous visitors): sanitization, attribution, enumeration surface, cache/ETag behavior — record findings in the PR.

## 7. Docs, persona, and contract lockstep

- [ ] 7.1 `docs/TOOLS.md`: `add_recipe_note`/`update_recipe_note` tier param + deprecated `private` alias; `read_recipe_notes` return shape (`handle`, `tier`, derived `private`) and the tiered visibility guarantees replacing the "own private + everyone's shared" sentence.
- [ ] 7.2 `docs/SCHEMAS.md`: `recipe_notes.tier` column (CHECK set, default-friends semantics, NULL-healing rule), `private` re-documented as legacy derived/dual-written; re-word the aggregate-read sentence to tiers.
- [ ] 7.3 `packages/worker/AGENT_INSTRUCTIONS.md` (Appendix C band 5 — the notes line binds to THIS change): the recipe-notes skill block's default-shared/`private: true` guidance becomes tier vocabulary (default friends; "just for me" → private; "put it on the public cookbook" → public with the recipe-lens caveat). Run `aubr build:plugin --check`.

## 8. Verification and merge

- [ ] 8.1 Production fixture capture (GATED on operator permission for remote reads; run pre-merge, read-only): `SELECT COUNT(*), SUM(private = 1) FROM recipe_notes;` (pre-migration fixture — post-migration tier counts must equal it); post-migration `SELECT COUNT(*) FROM recipe_notes WHERE tier IS NULL;` (expect 0) and `SELECT tier, COUNT(*) FROM recipe_notes GROUP BY tier;`; re-run `SELECT DISTINCT author FROM recipe_notes WHERE author NOT IN (SELECT id FROM members);` (expect empty — the handle join's ground truth). Encode divergent observations as test fixtures before merging.
- [ ] 8.2 Run `aubr typecheck` and `aubr test` (worker suite: sections 2/3/4/6 tests plus untouched suites — existing notes tests updated only where the contract deliberately changed); `aubr test:app` from 5.4.
- [ ] 8.3 Run `openspec validate note-visibility-tiers --strict`, the plugin `--check` from 7.3, and `git diff --check`; sync the approved deltas into the five living specs at archive time.
- [ ] 8.4 Report to the main thread: the public-tier product-risk acceptance (deployment-wide/anonymous speech on curated recipes), the `/api` author-stamp observation from 1.4, and any rebase performed in 1.3.
