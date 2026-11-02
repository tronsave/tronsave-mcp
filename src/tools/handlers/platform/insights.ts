import type { HelperApi } from "../helper";
import { ok } from "../../../utils/response";
import { AppError } from "../../../utils/errors";
import { stripUndefinedDeep } from "../../../utils/object";
import type { ToolInput } from "../../definitions/definition_type";
import { TOOL_NAMES } from "../../toolNames";
import {
  ACCOUNT_RESOURCES_QUERY,
  AUTO_BUY_SETTINGS_QUERY,
  CREATE_AUTO_BUY_SETTING_MUTATION,
  DELEGATIONS_QUERY,
  EXTENDABLE_RECEIVERS_QUERY,
  MARKET_OVERVIEW_QUERY,
  MARK_ALL_NOTIFICATIONS_READ_MUTATION,
  MARK_NOTIFICATION_READ_MUTATION,
  NOTIFICATIONS_QUERY,
  PRICE_TABLE_QUERY,
  SELLER_STATS_QUERY,
  SUGGEST_CREATE_ORDER_QUERY,
  SYSTEM_INFO_QUERY,
  UPDATE_AUTO_BUY_SETTING_MUTATION,
  AGENCY_BOT_QUERY,
  BULK_CREATE_INTERNAL_MUTATION,
  ESTIMATE_FLASH_UNSTAKE_QUERY,
  FLASH_UNSTAKE_ORDERS_COMPLETE_QUERY,
  FLASH_UNSTAKE_ORDERS_ONGOING_QUERY,
  FLASH_UNSTAKE_ORDERS_PUBLIC_QUERY,
  FLASH_UNSTAKE_REQUEST_QUERY,
  INTERNAL_TXS_QUERY,
  REFERRAL_QUERY,
  TELEGRAM_NOTIFY_QUERY,
  UPDATE_TELEGRAM_NOTIFY_MUTATION,
} from "./gql/insights";

type Gql = Record<string, any>;

/**
 * Read models and small account actions that sit on the TronSave GraphQL API: market overview,
 * price table, protocol parameters, per-address resources, order suggestions, seller stats,
 * delegation history, auto-buy rules and notifications.
 */
export function createInsightHandlers(helper: HelperApi) {
  const { fetchGraphqlApi } = helper;
  const strip = (v: unknown) => stripUndefinedDeep(v) as Record<string, unknown>;
  const signature = { requireSignature: true } as const;
  // Auto-buy rules are paid from the internal balance, so upstream also wants the account's api key.
  const signatureAndKey = { requireSignature: true, requireSessionApiKey: true } as const;

  const getMarketOverviewHandler = async (_input: ToolInput) => {
    const { data } = await fetchGraphqlApi(MARKET_OVERVIEW_QUERY, {}, {}, TOOL_NAMES.PLATFORM.MARKET_OVERVIEW_GET);
    const m = (data as Gql).market ?? {};
    return ok({
      resources: m.resources ?? null,
      totalPool: m.totalPool ?? null,
      apy: { energy: m.energyApy ?? null, bandwidth: m.bandwidthApy ?? null },
    });
  };

  const getPriceTableHandler = async (input: ToolInput) => {
    const { data } = await fetchGraphqlApi(PRICE_TABLE_QUERY, strip(input), {}, TOOL_NAMES.PLATFORM.PRICE_TABLE_GET);
    const t = (data as Gql).market?.resourcePriceTable;
    if (!t) {
      throw new AppError("No price table available for this resource.", 502, "PRICE_TABLE_EMPTY");
    }
    return ok({ durations: t.durations, amounts: t.amounts, prices: t.prices });
  };

  const getSystemInfoHandler = async (_input: ToolInput) => {
    const { data } = await fetchGraphqlApi(SYSTEM_INFO_QUERY, {}, {}, TOOL_NAMES.PLATFORM.SYSTEM_INFO_GET);
    return ok((data as Gql).system ?? {});
  };

  const getAccountResourcesHandler = async (input: ToolInput) => {
    const { data } = await fetchGraphqlApi(
      ACCOUNT_RESOURCES_QUERY,
      strip(input),
      {},
      TOOL_NAMES.PLATFORM.ACCOUNT_RESOURCES_GET,
    );
    return ok((data as Gql).user ?? {});
  };

  const suggestCreateOrderHandler = async (input: ToolInput) => {
    const { requester, options, ...orderInfo } = input;
    const { data } = await fetchGraphqlApi(
      SUGGEST_CREATE_ORDER_QUERY,
      strip({ requester, orderInfo, options }),
      {},
      TOOL_NAMES.PLATFORM.SUGGEST_CREATE_ORDER,
    );
    return ok({ suggestions: (data as Gql).market?.suggestCreateOrder ?? [] });
  };

  const listExtendableReceiversHandler = async (input: ToolInput) => {
    const { data } = await fetchGraphqlApi(
      EXTENDABLE_RECEIVERS_QUERY,
      strip(input),
      {},
      TOOL_NAMES.PLATFORM.EXTENDABLE_RECEIVERS_LIST,
    );
    return ok({ receivers: (data as Gql).market?.extendableReceivers ?? [] });
  };

  const getSellerStatsHandler = async (input: ToolInput) => {
    const { data } = await fetchGraphqlApi(
      SELLER_STATS_QUERY,
      strip({ timeFilterBy: "D30", ...input }),
      {},
      TOOL_NAMES.PLATFORM.SELLER_STATS_GET,
      signature,
    );
    const u = (data as Gql).user ?? {};
    return ok({ stats: u.stats ?? null, chart: u.chartSellers ?? [] });
  };

  const listDelegationsHandler = async (input: ToolInput) => {
    const { data } = await fetchGraphqlApi(
      DELEGATIONS_QUERY,
      strip({ limit: 20, ...input }),
      {},
      TOOL_NAMES.PLATFORM.DELEGATIONS_LIST,
      signature,
    );
    return ok({ delegations: (data as Gql).user?.delegates ?? [] });
  };

  const listAutoBuySettingsHandler = async (input: ToolInput) => {
    const { filterBy, ...rest } = input;
    const { data } = await fetchGraphqlApi(
      AUTO_BUY_SETTINGS_QUERY,
      strip({ limit: 10, ...rest, filterBy: filterBy ? [filterBy] : undefined }),
      {},
      TOOL_NAMES.PLATFORM.AUTO_BUY_SETTINGS_LIST,
      signature,
    );
    return ok({ settings: (data as Gql).user?.autoBuySettings ?? [] });
  };

  const createAutoBuySettingHandler = async (input: ToolInput) => {
    const { thresholdResourceAmount, limitBudgetInSun, limitInOrderCount, startActiveAt, endActiveAt, ...buyInfo } =
      input;
    const options = strip({ thresholdResourceAmount, limitBudgetInSun, limitInOrderCount, startActiveAt, endActiveAt });
    const { data } = await fetchGraphqlApi(
      CREATE_AUTO_BUY_SETTING_MUTATION,
      { buyInfo: strip(buyInfo), options },
      {},
      TOOL_NAMES.PLATFORM.AUTO_BUY_SETTING_CREATE,
      signatureAndKey,
    );
    const r = (data as Gql).users?.createAutoBuySetting;
    if (!r) throw new AppError("GraphQL response missing users.createAutoBuySetting", 502, "CREATE_AUTO_BUY_EMPTY");
    return ok(r);
  };

  const updateAutoBuySettingHandler = async (input: ToolInput) => {
    const { id, isActive, thresholdResourceAmount, limitBudgetInSun, limitInOrderCount, startActiveAt, endActiveAt, ...buyInfo } =
      input;
    const options = strip({ thresholdResourceAmount, limitBudgetInSun, limitInOrderCount, startActiveAt, endActiveAt });
    const info = strip(buyInfo);
    const { data } = await fetchGraphqlApi(
      UPDATE_AUTO_BUY_SETTING_MUTATION,
      strip({
        id,
        isActive,
        buyInfo: Object.keys(info).length ? info : undefined,
        options: Object.keys(options).length ? options : undefined,
      }),
      {},
      TOOL_NAMES.PLATFORM.AUTO_BUY_SETTING_UPDATE,
      signatureAndKey,
    );
    const r = (data as Gql).users?.updateAutoBuySetting;
    if (!r) throw new AppError("GraphQL response missing users.updateAutoBuySetting", 502, "UPDATE_AUTO_BUY_EMPTY");
    return ok(r);
  };

  const listNotificationsHandler = async (input: ToolInput) => {
    const { data } = await fetchGraphqlApi(
      NOTIFICATIONS_QUERY,
      strip({ limit: 20, ...input }),
      {},
      TOOL_NAMES.PLATFORM.NOTIFICATIONS_LIST,
      signature,
    );
    const u = (data as Gql).user ?? {};
    return ok({
      total: u.notifications?.total ?? 0,
      unreadCount: u.unreadNotificationCount?.count ?? 0,
      notifications: u.notifications?.data ?? [],
    });
  };

  const markNotificationsReadHandler = async (input: ToolInput) => {
    const id = typeof input.id === "string" ? input.id : undefined;
    const { data } = await fetchGraphqlApi(
      id ? MARK_NOTIFICATION_READ_MUTATION : MARK_ALL_NOTIFICATIONS_READ_MUTATION,
      id ? { id } : {},
      {},
      TOOL_NAMES.PLATFORM.NOTIFICATIONS_MARK_READ,
      signature,
    );
    const users = (data as Gql).users ?? {};
    const r = id ? users.markNotificationRead : users.markAllNotificationsRead;
    if (!r) throw new AppError("GraphQL response missing mark-read result", 502, "MARK_READ_EMPTY");
    return ok(r);
  };


  const getReferralHandler = async (input: ToolInput) => {
    const { data } = await fetchGraphqlApi(REFERRAL_QUERY, strip({ limit: 10, ...input }), {}, TOOL_NAMES.PLATFORM.REFERRAL_GET, signature);
    return ok((data as Gql).user?.info ?? {});
  };

  const getTelegramNotifyHandler = async (_input: ToolInput) => {
    const { data } = await fetchGraphqlApi(TELEGRAM_NOTIFY_QUERY, {}, {}, TOOL_NAMES.PLATFORM.TELEGRAM_NOTIFY_GET, signature);
    return ok({ setting: (data as Gql).user?.telegramNotifySetting ?? null });
  };

  const updateTelegramNotifyHandler = async (input: ToolInput) => {
    const { data } = await fetchGraphqlApi(
      UPDATE_TELEGRAM_NOTIFY_MUTATION,
      { data: strip(input) },
      {},
      TOOL_NAMES.PLATFORM.TELEGRAM_NOTIFY_UPDATE,
      signature,
    );
    const r = (data as Gql).users?.updateTelegramNotifySetting;
    if (!r) throw new AppError("GraphQL response missing users.updateTelegramNotifySetting", 502, "TELEGRAM_NOTIFY_EMPTY");
    return ok(r);
  };

  const getAgencyBotHandler = async (input: ToolInput) => {
    const { data } = await fetchGraphqlApi(AGENCY_BOT_QUERY, strip(input), {}, TOOL_NAMES.PLATFORM.AGENCY_BOT_GET, signature);
    return ok({ bot: (data as Gql).user?.botAgency ?? null });
  };

  const listInternalTransactionsHandler = async (input: ToolInput) => {
    const { data } = await fetchGraphqlApi(
      INTERNAL_TXS_QUERY,
      strip({ limit: 20, ...input }),
      {},
      TOOL_NAMES.PLATFORM.INTERNAL_TXS_LIST,
      signature,
    );
    const a = (data as Gql).user?.internalAcc ?? null;
    return ok({
      balance: a?.balance ?? null,
      depositAddress: a?.depositAddress ?? null,
      transactions: a?.internalTxs ?? [],
    });
  };

  const getFlashUnstakeRequestHandler = async (_input: ToolInput) => {
    const { data } = await fetchGraphqlApi(FLASH_UNSTAKE_REQUEST_QUERY, {}, {}, TOOL_NAMES.PLATFORM.FLASH_UNSTAKE_REQUEST_GET, signature);
    return ok({ request: (data as Gql).user?.flashUnstakeRequest ?? null });
  };

  const listFlashUnstakeOrdersHandler = async (input: ToolInput) => {
    const { kind = "available", ...page } = input;
    const query =
      kind === "completed"
        ? FLASH_UNSTAKE_ORDERS_COMPLETE_QUERY
        : kind === "ongoing"
          ? FLASH_UNSTAKE_ORDERS_ONGOING_QUERY
          : FLASH_UNSTAKE_ORDERS_PUBLIC_QUERY;
    const { data } = await fetchGraphqlApi(query, strip({ limit: 10, ...page }), {}, TOOL_NAMES.PLATFORM.FLASH_UNSTAKE_ORDERS_LIST);
    const f = (data as Gql).flashUnstake ?? {};
    return ok({ kind, orders: f.completeOrders ?? f.ongoingOrders ?? f.publicOrders ?? [] });
  };

  const estimateFlashUnstakeHandler = async (input: ToolInput) => {
    const { data } = await fetchGraphqlApi(ESTIMATE_FLASH_UNSTAKE_QUERY, strip(input), {}, TOOL_NAMES.PLATFORM.FLASH_UNSTAKE_ESTIMATE);
    const e = (data as Gql).market?.estimateFlashUnstakePayout;
    if (!e) throw new AppError("No flash-unstake estimate for this address (nothing staked?).", 404, "FLASH_UNSTAKE_ESTIMATE_EMPTY");
    return ok(e);
  };

  const bulkCreateInternalOrdersHandler = async (input: ToolInput) => {
    const { paymentAmount, ...orderInfo } = input;
    const { data } = await fetchGraphqlApi(
      BULK_CREATE_INTERNAL_MUTATION,
      { orderInfo: strip(orderInfo), paymentMethod: { paymentAmount } },
      {},
      TOOL_NAMES.PLATFORM.BULK_CREATE_INTERNAL_ORDERS,
      signatureAndKey,
    );
    const r = (data as Gql).orders?.bulkCreateInternal;
    if (!r) throw new AppError("GraphQL response missing orders.bulkCreateInternal", 502, "BULK_CREATE_EMPTY");
    return ok(r);
  };

  return {
    getMarketOverviewHandler,
    getPriceTableHandler,
    getSystemInfoHandler,
    getAccountResourcesHandler,
    suggestCreateOrderHandler,
    listExtendableReceiversHandler,
    getSellerStatsHandler,
    listDelegationsHandler,
    listAutoBuySettingsHandler,
    createAutoBuySettingHandler,
    updateAutoBuySettingHandler,
    listNotificationsHandler,
    markNotificationsReadHandler,
    getReferralHandler,
    getTelegramNotifyHandler,
    updateTelegramNotifyHandler,
    getAgencyBotHandler,
    listInternalTransactionsHandler,
    getFlashUnstakeRequestHandler,
    listFlashUnstakeOrdersHandler,
    estimateFlashUnstakeHandler,
    bulkCreateInternalOrdersHandler,
  };
}
