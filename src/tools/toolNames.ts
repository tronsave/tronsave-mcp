export const TRONSAVE_TOOL_PREFIX = "tronsave" as const;

type Prefixed<T extends string> = `${typeof TRONSAVE_TOOL_PREFIX}${T}`;
const withTronSavePrefix = <T extends string>(name: T): Prefixed<T> =>
  `${TRONSAVE_TOOL_PREFIX}_${name}` as Prefixed<T>;

export const TOOL_NAMES = {
  PLATFORM: {
    GET_SIGN_MESSAGE: withTronSavePrefix('get_sign_message'),
    LOGIN: withTronSavePrefix('login'),
    LOGOUT: withTronSavePrefix('logout'),
    SESSION_STATUS: withTronSavePrefix('get_session_status'),
    USER_INFO_GET: withTronSavePrefix('get_user_info'),
    USER_PERMISSIONS_GET: withTronSavePrefix('get_user_permissions'),
    USER_AUTO_SETTING_GET: withTronSavePrefix('get_user_auto_setting'),
    ESTIMATE_BUY_RESOURCE: withTronSavePrefix('estimate_buy_resource'),
    ORDER_DETAIL: withTronSavePrefix('get_order'),
    LIST_ORDERS: withTronSavePrefix('list_orders'),
    ORDER_BOOK: withTronSavePrefix('list_order_books'),
    /** GraphQL `Query.market.estimateMinPrice` — public market quote, no session. */
    GET_MIN_PRICE: withTronSavePrefix('get_min_price'),
    EXTENDABLE_DELEGATES_GET: withTronSavePrefix('list_extendable_delegates'),
    ORDER_CREATE: withTronSavePrefix('create_order'),
    ORDER_SELL_MANUAL: withTronSavePrefix('sell_order_manual'),
    ORDER_CANCEL: withTronSavePrefix('cancel_order'),
    ORDER_UPDATE: withTronSavePrefix('update_order'),
    REGISTER_AUTO_SELL: withTronSavePrefix('register_auto_sell'),
    UPDATE_AUTO_SELL_SETTING: withTronSavePrefix('update_auto_sell_setting'),
    GENERATE_API_KEY: withTronSavePrefix('generate_api_key'),
    REVOKE_API_KEY: withTronSavePrefix('revoke_api_key'),
    DELETE_AUTO_BUY_SETTING: withTronSavePrefix('delete_auto_buy_setting'),
    MARKET_OVERVIEW_GET: withTronSavePrefix('get_market_overview'),
    PRICE_TABLE_GET: withTronSavePrefix('get_price_table'),
    SYSTEM_INFO_GET: withTronSavePrefix('get_system_info'),
    ACCOUNT_RESOURCES_GET: withTronSavePrefix('get_account_resources'),
    SUGGEST_CREATE_ORDER: withTronSavePrefix('suggest_create_order'),
    EXTENDABLE_RECEIVERS_LIST: withTronSavePrefix('list_extendable_receivers'),
    SELLER_STATS_GET: withTronSavePrefix('get_seller_stats'),
    DELEGATIONS_LIST: withTronSavePrefix('list_delegations'),
    AUTO_BUY_SETTINGS_LIST: withTronSavePrefix('list_auto_buy_settings'),
    AUTO_BUY_SETTING_CREATE: withTronSavePrefix('create_auto_buy_setting'),
    AUTO_BUY_SETTING_UPDATE: withTronSavePrefix('update_auto_buy_setting'),
    NOTIFICATIONS_LIST: withTronSavePrefix('list_notifications'),
    NOTIFICATIONS_MARK_READ: withTronSavePrefix('mark_notifications_read'),
    REFERRAL_GET: withTronSavePrefix('get_referral'),
    TELEGRAM_NOTIFY_GET: withTronSavePrefix('get_telegram_notify_setting'),
    TELEGRAM_NOTIFY_UPDATE: withTronSavePrefix('update_telegram_notify_setting'),
    AGENCY_BOT_GET: withTronSavePrefix('get_agency_bot'),
    INTERNAL_TXS_LIST: withTronSavePrefix('list_internal_transactions'),
    FLASH_UNSTAKE_REQUEST_GET: withTronSavePrefix('get_flash_unstake_request'),
    FLASH_UNSTAKE_ORDERS_LIST: withTronSavePrefix('list_flash_unstake_orders'),
    FLASH_UNSTAKE_ESTIMATE: withTronSavePrefix('estimate_flash_unstake'),
    BULK_CREATE_INTERNAL_ORDERS: withTronSavePrefix('bulk_create_internal_orders'),
  },
  INTERNAL: {
    INTERNAL_ACCOUNT_GET: withTronSavePrefix('get_internal_account'),
    GET_DEPOSIT_ADDRESS: withTronSavePrefix('get_deposit_address'),
    INTERNAL_ORDER_HISTORY: withTronSavePrefix('internal_order_history'),
    INTERNAL_ORDER_DETAILS: withTronSavePrefix('internal_order_details'),
    INTERNAL_ORDER_BOOK: withTronSavePrefix('internal_order_book'),
    INTERNAL_ORDER_ESTIMATE: withTronSavePrefix('internal_order_estimate'),
    INTERNAL_ORDER_CREATE: withTronSavePrefix('internal_order_create'),
    INTERNAL_EXTEND_DELEGATES: withTronSavePrefix('internal_extend_delegates'),
    INTERNAL_EXTEND_REQUEST: withTronSavePrefix('internal_create_extend_request'),
  },
} as const;

export type ToolName =
  | (typeof TOOL_NAMES.PLATFORM)[keyof typeof TOOL_NAMES.PLATFORM]
  | (typeof TOOL_NAMES.INTERNAL)[keyof typeof TOOL_NAMES.INTERNAL];
