import type { AuthContext } from "../schemas/auth";

const maskValue = (value: string, visibleHead = 6, visibleTail = 4): string => {
  if (value.length <= visibleHead + visibleTail) {
    return value;
  }
  const head = value.slice(0, visibleHead);
  const tail = value.slice(-visibleTail);
  return `${head}...${tail}`;
};

/** Masks a credential for display (`abcd…xyz`); short values are fully hidden. */
export const maskSecret = (value: string): string =>
  value.length <= 10 ? "****" : `${value.slice(0, 4)}…${value.slice(-3)}`;

export interface RequestIdentityLog {
  authType: AuthContext["type"];
  sessionAuthType?: "signature" | "api-key";
  sessionId?: string;
  walletAddress?: string;
  apiKeyHint?: string;
}

/**
 * Build a safe log identity payload without exposing full credentials.
 */
export const toRequestIdentityLog = (auth: AuthContext): RequestIdentityLog => {
  if (auth.type === "none") {
    return { authType: "none" };
  }

  if (auth.type === "signature") {
    return {
      authType: "signature",
      walletAddress: auth.walletAddress ? maskValue(auth.walletAddress, 7, 5) : undefined,
    };
  }

  if (auth.type === "apiKey") {
    return {
      authType: "apiKey",
      apiKeyHint: auth.apiKey ? maskValue(auth.apiKey, 4, 3) : undefined,
    };
  }

  return {
    authType: "session",
    sessionAuthType: auth.sessionAuthType,
    sessionId: auth.sessionId ? maskValue(auth.sessionId, 8, 6) : undefined,
    walletAddress: auth.walletAddress ? maskValue(auth.walletAddress, 7, 5) : undefined,
    apiKeyHint: auth.sessionAuthType === "api-key" && auth.apiKey ? maskValue(auth.apiKey, 4, 3) : undefined,
  };
};
