import { describe, it, expect } from "vitest";
import {
  parseAllowlist,
  parseAuthResults,
  gateMessage,
  extractAnchors,
  decodeTrackerUrl,
  isLikelyContentLink,
  appendInboxEntry,
  addSources,
  type Allowlist,
} from "../src/email.js";
import { parseToml } from "../src/parse.js";
import { flattenInbox } from "../src/discovery.js";

describe("parseAllowlist", () => {
  it("parses members + senders, lowercasing addresses", () => {
    const a = parseAllowlist(`
[[members]]
address = "Alice@Example.com"
name = "Alice"

[[senders]]
address = "news@seriouseats.com"
`);
    expect(a.members.has("alice@example.com")).toBe(true);
    expect(a.senders.has("news@seriouseats.com")).toBe(true);
  });

  it("returns empty sets for absent/malformed input", () => {
    expect(parseAllowlist(null).members.size).toBe(0);
    expect(parseAllowlist("[[[ not toml").senders.size).toBe(0);
  });
});

describe("parseAuthResults", () => {
  it("extracts dkim/spf/dmarc verdicts and dkim domains", () => {
    const v = parseAuthResults(
      "mx.cloudflare.net; dkim=pass header.d=seriouseats.com; spf=pass; dmarc=pass",
    );
    expect(v).toMatchObject({ dkim: true, spf: true, dmarc: true });
    expect(v.dkimDomains).toContain("seriouseats.com");
  });

  it("records a failing dkim as false with no domain", () => {
    const v = parseAuthResults("mx; dkim=fail header.d=evil.com; spf=softfail; dmarc=none");
    expect(v.dkim).toBe(false);
    expect(v.dkimDomains).toEqual([]);
    expect(v.dmarc).toBe(false);
  });

  it("handles a null header", () => {
    expect(parseAuthResults(null)).toMatchObject({ dkim: false, spf: false, dmarc: false });
  });
});

describe("gateMessage", () => {
  const allowlist: Allowlist = {
    members: new Set(["alice@example.com"]),
    senders: new Set(["news@seriouseats.com"]),
  };
  const pass = (domain: string) => ({ dkim: true, spf: true, dmarc: true, dkimDomains: [domain] });

  it("(a) accepts an allowlisted sender with aligned DKIM (auto-forward)", () => {
    const r = gateMessage({ from: "news@seriouseats.com", allowlist, auth: pass("seriouseats.com") });
    expect(r).toMatchObject({ accepted: true, reason: "sender_dkim" });
  });

  it("(b) accepts an allowlisted member with aligned DKIM (manual forward)", () => {
    const r = gateMessage({ from: "alice@example.com", allowlist, auth: pass("example.com") });
    expect(r).toMatchObject({ accepted: true, reason: "member_dkim" });
  });

  it("drops an allowlisted sender whose DKIM is not aligned", () => {
    const r = gateMessage({ from: "news@seriouseats.com", allowlist, auth: pass("mailchimp.com") });
    expect(r.accepted).toBe(false);
  });

  it("drops mail from a non-allowlisted address even with passing DKIM", () => {
    const r = gateMessage({ from: "spam@nowhere.com", allowlist, auth: pass("nowhere.com") });
    expect(r.accepted).toBe(false);
  });

  it("drops an allowlisted member when DKIM did not pass (relay-SPF path deferred)", () => {
    const r = gateMessage({
      from: "alice@example.com",
      allowlist,
      auth: { dkim: false, spf: true, dmarc: false, dkimDomains: [] },
    });
    expect(r.accepted).toBe(false);
  });
});

describe("extractAnchors", () => {
  it("pulls href + link text from HTML and bare URLs from text", () => {
    const anchors = extractAnchors(
      '<p>Try <a href="https://x.test/chili">Weeknight Chili</a> and <a href="mailto:x">mail</a></p>',
      "Also https://y.test/soup here",
    );
    expect(anchors).toContainEqual({ url: "https://x.test/chili", title: "Weeknight Chili" });
    expect(anchors.some((a) => a.url.startsWith("mailto:"))).toBe(false);
    expect(anchors).toContainEqual({ url: "https://y.test/soup", title: null });
  });

  it("survives a nested forward wrapper (links still extracted)", () => {
    const wrapped =
      "<div>---------- Forwarded message ----------<br>" +
      'From: news@seriouseats.com<br><blockquote><a href="https://www.seriouseats.com/braise">Braise</a></blockquote></div>';
    const anchors = extractAnchors(wrapped, null);
    expect(anchors).toContainEqual({ url: "https://www.seriouseats.com/braise", title: "Braise" });
  });
});

describe("decodeTrackerUrl", () => {
  it("decodes an encoded destination from a query param without a network call", () => {
    const { url, followNeeded } = decodeTrackerUrl(
      "https://click.e.seriouseats.com/?url=https%3A%2F%2Fwww.seriouseats.com%2Fchili&u=123",
    );
    expect(url).toBe("https://www.seriouseats.com/chili");
    expect(followNeeded).toBe(false);
  });

  it("flags an opaque redirector for following", () => {
    const { url, followNeeded } = decodeTrackerUrl("https://sendgrid.net/ss/c/abcdef");
    expect(url).toBe("https://sendgrid.net/ss/c/abcdef");
    expect(followNeeded).toBe(true);
  });

  it("passes a plain content URL through untouched", () => {
    expect(decodeTrackerUrl("https://www.seriouseats.com/chili")).toEqual({
      url: "https://www.seriouseats.com/chili",
      followNeeded: false,
    });
  });
});

describe("isLikelyContentLink", () => {
  it("keeps content hosts, drops social + unsubscribe chrome", () => {
    expect(isLikelyContentLink("https://www.seriouseats.com/chili")).toBe(true);
    expect(isLikelyContentLink("https://facebook.com/seriouseats")).toBe(false);
    expect(isLikelyContentLink("https://www.seriouseats.com/unsubscribe")).toBe(false);
  });
});

describe("appendInboxEntry", () => {
  const entry = {
    from: "news@seriouseats.com",
    subject: "This week",
    received_at: "2026-06-11",
    candidates: [
      { title: "Chili", summary: null, url: "https://www.seriouseats.com/chili" },
      { title: "Soup", summary: null, url: "https://www.seriouseats.com/soup" },
    ],
  };

  it("appends a new entry and reports the written count", () => {
    const { text, written } = appendInboxEntry(null, entry, new Set());
    expect(written).toBe(2);
    const pool = flattenInbox(text);
    expect(pool.map((c) => c.url).sort()).toEqual([
      "https://www.seriouseats.com/chili",
      "https://www.seriouseats.com/soup",
    ]);
    // round-trips as valid TOML
    expect(() => parseToml(text, "discoveries_inbox.toml")).not.toThrow();
  });

  it("drops candidates already in `seen` (corpus ∪ existing inbox)", () => {
    const seen = new Set(["https://www.seriouseats.com/chili"]);
    const { written } = appendInboxEntry(null, entry, seen);
    expect(written).toBe(1);
  });

  it("writes nothing when every candidate is already seen", () => {
    const seen = new Set([
      "https://www.seriouseats.com/chili",
      "https://www.seriouseats.com/soup",
    ]);
    const { text, written } = appendInboxEntry(null, entry, seen);
    expect(written).toBe(0);
    expect(text).toBe("");
  });
});

describe("addSources", () => {
  it("adds members + senders and dedups by address", () => {
    const first = addSources(null, {
      members: [{ address: "Alice@Example.com", name: "Alice" }],
      senders: [{ address: "news@seriouseats.com" }],
    });
    expect(first.added).toEqual({ members: 1, senders: 1 });
    const second = addSources(first.text, {
      members: [{ address: "alice@example.com" }], // dup (case-insensitive)
      senders: [{ address: "cooking@nytimes.com" }],
    });
    expect(second.added).toEqual({ members: 0, senders: 1 });
    const al = parseAllowlist(second.text);
    expect(al.members.has("alice@example.com")).toBe(true);
    expect(al.senders.has("cooking@nytimes.com")).toBe(true);
    expect(al.senders.has("news@seriouseats.com")).toBe(true);
  });

  it("ignores entries with no @ address", () => {
    const { added } = addSources(null, { senders: [{ address: "not-an-email" }] });
    expect(added.senders).toBe(0);
  });
});
