// /logs — the all-cron-jobs run log (operator-admin). `?job=`/`?page=` are the SSR page's
// query params (defaults omitted: job "All", page 1); `?run=<id>` is the Status sparkline's
// deep-link, resolved client-side against the one payload.
import { createFileRoute } from "@tanstack/react-router";
import { LogsScreen } from "../screens/logs";

export const Route = createFileRoute("/logs")({
  validateSearch: (s: Record<string, unknown>) => ({
    job: typeof s.job === "string" ? s.job : "All",
    page: Number(s.page) >= 2 ? Math.floor(Number(s.page)) : 1,
    run: typeof s.run === "string" ? s.run : undefined,
  }),
  component: LogsScreen,
});
