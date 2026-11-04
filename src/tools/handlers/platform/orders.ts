import type { HelperApi } from "../helper";
import { ok } from "../../../utils/response";
import { getRequestContext } from "../../../handlers/authContext";
import { AppError } from "../../../utils/errors";
import { stripUndefinedDeep } from "../../../utils/object";
import { OrderCreateAdapter, type OrderCreateMutationData } from "../../adapters/platform/orderCreateAdapter";
import {
  orderCancelInputSchema,
  orderCreateInputSchema,
  orderDetailInputSchema,
  orderSellManualInputSchema,
  orderUpdateInputSchema,
  ordersHistoryInputSchema,
} from "../../definitions/platform/schema";
import { TOOL_NAMES } from "../../toolNames";
import z from "zod";
import {
  ORDER_CANCEL_MUTATION,
  ORDER_CREATE_MUTATION,
  ORDER_DETAIL_QUERY,
  ORDER_SELL_MANUAL_MUTATION,
  ORDER_UPDATE_MUTATION,
  ORDERS_LIST_QUERY,
} from "./gql/orders";
import type {
  OrderCancelMutationData,
  OrderDetailQueryData,
  OrdersListQueryData,
  OrderSellManualMutationData,
  OrderUpdateMutationData,
} from "./types/orders";

type OrderCreateParsed = z.infer<typeof orderCreateInputSchema>;
type OrderSellManualParsed = z.infer<typeof orderSellManualInputSchema>;
type OrderCancelParsed = z.infer<typeof orderCancelInputSchema>;
type OrderUpdateParsed = z.infer<typeof orderUpdateInputSchema>;
type OrderDetailParsed = z.infer<typeof orderDetailInputSchema>;
type OrdersListParsed = z.infer<typeof ordersHistoryInputSchema>;

export function createOrderHandlers(helper: HelperApi) {
  const { fetchGraphqlApi } = helper;
  const orderCreateAdapter = new OrderCreateAdapter();

  const runOrderCreateMutation = async (
    variables: Record<string, unknown>,
    toolName: typeof TOOL_NAMES.PLATFORM.ORDER_CREATE,
    options: { requireSessionApiKey?: boolean } = {},
  ) => {
    const gqlResponse = await fetchGraphqlApi(ORDER_CREATE_MUTATION, variables, {}, toolName, options);
    const root = gqlResponse.data as OrderCreateMutationData;
    return orderCreateAdapter.toToolOutput(root);
  };

  const orderDetailHandler = async (input: Record<string, unknown>) => {
    const parsed: OrderDetailParsed = orderDetailInputSchema.parse(input);
    const variables = stripUndefinedDeep({ id: parsed.id }) as Record<string, unknown>;
    const gqlResponse = await fetchGraphqlApi(ORDER_DETAIL_QUERY, variables, {}, TOOL_NAMES.PLATFORM.ORDER_DETAIL);
    const root = gqlResponse.data as OrderDetailQueryData;
    return ok({ order: root.order ?? null });
  };

  const ordersListHandler = async (input: Record<string, unknown>) => {
    const parsed: OrdersListParsed = ordersHistoryInputSchema.parse(input);
    const isMatching = parsed.status === "ACTIVE" ? true : parsed.status === "COMPLETED" ? false : undefined;

    let myAddress: string | undefined;
    let isOwner: boolean | undefined;
    if (parsed.isOnlyMyOrder) {
      const walletAddress = getRequestContext()?.auth.walletAddress;
      if (!walletAddress) {
        throw new AppError(
          "`onlyMyOrder` needs a signature session with a wallet address: call `tronsave_get_sign_message` → `tronsave_login`, then pass `mcp-session-id`. Pure api-key sessions have no `walletAddress` for this filter.",
          401,
          "LIST_ORDERS_MY_ADDRESS_REQUIRED",
        );
      }
      myAddress = walletAddress;
      isOwner = true;
    }

    const variables = stripUndefinedDeep({
      offset: parsed.offset,
      limit: parsed.limit,
      resourceType: parsed.resourceType,
      isMatching,
      myAddress,
      isOwner,
    }) as Record<string, unknown>;

    const gqlResponse = await fetchGraphqlApi(ORDERS_LIST_QUERY, variables, {}, TOOL_NAMES.PLATFORM.LIST_ORDERS);
    const root = gqlResponse.data as OrdersListQueryData;
    return ok({ orders: root.orders ?? [] });
  };

  const orderCreateHandler = async (input: Record<string, unknown>) => {
    const parsed: OrderCreateParsed = orderCreateInputSchema.parse(input);
    const paymentTypeMap = { onchain: "ONCHAIN", internal: "INTERNAL" } as const;
    const variables = orderCreateAdapter.toVariablesFromUnifiedInput(parsed, paymentTypeMap[parsed.paymentMethod]);
    const payload = await runOrderCreateMutation(variables, TOOL_NAMES.PLATFORM.ORDER_CREATE, {
      requireSessionApiKey: parsed.paymentMethod === "internal",
    });
    return ok(payload);
  };

  const orderSellManualHandler = async (input: Record<string, unknown>) => {
    const parsed: OrderSellManualParsed = orderSellManualInputSchema.parse(input);
    const variables = { sellManualInput: stripUndefinedDeep(parsed) } as Record<string, unknown>;
    const gqlResponse = await fetchGraphqlApi(
      ORDER_SELL_MANUAL_MUTATION,
      variables,
      {},
      TOOL_NAMES.PLATFORM.ORDER_SELL_MANUAL,
      { requireSignature: true },
    );
    const root = gqlResponse.data as OrderSellManualMutationData;
    const payload = root.orders?.sell;
    if (!payload) {
      throw new AppError("GraphQL response missing orders.sell", 502, "ORDER_SELL_MANUAL_EMPTY");
    }
    return ok(payload);
  };

  const orderCancelHandler = async (input: Record<string, unknown>) => {
    const parsed: OrderCancelParsed = orderCancelInputSchema.parse(input);
    const gqlResponse = await fetchGraphqlApi(
      ORDER_CANCEL_MUTATION,
      { orderId: parsed.orderId },
      {},
      TOOL_NAMES.PLATFORM.ORDER_CANCEL,
      { requireSignature: true },
    );
    const root = gqlResponse.data as OrderCancelMutationData;
    const payload = root.orders?.cancel;
    if (!payload) {
      throw new AppError("GraphQL response missing orders.cancel", 502, "ORDER_CANCEL_EMPTY");
    }
    return ok(payload);
  };

  const orderUpdateHandler = async (input: Record<string, unknown>) => {
    const parsed: OrderUpdateParsed = orderUpdateInputSchema.parse(input);
    const variables = stripUndefinedDeep(parsed) as Record<string, unknown>;
    const gqlResponse = await fetchGraphqlApi(
      ORDER_UPDATE_MUTATION,
      variables,
      {},
      TOOL_NAMES.PLATFORM.ORDER_UPDATE,
      { requireSignature: true },
    );
    const root = gqlResponse.data as OrderUpdateMutationData;
    const payload = root.orders?.update;
    if (!payload) {
      throw new AppError("GraphQL response missing orders.update", 502, "ORDER_UPDATE_EMPTY");
    }
    return ok(payload);
  };

  return {
    orderDetailHandler,
    ordersListHandler,
    orderCreateHandler,
    orderSellManualHandler,
    orderCancelHandler,
    orderUpdateHandler,
  };
}
