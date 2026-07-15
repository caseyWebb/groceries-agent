// People — the NAV STUB for band 5's `households-friends-and-people-page` change (the
// cookbook cold-start onboarding's "Add friends" card links here; that change fills
// this route with the real roster/requests surface). Deliberately minimal: the page
// exists so the destination is a real route, and its copy stays truthful about what
// ships today. Existing shared primitives only.
import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, IconSparkle, PageHead } from "@yamp/ui";

export const Route = createFileRoute("/_app/people")({
  component: PeoplePage,
});

function PeoplePage() {
  return (
    <div data-testid="people-page">
      <PageHead title="People" sub="Friends' recipes flow into your cookbook." />
      <EmptyState
        title="Friends are coming soon"
        sub="Adding friend households isn't available yet — your operator can connect households in the meantime."
        icon={<IconSparkle />}
      />
    </div>
  );
}
