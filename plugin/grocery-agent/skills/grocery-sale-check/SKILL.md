---
name: grocery-sale-check
description: "Check current Kroger flyer sales. Use for \"what's on sale this week?\", \"anything from my stockup list on sale?\", \"are there deals on the bulk stuff I buy?\"."
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core` skill before continuing.

# Sale check

Call `kroger_flyer()` and report the genuine markdowns it returns. It reads a flyer pre-computed in the background (fast, but possibly a few hours stale — it returns `as_of`; mention the age if it's notably old, and remember real pricing is confirmed at order time). It covers **broad** sale categories (`flyer_terms.toml`), not arbitrary item lookups — so if I ask whether a *specific* stockup/bulk item is on sale, cross-reference the returned items against my stockup and staples by name, and fall back to a targeted `kroger_prices` check for anything the broad flyer doesn't cover.
