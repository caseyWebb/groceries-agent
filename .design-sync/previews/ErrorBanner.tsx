import { ErrorBanner } from "operator-admin-kit";

export const Upstream = () => (
  <ErrorBanner message="upstream_unavailable: Kroger token exchange returned 503" />
);

export const Validation = () => (
  <ErrorBanner message="validation_failed: invite_code must be 8 characters" />
);
