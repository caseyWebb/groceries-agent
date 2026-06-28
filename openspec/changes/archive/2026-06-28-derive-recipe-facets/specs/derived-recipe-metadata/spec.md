## MODIFIED Requirements

### Requirement: Derived fields regenerate on a content-change gate

The Worker SHALL detect changes to a recipe's content via a content hash and SHALL regenerate the recipe's derived fields when that hash changes, on the scheduled reconcile. The description's content hash SHALL cover only the recipe's **indexed facets** the description is derived from (title, ingredients_key, course, protein, cuisine, time_total, dietary, season) — read from the D1 index, **not the recipe body** — so the describe pass stays pure D1 + AI and does not read the body. Those facets may themselves be derived (by the classify pass) and materialized into the index; the describe gate is indifferent to whether a facet was authored or derived, hashing the effective value. The content hash SHALL NOT include any derived description/embedding field, so that regenerating a derived field cannot itself trigger further regeneration. A steady corpus (no content changes) SHALL perform no regeneration work.

The body-reading derive step is the **classify pass** (see `recipe-facet-derivation`), a distinct producer with its own body-based change gate; the describe pass consumes the classify pass's materialized facets and remains body-free.

#### Scenario: Editing recipe content regenerates the description

- **WHEN** a recipe's effective facets change (an authored edit or a re-derivation by the classify pass)
- **THEN** the description content hash changes, the reconcile regenerates the `description`, and (because the description changed) the recipe is re-embedded on the same or a following tick

#### Scenario: A steady corpus does no work

- **WHEN** the reconcile runs and no recipe's content has changed
- **THEN** no description is regenerated and no embedding is recomputed

#### Scenario: A derived-field change does not loop

- **WHEN** the reconcile writes a regenerated `description`
- **THEN** the content hash (which excludes derived description/embedding fields) is unchanged by that write, so the next tick does not regenerate it again

#### Scenario: The describe pass does not read the body

- **WHEN** the describe pass regenerates a description
- **THEN** it reads the recipe's effective facets from the D1 index, not the recipe body — the classify pass is the only derive step that reads the body
