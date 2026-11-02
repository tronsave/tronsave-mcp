import type { AppContainer } from "../../../app/container";
import type { HelperApi } from "../helper";
import { createAuthHandlers } from "./auth";
import { createUserHandlers } from "./users";
import { createOrderHandlers } from "./orders";
import { createMarketHandlers } from "./market";
import { createAutoSellHandlers } from "./autoSell";
import { createInsightHandlers } from "./insights";

export function createPlatformHandlers(
  deps: AppContainer,
  helper: HelperApi,
) {
  const authHandlers = createAuthHandlers(deps);
  const userHandlers = createUserHandlers(deps, helper);
  const orderHandlers = createOrderHandlers(helper);
  const marketHandlers = createMarketHandlers(helper);
  const autoSellHandlers = createAutoSellHandlers(helper);
  const insightHandlers = createInsightHandlers(helper);

  return {
    ...authHandlers,
    ...userHandlers,
    ...orderHandlers,
    ...marketHandlers,
    ...autoSellHandlers,
    ...insightHandlers,
  };
}

export type PlatformHandlers = ReturnType<typeof createPlatformHandlers>;
