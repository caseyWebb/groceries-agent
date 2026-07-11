// /favorites → the cookbook's favorites view mode (member-app-core): the standalone
// page is retired behind the cookbook's view-mode tab row; the route survives only as
// a redirect so old links and bookmarks keep resolving. Other search params ride along
// (the cookbook route validates and strips them).
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/favorites")({
  validateSearch: (s: Record<string, unknown>) => s,
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/", search: { ...search, view: "favorites" as const } });
  },
});
