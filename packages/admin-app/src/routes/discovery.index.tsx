// /discovery — the candidate-pipeline view. `filter`/`page` are validated search params
// (same names/defaults as the SSR query params); stripSearchParams keeps default values
// out of the URL so every combination stays deep-linkable and clean.
import { createFileRoute, stripSearchParams, type SearchSchemaInput } from "@tanstack/react-router";
import { DiscoveryScreen } from "../screens/discovery";

const DEFAULTS = { filter: "all", page: 1 };

export const Route = createFileRoute("/discovery/")({
  // The SearchSchemaInput marker keeps the params optional on Links (defaults fill in here).
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => ({
    filter: typeof s.filter === "string" ? s.filter : DEFAULTS.filter,
    page: Number(s.page) >= 2 ? Number(s.page) : DEFAULTS.page,
  }),
  search: { middlewares: [stripSearchParams(DEFAULTS)] },
  component: DiscoveryRoute,
});

function DiscoveryRoute() {
  const { filter, page } = Route.useSearch();
  return <DiscoveryScreen filter={filter} page={page} />;
}
