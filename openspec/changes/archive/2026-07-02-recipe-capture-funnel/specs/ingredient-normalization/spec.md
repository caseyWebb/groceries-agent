# ingredient-normalization delta — recipe-capture-funnel

## ADDED Requirements

### Requirement: The recipe index projection is a capture surface

The recipe-index projection SHALL funnel every projected recipe's effective `ingredients_key` and `perishable_ingredients` through the shared `IngredientContext`, so each term that does not resolve to a known surviving id is enqueued to the novel-term queue — best-effort, deduped within the pass, insert-or-ignore in the queue — making the projected corpus a standing capture surface: terms classified before capture existed, and terms missed during any capture outage, are re-encountered every tick until the capture job places them, so the corpus converges into the identity graph organically at the capture job's own bounded pace with no manual backfill. The projection SHALL NOT call an embedding model or an LLM (capture is by enqueue only; the scheduled capture job disposes). The food guard SHALL NOT apply — recipe ingredient facets are food terms by construction (derived from the recipe body's Ingredients section), with no `kind`/`domain` to gate on, the same wholesale funnel treatment pantry receives. An enqueue failure SHALL never fail the projection or skip a recipe (the term stays unresolved and re-enqueues on a later tick).

#### Scenario: Legacy corpus terms converge organically

- **WHEN** the projection encounters a stored derived ingredient term with no identity-graph entry (a recipe faceted before the capture funnel existed)
- **THEN** the term is enqueued for capture, a later capture tick places it, and the projection thereafter writes its surviving canonical id into the index

#### Scenario: The projection spends no model calls

- **WHEN** a projection pass funnels the corpus's ingredient facets and finds unresolved terms
- **THEN** the terms are enqueued for the scheduled capture job and the projection itself spends zero embedding and zero classifier calls

#### Scenario: A capture-outage gap self-heals

- **WHEN** terms that should have been captured were dropped by an earlier outage of any capture path
- **THEN** the next projection pass re-encounters them in the stored facets and re-enqueues them, so the gap closes without operator intervention

#### Scenario: An enqueue failure is invisible to the index

- **WHEN** the novel-term enqueue write fails during a projection pass
- **THEN** the recipe still projects with the cleaned term, and the term re-enqueues on a later tick because it remains unresolved
