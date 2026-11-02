import { beforeEach, describe, expect, it, vi } from "vitest";
import { withRequestContext } from "../../src/handlers/authContext";
import type { AuthContext } from "../../src/schemas/auth";
import { createHelper } from "../../src/tools/handlers/helper";
import { createInternalHandlers } from "../../src/tools/handlers/internal";

/**
 * Locks the REST contract of the internal (api-key) tools: exact `/v2` path, HTTP method,
 * body/query shaping, the `apikey` header, and retry policy (quotes retry, writes never do).
 */
const restRequest = vi.fn(async (..._args: unknown[]) => ({ data: { ok: true } }));

const handlers = () => {
  const helper = createHelper({
    redisService: {} as never,
    clientsByNetwork: {
      mainnet: { restClient: { request: restRequest } as never, graphqlClient: {} as never },
      testnet: { restClient: { request: restRequest } as never, graphqlClient: {} as never },
    },
  });
  return createInternalHandlers(helper);
};

const auth = { type: "session", apiKey: "internal-key" } as unknown as AuthContext;
const run = <T>(fn: () => Promise<T>) => withRequestContext({ headers: {}, auth, network: "mainnet" }, fn);
const last = () => restRequest.mock.calls[restRequest.mock.calls.length - 1] as [string, Record<string, unknown>];

beforeEach(() => restRequest.mockClear());

describe("internal tools — endpoint, method and payload", () => {
  it("order history → GET /v2/orders with pagination", async () => {
    await run(() => handlers().getOrderHistoryHandler({ page: 2, pageSize: 25 }, undefined as never));
    const [path, init] = last();
    expect(path).toContain("/v2/orders?");
    expect(path).toContain("page=2");
    expect(path).toContain("pageSize=25");
    expect(init.method).toBe("GET");
  });

  it("order details → GET /v2/order/{id}, URL-encoded", async () => {
    await run(() => handlers().getOrderDetailsHandler({ orderId: "abc/123" }, undefined as never));
    expect(last()[0]).toBe("/v2/order/abc%2F123");
  });

  it("order book → GET /v2/order-book with query", async () => {
    await run(() => handlers().getOrderBookHandler({ resourceType: "ENERGY" }, undefined as never));
    expect(last()[0]).toContain("/v2/order-book?resourceType=ENERGY");
  });

  it("estimate → POST /v2/estimate-buy-resource, retried like a read", async () => {
    await run(() =>
      handlers().estimateBuyResourceHandler({ resourceType: "ENERGY", resourceAmount: 100_000 }, undefined as never),
    );
    const [path, init] = last();
    expect(path).toBe("/v2/estimate-buy-resource");
    expect(init.method).toBe("POST");
    expect(init.idempotent).toBe(true);
    expect(JSON.parse(init.body as string)).toMatchObject({ resourceType: "ENERGY", resourceAmount: 100_000 });
  });

  it("create → POST /v2/buy-resource and is NEVER retried", async () => {
    await run(() =>
      handlers().createOrderHandler({ resourceAmount: 100_000, receiver: "TRcv" }, undefined as never),
    );
    const [path, init] = last();
    expect(path).toBe("/v2/buy-resource");
    expect(init.method).toBe("POST");
    expect(init.idempotent).not.toBe(true);
    expect(JSON.parse(init.body as string)).toMatchObject({ receiver: "TRcv" });
  });

  it("extend delegates → POST /v2/get-extendable-delegates, retried like a read", async () => {
    await run(() =>
      handlers().getExtendableDelegatesHandler({ receiver: "TRcv", extendTo: 1_700_000_000_000 }, undefined as never),
    );
    const [path, init] = last();
    expect(path).toBe("/v2/get-extendable-delegates");
    expect(init.method).toBe("POST");
    expect(init.idempotent).toBe(true);
  });

  it("extend request → POST /v2/extend-request and is NEVER retried", async () => {
    await run(() =>
      handlers().extendRequestHandler(
        { receiver: "TRcv", extendData: [{ delegator: "TD", isExtend: true, extraAmount: 0, extendTo: 1 }] },
        undefined as never,
      ),
    );
    const [path, init] = last();
    expect(path).toBe("/v2/extend-request");
    expect(init.idempotent).not.toBe(true);
  });

  it("forwards the session api key as the `apikey` header", async () => {
    await run(() => handlers().getOrderHistoryHandler({}, undefined as never));
    expect((last()[1].headers as Record<string, string>).apikey).toBe("internal-key");
  });
});
