// Structured-error convention (design D4). Every tool returns a structured
// result, never a raw throw. The codes below are the enumerated set; later
// changes inherit this convention and may extend the set.

export type ErrorCode =
  | "not_found"
  | "index_unavailable"
  | "upstream_unavailable"
  | "malformed_data"
  | "unsupported"
  // Write-path codes (introduced with the git write tools):
  | "validation_failed" // a staged change failed structural validation; nothing committed
  | "conflict"; // the ref kept moving under us; commit abandoned after bounded retries

export interface ToolErrorShape {
  error: ErrorCode;
  message: string;
  [key: string]: unknown;
}

/** A typed error tools throw internally; serialized to a structured result at the tool boundary. */
export class ToolError extends Error {
  readonly code: ErrorCode;
  readonly context: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.context = context;
  }

  toShape(): ToolErrorShape {
    return { error: this.code, message: this.message, ...this.context };
  }
}

type McpResult = { content: { type: "text"; text: string }[]; isError?: boolean };

/** Wrap successful structured data as an MCP tool result. */
export function ok(data: unknown): McpResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

/** Wrap a structured error as an MCP tool result flagged isError. */
export function fail(err: ToolErrorShape): McpResult {
  return { content: [{ type: "text", text: JSON.stringify(err) }], isError: true };
}

/**
 * Run a tool body, converting any ToolError (or unexpected throw) into a
 * structured error result. This is the single enforcement point for D4.
 */
export async function runTool(body: () => Promise<unknown>): Promise<McpResult> {
  try {
    return ok(await body());
  } catch (e) {
    if (e instanceof ToolError) return fail(e.toShape());
    const message = e instanceof Error ? e.message : String(e);
    return fail({ error: "upstream_unavailable", message });
  }
}
