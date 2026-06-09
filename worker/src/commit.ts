// Atomic batched-commit engine (data-write-tools capability). Persists a set of
// full-file changes as exactly ONE commit via the Git Data API
// (base tree → new tree → commit → update ref), validating every entry first so
// nothing syntactically broken can land.
//
// Second-writer handling: the index-build Action (Change 02) also commits to the
// branch, so `update ref` can be rejected non-fast-forward. We re-read the base
// and replay the SAME full-file entries onto the new tree, bounded by
// MAX_REF_RETRIES. This is safe because the only other writer (the index Action)
// only touches `_indexes/*`, disjoint from the source files written here — so a
// conflict means the tree advanced on unrelated files, and overlaying our full
// contents on the new base_tree preserves both.

import { GitHubError, type GitHubClient, type TreeFile } from "./github.js";
import { ToolError } from "./errors.js";
import { validateFile } from "./validate.js";

const MAX_REF_RETRIES = 4;

export interface CommitResult {
  commit_sha: string;
  files: string[];
}

/**
 * Validate and commit `files` (each carrying its full new content) as one commit.
 * Throws ToolError("validation_failed") if any entry is structurally invalid (no
 * commit), ToolError("conflict") if the ref keeps advancing past the retry bound,
 * or ToolError("upstream_unavailable") on other GitHub failures.
 */
export async function commitFiles(
  gh: GitHubClient,
  files: TreeFile[],
  message: string,
): Promise<CommitResult> {
  if (files.length === 0) {
    throw new ToolError("validation_failed", "commit requested with no file changes");
  }
  for (const f of files) validateFile(f.path, f.content);

  for (let attempt = 1; attempt <= MAX_REF_RETRIES; attempt++) {
    const baseCommit = await gh.getRef();
    const baseTree = await gh.getCommitTree(baseCommit);
    const tree = await gh.createTree(baseTree, files);
    const commit = await gh.createCommit(message, tree, baseCommit);
    try {
      await gh.updateRef(commit);
      return { commit_sha: commit, files: files.map((f) => f.path) };
    } catch (e) {
      if (e instanceof GitHubError && e.status === 422) {
        // Non-fast-forward: the ref moved under us. Replay onto the new base.
        continue;
      }
      if (e instanceof GitHubError) {
        throw new ToolError("upstream_unavailable", e.message);
      }
      throw e;
    }
  }

  throw new ToolError(
    "conflict",
    `Branch kept advancing; commit abandoned after ${MAX_REF_RETRIES} attempts. Retry the operation.`,
    { attempts: MAX_REF_RETRIES },
  );
}
