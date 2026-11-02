import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphQLClient, isGraphqlMutation } from "../../src/clients/graphqlClient";
import { RestClient } from "../../src/clients/restClient";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("HttpClient retry policy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries idempotent GET on 503 and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await new RestClient("https://example.test").request<{ data: { ok: boolean } }>("/x");
    expect(out.data.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never retries a non-idempotent POST", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      new RestClient("https://example.test").request("/v2/extend-request", { method: "POST", body: "{}" }),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNREACHABLE" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never retries GraphQL mutations but retries queries", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    const client = new GraphQLClient("https://example.test/graphql");
    await expect(client.request("\nmutation X { a }")).rejects.toMatchObject({ code: "UPSTREAM_UNREACHABLE" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    await expect(client.request("query X { a }")).rejects.toBeDefined();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("maps GraphQL auth errors to UPSTREAM_UNAUTHORIZED with a re-login hint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ errors: [{ message: "Unauthorized" }] })));
    await expect(new GraphQLClient("https://example.test/graphql").request("query { a }")).rejects.toMatchObject({
      code: "UPSTREAM_UNAUTHORIZED",
      hint: expect.stringContaining("tronsave_login"),
    });
  });

  it("truncates large upstream error bodies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x".repeat(5000), { status: 400 })));
    const error = await new RestClient("https://example.test").request("/x").catch((e: Error) => e);
    expect((error as Error).message.length).toBeLessThan(400);
  });

  it("detects mutations", () => {
    expect(isGraphqlMutation("  mutation A { b }")).toBe(true);
    expect(isGraphqlMutation("query A { b }")).toBe(false);
  });
});
