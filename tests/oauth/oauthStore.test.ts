import { describe, expect, it } from "vitest";
import { buildContainer } from "../../src/app/container";
import { parseEnv } from "../../src/config/env";
import { OAuthStore } from "../../src/oauth/store";
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
});
