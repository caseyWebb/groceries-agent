// /insights — the group-popularity dashboard (group-insights).
import { createFileRoute } from "@tanstack/react-router";
import { InsightsScreen } from "../screens/insights";

export const Route = createFileRoute("/insights")({
  component: InsightsScreen,
});
