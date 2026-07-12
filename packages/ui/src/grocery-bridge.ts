import {
  groceryContractSupport,
  parseGroceryListData,
  type GroceryListData,
  type GroceryModelContext,
} from "@yamp/contract";
import type { GroceryAction, GroceryHostAdapter } from "./grocery-controller";

export interface GroceryBridgeResult {
  structuredContent?: Record<string, unknown>;
  content?: { type: string; text?: string }[];
  isError?: boolean;
}
export interface GroceryBridge {
  callServerTool(params: { name: string; arguments: Record<string, unknown> }): Promise<GroceryBridgeResult>;
  updateModelContext(params: { structuredContent?: Record<string, unknown> }): Promise<unknown>;
  sendMessage(params: { role: "user"; content: { type: "text"; text: string }[] }): Promise<unknown>;
}
export interface GroceryCapabilities {
  mode: "interactive" | "delegate" | "readonly";
  contractSupported: boolean;
}

export function resolveGroceryCapabilities(input: {
  contractVersion: unknown;
  serverTools: boolean;
  updateModelContext: boolean;
  message: boolean;
  hydrated: boolean;
}): GroceryCapabilities {
  const contractSupported = groceryContractSupport(input.contractVersion) === "supported";
  if (!contractSupported) return { mode: "readonly", contractSupported };
  if (input.serverTools && input.updateModelContext && input.hydrated)
    return { mode: "interactive", contractSupported };
  if (input.message) return { mode: "delegate", contractSupported };
  return { mode: "readonly", contractSupported };
}

export function grocerySnapshotFromBridge(result: GroceryBridgeResult): GroceryListData | null {
  if (result.isError) return null;
  const structured = result.structuredContent;
  const candidate = structured?.snapshot ?? structured;
  const parsed = parseGroceryListDataSafe(candidate);
  if (parsed) return parsed;
  const text = result.content?.find((c) => c.type === "text")?.text;
  if (!text) return null;
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    return parseGroceryListDataSafe(value.snapshot ?? value);
  } catch {
    return null;
  }
}

function parseGroceryListDataSafe(value: unknown): GroceryListData | null {
  try {
    return parseGroceryListData(value);
  } catch {
    return null;
  }
}

function callFor(action: GroceryAction): { name: string; arguments: Record<string, unknown> } {
  switch (action.kind) {
    case "add":
      return { name: "grocery_add", arguments: { name: action.name } };
    case "remove":
      return { name: "grocery_remove", arguments: { key: action.key } };
    case "checked":
      return { name: "set_grocery_checked", arguments: action };
    case "pantry_verify":
      return { name: "verify_grocery_pantry", arguments: action };
    case "pantry_buy_anyway":
      return { name: "set_grocery_buy_anyway", arguments: { ...action, enabled: true } };
    case "pantry_undo":
      return { name: "set_grocery_buy_anyway", arguments: { ...action, enabled: false } };
    case "substitute":
      return { name: "set_grocery_substitution", arguments: action };
    case "substitute_undo":
      return { name: "set_grocery_substitution", arguments: { ...action, undo: true } };
    case "relist":
      return {
        name: "relist_grocery_send_line",
        arguments: {
          send_id: action.send_id,
          line_key: action.key,
          expected_row_version: action.expected_row_version,
        },
      };
    case "mark_placed":
      return { name: "mark_grocery_send_placed", arguments: action };
  }
}

export function createGroceryBridgeAdapter(
  bridge: GroceryBridge,
  capabilities: GroceryCapabilities,
): GroceryHostAdapter {
  return {
    mode: capabilities.mode,
    online: true,
    async mutate(action) {
      if (capabilities.mode !== "interactive")
        throw new Error("Grocery writes are not available in this host");
      const call = callFor(action);
      const result = await bridge.callServerTool(call);
      const snapshot = grocerySnapshotFromBridge(result);
      if (!snapshot)
        throw new Error(
          result.isError ? "The grocery action failed" : "The server returned no current grocery snapshot",
        );
      const context: GroceryModelContext = {
        ...snapshot,
        action_summary: action.kind,
        outcome: {
          kind:
            action.kind === "mark_placed"
              ? "placed"
              : action.kind === "relist"
                ? "relisted"
                : action.kind === "checked"
                  ? "checked"
                  : action.kind.startsWith("pantry")
                    ? "pantry"
                    : "substitution",
          message: action.kind,
        },
      };
      await bridge.updateModelContext({ structuredContent: context as unknown as Record<string, unknown> });
      if (action.kind === "mark_placed")
        await bridge.sendMessage({
          role: "user",
          content: [{ type: "text", text: `The ${action.send_id} grocery send was marked placed.` }],
        });
      return snapshot;
    },
    async delegate(action) {
      if (capabilities.mode !== "delegate") return;
      await bridge.sendMessage({
        role: "user",
        content: [{ type: "text", text: `Please ${action.kind.replaceAll("_", " ")} in my grocery list.` }],
      });
    },
  };
}
