import { beforeEach, describe, expect, it, vi } from "vitest";
import { withRequestContext } from "../../src/handlers/authContext";
import type { AuthContext } from "../../src/schemas/auth";
import { createHelper } from "../../src/tools/handlers/helper";
import { createInsightHandlers } from "../../src/tools/handlers/platform/insights";
import { createInsightTools } from "../../src/tools/definitions/platform/insights";

/** Locks how each insight tool maps onto the TronSave GraphQL API: variables, headers, defaults. */
const gqlRequest = vi.fn(async (..._args: unknown[]) => ({}) as Record<string, unknown>);

const handlers = () =>
  createInsightHandlers(
    createHelper({
      redisService: {} as never,
      clientsByNetwork: {
        mainnet: { restClient: {} as never, graphqlClient: { request: gqlRequest } as never },
        testnet: { restClient: {} as never, graphqlClient: { request: gqlRequest } as never },
      },
    }),
  );

const auth = {
  type: "session",
  sessionAuthType: "signature",
  walletAddress: "TWallet",
  signature: "0xsig_1",
  token: "0xsig_1",
  apiKey: "key-1",
} as unknown as AuthContext;
const run = <T>(fn: () => Promise<T>) => withRequestContext({ headers: {}, auth, network: "mainnet" }, fn);
const last = () => gqlRequest.mock.calls[gqlRequest.mock.calls.length - 1] as [string, Record<string, unknown>, Record<string, string>];
const text = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

beforeEach(() => gqlRequest.mockReset());

describe("insight tools — GraphQL mapping", () => {
  it("market overview flattens the aliased APY fields", async () => {
    gqlRequest.mockResolvedValueOnce({ market: { resources: { totalAvailableEnergy: 5 }, totalPool: 3, energyApy: 12, bandwidthApy: 4 } });
    const r = await run(() => handlers().getMarketOverviewHandler({}));
    expect(text(r as never)).toMatchObject({ totalPool: 3, apy: { energy: 12, bandwidth: 4 } });
  });

  it("public tools send no credentials", async () => {
    gqlRequest.mockResolvedValueOnce({ market: { resourcePriceTable: { durations: ["1h"], amounts: [1], prices: [[2]] } } });
    await run(() => handlers().getPriceTableHandler({ resourceType: "ENERGY" }));
    const headers = last()[2];
    expect(headers.authorization).toBeUndefined();
    expect(headers.apikey).toBeUndefined();
  });

  it("signature reads forward the signature but not the api key", async () => {
    gqlRequest.mockResolvedValueOnce({ user: { delegates: [] } });
    await run(() => handlers().listDelegationsHandler({}));
    const [, vars, headers] = last();
    expect(headers.authorization).toBe("0xsig_1");
    expect(headers.apikey).toBeUndefined();
    expect(vars).toMatchObject({ limit: 20 });
  });

  it("auto-buy list defaults to the upstream page-size cap of 10 and wraps the filter", async () => {
    gqlRequest.mockResolvedValueOnce({ user: { autoBuySettings: [] } });
    await run(() => handlers().listAutoBuySettingsHandler({ filterBy: "ENERGY" }));
    expect(last()[1]).toMatchObject({ limit: 10, filterBy: ["ENERGY"] });
  });

  it("auto-buy create splits buyInfo / options and sends signature AND api key", async () => {
    gqlRequest.mockResolvedValueOnce({ users: { createAutoBuySetting: { code: 200, success: true, message: "ok" } } });
    await run(() =>
      handlers().createAutoBuySettingHandler({
        resourceType: "ENERGY", receiver: "TRcv", unitPrice: "60", durationSec: 3600, resourceAmount: 65000,
        thresholdResourceAmount: 100000, limitBudgetInSun: "20000000",
      }),
    );
    const [, vars, headers] = last();
    expect(vars.buyInfo).toEqual({ resourceType: "ENERGY", receiver: "TRcv", unitPrice: "60", durationSec: 3600, resourceAmount: 65000 });
    expect(vars.options).toEqual({ thresholdResourceAmount: 100000, limitBudgetInSun: "20000000" });
    expect(headers.authorization).toBe("0xsig_1");
    expect(headers.apikey).toBe("key-1");
  });

  it("auto-buy update only sends the fields that changed", async () => {
    gqlRequest.mockResolvedValueOnce({ users: { updateAutoBuySetting: { success: true } } });
    await run(() => handlers().updateAutoBuySettingHandler({ id: "a".repeat(24), isActive: false }));
    const vars = last()[1];
    expect(vars).toEqual({ id: "a".repeat(24), isActive: false });
  });

  it("mark-read picks the single or the all mutation", async () => {
    gqlRequest.mockResolvedValue({ users: { markNotificationRead: { success: true }, markAllNotificationsRead: { success: true } } });
    await run(() => handlers().markNotificationsReadHandler({ id: "b".repeat(24) }));
    expect(last()[0]).toContain("markNotificationRead(id");
    await run(() => handlers().markNotificationsReadHandler({}));
    expect(last()[0]).toContain("markAllNotificationsRead");
  });

  it("flash-unstake kinds select the matching query and unwrap the right list", async () => {
    gqlRequest.mockResolvedValueOnce({ flashUnstake: { completeOrders: [{ id: "x" }] } });
    const r = await run(() => handlers().listFlashUnstakeOrdersHandler({ kind: "completed" }));
    expect(last()[0]).toContain("completeOrders");
    expect(text(r as never)).toEqual({ kind: "completed", orders: [{ id: "x" }] });
  });

  it("flash-unstake estimate turns an empty answer into a clean 404", async () => {
    gqlRequest.mockResolvedValueOnce({ market: { estimateFlashUnstakePayout: null } });
    await expect(run(() => handlers().estimateFlashUnstakeHandler({ requester: "TReq" }))).rejects.toMatchObject({
      code: "FLASH_UNSTAKE_ESTIMATE_EMPTY",
    });
  });

  it("bulk buy nests paymentAmount into paymentMethod and needs the api key", async () => {
    gqlRequest.mockResolvedValueOnce({ orders: { bulkCreateInternal: { success: true, data: ["1", "2"] } } });
    await run(() =>
      handlers().bulkCreateInternalOrdersHandler({
        resourceType: "ENERGY", receivers: ["TA", "TB"], unitPrice: 100, durationSec: 3600, resourceAmount: 64000, paymentAmount: 12_800_000,
      }),
    );
    const [, vars, headers] = last();
    expect(vars.paymentMethod).toEqual({ paymentAmount: 12_800_000 });
    expect(vars.orderInfo).toMatchObject({ receivers: ["TA", "TB"] });
    expect(headers.apikey).toBe("key-1");
  });
});

describe("insight tool definitions", () => {
  const tools = createInsightTools({} as never);
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

  it("exposes unique, correctly gated tools", () => {
    expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
    expect(byName.tronsave_get_market_overview.auth.mode).toBe("public");
    expect(byName.tronsave_create_auto_buy_setting.auth.mode).toBe("signature-session");
    expect(byName.tronsave_bulk_create_internal_orders.auth.mode).toBe("signature-session");
  });

  const WRITES = new Set([
    "tronsave_create_auto_buy_setting",
    "tronsave_update_auto_buy_setting",
    "tronsave_mark_notifications_read",
    "tronsave_update_telegram_notify_setting",
    "tronsave_bulk_create_internal_orders",
  ]);

  it("marks money-moving tools as writes and reads as read-only", () => {
    for (const t of tools) {
      const writes = WRITES.has(t.name);
      expect(t.annotations?.readOnlyHint, t.name).toBe(!writes);
    }
  });

  it("validates inputs the way TronSave does", () => {
    const create = byName.tronsave_create_auto_buy_setting.inputSchema;
    expect(create.safeParse({}).success).toBe(false);
    expect(byName.tronsave_get_account_resources.inputSchema.safeParse({ address: "nope" }).success).toBe(false);
    expect(byName.tronsave_list_auto_buy_settings.inputSchema.safeParse({ limit: 11 }).success).toBe(false);
    expect(byName.tronsave_list_delegations.inputSchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(byName.tronsave_mark_notifications_read.inputSchema.safeParse({ id: "zz" }).success).toBe(false);
  });
});
