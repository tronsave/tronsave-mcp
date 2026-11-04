import type { PlatformHandlers } from "../../handlers/platform";
import type { ToolDefinition } from "../definition_type";
import { EmptyInputSchema } from "../shares";
import { TOOL_NAMES } from "../../toolNames";
import {
    extendableDelegatesInputSchema,
    extendableDelegatesOutputSchema,
    estimateBuyResourceInputSchema,
    estimateBuyEnergyOutputSchema,
    getMinPriceInputSchema,
    getMinPriceOutputSchema,
    getSignMessageOutputSchema,
    loginInputSchema,
    loginOutputSchema,
    logoutOutputSchema,
    sessionStatusOutputSchema,
    orderBookInputSchema,
    orderBookOutputSchema,
    orderCancelInputSchema,
    orderCancelOutputSchema,
    orderCreateInputSchema,
    orderCreateOutputSchema,
    orderSellManualInputSchema,
    orderSellManualOutputSchema,
    orderUpdateInputSchema,
    orderUpdateOutputSchema,
    registerAutoSellInputSchema,
    registerAutoSellOutputSchema,
    updateAutoSellSettingInputSchema,
    updateAutoSellSettingOutputSchema,
    generateApiKeyOutputSchema,
    revokeApiKeyOutputSchema,
    deleteAutoBuySettingInputSchema,
    deleteAutoBuySettingOutputSchema,
    orderDetailInputSchema,
    orderDetailOutputSchema,
    ordersHistoryInputSchema,
    ordersListOutputSchema,
    userAutoSettingOutputSchema,
    userPermissionsOutputSchema,
    userInfoOutputSchema,
} from "./schema";

/**
 * Platform tool definitions registered with the MCP server.
 *
 * Description authoring conventions (see ADR on tool descriptions):
 * - First sentence is an imperative verb phrase used by LLM routers.
 * - Mention return shape highlights when it shortens follow-up calls.
 * - Call out side effects, idempotency, and required auth explicitly.
 * - Keep cross-references (e.g. `tronsave_estimate_buy_resource`) so
 *   models can chain calls without re-reading the schema.
 *
 * Annotation conventions (MCP spec hints, advisory only):
 * - `readOnlyHint`    GET-style read tools.
 * - `destructiveHint` cancel/revoke/delete tools (ignored when readOnly).
 * - `idempotentHint`  repeating with same args produces same end state
 *                     (e.g. cancel already-cancelled = no-op). Mutating
 *                     create/update calls are NOT idempotent.
 * - `openWorldHint`   true for every tool — TronSave talks to GraphQL
 *                     and TRON RPC, both external systems.
 */
export function createPlatformTools(handlers: PlatformHandlers): ToolDefinition[] {
    return [
    {
        name: TOOL_NAMES.PLATFORM.GET_SIGN_MESSAGE,
        title: "Get Signature Message",
        description:
            "Step 1 of wallet login. Returns `{ message, timestamp }`: ask the user to sign `message` with their TRON wallet " +
            "(TronWeb `signMessageV2`, TronLink, etc.), then call `tronsave_login` with `signature: \"<signature>_<timestamp>\"`. " +
            "Signing the plain decimal `timestamp` text is also accepted. No auth needed; no side effects on the account.",
        auth: { mode: "public" },
        annotations: {
            title: "Get Signature Message",
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true,
        },
        inputSchema: EmptyInputSchema,
        outputSchema: getSignMessageOutputSchema,
        handler: handlers.getSignMessageHandler,
    },
    {
        name: TOOL_NAMES.PLATFORM.LOGIN,
        title: "Login Session",
        description:
            "Log in to TronSave for the rest of this MCP connection. Provide EXACTLY ONE of: " +
            "`signature` = `<signature>_<timestamp>` produced by the user's wallet over the `message` from " +
            "`tronsave_get_sign_message` (unlocks wallet tools; also loads the wallet's internal API key if it has one), or " +
            "`apiKey` = raw TronSave internal API key (unlocks internal-account tools and `paymentMethod=internal`). " +
            "The login is bound to the current `mcp-session-id` automatically — do not pass session ids in later tool arguments. " +
            "Returns `{ sessionId, authMode, walletAddress?, hasInternalApiKey, expiresAt, unlocked }`. " +
            "Signed timestamps older than the server limit (default 24h) are rejected with `SIGNATURE_EXPIRED`. " +
            "Never ask the user for private keys or seed phrases.",
        auth: { mode: "public" },
        annotations: {
            title: "Login Session",
            readOnlyHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
        inputSchema: loginInputSchema,
        outputSchema: loginOutputSchema,
        handler: handlers.loginHandler,
    },
    {
        name: TOOL_NAMES.PLATFORM.LOGOUT,
        title: "Logout",
        description:
            "Remove the TronSave login bound to this MCP connection (api-key or signature). " +
            "Returns `{ loggedOut: true }`; idempotent. Header credentials configured on the client are not affected.",
        auth: { mode: "public" },
        annotations: {
            title: "Logout",
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
        inputSchema: EmptyInputSchema,
        outputSchema: logoutOutputSchema,
        handler: handlers.logoutHandler,
    },
    {
        name: TOOL_NAMES.PLATFORM.SESSION_STATUS,
        title: "Session Status",
        description:
            "Report the current authentication state without calling TronSave: `authMode` (none | api-key | signature), " +
            "`source` (login | header), `walletAddress`, `hasInternalApiKey`, `expiresAt`, network, and which tool groups are " +
            "available now. Call this first when unsure whether to log in, and after `SESSION_REQUIRED` / `INVALID_SESSION_TYPE` errors.",
        auth: { mode: "public" },
        annotations: {
            title: "Session Status",
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: false,
        },
        inputSchema: EmptyInputSchema,
        outputSchema: sessionStatusOutputSchema,
        handler: handlers.sessionStatusHandler,
    },
    {
        name: TOOL_NAMES.PLATFORM.USER_INFO_GET,
        title: "User Information",
        description:
            "Read the current authenticated user's profile and linked TronSave internal account. " +
            "For the internal balance alone use `tronsave_get_internal_account`; for referral data `tronsave_get_referral`. " +
            "Returns `{ caller, address, balance (SUN string), info, internalAccount }` — " +
            "`info` carries referral/contact metadata and may be null; `internalAccount` is null when the " +
            "wallet has not provisioned a TronSave internal balance yet. " +
            "`internalAccount.apiKey` is masked. Requires a wallet signature identity. Read-only and idempotent. " +
            "Use `tronsave_get_user_auto_setting` for the auto-sell config or `tronsave_get_user_permissions` " +
            "for permission flags when the full profile is unnecessary.",
        auth: { mode: "signature-session" },
        annotations: {
            title: "User Information",
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true,
        },
        inputSchema: EmptyInputSchema,
        outputSchema: userInfoOutputSchema,
        handler: handlers.getUserInfoHandler,
    },
    {
        name: TOOL_NAMES.PLATFORM.USER_AUTO_SETTING_GET,
        title: "User Auto Setting",
        description:
            "Read the current user's auto-sell configuration (`autoSettings`). " +
            "Returns the full `autoSettings` object — call this before `tronsave_register_auto_sell` or " +
            "`tronsave_update_auto_sell_setting` to avoid overwriting fields you do not intend to change. " +
            "Requires a wallet signature identity. Read-only and idempotent.",
        auth: { mode: "signature-session" },
        annotations: {
            title: "User Auto Setting",
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true,
        },
        inputSchema: EmptyInputSchema,
        outputSchema: userAutoSettingOutputSchema,
        handler: handlers.getUserAutoSettingHandler,
    },
    {
        name: TOOL_NAMES.PLATFORM.USER_PERMISSIONS_GET,
        title: "User Permissions",
        description:
            "Read the enabled permission operations (`autoSettings.permitOperations`) for the authenticated user. " +
            "Returns `{ permitOperations: string[] }` — use it before mutating auto-sell or auto-buy rules to confirm " +
            "the action is allowed for the wallet. " +
            "Requires a wallet signature identity. Read-only and idempotent.",
        auth: { mode: "signature-session" },
        annotations: {
            title: "User Permissions",
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true,
        },
        inputSchema: EmptyInputSchema,
        outputSchema: userPermissionsOutputSchema,
        handler: handlers.getUserPermissionsHandler,
    },
    {
        name: TOOL_NAMES.PLATFORM.ESTIMATE_BUY_RESOURCE,
        title: "Estimate Buy Resource",
        description:
            "Quote price and availability for buying ENERGY or BANDWIDTH for a receiver address before placing an order. " +
            "This quote feeds `tronsave_create_order`; for `tronsave_internal_order_create` (API key) quote with `tronsave_internal_order_estimate`. " +
            "Returns `{ unitPrice (SUN/unit), durationSec, estimateTrx (total cost in SUN), availableResource, systemDepositAddress }` — " +
            "map them to `tronsave_create_order` as `orderUnitPrice`, `orderDurationSec`, `paymentPaymentAmount`. " +
            "Defaults: ENERGY, 100000 units (1000 for BANDWIDTH), 900 s. " +
            "Read-only and safe to call repeatedly; no session is required, but backend rate limits apply. " +
            "For order-book depth use `tronsave_list_order_books`; for the minimum unit price only use `tronsave_get_min_price`.",
        auth: { mode: "public" },
        annotations: {
            title: "Estimate Buy Resource",
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true,
        },
        inputSchema: estimateBuyResourceInputSchema,
        outputSchema: estimateBuyEnergyOutputSchema,
        handler: handlers.estimateBuyEnergyHandler,
    },
    {
        name: TOOL_NAMES.PLATFORM.ORDER_DETAIL,
        title: "Order Detail",
        description:
            "Read one order by `id` and return its full snapshot for NORMAL, FAST, or EXTEND order types. " +
            "With only an API key, use `tronsave_internal_order_details` instead. " +
            "Use this as the source of truth before `tronsave_update_order`, `tronsave_sell_order_manual`, or `tronsave_cancel_order` " +
            "to avoid acting on stale state. " +
            "Requires a wallet signature identity. Read-only and idempotent.",
        auth: { mode: "signature-session" },
        annotations: {
            title: "Order Detail",
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true,
        },
        inputSchema: orderDetailInputSchema,
        outputSchema: orderDetailOutputSchema,
        handler: handlers.orderDetailHandler,
    },
    {
        name: TOOL_NAMES.PLATFORM.LIST_ORDERS,
        title: "List Orders",
        description:
            "Query the market order list with paging (`offset`, `limit` ≤ 10). " +
            "For an API-key account's own purchases use `tronsave_internal_order_history`. " +
            "Returns `{ orders: [{ id, requester?.address, receiver.address, resourceType, resourceAmount, remainAmount, " +
            "durationSec, unitPrice (SUN), isOwner, isMatching, apy, createdAt, typeOrder (NORMAL|FAST|EXTEND) }] }`. " +
            "`status`: `ACTIVE` = still matching, `COMPLETED` = no longer matching. " +
            "Set `isOnlyMyOrder=true` (requires a wallet signature identity) to list orders requested by the caller's wallet. " +
            "Use `tronsave_get_order` with an `id` for one snapshot before mutating an order.",
        auth: { mode: "public" },
        annotations: {
            title: "List Orders",
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true,
        },
        inputSchema: ordersHistoryInputSchema,
        outputSchema: ordersListOutputSchema,
        handler: handlers.ordersListHandler,
    },
    {
        name: TOOL_NAMES.PLATFORM.ORDER_BOOK,
        title: "Order Book",
        description:
            "Read market depth buckets for `ENERGY` or `BANDWIDTH`. " +
            "Public view; with an API key, `tronsave_internal_order_book` adds SLOW/MEDIUM/FAST price tiers. " +
            "Returns price buckets `{ min, max, value }` optionally scoped by viewer address, minimum delegate amount, and duration. " +
            "No login required; read-only and idempotent. " +
            "Use this to estimate market ranges before create/update decisions; pair with " +
            "`tronsave_estimate_buy_resource` for quote-style buy estimation and `tronsave_get_order` for one concrete order.",
        auth: { mode: "public" },
        annotations: {
            title: "Order Book",
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true,
        },
        inputSchema: orderBookInputSchema,
        outputSchema: orderBookOutputSchema,
        handler: handlers.orderBookHandler,
    },
    {
        name: TOOL_NAMES.PLATFORM.GET_MIN_PRICE,
        title: "Get Minimum Unit Price",
        description:
            "Quote the minimum unit price for a buy. " +
            "Use when only the floor price matters; for a full purchase quote use `tronsave_estimate_buy_resource`, for a grid across amounts and durations `tronsave_get_price_table`. " +
            "Returns `{ minPrice }` (SUN per resource unit; per day when `durationSec` >= 86400) from GraphQL `market.estimateMinPrice` for the given " +
            "`resourceType`, `buyAmount`, and `durationSec`. Optional `address` scopes context when the API supports it. " +
            "No login required. Read-only and idempotent. " +
            "Pair with `tronsave_estimate_buy_resource` for full buy quotes and `tronsave_list_order_books` for depth buckets.",
        auth: { mode: "public" },
        annotations: {
            title: "Get Minimum Unit Price",
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true,
        },
        inputSchema: getMinPriceInputSchema,
        outputSchema: getMinPriceOutputSchema,
        handler: handlers.getMinPriceHandler,
    },
    {
        name: TOOL_NAMES.PLATFORM.EXTENDABLE_DELEGATES_GET,
        title: "Extendable Delegates",
        description:
            "List extendable delegate candidates for a `receiver` and `resourceType` (ENERGY|BANDWIDTH). " +
            "Optional `suggestData` scores an extend-and-buy scenario for planning purposes. " +
            "Read-only; does NOT create orders or change on-chain state. No login required. " +
            "NOTE: this is GraphQL market data for discovery only. To actually submit an extension, use " +
            "`tronsave_internal_create_extend_request` with `extendData` from the authenticated REST `POST /v2/get-extendable-delegates` " +
            "(payload shape differs from this GraphQL response).",
        auth: { mode: "public" },
        annotations: {
            title: "Extendable Delegates",
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true,
        },
        inputSchema: extendableDelegatesInputSchema,
        outputSchema: extendableDelegatesOutputSchema,
        handler: handlers.extendableDelegatesHandler,
    },
    {
        name: TOOL_NAMES.PLATFORM.ORDER_CREATE,
        title: "Create Order",
        description:
            "Create a buy order for ENERGY/BANDWIDTH delegated to `orderReceiver`. SPENDS FUNDS — confirm the plan with the user first. " +
            "API-key integrations paying from the internal balance can instead use `tronsave_internal_order_create` (FAST/MEDIUM/SLOW pricing, fill guards). " +
            "Inputs: `orderResourceType`, `orderReceiver`, `orderUnitPrice` (SUN, not TRX), `orderDurationSec`, `orderResourceAmount`, " +
            "`paymentPaymentAmount` (SUN), and `paymentMethod`: " +
            "`internal` — debits the TronSave internal balance (needs an api-key login/header or a signature login whose wallet has an internal account); " +
            "`onchain` — no login needed, but `paymentSignedTx` must be the user's wallet-signed TRX transfer to `systemDepositAddress`. " +
            "Take price/amount/duration values from the latest `tronsave_estimate_buy_resource`. " +
            "Returns `{ success, message, code, data.orderId }` — check `success`; verify with `tronsave_get_order` or `tronsave_list_orders`. " +
            "Not idempotent: on a timeout, verify before retrying to avoid duplicate orders.",
        auth: { mode: "public" },
        annotations: {
            title: "Create Order",
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
        inputSchema: orderCreateInputSchema,
        outputSchema: orderCreateOutputSchema,
        handler: handlers.orderCreateHandler,
    },
    {
        name: TOOL_NAMES.PLATFORM.ORDER_SELL_MANUAL,
        title: "Sell Order Manual",
        description:
            "Manually execute seller-side fulfillment of an existing order with a wallet `signedTx`. " +
            "Returns `{ success, message, code, delegatedId }`. " +
            "Side effect: broadcasts a market/delegation transaction and may consume balances/resources; not idempotent — each call re-executes. " +
            "Requires a wallet signature identity. " +
            "Use only when explicit manual sell is intended; call `tronsave_get_order` first to verify order state before signing.",
        auth: { mode: "signature-session" },
        annotations: {
            title: "Sell Order Manual",
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true,
        },
        inputSchema: orderSellManualInputSchema,
        outputSchema: orderSellManualOutputSchema,
        handler: handlers.orderSellManualHandler,
    },
    {
        name: TOOL_NAMES.PLATFORM.ORDER_CANCEL,
        title: "Cancel Order",
        description:
            "Cancel an open order by `orderId`. " +
            "Returns `{ success, message, code }`. " +
            "Side effect: marks the order non-matchable and refunds locked balance per backend rules; effectively destructive on the live order. " +
            "Idempotent — cancelling an already-cancelled order is a no-op success. Fails for fulfilled orders or unauthorized callers. " +
            "Requires a wallet signature identity (the order's owner). " +
            "Verify state with `tronsave_get_order` first; prefer `tronsave_update_order` when only price/receiver should change.",
        auth: { mode: "signature-session" },
        annotations: {
            title: "Cancel Order",
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
            openWorldHint: true,
        },
        inputSchema: orderCancelInputSchema,
        outputSchema: orderCancelOutputSchema,
        handler: handlers.orderCancelHandler,
    },
    {
        name: TOOL_NAMES.PLATFORM.ORDER_UPDATE,
        title: "Update Order",
        description:
            "Update an open order by `orderId` with partial fields (`receiver`, `newPrice`). " +
            "Returns `{ success, message, code }`. " +
            "Side effect: overwrites live order parameters; not idempotent — each call with a different `newPrice` produces a new state. " +
            "Requires a wallet signature identity (the order's owner). " +
            "Prefer this over cancel+recreate when only price/receiver should change. " +
            "Verify state with `tronsave_get_order` first; fails for already-fulfilled, already-cancelled, or non-editable orders.",
        auth: { mode: "signature-session" },
        annotations: {
            title: "Update Order",
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
        inputSchema: orderUpdateInputSchema,
        outputSchema: orderUpdateOutputSchema,
        handler: handlers.orderUpdateHandler,
    },
    {
        name: TOOL_NAMES.PLATFORM.REGISTER_AUTO_SELL,
        title: "Register Auto Sell",
        description:
            "Create the initial auto-sell configuration for the authenticated user. " +
            "Returns the persisted `autoSettings` payload. " +
            "Side effect: persists automation settings that affect future delegation/sell behavior; not idempotent — calling twice " +
            "may reset fields. Requires a wallet signature identity. " +
            "Use for FIRST-TIME setup only; for subsequent edits use `tronsave_update_auto_sell_setting`, " +
            "and always read the current state with `tronsave_get_user_auto_setting` first to avoid overwriting unknown fields. " +
            "Fails for invalid config combinations, unauthorized sessions, or backend policy restrictions.",
        auth: { mode: "signature-session" },
        annotations: {
            title: "Register Auto Sell",
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
        inputSchema: registerAutoSellInputSchema,
        outputSchema: registerAutoSellOutputSchema,
        handler: handlers.registerAutoSellHandler,
    },
    {
        name: TOOL_NAMES.PLATFORM.UPDATE_AUTO_SELL_SETTING,
        title: "Update Auto Sell Setting",
        description:
            "Update the existing auto-sell configuration with partial fields. " +
            "Returns the updated `autoSettings` payload. " +
            "Side effect: overwrites stored automation settings for the current user; not idempotent across different field sets. " +
            "Requires a wallet signature identity. " +
            "Use for INCREMENTAL changes after registration; read the baseline via `tronsave_get_user_auto_setting` to avoid accidental resets, " +
            "and use `tronsave_register_auto_sell` only for first-time setup. " +
            "Fails for invalid field combinations, unauthorized sessions, or policy constraints.",
        auth: { mode: "signature-session" },
        annotations: {
            title: "Update Auto Sell Setting",
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
        inputSchema: updateAutoSellSettingInputSchema,
        outputSchema: updateAutoSellSettingOutputSchema,
        handler: handlers.updateAutoSellSettingHandler,
    },
    {
        name: TOOL_NAMES.PLATFORM.GENERATE_API_KEY,
        title: "Generate API Key",
        description:
            "Generate a new internal API key credential for the current user. " +
            "Returns `data` containing the issued key — show it to the user once and tell them to store it securely; do not repeat it in later messages. " +
            "Side effect: issues secret material; not idempotent — each call mints a fresh key and may invalidate the previous one per backend policy. " +
            "Requires a wallet signature identity. " +
            "Sensitive output — never log raw keys; unauthorized sessions or policy checks may reject issuance.",
        auth: { mode: "signature-session" },
        annotations: {
            title: "Generate API Key",
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true,
        },
        sensitiveOutput: true,
        inputSchema: EmptyInputSchema,
        outputSchema: generateApiKeyOutputSchema,
        handler: handlers.generateApiKeyHandler,
    },
    {
        name: TOOL_NAMES.PLATFORM.REVOKE_API_KEY,
        title: "Revoke API Key",
        description:
            "Revoke the caller's current internal API key. " +
            "Side effect: any future request using the previous key is rejected. " +
            "Existing in-flight sessions cached by the server may continue serving until their TTL expires — treat the effect as 'best-effort immediate' rather than guaranteed instantaneous cutoff. " +
            "Idempotent — revoking an already-revoked key returns success. " +
            "Requires a wallet signature identity. " +
            "Call `tronsave_generate_api_key` afterwards to mint a replacement when continued internal access is needed.",
        auth: { mode: "signature-session" },
        annotations: {
            title: "Revoke API Key",
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
            openWorldHint: true,
        },
        inputSchema: EmptyInputSchema,
        outputSchema: revokeApiKeyOutputSchema,
        handler: handlers.revokeApiKeyHandler,
    },
    {
        name: TOOL_NAMES.PLATFORM.DELETE_AUTO_BUY_SETTING,
        title: "Delete Auto Buy Setting",
        description:
            "Permanently delete one auto-buy rule by `id` (`MObjectId`). " +
            "Side effect: stops all future executions matching that rule; the rule cannot be restored. " +
            "Idempotent — deleting a non-existent or already-removed id returns success. " +
            "Requires a wallet signature identity. " +
            "Use `tronsave_get_user_auto_setting` to list current rules first; prefer disabling/updating instead when reversibility is desired.",
        auth: { mode: "signature-session" },
        annotations: {
            title: "Delete Auto Buy Setting",
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
            openWorldHint: true,
        },
        inputSchema: deleteAutoBuySettingInputSchema,
        outputSchema: deleteAutoBuySettingOutputSchema,
        handler: handlers.deleteAutoBuySettingHandler,
    },
];
}
