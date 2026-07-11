// The pantry/waste controlled vocabularies — the SINGLE source of the three arrays the
// Worker's D17 department machinery (`src/department.ts`), the pantry write path, the
// ingredient-category cron, and the member app's pantry dropdowns all consume. Pure data
// (no runtime dependency), so it lives in the runtime-agnostic contract package: the
// Worker (workerd) re-exports it from `department.ts` and the member app (browser) imports
// it directly for its category/location datalists and its waste-reason modal.

/** Kitchen locations — THE location vocabulary product-wide (page 06). Fixed order:
 *  the member app renders its group-by-location sections in exactly this sequence. */
export const PANTRY_LOCATIONS = ["fridge", "freezer", "pantry", "spice_rack", "counter", "cabinet"] as const;
export type PantryLocation = (typeof PANTRY_LOCATIONS)[number];

/** The food taxonomy a pantry row's `category` holds — also the D17 analytics
 *  dimension source. NULL reads as uncategorized (filled by the classifier), never
 *  an error; there is deliberately NO `other` value. */
export const PANTRY_CATEGORIES = [
  "produce",
  "dairy",
  "meat",
  "seafood",
  "grains",
  "bakery",
  "canned",
  "condiments",
  "oils",
  "spices",
  "baking",
  "frozen",
  "snacks",
  "beverages",
] as const;
export type PantryCategory = (typeof PANTRY_CATEGORIES)[number];

/** The ONE canonical waste-reason enum (stories/03 §2's set, slugged). Capture defines
 *  it; band 4's versioned reason(+item-class)→avoidability table consumes it. */
export const WASTE_REASONS = [
  "spoiled",
  "moldy",
  "over_ripe",
  "expired",
  "freezer_burned",
  "stale",
  "forgot",
  "bought_too_much",
  "never_opened",
  "other",
] as const;
export type WasteReason = (typeof WASTE_REASONS)[number];
