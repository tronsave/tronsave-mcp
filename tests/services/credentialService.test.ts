import { describe, expect, it, vi } from "vitest";
import { CredentialService } from "../../src/services/credentialService";
import { AppError } from "../../src/utils/errors";

describe("CredentialService.fromSignature upstream errors", () => {
  const build = (request: ReturnType<typeof vi.fn>) =>
    new CredentialService(
      { verifyApiKey: vi.fn() } as never,
      { verifyLoginSignatureByTimestamp: vi.fn().mockResolvedValue("TWallet") } as never,
      { mainnet: { graphqlClient: { request } }, testnet: { graphqlClient: { request } } } as never,
    );

  it("rethrows UPSTREAM_UNAUTHORIZED from the user-info lookup", async () => {
    const creds = build(
      vi.fn().mockRejectedValue(new AppError("unauthorized", 401, "UPSTREAM_UNAUTHORIZED", { retryable: false })),
    );
    await expect(creds.fromSignature("sig_1700000000", "mainnet")).rejects.toMatchObject({
      code: "UPSTREAM_UNAUTHORIZED",
    });
  });

  it("still logs in without an internal api key when the lookup fails for another reason", async () => {
    const creds = build(
      vi.fn().mockRejectedValue(new AppError("down", 502, "UPSTREAM_UNAVAILABLE", { retryable: true })),
    );
    const verified = await creds.fromSignature("sig_1700000000", "mainnet");
    expect(verified).toMatchObject({ walletAddress: "TWallet", signature: "sig_1700000000" });
    expect(verified.apiKey).toBeUndefined();
    expect(verified.warnings[0]).toMatch(/internal API key/);
  });
});
