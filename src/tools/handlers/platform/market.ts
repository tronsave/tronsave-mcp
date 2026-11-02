import type { HelperApi } from "../helper";
import { ok } from "../../../utils/response";
import { getRequestContext } from "../../../handlers/authContext";
import { AppError } from "../../../utils/errors";
import { stripUndefinedDeep } from "../../../utils/object";
import {
  extendableDelegatesInputSchema,
  estimateBuyResourceInputSchema,
  getMinPriceInputSchema,
  orderBookInputSchema,
} from "../../definitions/platform/schema";
import { TOOL_NAMES } from "../../toolNames";
import z from "zod";
import {
  EXTENDABLE_DELEGATES_QUERY,
  GET_MIN_PRICE_QUERY,
  GET_SYSTEM_DEPOSIT_ADDRESS_QUERY,
  ORDER_BOOK_QUERY,
} from "./gql/market";
import type {
  EstimateMinPriceQueryData,
  ExtendableDelegatesQueryData,
  OrderBookQueryData,
} from "./types/market";

type OrderBookParsed = z.infer<typeof orderBookInputSchema>;
type EstimateMinPriceParsed = z.infer<typeof getMinPriceInputSchema>;
type ExtendableDelegatesParsed = z.infer<typeof extendableDelegatesInputSchema>;

export function createMarketHandlers(helper: HelperApi) {
  const { fetchApiInternal, fetchGraphqlApi } = helper;

  const fetchMarketEstimateMinPriceSun = async (
    params: {
      address?: string;
      resourceType: "ENERGY" | "BANDWIDTH";
      buyAmount: number;
      durationSec: number;
    },
    toolNameForLogs: string,
    emptyErrorCode: string,
  ): Promise<number> => {
    const variables = stripUndefinedDeep({
      address: params.address,
      resourceType: params.resourceType,
      buyAmount: params.buyAmount,
      durationSec: params.durationSec,
    }) as Record<string, unknown>;
    const gqlResponse = await fetchGraphqlApi(GET_MIN_PRICE_QUERY, variables, {}, toolNameForLogs);
    const root = gqlResponse.data as EstimateMinPriceQueryData;
    const raw = root.market?.estimateMinPrice;
    if (raw === null || raw === undefined || Number.isNaN(Number(raw))) {
      throw new AppError(
        "estimateMinPrice returned no numeric value. Check inputs or try again.",
        502,
        emptyErrorCode,
      );
    }
    return Number(raw);
  };

  const estimateBuyEnergyHandler = async (input: Record<string, unknown>) => {
    const parsed = estimateBuyResourceInputSchema.parse(input);
    const requester = getRequestContext()?.auth.walletAddress;
    const resourceType = parsed.resourceType;
    const durationSec = parsed.durationSec ?? 900;
    const buyResourceAmount = parsed.buyResourceAmount ?? (resourceType === "ENERGY" ? 100000 : 1000);

    let unitPrice: number | string = parsed.unitPrice ?? "MEDIUM";
    if (typeof parsed.unitPrice === "number" && Number.isFinite(parsed.unitPrice)) {
      const minPriceSun = await fetchMarketEstimateMinPriceSun(
        {
          address: requester,
          resourceType,
          buyAmount: buyResourceAmount,
          durationSec,
        },
        TOOL_NAMES.PLATFORM.ESTIMATE_BUY_RESOURCE,
        "ESTIMATE_BUY_RESOURCE_MIN_PRICE_EMPTY",
      );
      if (parsed.unitPrice < minPriceSun) {
        unitPrice = minPriceSun;
      }
    }

    const body = {
      resourceAmount: buyResourceAmount,
      resourceType,
      durationSec,
      unitPrice,
      requester,
      receiver: parsed.receiver,
      options: {
        allowPartialFill: parsed.allowPartialFill,
        minResourceDelegateRequiredAmount: parsed.minResourceDelegateRequiredAmount,
      },
    };

    const [systemDepositAddressResponse, estimateBuyResourceResponse] = await Promise.all([
      fetchGraphqlApi(GET_SYSTEM_DEPOSIT_ADDRESS_QUERY, {}, {}, TOOL_NAMES.PLATFORM.ESTIMATE_BUY_RESOURCE),
      fetchApiInternal("/v2/estimate-buy-resource", TOOL_NAMES.PLATFORM.ESTIMATE_BUY_RESOURCE, {
        method: "POST",
        body: stripUndefinedDeep(body) as Record<string, unknown>,
        requireSessionAuth: false,
        idempotent: true,
      }),
    ]);

    const systemDepositAddress =
      (systemDepositAddressResponse.data.system as { systemDepositAddress?: string | null } | null | undefined)
        ?.systemDepositAddress ?? null;
    const estimateBody =
      estimateBuyResourceResponse !== null && typeof estimateBuyResourceResponse === "object"
        ? (estimateBuyResourceResponse as Record<string, unknown>)
        : {};
    return ok({
      ...estimateBody,
      systemDepositAddress,
    });
  };

  const orderBookHandler = async (input: Record<string, unknown>) => {
    const parsed: OrderBookParsed = orderBookInputSchema.parse(input);
    const variables = stripUndefinedDeep(parsed) as Record<string, unknown>;
    const gqlResponse = await fetchGraphqlApi(ORDER_BOOK_QUERY, variables, {}, TOOL_NAMES.PLATFORM.ORDER_BOOK);
    const root = gqlResponse.data as OrderBookQueryData;
    return ok({ orderBook: root.market?.orderBook ?? [] });
  };

  const getMinPriceHandler = async (input: Record<string, unknown>) => {
    const parsed: EstimateMinPriceParsed = getMinPriceInputSchema.parse(input);
    const minPrice = await fetchMarketEstimateMinPriceSun(
      {
        address: parsed.address,
        resourceType: parsed.resourceType,
        buyAmount: parsed.buyAmount ?? (parsed.resourceType === "ENERGY" ? 100000 : 1000),
        durationSec: parsed.durationSec ?? 900,
      },
      TOOL_NAMES.PLATFORM.GET_MIN_PRICE,
      "GET_MIN_PRICE_EMPTY",
    );
    return ok({ minPrice });
  };

  const extendableDelegatesHandler = async (input: Record<string, unknown>) => {
    const parsed: ExtendableDelegatesParsed = extendableDelegatesInputSchema.parse(input);
    const variables = stripUndefinedDeep(parsed) as Record<string, unknown>;
    const gqlResponse = await fetchGraphqlApi(
      EXTENDABLE_DELEGATES_QUERY,
      variables,
      {},
      TOOL_NAMES.PLATFORM.EXTENDABLE_DELEGATES_GET,
    );
    const root = gqlResponse.data as ExtendableDelegatesQueryData;
    return ok({ extendableDelegates: root.market?.extendableDelegates ?? null });
  };

  return {
    estimateBuyEnergyHandler,
    orderBookHandler,
    getMinPriceHandler,
    extendableDelegatesHandler,
  };
}
