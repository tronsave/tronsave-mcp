import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { TronWeb } from "tronweb";
import { SignatureService } from "../../src/services/signatureService";
import type { RedisService } from "../../src/services/redisService";
import * as time from "../../src/utils/time";
import * as authContext from "../../src/handlers/authContext";

const WALLET = "TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9";
const NOW = 1_700_000_000;

describe("SignatureService.verifyLoginSignatureByTimestamp", () => {
  beforeEach(() => {
    vi.spyOn(TronWeb, "isAddress").mockReturnValue(true);
    vi.spyOn(time, "getUnixTimestamp").mockReturnValue(NOW + 60);
    vi.spyOn(authContext, "getRequestContext").mockReturnValue({
      headers: {},
      auth: { type: "none" },
      network: "mainnet",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path returns wallet address without nonce consumption", async () => {
    const setJson = vi.fn().mockResolvedValue(undefined);
    const getDel = vi.fn();

    const redis = { setJson, getDel } as unknown as RedisService;

    const svc = new SignatureService(redis, {
      verifyMessageV2: vi.fn().mockResolvedValue(WALLET),
    });

    const addr = await svc.verifyLoginSignatureByTimestamp("sig bytes", 1_700_000_000);
    expect(addr).toBe(WALLET);
    expect(getDel).not.toHaveBeenCalled();
  });

  it("repeated verification with same timestamp remains valid when signature is valid", async () => {
    const getDel = vi.fn();

    const redis = {
      setJson: vi.fn(),
      getDel,
    } as unknown as RedisService;

    const svc = new SignatureService(redis, {
      verifyMessageV2: vi.fn().mockResolvedValue(WALLET),
    });

    await expect(svc.verifyLoginSignatureByTimestamp("sig bytes", 1_700_000_000)).resolves.toBe(WALLET);
    await expect(svc.verifyLoginSignatureByTimestamp("sig bytes", 1_700_000_000)).resolves.toBe(WALLET);
    expect(getDel).not.toHaveBeenCalled();
  });

  it("createSignMessage stores nonce in Redis with ttl key pattern", async () => {
    vi.spyOn(time, "getUnixTimestamp").mockReturnValue(1_700_000_100);

    const setJson = vi.fn().mockResolvedValue(undefined);
    const redis = { setJson, getDel: vi.fn() } as unknown as RedisService;

    const svc = new SignatureService(redis);
    const out = await svc.createSignMessage();

    expect(out.timestamp).toBe(1_700_000_100);
    expect(setJson).toHaveBeenCalledWith(
      "auth:sign-message:timestamp:1700000100",
      { walletAddress: null, createdAt: 1_700_000_100 },
      expect.any(Number),
    );
  });
});

describe("SignatureService freshness and message formats", () => {
  beforeEach(() => {
    vi.spyOn(TronWeb, "isAddress").mockImplementation((value: unknown) => value === WALLET);
    vi.spyOn(time, "getUnixTimestamp").mockReturnValue(NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const redis = { setJson: vi.fn(), getDel: vi.fn() } as unknown as RedisService;

  it("rejects timestamps older than SIGNATURE_MAX_AGE_SECONDS", async () => {
    const svc = new SignatureService(redis, { verifyMessageV2: vi.fn().mockResolvedValue(WALLET) });
    await expect(svc.verifyLoginSignatureByTimestamp("sig", NOW - 2 * 86_400)).rejects.toMatchObject({
      code: "SIGNATURE_EXPIRED",
    });
  });

  it("rejects timestamps far in the future", async () => {
    const svc = new SignatureService(redis, { verifyMessageV2: vi.fn().mockResolvedValue(WALLET) });
    await expect(svc.verifyLoginSignatureByTimestamp("sig", NOW + 3_600)).rejects.toMatchObject({
      code: "SIGNATURE_EXPIRED",
    });
  });

  it("accepts millisecond timestamps", async () => {
    const svc = new SignatureService(redis, { verifyMessageV2: vi.fn().mockResolvedValue(WALLET) });
    await expect(svc.verifyLoginSignatureByTimestamp("sig", NOW * 1000)).resolves.toBe(WALLET);
  });

  it("falls back to the raw decimal message when the hex message does not verify", async () => {
    const verifyMessageV2 = vi.fn(async (message: string) => (message === String(NOW) ? WALLET : "Tother"));
    const svc = new SignatureService(redis, { verifyMessageV2 });
    await expect(svc.verifyLoginSignatureByTimestamp("sig", NOW)).resolves.toBe(WALLET);
    expect(verifyMessageV2).toHaveBeenCalledTimes(2);
  });

  it("returns INVALID_SIGNATURE when neither format verifies", async () => {
    const svc = new SignatureService(redis, { verifyMessageV2: vi.fn().mockRejectedValue(new Error("bad sig")) });
    await expect(svc.verifyLoginSignatureByTimestamp("sig", NOW)).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
  });
});

describe("SignatureService errors", () => {
  it("maps invalid timestamp parameter", async () => {
    const redis = { setJson: vi.fn(), getDel: vi.fn() } as unknown as RedisService;
    const svc = new SignatureService(redis);
    await expect(svc.verifyLoginSignatureByTimestamp("x", 1.5)).rejects.toMatchObject({
      code: "INVALID_TIMESTAMP",
    });
  });
});
