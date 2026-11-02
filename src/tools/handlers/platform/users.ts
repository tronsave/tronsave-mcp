import type { AppContainer } from "../../../app/container";
import type { HelperApi } from "../helper";
import { EmptyInputSchema } from "../../definitions/shares";
import { TOOL_NAMES } from "../../toolNames";
import { AppError } from "../../../utils/errors";
import { getRequestContext } from "../../../handlers/authContext";
import { REDIS_KEYS } from "../../../config/constants";
import { sha256Hex } from "../../../utils/crypto";
import { maskSecret } from "../../../utils/requestIdentity";
import { ok } from "../../../utils/response";
import type { ToolInput } from "../../definitions/definition_type";
import { deleteAutoBuySettingInputSchema } from "../../definitions/platform/schema";
import {
  DELETE_AUTO_BUY_SETTING_MUTATION,
  GENERATE_API_KEY_MUTATION,
  REVOKE_API_KEY_MUTATION,
  USER_AUTO_SETTING_QUERY,
  USER_INFO_QUERY,
  USER_PERMISSIONS_QUERY,
} from "./gql/users";
import type {
  DeleteAutoBuySettingMutationData,
  GenerateApiKeyMutationData,
  RevokeApiKeyMutationData,
} from "./types/users";

export function createUserHandlers(deps: AppContainer, helper: HelperApi) {
  const { redisService } = deps;
  const { fetchGraphqlApi } = helper;

  const getUserInfoHandler = async (input: ToolInput) => {
    void input;
    const requestContext = getRequestContext();
    const address = requestContext?.auth.walletAddress;
    if (!address) {
      throw new AppError("Missing wallet address in signature session", 401, "MISSING_SESSION_ADDRESS");
    }
    const userInfoResponse = (await fetchGraphqlApi(
      USER_INFO_QUERY,
      {},
      {},
      TOOL_NAMES.PLATFORM.USER_INFO_GET,
      { requireSignature: true },
    )) as { data: { user?: Record<string, unknown> | null } };
    const rawUser = userInfoResponse.data.user ?? {};
    // Backend GraphQL keeps `internalAcc` as the wire field; the MCP tool exposes
    // `internalAccount` for clarity. Map here without mutating the upstream query
    // (changing the query name would break the API contract).
    const { internalAcc, ...rest } = rawUser as Record<string, unknown>;
    const internalAccount = (internalAcc ?? null) as Record<string, unknown> | null;
    return ok({
      ...rest,
      // Never echo the raw internal API key into the model context; the session already holds it.
      internalAccount:
        internalAccount && typeof internalAccount.apiKey === "string"
          ? { ...internalAccount, apiKey: maskSecret(internalAccount.apiKey) }
          : internalAccount,
    });
  };

  const getUserAutoSettingHandler = async (input: ToolInput) => {
    void input;
    const requestContext = getRequestContext();
    const address = requestContext?.auth.walletAddress;
    if (!address) {
      throw new AppError("Missing wallet address in signature session", 401, "MISSING_SESSION_ADDRESS");
    }
    const response = (await fetchGraphqlApi(
      USER_AUTO_SETTING_QUERY,
      {},
      {},
      TOOL_NAMES.PLATFORM.USER_AUTO_SETTING_GET,
      { requireSignature: true },
    )) as { data: { user?: { autoSettings?: unknown } } };
    return ok(response.data.user?.autoSettings ?? {});
  };

  const getUserPermissionsHandler = async (input: ToolInput) => {
    void input;
    const requestContext = getRequestContext();
    const address = requestContext?.auth.walletAddress;
    if (!address) {
      throw new AppError("Missing wallet address in signature session", 401, "MISSING_SESSION_ADDRESS");
    }
    const response = (await fetchGraphqlApi(
      USER_PERMISSIONS_QUERY,
      {},
      {},
      TOOL_NAMES.PLATFORM.USER_PERMISSIONS_GET,
      { requireSignature: true },
    )) as { data: { user?: { autoSettings?: { permitOperations?: unknown[] | null } | null } } };
    return ok({ permitOperations: response.data.user?.autoSettings?.permitOperations ?? [] });
  };

  const generateApiKeyHandler = async (input: Record<string, unknown>) => {
    EmptyInputSchema.parse(input ?? {});
    if (!getRequestContext()?.auth.walletAddress) {
      throw new AppError("Missing wallet address in signature session", 401, "MISSING_SESSION_ADDRESS");
    }
    const gqlResponse = (await fetchGraphqlApi(
      GENERATE_API_KEY_MUTATION,
      {},
      {},
      TOOL_NAMES.PLATFORM.GENERATE_API_KEY,
      { requireSignature: true },
    )) as { data: GenerateApiKeyMutationData };
    const payload = gqlResponse.data.users?.generateApiKey;
    if (!payload) {
      throw new AppError("GraphQL response missing users.generateApiKey", 502, "GENERATE_API_KEY_EMPTY");
    }
    return ok(payload);
  };

  const revokeApiKeyHandler = async (input: Record<string, unknown>) => {
    EmptyInputSchema.parse(input ?? {});
    const requestContext = getRequestContext();
    if (!requestContext?.auth.walletAddress) {
      throw new AppError("Missing wallet address in signature session", 401, "MISSING_SESSION_ADDRESS");
    }
    const gqlResponse = (await fetchGraphqlApi(
      REVOKE_API_KEY_MUTATION,
      {},
      {},
      TOOL_NAMES.PLATFORM.REVOKE_API_KEY,
      { requireSignature: true },
    )) as { data: RevokeApiKeyMutationData };
    const payload = gqlResponse.data.users?.revokeApiKey;
    if (!payload) {
      throw new AppError("GraphQL response missing users.revokeApiKey", 502, "REVOKE_API_KEY_EMPTY");
    }
    const apiKey = requestContext.auth.apiKey;
    if (apiKey && payload.success) {
      await redisService.delete(REDIS_KEYS.apiKeyVerified(sha256Hex(apiKey)));
    }
    return ok(payload);
  };

  const deleteAutoBuySettingHandler = async (input: Record<string, unknown>) => {
    const requestContext = getRequestContext();
    if (!requestContext?.auth.walletAddress) {
      throw new AppError("Missing wallet address in signature session", 401, "MISSING_SESSION_ADDRESS");
    }
    const parsed = deleteAutoBuySettingInputSchema.parse(input);
    const gqlResponse = (await fetchGraphqlApi(
      DELETE_AUTO_BUY_SETTING_MUTATION,
      { id: parsed.id },
      {},
      TOOL_NAMES.PLATFORM.DELETE_AUTO_BUY_SETTING,
      { requireSignature: true, requireSessionApiKey: true },
    )) as { data: DeleteAutoBuySettingMutationData };
    const payload = gqlResponse.data.users?.deleteAutoBuySetting;
    if (!payload) {
      throw new AppError("GraphQL response missing users.deleteAutoBuySetting", 502, "DELETE_AUTO_BUY_SETTING_EMPTY");
    }
    return ok(payload);
  };

  return {
    getUserInfoHandler,
    getUserAutoSettingHandler,
    getUserPermissionsHandler,
    generateApiKeyHandler,
    revokeApiKeyHandler,
    deleteAutoBuySettingHandler,
  };
}
