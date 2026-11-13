import { describe, expect, it } from "vitest";
import { buildContainer } from "../../src/app/container";
import { parseEnv } from "../../src/config/env";
import { OAuthStore } from "../../src/oauth/store";
import { sha256Hex } from "../../src/utils/crypto";
import { getUnixTimestamp } from "../../src/utils/time";

const DAY = 86_400;

describe("OAuthStore token lifetimes", () => {
  const { redisService } = buildContainer(parseEnv({ NODE_ENV: "test" }));
  const store = new OAuthStore(redisService, {
    accessTokenSeconds: 3600,
    refreshTokenSeconds: 30 * DAY,
    signatureMaxAgeSeconds: DAY,
  });
  const issue = (grant: Parameters<OAuthStore["issueTokens"]>[0]["grant"]) =>
    store.issueTokens({ clientId: "c1", scopes: [], grant });

  it("keeps the configured lifetimes for API-key grants", async () => {
    const tokens = await issue({ network: "mainnet", apiKey: "k" });
    expect(tokens.expires_in).toBe(3600);
    const refresh = await store.takeRefreshToken(tokens.refresh_token);
    expect(refresh!.expiresAt - getUnixTimestamp()).toBeGreaterThan(29 * DAY);
  });

  it("never lets a wallet grant outlive its signature", async () => {
    const signedAt = getUnixTimestamp() - (DAY - 600);
    const tokens = await issue({ network: "mainnet", signature: `0xabc_${signedAt}`, walletAddress: "T1" });
    expect(tokens.expires_in).toBeLessThanOrEqual(600);
    const refresh = await store.takeRefreshToken(tokens.refresh_token);
    expect(refresh!.expiresAt).toBeLessThanOrEqual(signedAt + DAY);
  });

  it("accepts millisecond signature timestamps", async () => {
    const signedAtMs = (getUnixTimestamp() - 60) * 1000;
    const tokens = await issue({ network: "mainnet", signature: `0xabc_${signedAtMs}`, walletAddress: "T1" });
    expect(tokens.expires_in).toBe(3600);
  });

  it("refuses to refresh once the signature has expired", async () => {
    const signedAt = getUnixTimestamp() - DAY - 1;
    await expect(issue({ network: "mainnet", signature: `0xabc_${signedAt}`, walletAddress: "T1" })).rejects.toThrow(
      /signature behind this grant has expired/,
    );
  });

  it("stores each token's sibling key and deletes both when either one is revoked", async () => {
    const issued = await issue({ network: "mainnet", apiKey: "k" });
    const access = await store.getAccessToken(issued.access_token);
    expect(access?.pairKey).toBe(`oauth:rt:${sha256Hex(issued.refresh_token)}`);
    const refresh = await redisService.getJson<{ pairKey?: string; clientId: string }>(access!.pairKey!);
    expect(refresh).toMatchObject({
      clientId: "c1",
      pairKey: `oauth:at:${sha256Hex(issued.access_token)}`,
    });

    await store.revoke(issued.refresh_token, "c1");
    expect(await store.getAccessToken(issued.access_token)).toBeNull();
    expect(await redisService.getJson(access!.pairKey!)).toBeNull();
  });

  it("deletes the refresh token when the access token is revoked", async () => {
    const issued = await issue({ network: "mainnet", apiKey: "k" });
    const access = await store.getAccessToken(issued.access_token);
    await store.revoke(issued.access_token, "c1");
    expect(await store.getAccessToken(issued.access_token)).toBeNull();
    expect(await redisService.getJson(access!.pairKey!)).toBeNull();
  });

  it("leaves the pair stored when the client id does not own it", async () => {
    const issued = await issue({ network: "mainnet", apiKey: "k" });
    await store.revoke(issued.access_token, "someone-else");
    const access = await store.getAccessToken(issued.access_token);
    expect(access).toMatchObject({ clientId: "c1" });
    expect(await redisService.getJson(access!.pairKey!)).toMatchObject({ clientId: "c1" });
  });

  it("revokes a record that has no pairKey and leaves other keys alone", async () => {
    const token = "legacy-access-token";
    const key = `oauth:at:${sha256Hex(token)}`;
    const unrelated = "oauth:rt:unrelated-legacy";
    await redisService.setJson(
      key,
      { clientId: "c1", scopes: [], grant: { network: "mainnet", apiKey: "k" }, expiresAt: getUnixTimestamp() + 60 },
      60,
    );
    await redisService.setJson(unrelated, { marker: true }, 60);
    await store.revoke(token, "c1");
    expect(await redisService.getJson(key)).toBeNull();
    expect(await redisService.getJson(unrelated)).toEqual({ marker: true });
  });
});
