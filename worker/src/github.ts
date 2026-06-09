// Authenticated GitHub data-access client (design D2). The single read path for
// all repo data; reused by later changes. Reads files at GITHUB_REF via the
// Contents API with the raw media type (avoids base64 round-trips). Retries
// transient failures and rate limits with backoff, and surfaces exhaustion as a
// typed error the tool boundary maps to a structured result.

import type { Env } from "./env.js";

/** Thrown by the client; callers map `status` to a structured error code. */
export class GitHubError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

const MAX_ATTEMPTS = 3;
const USER_AGENT = "grocery-mcp";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry on 5xx, 429, and rate-limited 403; otherwise fail fast. */
function isTransient(status: number, remaining: string | null): boolean {
  if (status >= 500) return true;
  if (status === 429) return true;
  if (status === 403 && remaining === "0") return true;
  return false;
}

/** One file's full new content, addressed by repo-relative path. */
export interface TreeFile {
  path: string;
  content: string;
}

export interface GitHubClient {
  /** Fetch a repo file's raw text. Throws GitHubError(404) when absent. */
  getFile(path: string): Promise<string>;
  /** Resolve `heads/<ref>` to the commit sha it points at. */
  getRef(): Promise<string>;
  /** The tree sha of a commit. */
  getCommitTree(commitSha: string): Promise<string>;
  /** Create a tree from `base_tree` plus inline file contents; returns the new tree sha. */
  createTree(baseTree: string, files: TreeFile[]): Promise<string>;
  /** Create a commit with one parent; returns the new commit sha. */
  createCommit(message: string, tree: string, parent: string): Promise<string>;
  /**
   * Fast-forward `heads/<ref>` to `commitSha`. Throws GitHubError(422) when the
   * update is not a fast-forward (the ref moved under us) — the commit engine's
   * retry signal.
   */
  updateRef(commitSha: string): Promise<void>;
}

export function createGitHubClient(env: Env): GitHubClient {
  const contentsBase = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents`;
  const gitBase = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/git`;
  const branch = env.GITHUB_REF;

  function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": USER_AGENT,
      ...extra,
    };
  }

  async function getFile(path: string): Promise<string> {
    const url = `${contentsBase}/${path}?ref=${encodeURIComponent(branch)}`;
    let lastStatus = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const res = await fetch(url, {
        headers: authHeaders({ Accept: "application/vnd.github.raw" }),
      });

      if (res.ok) return res.text();

      lastStatus = res.status;
      if (res.status === 404) {
        throw new GitHubError(404, `Not found: ${path}`);
      }

      const remaining = res.headers.get("x-ratelimit-remaining");
      if (isTransient(res.status, remaining) && attempt < MAX_ATTEMPTS) {
        await sleep(200 * attempt);
        continue;
      }
      throw new GitHubError(res.status, `GitHub request failed (${res.status}) for ${path}`);
    }

    throw new GitHubError(lastStatus, `GitHub request exhausted retries for ${path}`);
  }

  /**
   * Authenticated JSON request to the Git Data API with the same transient-retry
   * policy as getFile. `expectStatuses` lists non-2xx codes the caller handles
   * itself (e.g. 422 on updateRef) — these are thrown immediately, not retried.
   */
  async function requestJson(
    method: string,
    url: string,
    body: unknown | null,
    expectStatuses: number[] = [],
  ): Promise<unknown> {
    let lastStatus = 0;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const res = await fetch(url, {
        method,
        headers: authHeaders({
          Accept: "application/vnd.github+json",
          ...(body != null ? { "Content-Type": "application/json" } : {}),
        }),
        body: body != null ? JSON.stringify(body) : undefined,
      });

      if (res.ok) return res.status === 204 ? null : res.json();

      lastStatus = res.status;
      if (expectStatuses.includes(res.status)) {
        throw new GitHubError(res.status, `GitHub ${method} ${url} returned ${res.status}`);
      }

      const remaining = res.headers.get("x-ratelimit-remaining");
      if (isTransient(res.status, remaining) && attempt < MAX_ATTEMPTS) {
        await sleep(200 * attempt);
        continue;
      }
      throw new GitHubError(res.status, `GitHub ${method} request failed (${res.status})`);
    }
    throw new GitHubError(lastStatus, `GitHub ${method} request exhausted retries`);
  }

  async function getRef(): Promise<string> {
    const data = (await requestJson("GET", `${gitBase}/ref/heads/${branch}`, null)) as {
      object?: { sha?: string };
    };
    const sha = data.object?.sha;
    if (!sha) throw new GitHubError(502, `Malformed ref response for heads/${branch}`);
    return sha;
  }

  async function getCommitTree(commitSha: string): Promise<string> {
    const data = (await requestJson("GET", `${gitBase}/commits/${commitSha}`, null)) as {
      tree?: { sha?: string };
    };
    const sha = data.tree?.sha;
    if (!sha) throw new GitHubError(502, `Malformed commit response for ${commitSha}`);
    return sha;
  }

  async function createTree(baseTree: string, files: TreeFile[]): Promise<string> {
    const data = (await requestJson("POST", `${gitBase}/trees`, {
      base_tree: baseTree,
      tree: files.map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.content })),
    })) as { sha?: string };
    if (!data.sha) throw new GitHubError(502, "Malformed create-tree response");
    return data.sha;
  }

  async function createCommit(message: string, tree: string, parent: string): Promise<string> {
    const data = (await requestJson("POST", `${gitBase}/commits`, {
      message,
      tree,
      parents: [parent],
    })) as { sha?: string };
    if (!data.sha) throw new GitHubError(502, "Malformed create-commit response");
    return data.sha;
  }

  async function updateRef(commitSha: string): Promise<void> {
    // force:false → GitHub returns 422 when the update is not a fast-forward.
    await requestJson("PATCH", `${gitBase}/refs/heads/${branch}`, { sha: commitSha, force: false }, [
      422,
    ]);
  }

  return { getFile, getRef, getCommitTree, createTree, createCommit, updateRef };
}
