// /usage — the three observability dashboards (usage-observability / usage-trends /
// tool-usage-trends).
import { createFileRoute } from "@tanstack/react-router";
import { UsageScreen } from "../screens/usage";

export const Route = createFileRoute("/usage")({
  component: UsageScreen,
});
