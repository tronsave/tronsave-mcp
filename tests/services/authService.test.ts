import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TronWeb } from "tronweb";
import { REDIS_KEYS } from "../../src/config/constants";
import { env } from "../../src/config/env";
import { AuthService } from "../../src/services/authService";
import { SignatureService } from "../../src/services/signatureService";
import { sha256Hex } from "../../src/utils/crypto";
import { AppError } from "../../src/utils/errors";
import * as time from "../../src/utils/time";

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
    expect(redisService.setJson).toHaveBeenCalledWith(
      REDIS_KEYS.apiKeyVerified("mainnet", sha256Hex("sample_key")),
      expect.objectContaining({ walletAddress: "T123" }),
      env.AUTH_VERIFY_CACHE_TTL_SECONDS,
    );
  });

  it("does not treat a key verified on testnet as verified on mainnet", async () => {
    const restClient = { request: vi.fn().mockResolvedValue({ data: { walletAddress: "T1" } }) };
    const redisService = {
      getJson: vi.fn(async (key: string) => (key.includes(":testnet:") ? { walletAddress: "T1", verifiedAt: 1 } : null)),
      setJson: vi.fn(),
    };
    const auth = new AuthService(
      { getSession: vi.fn().mockResolvedValue(null) } as never,
      redisService as never,
      { mainnet: { restClient }, testnet: { restClient } } as never,
    );

    const testnet = await auth.detect({ authorization: "ApiKey sample_key" }, "testnet");
    expect(testnet.type).toBe("apiKey");
    expect(restClient.request).not.toHaveBeenCalled();

    const mainnet = await auth.detect({ authorization: "ApiKey sample_key" }, "mainnet");
    expect(mainnet.type).toBe("apiKey");
    expect(restClient.request).toHaveBeenCalledOnce();
    expect(redisService.setJson).toHaveBeenCalledWith(
      REDIS_KEYS.apiKeyVerified("mainnet", sha256Hex("sample_key")),
      expect.objectContaining({ walletAddress: "T1" }),
      env.AUTH_VERIFY_CACHE_TTL_SECONDS,
    );
  });

  it("treats upstream 4xx as an invalid api key and rethrows 5xx", async () => {
    const redisService = { getJson: vi.fn().mockResolvedValue(null), setJson: vi.fn() };
    const restClient = {
      request: vi
        .fn()
        .mockRejectedValueOnce(new AppError("RestClient request failed: 401", 401, "UPSTREAM_UNAUTHORIZED", { retryable: false }))
        .mockRejectedValueOnce(new AppError("RestClient request failed: 400", 400, "REST_ERROR"))
        .mockRejectedValueOnce(new AppError("down", 503, "UPSTREAM_UNAVAILABLE", { retryable: true })),
    };
    const auth = new AuthService(
      { getSession: vi.fn().mockResolvedValue(null) } as never,
      redisService as never,
      { mainnet: { restClient }, testnet: { restClient } } as never,
    );
    await expect(auth.verifyApiKey("bad", "mainnet")).rejects.toMatchObject({ code: "INVALID_API_KEY" });
    await expect(auth.verifyApiKey("bad", "testnet")).rejects.toMatchObject({ code: "INVALID_API_KEY" });
    await expect(auth.verifyApiKey("bad", "mainnet")).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE", statusCode: 503 });
    expect(redisService.setJson).not.toHaveBeenCalled();
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

describe("AuthService signature verify cache", () => {
  const NOW = 1_700_000_000;
  const WALLET = "TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9";

  beforeEach(() => {
    vi.spyOn(time, "getUnixTimestamp").mockReturnValue(NOW);
    vi.spyOn(TronWeb, "isAddress").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const build = (getJson: ReturnType<typeof vi.fn>) => {
    const setJson = vi.fn();
    const signatureService = new SignatureService({} as never, {
      verifyMessageV2: vi.fn().mockResolvedValue(WALLET),
    });
    const verify = vi.spyOn(signatureService, "verifyLoginSignatureByTimestamp");
    const auth = new AuthService(
      { getSession: vi.fn().mockResolvedValue(null) } as never,
      { getJson, setJson } as never,
      { mainnet: { restClient: { request: vi.fn() } }, testnet: { restClient: { request: vi.fn() } } } as never,
      signatureService,
    );
    return { auth, verify, setJson };
  };

  const header = (timestamp: number) => ({ authorization: `Signature 0xabc_${timestamp}` });

  it("returns a cached wallet while the signature is still inside the age window", async () => {
    const { auth, verify } = build(vi.fn().mockResolvedValue({ walletAddress: WALLET, verifiedAt: 1 }));
    const out = await auth.detect(header(NOW - 10), "mainnet");
    expect(out).toMatchObject({ type: "signature", walletAddress: WALLET, signature: `0xabc_${NOW - 10}` });
    expect(verify).not.toHaveBeenCalled();
  });

  it("accepts a cached millisecond timestamp that is still fresh", async () => {
    const { auth, verify } = build(vi.fn().mockResolvedValue({ walletAddress: WALLET, verifiedAt: 1 }));
    const timestamp = (NOW - 10) * 1000;
    const out = await auth.detect(header(timestamp), "mainnet");
    expect(out).toMatchObject({ type: "signature", walletAddress: WALLET });
    expect(verify).not.toHaveBeenCalled();
  });

  it("rejects a cached signature older than SIGNATURE_MAX_AGE_SECONDS", async () => {
    const { auth, verify } = build(vi.fn().mockResolvedValue({ walletAddress: WALLET, verifiedAt: 1 }));
    const out = await auth.detect(header(NOW - env.SIGNATURE_MAX_AGE_SECONDS - 1), "mainnet");
    expect(out).toMatchObject({ type: "none", authError: { code: "SIGNATURE_EXPIRED" } });
    expect(verify).not.toHaveBeenCalled();
  });

  it("rejects a cached signature dated too far ahead", async () => {
    const { auth, verify } = build(vi.fn().mockResolvedValue({ walletAddress: WALLET, verifiedAt: 1 }));
    const out = await auth.detect(header(NOW + 301), "mainnet");
    expect(out).toMatchObject({ type: "none", authError: { code: "SIGNATURE_EXPIRED" } });
    expect(verify).not.toHaveBeenCalled();
  });

  it("caches a new verification for the seconds left before the signature expires", async () => {
    const { auth, setJson } = build(vi.fn().mockResolvedValue(null));
    const ageLeft = 15;
    const out = await auth.detect(header(NOW - env.SIGNATURE_MAX_AGE_SECONDS + ageLeft), "mainnet");
    expect(out).toMatchObject({ type: "signature", walletAddress: WALLET });
    expect(setJson).toHaveBeenCalledWith(
      expect.stringContaining("auth:signature-verified:"),
      expect.objectContaining({ walletAddress: WALLET, verifiedAt: NOW }),
      Math.min(env.AUTH_VERIFY_CACHE_TTL_SECONDS, ageLeft),
    );
  });

  it("caches a millisecond timestamp using the seconds that remain", async () => {
    const { auth, setJson } = build(vi.fn().mockResolvedValue(null));
    const ageLeft = 20;
    const timestamp = (NOW - env.SIGNATURE_MAX_AGE_SECONDS + ageLeft) * 1000;
    await auth.detect(header(timestamp), "mainnet");
    expect(setJson).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ walletAddress: WALLET }),
      Math.min(env.AUTH_VERIFY_CACHE_TTL_SECONDS, ageLeft),
    );
  });

  it("skips the cache when the signature is already at the end of its age window", async () => {
    const { auth, setJson } = build(vi.fn().mockResolvedValue(null));
    const out = await auth.detect(header(NOW - env.SIGNATURE_MAX_AGE_SECONDS), "mainnet");
    expect(out).toMatchObject({ type: "signature", walletAddress: WALLET });
    expect(setJson).not.toHaveBeenCalled();
  });
});
