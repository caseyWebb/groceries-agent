import { Dot } from "operator-admin-kit";

type State = "ok" | "fail" | "never" | "muted";

const Row = ({ state, label }: { state: State; label: string }) => (
  <div className="row">
    <Dot state={state} />
    <span style={{ marginLeft: "0.5rem" }}>{label}</span>
  </div>
);

export const ServiceHealth = () => (
  <div>
    <Row state="ok" label="grocery-mcp · healthy" />
    <Row state="fail" label="kroger flyer · last sync failed" />
    <Row state="never" label="discovery sweep · never run" />
    <Row state="muted" label="embeddings · disabled" />
  </div>
);
