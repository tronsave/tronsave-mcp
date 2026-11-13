import { NETWORK_ENDPOINTS, REDIS_KEYS, type Network } from "../config/constants";
import { env } from "../config/env";
import { TronWeb } from "tronweb";
import { AppError } from "../utils/errors";
import { getUnixTimestamp } from "../utils/time";
import { RedisService } from "./redisService";
import { getRequestContext } from "../handlers/authContext";

/** Stored when issuing a timestamp nonce via `createSignMessage`; `walletAddress` reserved for future binding. */
export interface SignMessageNonceRecord {
  walletAddress: null;
  createdAt: number;
}

/**
 * Optional injector for tests — avoids spinning real TronWeb crypto during unit tests.
 * Production omits this and uses AsyncLocalStorage network + full node endpoints.
 */
export type SignatureVerifyInjector = {
  verifyMessageV2: (message: string, signature: string) => Promise<string | boolean | null>;
};

/** Tolerated clock skew for timestamps slightly ahead of the server clock. */
const FUTURE_SKEW_SECONDS = 300;

const tronWebByNetwork: Record<Network, TronWeb> = {
  mainnet: new TronWeb({
    // verifyMessageV2 runs locally; fullHost is still required by TronWeb constructor.
    fullHost: NETWORK_ENDPOINTS.mainnet.tronFullNodeUrl,
  }),
  testnet: new TronWeb({
    fullHost: NETWORK_ENDPOINTS.testnet.tronFullNodeUrl,
  }),
};

const resolveTronWebFromContext = (): TronWeb => {
  const network = getRequestContext()?.network ?? "mainnet";
  return tronWebByNetwork[network];
};

/** Splits `<signature>_<timestamp>` (optionally prefixed with `Signature `). */
export const parseSignatureToken = (raw: string): { signature: string; timestamp: number; token: string } | null => {
  const token = raw.replace(/^Signature\s+/i, "").trim();
  const match = token.match(/^(.+)_([0-9]+)$/);
  if (!match) {
    return null;
  }
  const signature = match[1].trim();
  const timestamp = Number(match[2]);
  if (!signature || !Number.isSafeInteger(timestamp) || timestamp <= 0) {
    return null;
  }
  return { signature, timestamp, token };
};

export class SignatureService {
  constructor(
    private readonly redisService: RedisService,
    private readonly verifyInjector?: SignatureVerifyInjector,
  ) {}

  /** Hex-encode UTF-8 string char codes (legacy format matching prior server behavior). */
  ToHex(str: string): string {
    let result = "";
    for (let i = 0; i < str.length; i += 1) {
      result += str.charCodeAt(i).toString(16);
    }
    return result;
  }

  async createSignMessage(): Promise<{ message: string; timestamp: number }> {
    const timestamp = getUnixTimestamp();
    const messageHex = this.ToHex(timestamp.toString());
    const record: SignMessageNonceRecord = {
      walletAddress: null,
      createdAt: timestamp,
    };
    await this.redisService.setJson(
      REDIS_KEYS.signMessageByTimestamp(timestamp),
      record,
      env.SIGN_MESSAGE_TTL_SECONDS,
    );
    return { message: messageHex, timestamp };
  }

  /**
   * Validates wallet proof-of-possession for login:
   * 1) Timestamp has valid shape and is within `SIGNATURE_MAX_AGE_SECONDS` (seconds or ms accepted).
   * 2) Local signature verification over the timestamp message (hex or raw text).
   *
   * Direct signature mode does NOT require a pre-issued server nonce; the age window bounds
   * replay of a leaked signature instead (see ADR 001).
   */
  async verifyLoginSignatureByTimestamp(signature: string, timestamp: number): Promise<string> {
    if (!Number.isInteger(timestamp) || timestamp <= 0) {
      throw new AppError("Invalid timestamp", 400, "INVALID_TIMESTAMP");
    }
    this.assertTimestampFresh(timestamp);

    const recoveredAddress = await this.verifyWithRawOrHexMessage(timestamp.toString(), signature);
    if (!recoveredAddress || !TronWeb.isAddress(recoveredAddress)) {
      throw new AppError("Invalid TRON signature", 401, "INVALID_SIGNATURE", {
        retryable: false,
        hint: "Sign the exact `message` returned by `tronsave_get_sign_message` (or the decimal timestamp text) with the wallet, then send `<signature>_<timestamp>`.",
      });
    }

    return recoveredAddress;
  }

  /**
   * Rejects a signed timestamp outside `SIGNATURE_MAX_AGE_SECONDS` (Unix seconds or milliseconds).
   * Live verification and the signature verify cache both use this, so a cache hit cannot outlive
   * the signature.
   */
  assertTimestampFresh(timestamp: number): void {
    const seconds = timestamp > 1e11 ? Math.floor(timestamp / 1000) : timestamp;
    const now = getUnixTimestamp();
    if (seconds > now + FUTURE_SKEW_SECONDS || now - seconds > env.SIGNATURE_MAX_AGE_SECONDS) {
      throw new AppError("Signed timestamp is expired or in the future", 401, "SIGNATURE_EXPIRED", {
        retryable: false,
        hint: "Call `tronsave_get_sign_message` for a fresh timestamp, sign it, then call `tronsave_login` again.",
      });
    }
  }

  /**
   * Support both client signing styles: wallets that signed the hex `message` from
   * `tronsave_get_sign_message`, and wallets that signed the raw decimal timestamp text.
   */
  private async verifyWithRawOrHexMessage(message: string, signature: string): Promise<string | null> {
    for (const candidate of [this.ToHex(message), message]) {
      const recovered = await this.recover(candidate, signature);
      if (recovered) {
        return recovered;
      }
    }
    return null;
  }

  private async recover(message: string, signature: string): Promise<string | null> {
    try {
      const recovered = this.verifyInjector
        ? await this.verifyInjector.verifyMessageV2(message, signature)
        : await resolveTronWebFromContext().trx.verifyMessageV2(message, signature);
      return typeof recovered === "string" && TronWeb.isAddress(recovered) ? recovered : null;
    } catch {
      // Malformed signatures make TronWeb throw; treat as "not this message format".
      return null;
    }
  }
}
