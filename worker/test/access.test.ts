import { describe, it, expect, beforeAll } from "vitest";
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet, type JWTVerifyGetKey } from "jose";
import { createAccessVerifier } from "../src/access.js";

const TEAM = "casey.cloudflareaccess.com";
const ISSUER = `https://${TEAM}`;
const AUD = "test-aud-tag";

let jwks: JWTVerifyGetKey;
let privateKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  jwk.kid = "k1";
  jwk.alg = "RS256";
  jwks = createLocalJWKSet({ keys: [jwk] });
});

async function sign(opts: {
  aud?: string;
  iss?: string;
  expSecondsFromNow?: number;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.expSecondsFromNow ?? 3600))
    .sign(privateKey);
}

describe("createAccessVerifier", () => {
  it("accepts a valid token (right issuer + audience)", async () => {
    const v = createAccessVerifier(TEAM, AUD, jwks);
    expect(await v.verify(await sign({}))).toBe(true);
  });

  it("rejects a token for a different audience", async () => {
    const v = createAccessVerifier(TEAM, AUD, jwks);
    expect(await v.verify(await sign({ aud: "some-other-app" }))).toBe(false);
  });

  it("rejects a token from a different issuer", async () => {
    const v = createAccessVerifier(TEAM, AUD, jwks);
    expect(await v.verify(await sign({ iss: "https://evil.cloudflareaccess.com" }))).toBe(false);
  });

  it("rejects an expired token", async () => {
    const v = createAccessVerifier(TEAM, AUD, jwks);
    expect(await v.verify(await sign({ expSecondsFromNow: -10 }))).toBe(false);
  });

  it("rejects garbage", async () => {
    const v = createAccessVerifier(TEAM, AUD, jwks);
    expect(await v.verify("not.a.jwt")).toBe(false);
    expect(await v.verify("")).toBe(false);
  });
});
