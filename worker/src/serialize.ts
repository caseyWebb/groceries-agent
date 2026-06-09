// Serialization helpers for the write path. Counterpart to parse.ts: turn
// structured data back into the repo's on-disk text. TOML round-trips lose
// comments, so for the agent-writable item files (pantry, grocery_list) we
// preserve the leading documentation header and let smol-toml own the data body.

import { dump as dumpYaml } from "js-yaml";
import { stringify as stringifyTomlRaw } from "smol-toml";

/** Reassemble a markdown file from frontmatter + body (inverse of parseMarkdown). */
export function serializeMarkdown(frontmatter: Record<string, unknown>, body: string): string {
  // dumpYaml ends with a trailing newline; quotes date-like strings to keep them strings.
  const yaml = dumpYaml(frontmatter, { lineWidth: -1 });
  return `---\n${yaml}---\n${body}`;
}

/**
 * Split a TOML document into its leading comment/blank header (documentation)
 * and the rest. The header is the contiguous run of lines from the top that are
 * blank or start with `#`, up to the first data line.
 */
export function splitTomlHeader(text: string): { header: string; rest: string } {
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    break;
  }
  return { header: lines.slice(0, i).join("\n"), rest: lines.slice(i).join("\n") };
}

/**
 * Serialize a parsed TOML object back to text, preserving `originalText`'s
 * leading documentation header. Used for the item-array files so first write
 * doesn't strip their header comments.
 */
export function stringifyTomlWithHeader(
  originalText: string,
  data: Record<string, unknown>,
): string {
  const body = stringifyTomlRaw(data);
  const { header } = splitTomlHeader(originalText);
  const trimmedHeader = header.replace(/\s+$/, "");
  if (trimmedHeader === "") return `${body}\n`;
  return `${trimmedHeader}\n\n${body}\n`;
}
