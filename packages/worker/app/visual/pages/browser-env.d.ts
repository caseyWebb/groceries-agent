// Ambient browser types for page.evaluate callbacks (this tsconfig deliberately has
// no DOM lib — the harness itself is Node; only these evaluate bodies run in the
// browser). Included ambiently via the tsconfig's `pages` include; just enough fetch
// surface for the session-authenticated raw writes.
interface BrowserFetchResponse {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}
declare function fetch(
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<BrowserFetchResponse>;
