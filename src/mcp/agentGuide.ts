import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Sent in the `initialize` result (`instructions`). MCP clients inject it into the model's
 * context, so it must stay short, imperative and accurate. Long-form material lives in the
 * `tronsave://guide/agent` resource.
 */
export const SERVER_INSTRUCTIONS = `TronSave MCP: rent TRON ENERGY / BANDWIDTH on the TronSave market and manage TronSave accounts.

Units: unit prices are SUN per resource unit; payment amounts are SUN (1 TRX = 1,000,000 SUN). durationSec is seconds. Under 1 day a unit price covers the whole rental; from 1 day up it is charged per started day (total = amount x unitPrice x ceil(durationSec / 86400)). For an exact total use estimateTrx from tronsave_estimate_buy_resource. Fields named extendTo (internal extend tools) are Unix epoch SECONDS.
Network is fixed by the URL: /mcp = mainnet, /testnet/mcp = Nile testnet.

Auth (check anytime with tronsave_get_session_status):
- public tools: market data, quotes, tronsave_list_orders, tronsave_create_order with paymentMethod=onchain.
- API key: tronsave_login {apiKey} or client header "Authorization: ApiKey <key>". Unlocks internal-account tools and paymentMethod=internal.
- Wallet signature: tronsave_get_sign_message -> the user signs "message" in their own wallet -> tronsave_login {signature: "<signature>_<timestamp>"}. Unlocks profile, order update/cancel/manual-sell, auto-sell and api-key management.
- If the app connected through OAuth sign-in, the user is already authenticated: check tronsave_get_session_status before asking them to log in.
- Login is bound to this MCP connection automatically; never put session ids in tool arguments.
- Never ask for private keys or seed phrases. All signing happens in the user's wallet.

Buying resources:
1. tronsave_estimate_buy_resource -> unitPrice (SUN), estimateTrx (SUN), availableResource.
2. Present receiver, amount, duration, unit price and total (TRX) and get explicit user confirmation.
3. tronsave_create_order using orderUnitPrice / paymentPaymentAmount from step 1.
4. Verify with tronsave_get_order (signature session) or tronsave_list_orders.

Safety:
- Ask the user before calling any tool that is not readOnly.
- Errors return {"error":{"code","message","retryable","hint"}}: follow hint. Never repeat a write when retryable is false; after UPSTREAM_TIMEOUT on a write, verify state first.
- Reference: resource tronsave://guide/agent.`;

export const AGENT_GUIDE_MARKDOWN = `# TronSave MCP — Agent Guide

${SERVER_INSTRUCTIONS}

## Tool map

| Goal | Tool | Auth |
|---|---|---|
| Check who I am / what is unlocked | \`tronsave_get_session_status\` | public |
| Price & availability for a buy | \`tronsave_estimate_buy_resource\` | public |
| Lowest unit price | \`tronsave_get_min_price\` | public |
| Market depth | \`tronsave_list_order_books\` | public |
| Browse orders / my orders | \`tronsave_list_orders\` (\`isOnlyMyOrder\` needs signature) | public |
| Extension discovery | \`tronsave_list_extendable_delegates\` | public |
| Buy resources | \`tronsave_create_order\` | public (onchain) / api key (internal) |
| Login / logout | \`tronsave_get_sign_message\`, \`tronsave_login\`, \`tronsave_logout\` | public |
| One order snapshot | \`tronsave_get_order\` | signature |
| Update / cancel / manual sell | \`tronsave_update_order\`, \`tronsave_cancel_order\`, \`tronsave_sell_order_manual\` | signature |
| Profile, permissions, auto-sell | \`tronsave_get_user_info\`, \`tronsave_get_user_permissions\`, \`tronsave_get_user_auto_setting\`, \`tronsave_register_auto_sell\`, \`tronsave_update_auto_sell_setting\` | signature |
| API keys, auto-buy rules | \`tronsave_generate_api_key\`, \`tronsave_revoke_api_key\`, \`tronsave_delete_auto_buy_setting\` | signature |
| Internal balance & deposit | \`tronsave_get_internal_account\`, \`tronsave_get_deposit_address\` | api key |
| Internal quote / buy / history | \`tronsave_internal_order_estimate\`, \`tronsave_internal_order_create\`, \`tronsave_internal_order_history\`, \`tronsave_internal_order_details\`, \`tronsave_internal_order_book\` | api key |
| Extend delegations | \`tronsave_internal_extend_delegates\` then \`tronsave_internal_create_extend_request\` | api key |
| Market overview, protocol parameters, price grid | \`tronsave_get_market_overview\`, \`tronsave_get_system_info\`, \`tronsave_get_price_table\` | public |
| How would this buy be filled / extendable receivers / any address's resources | \`tronsave_suggest_create_order\`, \`tronsave_list_extendable_receivers\`, \`tronsave_get_account_resources\` | public |
| Flash unstake market and estimate | \`tronsave_list_flash_unstake_orders\`, \`tronsave_estimate_flash_unstake\` | public |
| Seller earnings and delegations | \`tronsave_get_seller_stats\`, \`tronsave_list_delegations\` | signature |
| Auto-buy rules | \`tronsave_list_auto_buy_settings\`, \`tronsave_create_auto_buy_setting\`, \`tronsave_update_auto_buy_setting\` | signature |
| Notifications, Telegram alerts | \`tronsave_list_notifications\`, \`tronsave_mark_notifications_read\`, \`tronsave_get_telegram_notify_setting\`, \`tronsave_update_telegram_notify_setting\` | signature |
| Referral, agency bot, internal ledger, my flash unstake | \`tronsave_get_referral\`, \`tronsave_get_agency_bot\`, \`tronsave_list_internal_transactions\`, \`tronsave_get_flash_unstake_request\` | signature |
| Buy for many receivers | \`tronsave_bulk_create_internal_orders\` (paymentAmount must match the total payout within 2%) | signature + internal balance |

## Payment methods for \`tronsave_create_order\`

- \`internal\`: debits the TronSave internal balance of the API key. Top up via \`tronsave_get_deposit_address\` (TRX only, minimum 10 TRX).
- \`onchain\`: the user's wallet signs a TRX transfer of \`paymentPaymentAmount\` SUN to \`systemDepositAddress\` (from the estimate) and the signed transaction object is passed as \`paymentSignedTx\`. Never fabricate or edit a signed transaction.

## Error codes

| Code | Meaning | What to do |
|---|---|---|
| \`SESSION_REQUIRED\` | Tool needs auth | Log in (see hint) and retry |
| \`INVALID_SESSION_TYPE\` | Needs wallet signature, have api key | Do signature login |
| \`API_KEY_SESSION_REQUIRED\` | Needs internal API key | Api-key login or header |
| \`INVALID_API_KEY\`, \`INVALID_SIGNATURE\`, \`SIGNATURE_EXPIRED\` | Credentials rejected | Fix credentials / re-sign |
| \`UPSTREAM_UNAUTHORIZED\` | TronSave rejected the session | Re-login |
| \`GRAPHQL_ERROR\`, \`REST_ERROR\` | Business rule rejected the request | Read message, fix inputs |
| \`UPSTREAM_TIMEOUT\`, \`UPSTREAM_UNREACHABLE\`, \`UPSTREAM_UNAVAILABLE\` | TronSave slow/down | Reads: retry later. Writes: verify state first |
| \`INTERNAL_ERROR\` | Unexpected | Report to user |

Input validation failures are returned as tool errors that start with "Input validation error"; fix the arguments to match the tool's inputSchema.
`;

/** Registers read-only guide resources and user-invocable prompts on a server instance. */
export const registerAgentGuide = (server: McpServer): void => {
  server.registerResource(
    "agent-guide",
    "tronsave://guide/agent",
    {
      title: "TronSave MCP agent guide",
      description: "Auth model, units, workflows, tool map and error codes for agents using this server.",
      mimeType: "text/markdown",
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: AGENT_GUIDE_MARKDOWN }] }),
  );

  server.registerPrompt(
    "buy_resource",
    {
      title: "Buy ENERGY or BANDWIDTH",
      description: "Quote, confirm and place a TronSave order for a receiver address.",
      argsSchema: {
        receiver: z.string().describe("TRON address that receives the resource"),
        amount: z.string().optional().describe("Resource units, e.g. 65000"),
        resourceType: z.string().optional().describe("ENERGY (default) or BANDWIDTH"),
        duration: z.string().optional().describe("Duration, e.g. 1h, 1d, 3d"),
      },
    },
    async ({ receiver, amount, resourceType, duration }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Buy ${amount ?? "65000"} ${resourceType ?? "ENERGY"} for ${receiver} for ${duration ?? "1 hour"} on TronSave. ` +
              "First call tronsave_get_session_status and tronsave_estimate_buy_resource, show me the plan with the total in TRX, " +
              "wait for my explicit confirmation, then call tronsave_create_order and verify the result.",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "account_overview",
    {
      title: "TronSave account overview",
      description: "Summarize auth state, balances and recent orders for the logged-in account.",
    },
    async () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Give me an overview of my TronSave account: call tronsave_get_session_status, then the account tools that are unlocked " +
              "(tronsave_get_internal_account and/or tronsave_get_user_info) and tronsave_list_orders with isOnlyMyOrder when available. " +
              "Read-only: do not change anything.",
          },
        },
      ],
    }),
  );
};
