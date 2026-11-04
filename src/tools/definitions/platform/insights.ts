import { z } from "zod";
import type { PlatformHandlers } from "../../handlers/platform";
import { TOOL_NAMES } from "../../toolNames";
import type { ToolDefinition } from "../definition_type";
import { EmptyInputSchema, tronAddress } from "../shares";

const resourceType = z.enum(["ENERGY", "BANDWIDTH"]).describe("ENERGY (smart-contract calls) or BANDWIDTH (plain transfers).");
const readOnly = (title: string) => ({ title, readOnlyHint: true, idempotentHint: true, openWorldHint: true });
const write = (title: string, idempotent = false) => ({
  title,
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: idempotent,
  openWorldHint: true,
});
const RANGE = (what: string) =>
  z
    .object({
      isEnabled: z.boolean().describe("Whether this range filter is applied."),
      from: z.number().describe(`Lower bound (${what}).`),
      to: z.number().describe(`Upper bound (${what}).`),
    })
    .describe(`Alert only for orders whose ${what} is in this range.`);
const VALUE = (what: string) =>
  z
    .object({
      isEnabled: z.boolean().describe("Whether this alert is sent."),
      value: z.number().describe(`Threshold: ${what}.`),
    })
    .describe(`Alert when ${what} is reached.`);
const offset = (unit = "rows") => z.number().int().min(0).optional().describe(`Number of ${unit} to skip for pagination (default 0); add \`limit\` to page forward.`);
const objectId = z.string().regex(/^[0-9a-f]{24}$/i, "Must be a 24-char hex id.");
const mutationResult = z.looseObject({
  code: z.number().optional(),
  success: z.boolean().optional(),
  message: z.string().optional(),
});

const autoBuyFields = {
  resourceType: resourceType.describe("ENERGY or BANDWIDTH."),
  receiver: tronAddress("TRON base58 address that receives each delegation."),
  unitPrice: z.string().min(1).describe("Maximum unit price in SUN, as a decimal string."),
  durationSec: z.number().positive().describe("Delegation duration of each purchase, in seconds."),
  resourceAmount: z.number().positive().describe("Resource units bought each time the rule fires."),
  thresholdResourceAmount: z
    .number()
    .min(0)
    .describe("Rule fires when the receiver's remaining resource drops below this many units (TronSave requires at least 100000)."),
  limitBudgetInSun: z.string().optional().describe("Optional total budget cap in SUN (decimal string); must be greater than 10000000 (10 TRX)."),
  limitInOrderCount: z.number().int().positive().optional().describe("Optional cap on the number of orders."),
  startActiveAt: z.number().int().optional().describe("Optional Unix time in seconds when the rule starts."),
  endActiveAt: z.number().int().optional().describe("Optional Unix time in seconds when the rule stops."),
};

export function createInsightTools(handlers: PlatformHandlers): ToolDefinition[] {
  return [
    {
      name: TOOL_NAMES.PLATFORM.MARKET_OVERVIEW_GET,
      title: "Market Overview",
      description:
        "Read the TronSave market summary: resource currently available and total listed for ENERGY and BANDWIDTH, number of pooled sellers, and seller APY (percent). " +
        "Use for a quick 'how is the market' answer before pricing; for prices use `tronsave_get_price_table` (grid) or `tronsave_estimate_buy_resource` (one quote), for depth by price use `tronsave_list_order_books`. Public, read-only. Data refreshes about every TRON block (3 s).",
      auth: { mode: "public" },
      annotations: readOnly("Market Overview"),
      inputSchema: EmptyInputSchema,
      outputSchema: z.looseObject({
        resources: z.looseObject({
          totalAvailableEnergy: z.number().optional(),
          totalAvailableBandwidth: z.number().optional(),
          totalLimitEnergy: z.number().optional(),
          totalLimitBandwidth: z.number().optional(),
        }).nullable().optional(),
        totalPool: z.number().nullable().optional().describe("Number of sellers in the pool."),
        apy: z.looseObject({ energy: z.number().nullable().optional(), bandwidth: z.number().nullable().optional() }),
      }),
      handler: handlers.getMarketOverviewHandler,
    },
    {
      name: TOOL_NAMES.PLATFORM.PRICE_TABLE_GET,
      title: "Resource Price Table",
      description:
        "Read the price grid for ENERGY or BANDWIDTH: `prices[i][j]` is the unit price in SUN for `amounts[i]` resource units rented for `durations[j]` (e.g. '15m', '1h', '1d'). Durations of 1 day or longer are priced per day: '30d' at 40 SUN costs 40 x 30 SUN per unit in total. " +
        "Use to compare cost across amounts and durations in one call. For an exact quote on one purchase use `tronsave_estimate_buy_resource`; for only the floor price use `tronsave_get_min_price`. Public, read-only.",
      auth: { mode: "public" },
      annotations: readOnly("Resource Price Table"),
      inputSchema: z.object({
        resourceType,
        address: tronAddress("Optional receiver address; prices can depend on the account.").optional(),
      }),
      outputSchema: z.looseObject({
        durations: z.array(z.string()),
        amounts: z.array(z.number()),
        prices: z.array(z.array(z.number())),
      }),
      handler: handlers.getPriceTableHandler,
    },
    {
      name: TOOL_NAMES.PLATFORM.SYSTEM_INFO_GET,
      title: "Protocol Parameters",
      description:
        "Read TronSave and TRON protocol parameters: latest block, minimum buy amounts, TRX burn rates per unit, dynamic buy/lowest prices, the system deposit address, max lock period and the energy cost of a USDT transfer. " +
        "Use to size purchases (minimums) and to compare renting with burning TRX. For market prices use `tronsave_get_price_table` or `tronsave_estimate_buy_resource`; for supply and APY use `tronsave_get_market_overview`. Public, read-only.",
      auth: { mode: "public" },
      annotations: readOnly("Protocol Parameters"),
      inputSchema: EmptyInputSchema,
      outputSchema: z.looseObject({
        lastBlock: z.looseObject({ number: z.number().nullable().optional(), timestamp: z.number().nullable().optional() }).nullable().optional(),
        systemDepositAddress: z.string().nullable().optional(),
        minBuyEnergyAmount: z.number().optional(),
        minBuyBandwidthAmount: z.number().optional(),
        burningEnergyRate: z.number().optional().describe("SUN burned per energy unit when none is rented."),
        burningBandwidthRate: z.number().optional(),
        usdtTransferEnergyValue: z.looseObject({ value: z.number().optional(), rawValue: z.number().optional() }).optional(),
      }),
      handler: handlers.getSystemInfoHandler,
    },
    {
      name: TOOL_NAMES.PLATFORM.ACCOUNT_RESOURCES_GET,
      title: "Account Resources",
      description:
        "Read the on-chain staked and delegatable ENERGY/BANDWIDTH of a TRON address, plus its TRX balance (SUN string). " +
        "Use to check whether a wallet can sell, or how much resource it holds. Public (any address), read-only; does not need a login.",
      auth: { mode: "public" },
      annotations: readOnly("Account Resources"),
      inputSchema: z.object({ address: tronAddress("TRON base58 address to inspect.") }),
      outputSchema: z.looseObject({
        address: z.string().optional(),
        balance: z.string().optional(),
        resourcesV2: z.looseObject({}).nullable().optional(),
      }),
      handler: handlers.getAccountResourcesHandler,
    },
    {
      name: TOOL_NAMES.PLATFORM.SUGGEST_CREATE_ORDER,
      title: "Suggest Order Strategy",
      description:
        "Ask the market how a buy would be filled: a plain new order, buying more only, or extending existing delegations (optionally plus extra). Returns each option with `readyToFill` (percent), `payout` (SUN) and the `extendData` rows. " +
        "Use before `tronsave_create_order` when the receiver may already have delegations that can be extended cheaper. Public, read-only. Prices move every ~3 s: re-run right before ordering.",
      auth: { mode: "public" },
      annotations: readOnly("Suggest Order Strategy"),
      inputSchema: z.object({
        resourceType,
        receiver: tronAddress("TRON base58 address that will receive the resource."),
        resourceAmount: z.number().positive().describe("Resource units to buy."),
        durationSec: z.number().positive().describe("Delegation duration in seconds."),
        unitPrice: z.number().positive().describe("Unit price in SUN you are willing to pay."),
        requester: tronAddress("TRON base58 address that pays; defaults to the logged-in wallet.").optional(),
      }),
      outputSchema: z.looseObject({ suggestions: z.array(z.looseObject({})) }),
      handler: handlers.suggestCreateOrderHandler,
    },
    {
      name: TOOL_NAMES.PLATFORM.EXTENDABLE_RECEIVERS_LIST,
      title: "Extendable Receivers",
      description:
        "List the receiver addresses that have delegations bought by `requester` which can still be extended, with expiry time (Unix seconds), delegation count and total amount. " +
        "Use as the first step of an extension flow to find which receiver to extend, then `tronsave_list_extendable_delegates` (market view) or `tronsave_internal_extend_delegates` (API-key path, returns the `extendData` to submit). Public (any requester address), read-only.",
      auth: { mode: "public" },
      annotations: readOnly("Extendable Receivers"),
      inputSchema: z.object({
        requester: tronAddress("TRON base58 address that bought the delegations."),
        resourceType: resourceType.optional().describe("Only delegations of this resource; omit for both."),
      }),
      outputSchema: z.looseObject({ receivers: z.array(z.looseObject({})) }),
      handler: handlers.listExtendableReceiversHandler,
    },
    {
      name: TOOL_NAMES.PLATFORM.SELLER_STATS_GET,
      title: "Seller Statistics",
      description:
        "Read the logged-in seller's lifetime totals (delegations, resource delegated, TRX earned, average price per resource) and a daily earnings chart split into auto, manual, exclusive and extend delegations. " +
        "Use for 'how much did I earn' totals; for the individual delegations behind them use `tronsave_list_delegations`. Requires a wallet signature identity. Read-only.",
      auth: { mode: "signature-session" },
      annotations: readOnly("Seller Statistics"),
      inputSchema: z.object({
        resourceType: resourceType.default("ENERGY").describe("Resource the chart is drawn for."),
        timeFilterBy: z.enum(["D7", "D30", "D365"]).optional().describe("Chart window; default D30."),
      }),
      outputSchema: z.looseObject({
        stats: z.looseObject({}).nullable().optional(),
        chart: z.array(z.looseObject({})),
      }),
      handler: handlers.getSellerStatsHandler,
    },
    {
      name: TOOL_NAMES.PLATFORM.DELEGATIONS_LIST,
      title: "Delegation History",
      description:
        "List the logged-in seller's delegations (resource sent to buyers): amount, TRX amount, duration, unit price, type (AUTO, MANUAL, EXTEND, FAST), status and payout. Newest first; page with `offset`/`limit`. " +
        "Use for a seller's per-delegation history; for earnings totals use `tronsave_get_seller_stats`, for orders the user bought use `tronsave_list_orders` (`isOnlyMyOrder`). Requires a wallet signature identity. Read-only.",
      auth: { mode: "signature-session" },
      annotations: readOnly("Delegation History"),
      inputSchema: z.object({
        offset: offset("delegations"),
        limit: z.number().int().min(1).max(50).optional().describe("Rows to return (default 20, max 50)."),
        timeFilterBy: z.enum(["All", "D7", "D30"]).optional().describe("Time window: All, last 7 days (D7) or last 30 days (D30). Default All."),
        filterByTypeDelegate: z
          .enum(["AUTO", "MANUAL", "EXTEND", "FAST"])
          .optional()
          .describe("Only this delegation type: AUTO (auto-sell pool), MANUAL (`tronsave_sell_order_manual`), EXTEND (extensions), FAST (fast orders). Omit for all."),
        filterByResourceType: resourceType.optional().describe("Only ENERGY or only BANDWIDTH delegations; omit for both."),
      }),
      outputSchema: z.looseObject({ delegations: z.array(z.looseObject({})) }),
      handler: handlers.listDelegationsHandler,
    },
    {
      name: TOOL_NAMES.PLATFORM.AUTO_BUY_SETTINGS_LIST,
      title: "Auto-Buy Rules",
      description:
        "List the logged-in user's auto-buy rules: receiver, resource, unit price cap, threshold, budget/order limits, totals bought and active state. " +
        "Use before `tronsave_update_auto_buy_setting` or `tronsave_delete_auto_buy_setting` to get rule ids. Requires a wallet signature identity. Read-only.",
      auth: { mode: "signature-session" },
      annotations: readOnly("Auto-Buy Rules"),
      inputSchema: z.object({
        offset: offset("rules"),
        limit: z.number().int().min(1).max(10).optional().describe("Rows to return (default 10, max 10)."),
        filterBy: resourceType.optional().describe("Only rules for this resource."),
      }),
      outputSchema: z.looseObject({ settings: z.array(z.looseObject({})) }),
      handler: handlers.listAutoBuySettingsHandler,
    },
    {
      name: TOOL_NAMES.PLATFORM.AUTO_BUY_SETTING_CREATE,
      title: "Create Auto-Buy Rule",
      description:
        "Create a rule that automatically buys `resourceAmount` for `receiver` whenever its remaining resource falls below `thresholdResourceAmount`, paying up to `unitPrice` SUN per unit from the TronSave internal balance. " +
        "Side effect: SPENDS internal TRX every time the rule fires until a budget/order limit or `endActiveAt` stops it; not idempotent (each call adds a rule). " +
        "Confirm receiver, amounts, price cap and limits with the user first; prefer setting `limitBudgetInSun`. Requires a wallet signature identity.",
      auth: { mode: "signature-session" },
      annotations: write("Create Auto-Buy Rule"),
      inputSchema: z.object(autoBuyFields),
      outputSchema: mutationResult,
      handler: handlers.createAutoBuySettingHandler,
    },
    {
      name: TOOL_NAMES.PLATFORM.AUTO_BUY_SETTING_UPDATE,
      title: "Update Auto-Buy Rule",
      description:
        "Change an auto-buy rule by id: pause or resume it with `isActive`, or change any of price cap, amount, duration, threshold and limits (only the fields you send change). " +
        "Side effect: a resumed or loosened rule can start spending internal TRX again. Idempotent for the same arguments. Get ids from `tronsave_list_auto_buy_settings`. Requires a wallet signature identity.",
      auth: { mode: "signature-session" },
      annotations: write("Update Auto-Buy Rule", true),
      inputSchema: z.object({
        id: objectId.describe("Rule id from `tronsave_list_auto_buy_settings`."),
        isActive: z.boolean().optional().describe("false pauses the rule, true resumes it."),
        ...Object.fromEntries(Object.entries(autoBuyFields).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()])),
      }),
      outputSchema: mutationResult.extend({ data: z.looseObject({}).nullable().optional() }),
      handler: handlers.updateAutoBuySettingHandler,
    },
    {
      name: TOOL_NAMES.PLATFORM.NOTIFICATIONS_LIST,
      title: "Notifications",
      description:
        "List the logged-in user's notifications (order created / filled / cancelled / reclaimed, referral payouts) newest first, with the unread count. " +
        "Use to follow up on an order after creating it; page with `offset`/`limit`, and mark items read with `tronsave_mark_notifications_read`. Requires a wallet signature identity. Read-only.",
      auth: { mode: "signature-session" },
      annotations: readOnly("Notifications"),
      inputSchema: z.object({
        offset: offset("notifications"),
        limit: z.number().int().min(1).max(100).optional().describe("Notifications to return (default 20, max 100)."),
        unreadOnly: z.boolean().optional().describe("true returns only unread notifications; default false returns all."),
      }),
      outputSchema: z.looseObject({
        total: z.number(),
        unreadCount: z.number(),
        notifications: z.array(z.looseObject({})),
      }),
      handler: handlers.listNotificationsHandler,
    },
    {
      name: TOOL_NAMES.PLATFORM.NOTIFICATIONS_MARK_READ,
      title: "Mark Notifications Read",
      description:
        "Mark one notification (by `id`) or, when `id` is omitted, ALL of the user's notifications as read. Get ids from `tronsave_list_notifications`. Only changes the read flag; idempotent. Requires a wallet signature identity.",
      auth: { mode: "signature-session" },
      annotations: write("Mark Notifications Read", true),
      inputSchema: z.object({ id: objectId.optional().describe("Notification id; omit to mark everything read.") }),
      outputSchema: mutationResult.extend({ modifiedCount: z.number().optional() }),
      handler: handlers.markNotificationsReadHandler,
    },
    {
      name: TOOL_NAMES.PLATFORM.REFERRAL_GET,
      title: "Referral Program",
      description:
        "Read the logged-in user's referral status: own referral code, sponsor, referral counts, bonus earned and remaining (SUN strings), rank, the referral list (PENDING/ACTIVE) and recent commission payouts. " +
        "Use for referral questions only; account profile is `tronsave_get_user_info`. `offset`/`limit` page the referral list and the payout list together. Requires a wallet signature identity. Read-only.",
      auth: { mode: "signature-session" },
      annotations: readOnly("Referral Program"),
      inputSchema: z.object({
        offset: offset("rows of each list"),
        limit: z.number().int().min(1).max(50).optional().describe("Rows per list (default 10, max 50)."),
        filterBy: z.enum(["PENDING", "ACTIVE"]).optional().describe("Only referrals in this status."),
      }),
      outputSchema: z.looseObject({ userRefCode: z.string().nullable().optional(), totalRef: z.number().nullable().optional() }),
      handler: handlers.getReferralHandler,
    },
    {
      name: TOOL_NAMES.PLATFORM.TELEGRAM_NOTIFY_GET,
      title: "Telegram Notification Settings",
      description:
        "Read the Telegram alert filters of the logged-in user: seller alerts (remaining amount, duration, price and APY ranges, unlocked-only) and buyer alerts (reclaim warning time, low energy / bandwidth thresholds). `setting` is null when Telegram is not linked. " +
        "Read these before changing them with `tronsave_update_telegram_notify_setting` (which replaces whole filter objects). For in-app alerts use `tronsave_list_notifications`. Requires a wallet signature identity. Read-only.",
      auth: { mode: "signature-session" },
      annotations: readOnly("Telegram Notification Settings"),
      inputSchema: EmptyInputSchema,
      outputSchema: z.looseObject({ setting: z.looseObject({}).nullable() }),
      handler: handlers.getTelegramNotifyHandler,
    },
    {
      name: TOOL_NAMES.PLATFORM.TELEGRAM_NOTIFY_UPDATE,
      title: "Update Telegram Notification Settings",
      description:
        "Replace the Telegram alert filters. Send the COMPLETE `sellerFilter` and/or `buyerFilter` objects (read the current ones with `tronsave_get_telegram_notify_setting`, edit, send back); each range or value has `isEnabled` plus its numbers. " +
        "Only changes which alerts are sent; no funds move. Idempotent. Requires a wallet signature identity and a linked Telegram account.",
      auth: { mode: "signature-session" },
      annotations: write("Update Telegram Notification Settings", true),
      inputSchema: z.object({
        sellerFilter: z
          .object({
            isEnabled: z.boolean().describe("Master switch for seller alerts (new buy orders on the market)."),
            onlySendUnlockOrders: z.boolean().describe("true alerts only for orders that do not lock the seller's resource."),
            remainAmount: RANGE("remaining unfilled resource units"),
            duration: RANGE("rental duration in seconds"),
            price: RANGE("unit price in SUN"),
            apy: RANGE("seller APY in percent"),
          })
          .optional()
          .describe("Complete seller alert filter; omit to leave seller alerts unchanged."),
        buyerFilter: z
          .object({
            isEnabled: z.boolean().describe("Master switch for buyer alerts (your delegations and resources)."),
            reclaimAlertTime: VALUE("seconds left before a delegation is reclaimed"),
            lowResourceAlertEnergy: VALUE("remaining ENERGY units of the receiver"),
            lowResourceAlertBandwidth: VALUE("remaining BANDWIDTH units of the receiver"),
          })
          .optional()
          .describe("Complete buyer alert filter; omit to leave buyer alerts unchanged."),
      }),
      outputSchema: mutationResult,
      handler: handlers.updateTelegramNotifyHandler,
    },
    {
      name: TOOL_NAMES.PLATFORM.AGENCY_BOT_GET,
      title: "Agency Bot",
      description:
        "Read the logged-in user's Telegram agency bot (resale bot): name, username, status (PENDING, ACTIVE, INACTIVE, BLOCKED, REJECTED), rewards (total and unpaid) and order / resource statistics. `bot` is null when none is registered. " +
        "The bot token is never returned. Requires a wallet signature identity. Read-only.",
      auth: { mode: "signature-session" },
      annotations: readOnly("Agency Bot"),
      inputSchema: z.object({ timeFilterBy: z.enum(["All", "D7", "D30"]).optional().describe("Statistics window.") }),
      outputSchema: z.looseObject({ bot: z.looseObject({}).nullable() }),
      handler: handlers.getAgencyBotHandler,
    },
    {
      name: TOOL_NAMES.PLATFORM.INTERNAL_TXS_LIST,
      title: "Internal Account Transactions",
      description:
        "List the TRX ledger of the logged-in user's internal account (deposits, order payments, refunds), newest first, with the current balance and deposit address. Amounts are SUN strings. " +
        "Use to reconcile spending after orders. For the orders themselves use `tronsave_internal_order_history` (API key) or `tronsave_list_orders` (`isOnlyMyOrder`); for the balance alone, `tronsave_get_internal_account`. Page with `offset`/`limit`. Requires a wallet signature identity. Read-only.",
      auth: { mode: "signature-session" },
      annotations: readOnly("Internal Account Transactions"),
      inputSchema: z.object({
        offset: offset("ledger entries"),
        limit: z.number().int().min(1).max(50).optional().describe("Ledger entries to return (default 20, max 50)."),
      }),
      outputSchema: z.looseObject({ transactions: z.array(z.looseObject({})) }),
      handler: handlers.listInternalTransactionsHandler,
    },
    {
      name: TOOL_NAMES.PLATFORM.FLASH_UNSTAKE_REQUEST_GET,
      title: "My Flash Unstake Request",
      description:
        "Read the logged-in user's flash-unstake request (selling staked TRX early for an immediate payout): state, payout state, amounts and release progress. `request` is null when there is none. " +
        "Use for the user's own request; to preview a payout before requesting use `tronsave_estimate_flash_unstake`, to browse everyone's orders use `tronsave_list_flash_unstake_orders`. Requires a wallet signature identity. Read-only.",
      auth: { mode: "signature-session" },
      annotations: readOnly("My Flash Unstake Request"),
      inputSchema: EmptyInputSchema,
      outputSchema: z.looseObject({ request: z.looseObject({}).nullable() }),
      handler: handlers.getFlashUnstakeRequestHandler,
    },
    {
      name: TOOL_NAMES.PLATFORM.FLASH_UNSTAKE_ORDERS_LIST,
      title: "Flash Unstake Market",
      description:
        "Browse the flash-unstake market: `available` (open orders buyers can take), `ongoing` (being paid out) or `completed`. Amounts are SUN-scaled numbers; `estimateCompletionTime` is seconds. " +
        "Use to browse the whole market; the user's own request is `tronsave_get_flash_unstake_request` and a payout preview is `tronsave_estimate_flash_unstake`. Public, read-only.",
      auth: { mode: "public" },
      annotations: readOnly("Flash Unstake Market"),
      inputSchema: z.object({
        kind: z.enum(["available", "ongoing", "completed"]).optional().describe("Which orders to list: available (default), ongoing or completed."),
        offset: offset("orders"),
        limit: z.number().int().min(1).max(50).optional().describe("Orders to return (default 10, max 50)."),
      }),
      outputSchema: z.looseObject({ kind: z.string(), orders: z.array(z.looseObject({})) }),
      handler: handlers.listFlashUnstakeOrdersHandler,
    },
    {
      name: TOOL_NAMES.PLATFORM.FLASH_UNSTAKE_ESTIMATE,
      title: "Estimate Flash Unstake",
      description:
        "Estimate what an address would receive by flash-unstaking all its staked TRX now: total staked, fee percentage, payout, delegations to reclaim and the minimum unstake amount. Nothing is submitted. " +
        "Use before requesting a flash unstake; check an existing request with `tronsave_get_flash_unstake_request`. Public (any address), read-only. Fails with 404 when the address has nothing staked.",
      auth: { mode: "public" },
      annotations: readOnly("Estimate Flash Unstake"),
      inputSchema: z.object({ requester: tronAddress("TRON base58 address that owns the stake.") }),
      outputSchema: z.looseObject({ payoutAmount: z.number().optional(), feePercentage: z.number().optional() }),
      handler: handlers.estimateFlashUnstakeHandler,
    },
    {
      name: TOOL_NAMES.PLATFORM.BULK_CREATE_INTERNAL_ORDERS,
      title: "Bulk Buy For Many Receivers",
      description:
        "Buy the SAME amount of ENERGY or BANDWIDTH for several receiver addresses in one call, paid from the TronSave internal balance; returns one order id per receiver. " +
        "Side effect: SPENDS `paymentAmount` SUN of the internal balance; not idempotent (a repeat buys again). Estimate one receiver with `tronsave_estimate_buy_resource` first and show the user receivers, amount and total cost before calling. Requires a wallet signature identity.",
      auth: { mode: "signature-session" },
      annotations: write("Bulk Buy For Many Receivers"),
      inputSchema: z.object({
        resourceType: resourceType.describe("Resource bought for every receiver."),
        receivers: z.array(tronAddress("TRON base58 receiver.")).min(1).max(50).describe("Receiver addresses (1 to 50)."),
        unitPrice: z.number().positive().describe("Unit price in SUN per resource unit, per receiver."),
        durationSec: z.number().positive().describe("Delegation duration in seconds."),
        resourceAmount: z.number().positive().describe("Resource units bought for EACH receiver."),
        paymentAmount: z.number().positive().describe("Total payment in SUN for the whole batch. Must equal the total payout (about unitPrice x resourceAmount x receivers x durationSec / 86400) within 2%; a mismatch is rejected with the expected total."),
        sponsor: z.string().optional().describe("Optional sponsor or referral code."),
      }),
      outputSchema: mutationResult.extend({ data: z.array(z.string().nullable()).nullable().optional() }),
      handler: handlers.bulkCreateInternalOrdersHandler,
    },
  ];
}
