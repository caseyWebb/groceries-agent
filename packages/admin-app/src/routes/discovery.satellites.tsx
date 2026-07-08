// /discovery/satellites — the satellite ingest liveness view + the source-health audit.
import { createFileRoute } from "@tanstack/react-router";
import { SatellitesScreen } from "../screens/satellites";

export const Route = createFileRoute("/discovery/satellites")({
  component: SatellitesScreen,
});
