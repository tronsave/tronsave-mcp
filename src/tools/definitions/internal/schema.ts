import z from "zod";
import { tronAddress } from "../shares";

/** Second sentence on every internal tool: prerequisite after the imperative core (see mcp_tool_standards §3). */
export const TRONSAVE_API_KEY_AUTH =
    "Requires an internal API key: `tronsave_login` (api-key mode, or signature mode for a wallet with an internal account) or an `Authorization: ApiKey <key>` client header. " +
    "Never pass API keys as tool arguments; the server forwards the key from the session/header to TronSave.";

/**
 * Sentence 1: imperative + core function. Sentence 2: {@link TRONSAVE_API_KEY_AUTH}.
 * Remaining sentences: when to use, side effects, read-only, etc.
 */
export function withTronSaveAuth(firstSentence: string, ...rest: string[]): string {
    const core = firstSentence.trim();
    const tail = rest.map((s) => s.trim()).filter(Boolean).join(" ");
    const coreWithStop = core.endsWith(".") ? core : `${core}.`;
    return tail
        ? `${coreWithStop} ${TRONSAVE_API_KEY_AUTH} ${tail}`
        : `${coreWithStop} ${TRONSAVE_API_KEY_AUTH}`;
}

export const resourceTypeOptional = z
    .enum(["ENERGY", "BANDWIDTH"])
    .optional()
    .describe("Resource type. Default ENERGY when omitted.");

/** Receiver for internal `POST /v2/extend-request` (delegation extension). */
export const receiverDelegatedRequired = tronAddress("TRON base58 address of the account that receives the delegated resource.");

export const extendDataRowSchema = z.object({
    delegator: tronAddress("TRON base58 delegator address."),
    isExtend: z.boolean().describe("Whether to extend this delegation row."),
    extraAmount: z
        .number()
        .min(0)
        .describe("Additional resource amount to add (resource units)."),
    extendTo: z
        .number()
        .int()
        .positive()
        .describe("Target end time as Unix epoch SECONDS (UTC) for this delegator row in `POST /v2/extend-request`; echo the value returned by `tronsave_internal_extend_delegates`."),
});

/** ----- Output Schema ----- */

export const getInternalAccountOutputSchema = z.object({
    id: z.string().describe("Internal account id."),
    balance: z.string().describe("Internal balance in SUN as a decimal string (TRX = SUN / 1e6)."),
    representAddress: z.string().describe("TRON base58 address that represents (owns) the internal account."),
    depositAddress: z.string().describe("TRON base58 deposit address; send TRX here to top up the internal balance (min 10 TRX)."),
    apiKey: z.string().optional().describe("MASKED internal API key; the full key is never returned."),
});

/** `POST /v2/extend-request` response body: the new extension order. */
export const buyResourceOutputSchema = z.object({
    orderId: z.string().describe("New extension order id (hex string)."),
});

export const unitPriceOptional = z
    .union([z.enum(["FAST", "MEDIUM", "SLOW"]), z.number()])
    .optional()
    .describe(
        "Pricing: FAST | MEDIUM | SLOW strategy, or exact unit price in SUN per resource unit. Default MEDIUM when omitted."
    );

export const durationSecOptional = z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Delegation duration in seconds. Default 259200 (3 days) when omitted.");

export const receiverOptional = tronAddress("TRON base58 address that will receive the resource.").optional();

export const receiverRequired = tronAddress("TRON base58 address that will receive the resource.");

export const requesterOptional = tronAddress("TRON base58 requester; defaults to the API key account when omitted.").optional();

/** Receiver for delegation extend flows (internal.extend.*). */
export const resourceAmountPositive = z
    .number()
    .positive()
    .describe("Amount of resource to purchase (resource units).");

export const paginationFields = {
    page: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Page index, 0-based. Omit for first page (default 0)."),
    pageSize: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Orders per page. Default 10 when omitted. Typical range 1–100."),
} as const;

export const orderBookFields = {
    address: tronAddress("Optional TRON base58 address filter for the receiver.").optional(),
    resourceType: resourceTypeOptional,
    minDelegateAmount: z
        .number()
        .min(0)
        .optional()
        .describe("Minimum resource amount per offer level to include (resource units, not SUN)."),
    durationSec: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Delegation duration window in seconds for the quote."),
} as const;

export const orderEstimateOptions = z
    .object({
        allowPartialFill: z
            .boolean()
            .optional()
            .describe("Allow partial fill so the order can match partially. Default true when omitted."),
    })
    .optional()
    .describe("Optional flags that affect matching behavior for the estimate.");

export const orderCreateOptions = z
    .object({
        allowPartialFill: z
            .boolean()
            .optional()
            .describe("Allow partial fill. Default true when omitted."),
        onlyCreateWhenFulfilled: z
            .boolean()
            .optional()
            .describe("Only create if the order can be 100% fulfilled. Default false when omitted."),
        maxPriceAccepted: z
            .number()
            .min(0)
            .optional()
            .describe("Maximum unit price in SUN you accept."),
        preventDuplicateIncompleteOrders: z
            .boolean()
            .optional()
            .describe("Skip if an identical pending order already exists. Default false when omitted."),
        minResourceDelegateRequiredAmount: z
            .number()
            .min(0)
            .optional()
            .describe("Minimum resource amount per matching provider (resource units)."),
    })
    .optional()
    .describe("Optional execution guards and fill behavior.");

/** One delegator row for `POST /v2/extend-request`; echoed unchanged from `internal_extend_delegates`. */
export const extendToRequired = z
    .number()
    .int()
    .positive()
    .describe("Target end time as Unix epoch SECONDS (UTC) for the extended delegation, e.g. now + 86400 for one more day. Milliseconds are rejected by TronSave (INVALID_EXTEND_TIME).");

export const maxPriceAcceptedOptional = z
    .number()
    .min(0)
    .optional()
    .describe("Maximum unit price in SUN you are willing to pay for the extension.");

export const orderIdParam = z
    .string()
    .min(1)
    .describe(
        "TronSave order ID (hex string), e.g. value returned in internal.order.create response data.orderId."
    );


/**
 * ----- Output Schema -----
 * These describe the inner `data` payload that `fetchApiInternal` returns after unwrapping the
 * REST `{ error, message, data }` envelope. They are intentionally PERMISSIVE — `z.looseObject`
 * with optional fields — because the live `/v2` responses vary by endpoint (e.g. order-history
 * rows are lighter than order-detail, `createdAt` may be unix-ms or ISO, order-book may return a
 * depth array or price tiers). The MCP SDK validates `structuredContent` against these, so
 * tolerance avoids false rejections. Tighten field-by-field once the live smoke confirms shapes.
 */

export const internalOrderOutputSchema = z.looseObject({
    id: z.string().optional().describe("TronSave order ID (hex string)."),
    requester: z.string().optional().describe("TRON base58 requester address."),
    receiver: z.string().optional().describe("TRON base58 receiver address."),
    resourceAmount: z.number().optional().describe("Resource amount of order."),
    resourceType: resourceTypeOptional.describe("Resource type."),
    remainAmount: z.number().optional().describe("Remaining unfulfilled amount."),
    orderType: z.string().optional().describe("Order type (NORMAL | FAST | EXTEND)."),
    price: z.number().optional().describe("Unit price in SUN."),
    durationSec: z.number().optional().describe("Delegated duration in seconds."),
    status: z.string().optional().describe("Order status."),
    allowPartialFill: z.boolean().optional().describe("Whether partial fill is allowed."),
    payoutAmount: z.number().optional().describe("Payout amount in SUN."),
    fulfilledPercent: z.number().optional().describe("0 = pending, 1-99 = partial, 100 = fully matched."),
    createdAt: z
        .union([z.number(), z.string()])
        .optional()
        .describe("Order created time (Unix epoch ms or ISO-8601, endpoint-dependent)."),
    delegates: z
        .array(
            z.looseObject({
                delegator: z.string().optional().describe("TRON base58 address of delegator."),
                amount: z.number().optional().describe("Delegated resource amount."),
                txid: z.string().optional().describe("Transaction ID on TRON network."),
            }),
        )
        .optional()
        .describe("Delegations fulfilling this order."),
});

/** One row of market depth: unit price and liquidity at that level. */
export const orderBookLevelSchema = z.looseObject({
    price: z.number().optional().describe("Price in SUN."),
    availableResourceAmount: z.number().optional().describe("Available resource amount at this price level."),
});

/** `GET /v2/order-book` — tolerant of both a depth array and SLOW/MEDIUM/FAST price-tier shapes. */
export const getOrderBookOutputSchema = z.looseObject({
    data: z.array(orderBookLevelSchema).optional().describe("Order book entries sorted by price."),
    slow: z.number().optional().describe("SLOW price tier (SUN)."),
    medium: z.number().optional().describe("MEDIUM price tier (SUN)."),
    fast: z.number().optional().describe("FAST price tier (SUN)."),
    availableResource: z.number().optional().describe("Available resource at the quoted tiers."),
});

/** Paginated `GET /v2/orders` response (`data` array; `total` may be absent). */
export const internalOrderListOutputSchema = z.looseObject({
    data: z.array(internalOrderOutputSchema).optional().describe("Orders on this page, newest first."),
    total: z.number().optional().describe("Total orders matching the query (for pagination)."),
});

export const estimateOrderOutputSchema = z.looseObject({
    unitPrice: z.number().optional().describe("Unit price in SUN."),
    durationSec: z.number().optional().describe("Delegated duration in seconds."),
    estimateTrx: z.number().optional().describe("Estimated TRX cost in SUN."),
    availableResource: z.number().optional().describe("Available resource amount."),
});

/** `POST /v2/buy-resource` and `POST /v2/extend-request` both return a new order id. */
/** `POST /v2/get-extendable-delegates` preview: book, totals, and rows to echo into the extend request. */
export const extendDelegatesOutputSchema = z.looseObject({
    extendOrderBook: z.array(orderBookLevelSchema).optional().describe("Order book for extend."),
    totalDelegateAmount: z.number().optional().describe("Total delegated resource amount."),
    totalAvailableExtendAmount: z.number().optional().describe("Total available amount to extend."),
    totalEstimateTrx: z.number().optional().describe("Total estimated TRX cost in SUN."),
    isAbleToExtend: z.boolean().optional().describe("Whether balance is sufficient to extend."),
    yourBalance: z.number().optional().describe("Current account balance in SUN."),
    extendData: z
        .array(extendDataRowSchema)
        .nullable()
        .optional()
        .describe("Delegations to extend; pass unchanged into internal_create_extend_request `extendData`."),
});