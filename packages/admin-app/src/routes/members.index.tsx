// /members — the roster (stat tiles + invite dialog + per-row actions).
import { createFileRoute } from "@tanstack/react-router";
import { MembersScreen } from "../screens/members";

export const Route = createFileRoute("/members/")({
  component: MembersScreen,
});
