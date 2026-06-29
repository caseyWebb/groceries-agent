import { Pill } from "operator-admin-kit";

export const SubNav = () => (
  <div style={{ display: "flex", gap: "0.5rem" }}>
    <Pill label="Status" active />
    <Pill label="Members" />
    <Pill label="Tool console" />
  </div>
);

export const Active = () => <Pill label="Status" active />;

export const Inactive = () => <Pill label="Members" />;
