import { describe, expect, it, vi } from "vitest";

/**
 * `tron.ts` proxies `TronWeb.isAddress` and `Trx.verifyMessageV2` so we mock the
 * `tronweb` module directly. This keeps the test fast and deterministic — no
 * cryptographic recovery is exercised here, just the wrapper contract.
 */
/**
 * `vi.mock()` is hoisted by Vitest so any references inside the factory must resolve at hoist time.
 * We inline the address constants in the factory and re-declare them below for the assertions.
 */
vi.mock("tronweb", () => {
  const VALID = "T1234567890ABCDEFGHIJKLMNOPQRSTUVW"; // 34 chars, starts with T
  const OTHER = "TZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ";
  return {
    TronWeb: {
      isAddress: (addr: string) => typeof addr === "string" && addr.startsWith("T") && addr.length === 34,
    },
    Trx: {
      verifyMessageV2: (_message: string, signature: string) => {
        if (signature === "good") {
          return VALID;
        }
        if (signature === "mismatch") {
          return OTHER;
        }
        return null;
      },
    },
  };
});

import { assertValidTronAddress, validateTronAddress, verifyTronSignature } from "../../src/utils/tron";
import { AppError } from "../../src/utils/errors";

const VALID_ADDRESS = "T1234567890ABCDEFGHIJKLMNOPQRSTUVW";

describe("validateTronAddress", () => {
  it("returns true for syntactically valid address", () => {
    expect(validateTronAddress(VALID_ADDRESS)).toBe(true);
  });

  it("returns false for clearly invalid string", () => {
    expect(validateTronAddress("not-a-tron-address")).toBe(false);
  });
});

describe("assertValidTronAddress", () => {
  it("does not throw for valid address", () => {
    expect(() => assertValidTronAddress(VALID_ADDRESS)).not.toThrow();
  });

  it("throws AppError with INVALID_TRON_ADDRESS for invalid address", () => {
    try {
      assertValidTronAddress("bad");
      expect.fail("expected to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("INVALID_TRON_ADDRESS");
      expect((error as AppError).statusCode).toBe(400);
    }
  });
});

describe("verifyTronSignature", () => {
  it("returns true when recovered address matches", () => {
    expect(verifyTronSignature("any-message", "good", VALID_ADDRESS)).toBe(true);
  });

  it("returns false when recovered address differs", () => {
    expect(verifyTronSignature("any-message", "mismatch", VALID_ADDRESS)).toBe(false);
  });

  it("returns false when recovery yields no address", () => {
    expect(verifyTronSignature("any-message", "bad", VALID_ADDRESS)).toBe(false);
  });
});
