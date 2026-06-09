import { describe, it, expect } from "vitest";
import {
  handleOAuthRequest,
  challengeFromVerifier,
  generateVerifier,
  type OAuthDeps,
  type Pkce,
} from "../src/oauth.js";
import type { KrogerUserClient, KvStore } from "../src/kroger-user.js";

function memKv(initial: Record<string, string> = {}): KvStore {
  const store = new Map(Object.entries(initial));
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

function stubClient(overrides: Partial<KrogerUserClient> = {}): KrogerUserClient {
  return {
    buildAuthorizeUrl: (redirectUri, state, challenge) =>
      `https://kroger/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&code_challenge=${challenge}`,
    exchangeCode: async () => {},
    getAccessToken: async () => "A1",
    addToCart: async () => {},
    ...overrides,
  };
}

const fixedPkce: Pkce = {
  generateVerifier: () => "fixed-verifier",
  generateState: () => "fixed-state",
  challengeFromVerifier: async () => "fixed-challenge",
};

describe("/oauth route handling", () => {
  it("init stores the verifier under state and redirects to Kroger", async () => {
    const kv = memKv();
    const deps: OAuthDeps = { kv, client: stubClient(), pkce: fixedPkce };
    const res = await handleOAuthRequest(deps, new URL("https://grocery-mcp.example.com/oauth/init"));

    expect(res.status).toBe(302);
    const loc = res.headers.get("location")!;
    expect(loc).toContain("state=fixed-state");
    expect(loc).toContain("code_challenge=fixed-challenge");
    expect(loc).toContain(encodeURIComponent("https://grocery-mcp.example.com/oauth/callback"));
    expect(await kv.get("kroger:pkce:fixed-state")).toBe("fixed-verifier");
  });

  it("completes the init→callback handshake: verifies state, exchanges the code", async () => {
    const kv = memKv();
    let exchanged: { code: string; verifier: string } | null = null;
    const client = stubClient({
      exchangeCode: async (code, verifier) => {
        exchanged = { code, verifier };
      },
    });
    const deps: OAuthDeps = { kv, client, pkce: fixedPkce };

    await handleOAuthRequest(deps, new URL("https://x.com/oauth/init"));
    const res = await handleOAuthRequest(
      deps,
      new URL("https://x.com/oauth/callback?code=THECODE&state=fixed-state"),
    );

    expect(res.status).toBe(200);
    expect(exchanged).toEqual({ code: "THECODE", verifier: "fixed-verifier" });
    // The single-use verifier is consumed.
    expect(await kv.get("kroger:pkce:fixed-state")).toBeNull();
  });

  it("rejects a forged/replayed callback whose state has no stored verifier", async () => {
    const kv = memKv();
    let exchangeCalled = false;
    const client = stubClient({
      exchangeCode: async () => {
        exchangeCalled = true;
      },
    });
    const deps: OAuthDeps = { kv, client, pkce: fixedPkce };

    const res = await handleOAuthRequest(
      deps,
      new URL("https://x.com/oauth/callback?code=c&state=attacker-state"),
    );

    expect(res.status).toBe(400);
    expect(exchangeCalled).toBe(false);
  });

  it("rejects a callback missing state, with no exchange", async () => {
    const kv = memKv();
    let exchangeCalled = false;
    const deps: OAuthDeps = {
      kv,
      client: stubClient({ exchangeCode: async () => { exchangeCalled = true; } }),
      pkce: fixedPkce,
    };
    const res = await handleOAuthRequest(deps, new URL("https://x.com/oauth/callback?code=c"));
    expect(res.status).toBe(400);
    expect(exchangeCalled).toBe(false);
  });

  it("surfaces a Kroger error param without attempting exchange", async () => {
    const kv = memKv({ "kroger:pkce:fixed-state": "fixed-verifier" });
    let exchangeCalled = false;
    const deps: OAuthDeps = {
      kv,
      client: stubClient({ exchangeCode: async () => { exchangeCalled = true; } }),
      pkce: fixedPkce,
    };
    const res = await handleOAuthRequest(
      deps,
      new URL("https://x.com/oauth/callback?error=access_denied&state=fixed-state"),
    );
    expect(res.status).toBe(400);
    expect(exchangeCalled).toBe(false);
  });

  it("PKCE S256 challenge is the base64url SHA-256 of the verifier", async () => {
    // Known RFC 7636 Appendix B test vector.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = await challengeFromVerifier(verifier);
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("generateVerifier yields a URL-safe string of adequate length", () => {
    const v = generateVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(v.length).toBeGreaterThanOrEqual(43);
  });
});
