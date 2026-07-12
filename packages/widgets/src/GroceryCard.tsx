import * as React from "react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { GroceryListData } from "@yamp/contract";
import {
  GroceryList,
  createGroceryBridgeAdapter,
  grocerySnapshotFromBridge,
  resolveGroceryCapabilities,
  type GroceryBridge,
} from "@yamp/ui";

export function GroceryCard({ app, data }: { app: App; data: GroceryListData }) {
  const [initial] = React.useState(data);
  const [current, setCurrent] = React.useState(initial);
  const host = React.useState(() => app.getHostCapabilities())[0];
  const eligible = resolveGroceryCapabilities({
    contractVersion: initial.contract_version,
    serverTools: host?.serverTools != null,
    updateModelContext: host?.updateModelContext != null,
    message: host?.message != null,
    hydrated: false,
  });
  const [hydrated, setHydrated] = React.useState(false);
  const [bootFailed, setBootFailed] = React.useState(false);

  React.useEffect(() => {
    if (!eligible.contractSupported || host?.serverTools == null || host?.updateModelContext == null) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await (app as unknown as GroceryBridge).callServerTool({ name: "read_grocery_snapshot", arguments: {} });
        const snapshot = grocerySnapshotFromBridge(result);
        if (!cancelled && snapshot) { setCurrent(snapshot); setHydrated(true); }
        else if (!cancelled) setBootFailed(true);
      } catch { if (!cancelled) setBootFailed(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  const capabilities = resolveGroceryCapabilities({
    contractVersion: initial.contract_version,
    serverTools: host?.serverTools != null,
    updateModelContext: host?.updateModelContext != null,
    message: host?.message != null,
    hydrated: hydrated && !bootFailed,
  });
  const adapter = React.useMemo(() => createGroceryBridgeAdapter(app as unknown as GroceryBridge, capabilities), [app, capabilities.mode]);
  return <div data-widget="grocery-list" data-testid="grocery-card" data-hydrated={hydrated || undefined}>
    {bootFailed ? <p className="muted-line" role="status">Showing the saved list read-only; current state could not be refreshed.</p> : null}
    <GroceryList data={current} adapter={adapter} onDataChange={setCurrent} />
  </div>;
}
