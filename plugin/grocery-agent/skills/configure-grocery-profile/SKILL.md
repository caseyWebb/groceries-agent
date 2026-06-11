---
name: configure-grocery-profile
description: "Review and set up the user's grocery profile — taste, cooking preferences, diet principles, starting pantry, and heat-and-eat acceptance. Idempotent: on a brand-new user it walks first-time setup; on a returning user it reads back what it already knows and asks what to change. Use for \"get started\", \"set me up\", \"onboard me\", \"update my profile\", \"what do you know about me\", \"change my preferences/diet/taste\", or when the read tools show an empty profile."
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core` and `grocery-corpus` skills before continuing.

# Configure grocery profile

This skill is **idempotent** — it both sets up a new profile and reviews/edits an existing one. Always start by reading the current state: `read_preferences()`, `read_taste()`, `read_diet_principles()`, `read_pantry()`. Then branch:

- **Empty profile (first run):** a new member shouldn't have to type a wall of config before you're useful. Walk them through it **conversationally, a few things at a time, persisting each piece as it's gathered** — a half-finished setup still leaves real data saved. Gather the five areas below in order, one short exchange each.
- **Existing profile:** **tell them what you already know** — a short readback ("You cook 3 nights/week, leftovers for lunch; you lean Thai and Filipino and skip cilantro; fish weekly, no pork; you keep frozen lasagna and breakfast burritos around; pantry has rice, soy, ginger, …") — then **ask if they want to change anything.** Edit only what they name; leave the rest, and don't re-interrogate fields that are already set.

The five areas:

1. **Taste** — favorite cuisines and proteins, and any hard dislikes ("I don't do cilantro"). A short narrative to `taste.md` via `update_taste`. A couple of sentences is plenty; don't interrogate.
2. **Cooking preferences** — `default_cooking_nights` (nights a week they cook) and `lunch_strategy` (e.g. leftovers), plus any standing brand defaults. Via `update_preferences`. Skip anything they have no opinion on — defaults are fine.
3. **Diet principles** — variety targets or rules with reasoning ("fish at least once a week", "no pork"). To `diet_principles.md` via `update_diet_principles`. Distinguish hard restrictions (gates) from soft variety targets.
4. **Starting pantry** — staples and proteins on hand; this seeds the drift-catching pantry walk. Adds via `update_pantry`. Keep it light — the pantry self-corrects through normal use.
5. **Heat-and-eat acceptance** — which convenience meals they're fine with and for which meals ("frozen burritos for breakfast, Amy's frozen dinners for lazy nights"), plus any variety tolerance. For each item they name, `add_draft_ready_to_eat({ meal, name, status: "active" })` — items the member explicitly accepts land `active`, not as drafts. Purely optional: someone with no opinion skips it and the catalog stays empty, filling later through discovery.

Persist each change as you go (the granular write tools each commit on their own — appropriate here, since this is a sequence of standalone config writes, not one batched planning session). On a fresh setup, when the basics are in, offer the natural next step — "want me to put together a first menu?" — which hands off to the meal-plan flow. Don't block on completeness; the profile fills in through normal use.
