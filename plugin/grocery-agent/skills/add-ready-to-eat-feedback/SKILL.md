---
name: add-ready-to-eat-feedback
description: "Rate or disposition a ready-to-eat / heat-and-eat item — the convenience-meal analog of recipe feedback. Use for \"rate the frozen lasagna\", \"stop suggesting those taquitos\", or dispositioning a draft RTE discovery (activate or reject)."
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core` and `grocery-corpus` skills before continuing.

# Ready-to-eat feedback

Rate or change the status of a ready-to-eat item in the user's personal catalog: call `update_ready_to_eat(slug, updates)` — a draft goes `active` (optionally with a `rating`, an integer 1–5), or `rejected` to stop suggesting it. Address the item by its `slug` (from `ready_to_eat_available` or the `add_draft_ready_to_eat` that created it); resolve it by name if you don't have it yet. Edits the caller's own `ready_to_eat.toml` — never anyone else's view.
