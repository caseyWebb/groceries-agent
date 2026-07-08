// /normalize — the Normalization area. Every SSR query param (tab/stream/filter/q/src/page/
// node/facet) is a validated search param with the same name and defaults-omitted convention,
// so every tab/stream/filter/selection combination deep-links (the Playwright suite's
// `gotoTab` drives hard `?tab=` URLs).
import { createFileRoute } from "@tanstack/react-router";
import { NormalizeScreen } from "../screens/normalize";
import { validateNormalizeSearch } from "../screens/normalize-shared";

export const Route = createFileRoute("/normalize")({
  validateSearch: validateNormalizeSearch,
  component: NormalizeRoute,
});

function NormalizeRoute() {
  const search = Route.useSearch();
  return <NormalizeScreen search={search} />;
}
