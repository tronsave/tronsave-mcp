import type { HelperApi } from "../helper";
import { ok } from "../../../utils/response";
import { getRequestContext } from "../../../handlers/authContext";
import { AppError } from "../../../utils/errors";
import { stripUndefinedDeep } from "../../../utils/object";
import {
  registerAutoSellInputSchema,
  updateAutoSellSettingInputSchema,
} from "../../definitions/platform/schema";
import { TOOL_NAMES } from "../../toolNames";
import z from "zod";
import { REGISTER_AUTO_SELL_MUTATION, UPDATE_AUTO_SELL_SETTING_MUTATION } from "./gql/autoSell";
import type { RegisterAutoSellMutationData, UpdateAutoSellSettingMutationData } from "./types/autoSell";

type AutoSellSettingMutationParsed = z.infer<typeof registerAutoSellInputSchema>;

export function createAutoSellHandlers(helper: HelperApi) {
  const { fetchGraphqlApi } = helper;

  const registerAutoSellHandler = async (input: Record<string, unknown>) => {
    const requestContext = getRequestContext();
    const address = requestContext?.auth.walletAddress;
    if (!address) {
      throw new AppError("Missing wallet address in signature session", 401, "MISSING_SESSION_ADDRESS");
    }

    const parsed: AutoSellSettingMutationParsed = registerAutoSellInputSchema.parse(input);
    const variables = stripUndefinedDeep(parsed) as Record<string, unknown>;
    const gqlResponse = await fetchGraphqlApi(
      REGISTER_AUTO_SELL_MUTATION,
      variables,
      {},
      TOOL_NAMES.PLATFORM.REGISTER_AUTO_SELL,
      { requireSignature: true },
    );
    const root = gqlResponse.data as RegisterAutoSellMutationData;
    const payload = root.users?.registerAutoSell;
    if (!payload) {
      throw new AppError("GraphQL response missing users.registerAutoSell", 502, "REGISTER_AUTO_SELL_EMPTY");
    }
    return ok(payload);
  };

  const updateAutoSellSettingHandler = async (input: Record<string, unknown>) => {
    const requestContext = getRequestContext();
    const address = requestContext?.auth.walletAddress;
    if (!address) {
      throw new AppError("Missing wallet address in signature session", 401, "MISSING_SESSION_ADDRESS");
    }

    const parsed: AutoSellSettingMutationParsed = updateAutoSellSettingInputSchema.parse(input);
    const variables = stripUndefinedDeep(parsed) as Record<string, unknown>;
    const gqlResponse = await fetchGraphqlApi(
      UPDATE_AUTO_SELL_SETTING_MUTATION,
      variables,
      {},
      TOOL_NAMES.PLATFORM.UPDATE_AUTO_SELL_SETTING,
      { requireSignature: true },
    );
    const root = gqlResponse.data as UpdateAutoSellSettingMutationData;
    const payload = root.users?.updateAutoSellSetting;
    if (!payload) {
      throw new AppError("GraphQL response missing users.updateAutoSellSetting", 502, "UPDATE_AUTO_SELL_SETTING_EMPTY");
    }
    return ok(payload);
  };

  return {
    registerAutoSellHandler,
    updateAutoSellSettingHandler,
  };
}
