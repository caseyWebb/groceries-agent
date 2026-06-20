## Context

`data-deploy.yml` is a reusable workflow operators call from their data repo at `@main`, so fixing it in the code repo fixes it for everyone. Today its config step is:

```yaml
- name: Overlay the operator's wrangler config onto the source
  run: cp "${{ inputs.config_path }}" _code/wrangler.jsonc
```

A full replace. The deployed config is therefore 100% the operator's data-repo `wrangler.jsonc`; the code repo's `wrangler.jsonc` is used only for local dev / `--dry-run` and never ships. So code-level config (`triggers`, `compatibility_flags`, `main`, new bindings) is invisible to operators. The `operator-provisioning` capability already encodes the zero-config posture (auto-provision KV without ids, inject repo coords via `--var`, resolve bindings from the operator's config) — this change keeps all of that and adds a merge so code-level config is authoritative again.

The hazard: the code repo's `wrangler.jsonc` currently contains the **maintainer's real KV namespace ids**. Any merge that lets code ids reach another operator would bind that operator's Worker to the maintainer's KV — a cross-tenant data exposure. So the merge is security-sensitive, and KV-id provenance is the central decision.

## Goals / Non-Goals

**Goals:**
- Code-level wrangler config (`triggers`, `compatibility_*`, `main`, `observability`, `workers_dev`) propagates to operators automatically on deploy.
- No operator migration: existing full-copy `wrangler.jsonc` files keep deploying correctly.
- Preserve the zero-config posture (auto-provision KV, injected coords, by-binding KV writes).
- The KV-id provenance rule is enforced and tested.

**Non-Goals:**
- Slimming operators' `wrangler.jsonc` to overlay-only (a nice later cleanup).
- Changing deploy auth, KV auto-provisioning, or secret posture.
- Merging arbitrary future keys without an explicit rule (the rule set is curated).

## Decisions

### 1. Merge, with the code config as the base and a curated per-key rule set

Replace the `cp` with a tested merge helper (`scripts/merge-wrangler-config.mjs`) run in the deploy. It takes the **code** `wrangler.jsonc` as the base and applies the operator's config by explicit per-key rules — *not* a blind deep merge, because the keys have different ownership and `kv_namespaces` needs by-binding handling.

| Key | Source / rule |
|---|---|
| `main`, `compatibility_date`, `compatibility_flags`, `observability`, `workers_dev` | **code** (operator value ignored — these are code-level) |
| `triggers` | **code** (so a new cron propagates) |
| `name` | operator if set, else code |
| `routes` / custom domain | **operator** |
| `vars` | code base, operator overrides per-key (and the deploy still injects `DATA_OWNER`/`DATA_REPO`/`DATA_REF` via `--var`, which wins at runtime) |
| `kv_namespaces` | **binding set from code**; **id always from the operator** (matched by binding name), else omitted → auto-provisioned. Code ids are dropped unconditionally (Decision 2). |

- **vs. blind deep merge:** arrays (`kv_namespaces`) don't deep-merge sensibly, and "operator wins everywhere" would let an operator's stale `compatibility_flags` or missing `triggers` override code. A curated rule set makes ownership explicit and reviewable.
- **vs. code-as-overlay-on-operator (closest to today):** would require operators to keep a full, correct copy of every code-level key — exactly the sync burden we're removing.

### 2. KV namespace ids ALWAYS originate from the operator; code ids are never deployed elsewhere

The merge matches `kv_namespaces` by **binding name**. For each binding the code declares, the deployed entry uses the **operator's id** for that binding if present, otherwise **no id** (so `wrangler deploy` auto-provisions — the existing posture). The code repo's ids are **discarded unconditionally**. This guarantees a fresh operator can never bind the maintainer's namespaces, and a new code-required binding still appears (auto-provisioned for that operator).

- Belt-and-suspenders: also **scrub the maintainer's real KV ids from the code repo's committed `wrangler.jsonc`** (replace with no-id bindings) so the footgun is gone even if the merge rule regresses. *(Open question — see below; the maintainer currently relies on those ids for their own deploy path.)*

### 3. No operator migration — the merge tolerates today's full-copy configs

Because code is the base and the operator only *contributes* its owned keys, an operator's existing full `wrangler.jsonc` still works: its KV ids, `vars`, `routes`, and `name` are read per the rules; its (possibly stale) `triggers`/`compatibility_*` are simply ignored in favor of code's. So operators do nothing; they just stop having to hand-sync. A future change could shrink their config to an overlay, but that's optional.

### 4. The merge is a tested, standalone helper

The merge logic is correctness- and security-critical, so it lives in `scripts/merge-wrangler-config.mjs` as a pure function over two parsed configs, unit-tested under `tests/` (Node `--test`, like the other build tooling), and the workflow just calls it. Tests cover: code `triggers` propagate; operator KV ids win and code KV ids never survive; a code-only binding appears id-less; operator `routes`/`name`/`vars` are honored; `compatibility_flags` come from code even if the operator's differ.

## Risks / Trade-offs

- **Mis-binding KV (cross-tenant)** → the single most important risk; mitigated by Decision 2 + dedicated tests asserting code ids never appear in the output and operator/absent ids always do.
- **A code-level key an operator legitimately needs to override** (e.g. a custom `name` or extra route) → the rule table lets operator win for `name`/`routes`/`vars`; if a new override need appears, extend the table explicitly.
- **JSONC parsing** (the configs have comments) → the helper must parse JSONC (reuse the repo's TOML/JSON tooling pattern or a JSONC parser), not `JSON.parse` raw.
- **Drift between this rule table and reality** → keep the table small and tested; document the ownership boundary in `CONTRIBUTING.md`.

## Migration Plan

1. Land the merge helper + tests, swap the `cp` step for the merge step in `data-deploy.yml`.
2. Operators redeploy (no config change needed); code-level config now applies. The flyer cron registers on the next deploy.
3. Update `SELF_HOSTING.md` to drop the manual `triggers` stopgap and describe the merged-config model.
4. **Rollback:** revert the workflow step to the `cp`; operators fall back to needing the manual `triggers` block.

## Open Questions

- **Scrub the maintainer's KV ids from the code repo's `wrangler.jsonc`?** It removes the footgun but the maintainer's own deploy/local path may rely on them. Resolve before relying solely on Decision 2, or keep both the scrub *and* the merge-strip.
- **Where does the merge run** — inline `node scripts/merge-wrangler-config.mjs` in the workflow (needs `npm ci` first, already present) vs a self-contained script with no deps? Prefer reusing the installed toolchain.
- **`name` precedence** — is the Worker name code-default or operator-chosen? Defaulting to operator-if-set, else code, but confirm against how operators currently name their Worker.
