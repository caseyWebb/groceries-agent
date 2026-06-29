import { TierBadge } from "operator-admin-kit";

export const AllStatuses = () => (
  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
    <TierBadge status="indexed" />
    <TierBadge status="skipped" />
    <TierBadge status="pending" />
    <TierBadge status="orphaned" />
  </div>
);

export const Indexed = () => <TierBadge status="indexed" />;
