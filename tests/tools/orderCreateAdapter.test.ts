import { describe, expect, it } from "vitest";
import { OrderCreateAdapter } from "../../src/tools/adapters/platform/orderCreateAdapter";
import type { OrderCreatePaymentType } from "../../src/tools/adapters/platform/orderCreateAdapter";

const makeInput = () => ({
  orderResourceType: "ENERGY" as const,
  orderReceiver: "TXYZreceiver",
  orderUnitPrice: 10,
  orderDurationSec: 900,
  orderResourceAmount: 1000,
  paymentPaymentAmount: 100,
});

describe("OrderCreateAdapter.toVariablesFromUnifiedInput", () => {
  it("maps onchain payment fields", () => {
    const adapter = new OrderCreateAdapter();
    const variables = adapter.toVariablesFromUnifiedInput(
      {
        ...makeInput(),
        paymentMethod: "onchain",
        paymentSignedTx: { txID: "abc" },
      } as never,
      "ONCHAIN" as OrderCreatePaymentType,
    );
    expect(variables).toMatchObject({
      paymentMethod: {
        paymentType: "ONCHAIN",
        paymentAmount: 100,
      },
    });
  });

  it("maps internal payment without signedTx", () => {
    const adapter = new OrderCreateAdapter();
    const variables = adapter.toVariablesFromUnifiedInput(
      {
        ...makeInput(),
        paymentMethod: "internal",
      } as never,
      "INTERNAL" as OrderCreatePaymentType,
    );
    expect(variables).toMatchObject({
      paymentMethod: {
        paymentType: "INTERNAL",
        paymentAmount: 100,
      },
    });
    expect((variables as { paymentMethod: { signedTx?: unknown } }).paymentMethod.signedTx).toBeUndefined();
  });

});
