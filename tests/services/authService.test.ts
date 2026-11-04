import { describe, expect, it, vi } from "vitest";
import { AuthService } from "../../src/services/authService";

describe("AuthService api-key cache", () => {
  it("uses redis verify cache hit and skips upstream request", async () => {
    const sessionService = {
      getSession: vi.fn().mockResolvedValue(null),
    };
    const redisService = {
      getJson: vi.fn().mockResolvedValue({ verifiedAt: 123 }),
      setJson: vi.fn(),
    };
    const restClient = {
      request: vi.fn(),
    };
    const auth = new AuthService(
      sessionService as never,
      redisService as never,
      { mainnet: { restClient }, testnet: { restClient } },
    );

    const out = await auth.detect({ authorization: "ApiKey sample_key" }, "mainnet");
    expect(out.type).toBe("apiKey");
    expect(restClient.request).not.toHaveBeenCalled();
  });

  it("cache miss verifies upstream and stores short-lived cache", async () => {
    const sessionService = {
      getSession: vi.fn().mockResolvedValue(null),
    };
    const redisService = {
      getJson: vi.fn().mockResolvedValue(null),
      setJson: vi.fn().mockResolvedValue(undefined),
    };
    const restClient = {
      request: vi.fn().mockResolvedValue({ data: { walletAddress: "T123" } }),
    };
    const auth = new AuthService(
      sessionService as never,
      redisService as never,
      { mainnet: { restClient }, testnet: { restClient } },
    );

    const out = await auth.detect({ authorization: "ApiKey sample_key" }, "mainnet");
    expect(out.type).toBe("apiKey");
    expect(restClient.request).toHaveBeenCalledOnce();
    expect(redisService.setJson).toHaveBeenCalledOnce();
  });
});

describe("AuthService header resolution", () => {
  const WALLET = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

  const build = (overrides: { session?: unknown; restRequest?: ReturnType<typeof vi.fn>; recovered?: string } = {}) => {
    const sessionService = { getSession: vi.fn().mockResolvedValue(overrides.session ?? null) };
    const redisService = { getJson: vi.fn().mockResolvedValue(null), setJson: vi.fn() };
    const restClient = { request: overrides.restRequest ?? vi.fn().mockResolvedValue({ data: { id: "a" } }) };
    const signatureService = {
      verifyLoginSignatureByTimestamp: vi.fn().mockResolvedValue(overrides.recovered ?? WALLET),
    };
    const auth = new AuthService(
      sessionService as never,
      redisService as never,
      { mainnet: { restClient }, testnet: { restClient } } as never,
      signatureService as never,
    );
    return { auth, signatureService, restClient };
  };

  it("falls through to the ApiKey header when the transport session has no login", async () => {
    const { auth } = build();
    const out = await auth.detect({ "mcp-session-id": "s1", authorization: "ApiKey k" }, "mainnet");
    expect(out).toMatchObject({ type: "apiKey", apiKey: "k" });
  });

  it("accepts Bearer as an api-key alias", async () => {
    const { auth } = build();
    expect(await auth.detect({ authorization: "Bearer k3" }, "mainnet")).toMatchObject({
      type: "apiKey",
      apiKey: "k3",
      authorization: "ApiKey k3",
    });
  });

  it("accepts x-api-key as an alternative header", async () => {
    const { auth } = build();
    expect(await auth.detect({ "x-api-key": "k2" }, "mainnet")).toMatchObject({ type: "apiKey", apiKey: "k2" });
  });

  it("prefers a stored login over headers", async () => {
    const { auth } = build({ session: { sessionId: "s1", apiKey: "stored", signature: "sig_1", walletAddress: WALLET } });
    const out = await auth.detect({ "mcp-session-id": "s1", authorization: "ApiKey other" }, "mainnet");
    expect(out).toMatchObject({ type: "session", sessionAuthType: "signature", apiKey: "stored", signature: "sig_1" });
  });

  it("reports a rejected ApiKey header as authError instead of throwing", async () => {
    const { auth } = build({ restRequest: vi.fn().mockResolvedValue({ data: null }) });
    const out = await auth.detect({ authorization: "ApiKey bad" }, "mainnet");
    expect(out).toMatchObject({ type: "none", authError: { code: "INVALID_API_KEY" } });
  });

  it("verifies Signature headers and derives the wallet from the signature, not x-address", async () => {
    const { auth, signatureService } = build();
    const out = await auth.detect({ authorization: "Signature 0xabc_1700000000" }, "mainnet");
    expect(signatureService.verifyLoginSignatureByTimestamp).toHaveBeenCalledWith("0xabc", 1700000000);
    expect(out).toMatchObject({ type: "signature", walletAddress: WALLET, signature: "0xabc_1700000000" });
  });

  it("rejects a Signature header whose x-address does not match the signer", async () => {
    const { auth } = build();
    const out = await auth.detect(
      { authorization: "Signature 0xabc_1700000000", "x-address": "TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9" },
      "mainnet",
    );
    expect(out).toMatchObject({ type: "none", authError: { code: "SIGNATURE_ADDRESS_MISMATCH" } });
  });
});
