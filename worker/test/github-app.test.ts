import { describe, it, expect, beforeEach } from "vitest";
import { exportPKCS8, generateKeyPair, decodeJwt, decodeProtectedHeader } from "jose";
import {
  createInstallationAuth,
  __resetInstallationTokenCache,
} from "../src/github-app.js";
import { GitHubError } from "../src/github.js";

const TOKEN_URL = "https://api.github.com/app/installations/42/access_tokens";

// A real RSA key so the App JWT actually signs; the fetch is faked so no network.
let pem: string;

beforeEach(async () => {
  __resetInstallationTokenCache();
  if (!pem) {
    const { privateKey } = await generateKeyPair("RS256", { extractable: true });
    pem = await exportPKCS8(privateKey);
  }
});

/** A fake fetch that records calls and returns a token expiring `ttlMs` from now. */
function fakeFetch(ttlMs: number) {
  const calls: { url: string; auth: string }[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), auth: headers.Authorization ?? "" });
    return new Response(
      JSON.stringify({ token: `inst-token-${calls.length}`, expires_at: new Date(Date.now() + ttlMs).toISOString() }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("createInstallationAuth", () => {
  it("mints an installation token via the App JWT", async () => {
    const { calls, fetchImpl } = fakeFetch(60 * 60_000);
    const auth = createInstallationAuth("123", pem, "42", fetchImpl);

    const token = await auth.token();

    expect(token).toBe("inst-token-1");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(TOKEN_URL);
    // The Authorization header carries a signed App JWT (iss = app id, alg RS256).
    const jwt = calls[0].auth.replace(/^Bearer /, "");
    expect(decodeProtectedHeader(jwt).alg).toBe("RS256");
    expect(decodeJwt(jwt).iss).toBe("123");
  });

  it("caches the token across calls (single mint)", async () => {
    const { calls, fetchImpl } = fakeFetch(60 * 60_000);
    const auth = createInstallationAuth("123", pem, "42", fetchImpl);

    const a = await auth.token();
    const b = await auth.token();

    expect(a).toBe(b);
    expect(calls).toHaveLength(1);
  });

  it("re-mints when the cached token is within the refresh skew of expiry", async () => {
    // Token already inside the 60s refresh skew → never cacheable, re-minted each call.
    const { calls, fetchImpl } = fakeFetch(30_000);
    const auth = createInstallationAuth("123", pem, "42", fetchImpl);

    const a = await auth.token();
    const b = await auth.token();

    expect(a).toBe("inst-token-1");
    expect(b).toBe("inst-token-2");
    expect(calls).toHaveLength(2);
  });

  it("keeps installations' tokens separate (no cross-installation bleed)", async () => {
    const { fetchImpl } = fakeFetch(60 * 60_000);
    const a = createInstallationAuth("123", pem, "42", fetchImpl);
    const b = createInstallationAuth("123", pem, "99", fetchImpl);

    const ta = await a.token();
    const tb = await b.token();

    expect(ta).not.toBe(tb);
  });

  it("surfaces a GitHubError when minting fails", async () => {
    const fetchImpl = (async () =>
      new Response("nope", { status: 403 })) as unknown as typeof fetch;
    const auth = createInstallationAuth("123", pem, "42", fetchImpl);

    await expect(auth.token()).rejects.toBeInstanceOf(GitHubError);
  });
});
