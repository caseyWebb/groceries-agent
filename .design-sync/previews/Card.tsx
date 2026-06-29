import { Card } from "operator-admin-kit";

export const Basic = () => (
  <Card>
    <h2>Members</h2>
    <p className="muted small">3 active · 1 pending invite</p>
  </Card>
);

export const StatusCard = () => (
  <Card>
    <h2>grocery-mcp</h2>
    <div className="row">
      <span className="k">status</span>
      <span className="v">healthy</span>
    </div>
    <div className="row">
      <span className="k">last reconcile</span>
      <span className="v">2m ago</span>
    </div>
  </Card>
);
