import { describe, expect, it } from "vitest";
import { createAllTools } from "../../src/tools";
import { createInternalTools } from "../../src/tools/definitions/internal";
import { createPlatformTools } from "../../src/tools/definitions/platform";

const noopHandler = async () => ({
  content: [{ type: "text" as const, text: "{}" }],
  structuredContent: {},
  isError: false,
});

describe("tool registration counts", () => {
  it("combines platform and internal definitions deterministically", () => {
    const platformTools = createPlatformTools(
      {
        getSignMessageHandler: noopHandler,
        loginHandler: noopHandler,
        getUserInfoHandler: noopHandler,
        getUserAutoSettingHandler: noopHandler,
        getUserPermissionsHandler: noopHandler,
        estimateBuyEnergyHandler: noopHandler,
        orderDetailHandler: noopHandler,
        ordersListHandler: noopHandler,
        orderBookHandler: noopHandler,
        getMinPriceHandler: noopHandler,
        extendableDelegatesHandler: noopHandler,
        orderCreateHandler: noopHandler,
        orderSellManualHandler: noopHandler,
        orderCancelHandler: noopHandler,
        orderUpdateHandler: noopHandler,
        registerAutoSellHandler: noopHandler,
        updateAutoSellSettingHandler: noopHandler,
        generateApiKeyHandler: noopHandler,
        revokeApiKeyHandler: noopHandler,
        deleteAutoBuySettingHandler: noopHandler,
      } as never,
    );
    const internalTools = createInternalTools(
      {
        getInternalAccountHandler: noopHandler,
        getDepositAddressHandler: noopHandler,
        getOrderHistoryHandler: noopHandler,
        getOrderDetailsHandler: noopHandler,
        getOrderBookHandler: noopHandler,
        estimateBuyResourceHandler: noopHandler,
        createOrderHandler: noopHandler,
        getExtendableDelegatesHandler: noopHandler,
        extendRequestHandler: noopHandler,
      } as never,
    );
    const all = createAllTools({} as never, {} as never);

    expect(platformTools.length).toBe(22);
    expect(internalTools.length).toBe(9);
    expect(all.length).toBe(53);
  });
});
