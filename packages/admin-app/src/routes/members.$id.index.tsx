// /members/$id — member detail at its default section (Profile).
import { createFileRoute } from "@tanstack/react-router";
import { MemberDetailScreen } from "../screens/member-detail";

export const Route = createFileRoute("/members/$id/")({
  component: MemberDetailIndex,
});

function MemberDetailIndex() {
  const { id } = Route.useParams();
  return <MemberDetailScreen id={id} section="Profile" />;
}
