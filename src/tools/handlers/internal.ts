import { ok } from "../../utils/response";
import type { HelperApi } from "./helper";
import type { ToolInput } from "../definitions/definition_type";
import { TOOL_NAMES } from "../toolNames";
import { maskSecret } from "../../utils/requestIdentity";

type InternalQuery = Record<string, string | number | boolean | undefined>;

/**
 * Internal REST-backed tools share one `fetchApiInternal` bound to the composition-root clients.
 */
export function createInternalHandlers(helper: HelperApi) {
  const { fetchApiInternal } = helper;

  const getInternalAccountHandler = async (input: ToolInput) => {
    void input;
    const response = await fetchApiInternal<Record<string, unknown> | null>(
      "/v2/user-info",
      TOOL_NAMES.INTERNAL.INTERNAL_ACCOUNT_GET,
      { method: "GET" },
    );
    const account = response ?? {};
    // Never echo the raw internal API key back into the model context.
    return ok(typeof account.apiKey === "string" ? { ...account, apiKey: maskSecret(account.apiKey) } : account);
  };

  const getDepositAddressHandler = async (input: ToolInput) => {
    const response = await fetchApiInternal<{ depositAddress?: string } | null>(
      "/v2/user-info",
      TOOL_NAMES.INTERNAL.GET_DEPOSIT_ADDRESS,
      { method: "GET" },
    );
    return ok({
      depositAddress: response?.depositAddress ?? null,
      amountTrx: input.amountTrx,
      minimumDepositTrx: 10,
    });
  };

  const getOrderHistoryHandler = async (input: ToolInput) => {
    const response = await fetchApiInternal("/v2/orders", TOOL_NAMES.INTERNAL.INTERNAL_ORDER_HISTORY, {
      method: "GET",
      query: input as InternalQuery,
    });
    return ok(response);
  };

  const getOrderDetailsHandler = async (input: ToolInput) => {
    const path = `/v2/order/${encodeURIComponent(String(input.orderId))}`;
    const response = await fetchApiInternal(path, TOOL_NAMES.INTERNAL.INTERNAL_ORDER_DETAILS, { method: "GET" });
    return ok(response);
  };

  const getOrderBookHandler = async (input: ToolInput) => {
    const response = await fetchApiInternal("/v2/order-book", TOOL_NAMES.INTERNAL.INTERNAL_ORDER_BOOK, {
      method: "GET",
      query: input as InternalQuery,
    });
    return ok(response);
  };

  // POST, but a quote: safe to retry like a read.
  const estimateBuyResourceHandler = async (input: ToolInput) => {
    const response = await fetchApiInternal("/v2/estimate-buy-resource", TOOL_NAMES.INTERNAL.INTERNAL_ORDER_ESTIMATE, {
      method: "POST",
      idempotent: true,
      body: { ...input },
    });
    return ok(response);
  };

  const createOrderHandler = async (input: ToolInput) => {
    const response = await fetchApiInternal("/v2/buy-resource", TOOL_NAMES.INTERNAL.INTERNAL_ORDER_CREATE, {
      method: "POST",
      body: { ...input },
    });
    return ok(response);
  };

  // POST, but a preview: safe to retry like a read.
  const getExtendableDelegatesHandler = async (input: ToolInput) => {
    const response = await fetchApiInternal(
      "/v2/get-extendable-delegates",
      TOOL_NAMES.INTERNAL.INTERNAL_EXTEND_DELEGATES,
      { method: "POST", idempotent: true, body: { ...input } },
    );
    return ok(response);
  };

  const extendRequestHandler = async (input: ToolInput) => {
    const response = await fetchApiInternal("/v2/extend-request", TOOL_NAMES.INTERNAL.INTERNAL_EXTEND_REQUEST, {
      method: "POST",
      body: { ...input },
    });
    return ok(response);
  };

  return {
    getInternalAccountHandler,
    getDepositAddressHandler,
    getOrderHistoryHandler,
    getOrderDetailsHandler,
    getOrderBookHandler,
    estimateBuyResourceHandler,
    createOrderHandler,
    getExtendableDelegatesHandler,
    extendRequestHandler,
  };
}

export type InternalHandlers = ReturnType<typeof createInternalHandlers>;
