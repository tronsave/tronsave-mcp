import { describe, expect, it, vi } from "vitest";
import { REDIS_KEYS } from "../../../../src/config/constants";
import { withRequestContext } from "../../../../src/handlers/authContext";
import { createUserHandlers } from "../../../../src/tools/handlers/platform/users";
import { sha256Hex } from "../../../../src/utils/crypto";

const revoked = (success: boolean) => ({
  data: { users: { revokeApiKey: { success, code: success ? 0 : 400, message: success ? "ok" : "no" } } },
});

describe("revokeApiKeyHandler cache", () => {
  const run = async (network: "mainnet" | "testnet", apiKey: string | undefined, success: boolean) => {
    const redisService = { delete: vi.fn() };
    const fetchGraphqlApi = vi.fn().mockResolvedValue(revoked(success));
    const { revokeApiKeyHandler } = createUserHandlers(
      { redisService } as never,
      { fetchGraphqlApi } as never,
    );
    const result = await withRequestContext(
      {
        headers: {},
        auth: { type: "signature", walletAddress: "TWallet", apiKey },
        network,
      },
      () => revokeApiKeyHandler({}),
    );
    return { result, redisService };
  };

  it("deletes the verified-key cache for the request network", async () => {
    const apiKey = "raw-key";
    const { result, redisService } = await run("testnet", apiKey, true);
    expect(result.isError).toBe(false);
    expect(redisService.delete).toHaveBeenCalledWith(REDIS_KEYS.apiKeyVerified("testnet", sha256Hex(apiKey)));
  });

  it("leaves the cache in place when the revoke did not succeed", async () => {
    const { result, redisService } = await run("mainnet", "raw-key", false);
    expect(result.isError).toBe(true);
    expect(redisService.delete).not.toHaveBeenCalled();
  });

  it("leaves the cache in place when the session has no api key", async () => {
    const { redisService } = await run("mainnet", undefined, true);
    expect(redisService.delete).not.toHaveBeenCalled();
  });
});
