import z from "zod";
import type { InternalHandlers } from "../../handlers/internal";
import { TOOL_NAMES } from "../../toolNames";
import type { ToolDefinition } from "../definition_type";
import { EmptyInputSchema } from "../shares";
import {
  buyResourceOutputSchema,
  durationSecOptional,
  estimateOrderOutputSchema,
  extendDataRowSchema,
  extendDelegatesOutputSchema,
  extendToRequired,
  getInternalAccountOutputSchema,
  getOrderBookOutputSchema,
  internalOrderListOutputSchema,
  internalOrderOutputSchema,
  maxPriceAcceptedOptional,
  orderBookFields,
  orderCreateOptions,
  orderEstimateOptions,
  orderIdParam,
  paginationFields,
  receiverDelegatedRequired,
  receiverOptional,
  receiverRequired,
  requesterOptional,
  resourceAmountPositive,
  resourceTypeOptional,
  unitPriceOptional,
  withTronSaveAuth,
} from "./schema";

export function createInternalTools(handlers: InternalHandlers): ToolDefinition[] {
  return [
    {
      name: TOOL_NAMES.INTERNAL.INTERNAL_ACCOUNT_GET,
      title: "Internal Account Information",
      description: withTronSaveAuth(
        "Retrieve the Tronsave internal account profile for the current logged-in session (wallet/represent address, balances, deposit address).",
        "Use when the user needs their linked address or balance; for the full wallet profile use `tronsave_get_user_info`, for the ledger of deposits and payments `tronsave_list_internal_transactions`.",
        "Returns `{ id, balance (SUN string), representAddress, depositAddress }`; any API key in the payload is masked. Read-only.",
      ),
      auth: { mode: "session" },
      annotations: {
        title: "Internal Account Information",
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: EmptyInputSchema,
      outputSchema: getInternalAccountOutputSchema,
      handler: handlers.getInternalAccountHandler,
    },
    {
      name: TOOL_NAMES.INTERNAL.GET_DEPOSIT_ADDRESS,
      title: "Get Deposit Address",
      description: withTronSaveAuth(
        "Fetches the specific deposit address for the TronSave internal account.",
        "Trigger this tool if the user asks for a deposit address or needs to top up their TronSave TRX balance.",
        "Constraints: 1) TRX only; 2) Minimum deposit amount is 10 TRX; 3) Read-only operation.",
      ),
      auth: { mode: "session" },
      annotations: {
        title: "Get Deposit Address",
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: z.object({
        amountTrx: z.number().min(10).describe("Amount of TRX the user intends to deposit (minimum 10 TRX)."),
      }),
      outputSchema: z.object({
        depositAddress: z
          .string()
          .nullable()
          .describe("TRON base58 deposit address; send TRX here to top up the TronSave internal balance."),
        amountTrx: z.number().describe("Amount of TRX the user intends to deposit (echoed back)."),
        minimumDepositTrx: z.number().describe("Minimum accepted deposit in TRX."),
      }),
      handler: handlers.getDepositAddressHandler,
    },
    {
      name: TOOL_NAMES.INTERNAL.INTERNAL_ORDER_HISTORY,
      title: "Internal Account Order History",
      description: withTronSaveAuth(
        "List paginated order history for the internal account linked to the API key, newest first.",
        "Use when the user asks about past purchases, fulfillment, payouts, or delegates on their internal account. This is the API-key path; wallet-signature sessions can also use `tronsave_list_orders` with `isOnlyMyOrder`.",
        "Read-only. Pair with `tronsave_internal_order_details` for a single order's full snapshot.",
      ),
      auth: { mode: "session" },
      annotations: {
        title: "Internal Account Order History",
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: z.object({ ...paginationFields }),
      outputSchema: internalOrderListOutputSchema,
      handler: handlers.getOrderHistoryHandler,
    },
    {
      name: TOOL_NAMES.INTERNAL.INTERNAL_ORDER_DETAILS,
      title: "Internal Order Details",
      description: withTronSaveAuth(
        "Fetch full details for one internal-account order by order ID.",
        "Use when monitoring fulfillment after `tronsave_internal_order_create`, or when the user asks for status on a specific order id. API-key path; with a wallet signature `tronsave_get_order` returns the same order.",
        "Read-only. FRESHNESS: order state changes within seconds as the market matches — re-read immediately before acting.",
      ),
      auth: { mode: "session" },
      annotations: {
        title: "Internal Order Details",
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: z.object({
        orderId: orderIdParam,
      }),
      outputSchema: internalOrderOutputSchema,
      handler: handlers.getOrderDetailsHandler,
    },
    {
      name: TOOL_NAMES.INTERNAL.INTERNAL_ORDER_BOOK,
      title: "Internal Market Order Book",
      description: withTronSaveAuth(
        "Return the current TronSave market depth/price tiers for ENERGY or BANDWIDTH via the api-key REST endpoint.",
        "Use before `tronsave_internal_order_create` or `tronsave_internal_order_estimate` when the user needs live prices or liquidity. Same depth as the public `tronsave_list_order_books`, plus SLOW/MEDIUM/FAST price tiers; use the public tool when there is no API key.",
        "Read-only. FRESHNESS: live market depth can change roughly every 3 seconds (one TRON block) — re-read immediately before placing an order.",
      ),
      auth: { mode: "session" },
      annotations: {
        title: "Internal Market Order Book",
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: z.object({ ...orderBookFields }),
      outputSchema: getOrderBookOutputSchema,
      handler: handlers.getOrderBookHandler,
    },
    {
      name: TOOL_NAMES.INTERNAL.INTERNAL_ORDER_ESTIMATE,
      title: "Estimate TRX Cost Before Order",
      description: withTronSaveAuth(
        "Estimate the TRX cost and availability for a buy order before submitting it (api-key internal account).",
        "Use when the user wants a quote or price check; feed the result into `tronsave_internal_order_create`. Quotes for `tronsave_create_order` come from `tronsave_estimate_buy_resource` instead.",
        "Read-only. FRESHNESS: `unitPrice`/`estimateTrx` are live and can change roughly every 3 seconds — re-estimate immediately before creating the order.",
      ),
      auth: { mode: "session" },
      annotations: {
        title: "Estimate TRX Cost Before Order",
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: z.object({
        resourceType: resourceTypeOptional,
        resourceAmount: resourceAmountPositive,
        receiver: receiverOptional,
        requester: requesterOptional,
        durationSec: durationSecOptional,
        unitPrice: unitPriceOptional,
        options: orderEstimateOptions,
      }),
      outputSchema: estimateOrderOutputSchema,
      handler: handlers.estimateBuyResourceHandler,
    },
    {
      name: TOOL_NAMES.INTERNAL.INTERNAL_ORDER_CREATE,
      title: "Create Energy or Bandwidth Order (Internal)",
      description: withTronSaveAuth(
        "Place a new buy order for ENERGY or BANDWIDTH on TronSave, paid from the internal account balance.",
        "Side effect: SPENDS internal TRX balance and creates a live order; not idempotent — each call places a new order. This is the api-key/internal path; for the signature-session market path use `tronsave_create_order`.",
        "Always derive `unitPrice` from the latest `tronsave_internal_order_estimate` (re-estimate immediately before submitting — quotes older than a few seconds may be stale and revert). Returns `{ orderId }`.",
      ),
      auth: { mode: "session" },
      annotations: {
        title: "Create Energy or Bandwidth Order (Internal)",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: z.object({
        resourceType: resourceTypeOptional,
        resourceAmount: resourceAmountPositive,
        receiver: receiverRequired,
        durationSec: durationSecOptional,
        unitPrice: unitPriceOptional,
        sponsor: z.string().optional().describe("Optional sponsor or referral code."),
        options: orderCreateOptions,
      }),
      outputSchema: buyResourceOutputSchema,
      handler: handlers.createOrderHandler,
    },
    {
      name: TOOL_NAMES.INTERNAL.INTERNAL_EXTEND_DELEGATES,
      title: "List Extendable Delegations",
      description: withTronSaveAuth(
        "Return extendable delegations for a receiver plus an `extendData` payload for the extension flow.",
        "Use as STEP 1 before `tronsave_internal_create_extend_request` when the user wants to extend existing delegation time. This is the only source of submittable `extendData`; `tronsave_list_extendable_delegates` is a public market view, and `tronsave_list_extendable_receivers` finds which receiver to extend.",
        "Read-only; does not submit anything. FRESHNESS: pricing/availability change within seconds — run immediately before extending and pass the returned `extendData` unchanged.",
      ),
      auth: { mode: "session" },
      annotations: {
        title: "List Extendable Delegations",
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: z.object({
        receiver: receiverDelegatedRequired,
        extendTo: extendToRequired,
        resourceType: resourceTypeOptional,
        maxPriceAccepted: maxPriceAcceptedOptional,
        requester: requesterOptional,
      }),
      outputSchema: extendDelegatesOutputSchema,
      handler: handlers.getExtendableDelegatesHandler,
    },
    {
      name: TOOL_NAMES.INTERNAL.INTERNAL_EXTEND_REQUEST,
      title: "Submit Delegation Extension",
      description: withTronSaveAuth(
        "Submit an extension request for existing delegated resources on TronSave via authenticated REST `POST /v2/extend-request`.",
        "Side effect: creates an extension order and may commit TRX from the internal account.",
        "`extendData` must follow the REST contract (see schema on each row). Get `extendData` from `tronsave_internal_extend_delegates` (STEP 1) and pass the rows unchanged. Do not copy rows from `tronsave_list_extendable_delegates` (GraphQL); that payload shape differs and is for market discovery only.",
      ),
      auth: { mode: "session" },
      annotations: {
        title: "Submit Delegation Extension",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: z.object({
        receiver: receiverDelegatedRequired,
        extendData: z
          .array(extendDataRowSchema)
          .min(1)
          .describe(
            "Delegator-level rows for `POST /v2/extend-request`. Each row matches TronSave's REST extend contract (delegator, isExtend, extraAmount, extendTo in Unix seconds)—typically taken from `extendData` returned by `POST /v2/get-extendable-delegates` when called with the user's session, not from GraphQL `tronsave_list_extendable_delegates`.",
          ),
        resourceType: resourceTypeOptional,
      }),
      /** New extension order id from `POST /v2/extend-request` (hex `orderId`). */
      outputSchema: buyResourceOutputSchema,
      handler: handlers.extendRequestHandler,
    },
  ];
}
