// /members/$id/$section — member detail deep-linked to a section pill (an unknown segment
// falls back to Profile, the SSR route's behavior).
import { createFileRoute } from "@tanstack/react-router";
import { MemberDetailScreen, sectionOfSlug } from "../screens/member-detail";

export const Route = createFileRoute("/members/$id/$section")({
  component: MemberDetailSection,
});

function MemberDetailSection() {
  const { id, section } = Route.useParams();
  return <MemberDetailScreen id={id} section={sectionOfSlug(section)} />;
}
