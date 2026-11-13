import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import { installOrderedStdioDispatch, type OrderedDispatchTransport } from "../../src/stdio/orderedDispatch";

const request = (id: number, method = "tools/call"): JSONRPCMessage =>
  ({ jsonrpc: "2.0", id, method }) as JSONRPCMessage;

const transport = (): OrderedDispatchTransport => ({ send: async () => {} });

const idOf = (message: JSONRPCMessage): number | undefined =>
  "id" in message && typeof message.id === "number" ? message.id : undefined;

describe("stdio message queue", () => {
  it("waits until the response is sent before the next message starts", async () => {
    const seen: string[] = [];
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const box = transport();
    installOrderedStdioDispatch(box, async (message) => {
      const id = idOf(message);
      seen.push(`start:${id}`);
      if (id === 1) {
        void hold.then(async () => {
          seen.push("login-finished");
          await box.send({ jsonrpc: "2.0", id: 1, result: { ok: true } } as JSONRPCMessage);
        });
        return;
      }
      await box.send({ jsonrpc: "2.0", id, result: {} } as JSONRPCMessage);
    });

    box.onmessage?.(request(1));
    box.onmessage?.(request(2));
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(seen).toEqual(["start:1"]);

    release();
    await vi.waitFor(() => expect(seen).toEqual(["start:1", "login-finished", "start:2"]));
  });

  it("continues after a notification without waiting for a response", async () => {
    const seen: string[] = [];
    const box = transport();
    installOrderedStdioDispatch(box, async (message) => {
      if (!("id" in message)) {
        seen.push("note");
        return;
      }
      seen.push(`req:${idOf(message)}`);
      await box.send({ jsonrpc: "2.0", id: idOf(message), result: {} } as JSONRPCMessage);
    });
    box.onmessage?.({ jsonrpc: "2.0", method: "notifications/initialized" } as JSONRPCMessage);
    box.onmessage?.(request(3, "tools/list"));
    await vi.waitFor(() => expect(seen).toEqual(["note", "req:3"]));
  });

  it("continues after a response from the client without waiting for a send", async () => {
    const seen: string[] = [];
    const box = transport();
    installOrderedStdioDispatch(box, async (message) => {
      if ("result" in message) {
        seen.push("client-response");
        return;
      }
      seen.push(`req:${idOf(message)}`);
      await box.send({ jsonrpc: "2.0", id: idOf(message), result: {} } as JSONRPCMessage);
    });
    box.onmessage?.({ jsonrpc: "2.0", id: 8, result: { ok: true } } as JSONRPCMessage);
    box.onmessage?.(request(4, "ping"));
    await vi.waitFor(() => expect(seen).toEqual(["client-response", "req:4"]));
  });

  it("delivers a client response while a request waits on it (elicitation) instead of deadlocking", async () => {
    const seen: string[] = [];
    let answerElicitation: () => void = () => {};
    const elicited = new Promise<void>((resolve) => {
      answerElicitation = resolve;
    });
    const box = transport();
    installOrderedStdioDispatch(box, async (message) => {
      if ("result" in message) {
        seen.push("client-response");
        answerElicitation();
        return;
      }
      seen.push(`req:${idOf(message)}`);
      // The handler finishes only after the client answers the server's own request.
      void elicited.then(() => box.send({ jsonrpc: "2.0", id: idOf(message), result: {} } as JSONRPCMessage));
    });
    box.onmessage?.(request(5));
    box.onmessage?.(request(6));
    await vi.waitFor(() => expect(seen).toEqual(["req:5"]));
    // Request 6 is queued behind 5, and 5 waits for this answer: it must not queue behind them.
    box.onmessage?.({ jsonrpc: "2.0", id: "srv-1", result: { action: "accept" } } as JSONRPCMessage);
    await vi.waitFor(() => expect(seen).toEqual(["req:5", "client-response", "req:6"]));
  });

  it("treats a JSON-RPC error result as the answer", async () => {
    const seen: string[] = [];
    const box = transport();
    installOrderedStdioDispatch(box, async (message) => {
      seen.push(`start:${idOf(message)}`);
      await box.send({
        jsonrpc: "2.0",
        id: idOf(message),
        error: { code: -32603, message: "nope" },
      } as JSONRPCMessage);
    });
    box.onmessage?.(request(1));
    box.onmessage?.(request(2));
    await vi.waitFor(() => expect(seen).toEqual(["start:1", "start:2"]));
  });

  it("keeps later messages moving when dispatch throws", async () => {
    const seen: number[] = [];
    const box = transport();
    installOrderedStdioDispatch(box, async (message) => {
      const id = idOf(message);
      if (id === 1) throw new Error("boom");
      seen.push(id ?? 0);
      await box.send({ jsonrpc: "2.0", id, result: {} } as JSONRPCMessage);
    });
    box.onmessage?.(request(1));
    box.onmessage?.(request(2));
    await vi.waitFor(() => expect(seen).toEqual([2]));
  });

  it("does not deadlock when sending the response fails", async () => {
    const seen: number[] = [];
    const box = transport();
    box.send = async (message) => {
      if ("id" in message && message.id === 1) throw new Error("broken pipe");
    };
    installOrderedStdioDispatch(box, async (message) => {
      const id = idOf(message) ?? 0;
      await box.send({ jsonrpc: "2.0", id, result: {} } as JSONRPCMessage);
      seen.push(id);
    });
    box.onmessage?.(request(1));
    box.onmessage?.(request(2));
    await vi.waitFor(() => expect(seen).toEqual([2]));
  });

  it("does not treat an outbound notification as the request's answer", async () => {
    const seen: string[] = [];
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const box = transport();
    installOrderedStdioDispatch(box, async (message) => {
      const id = idOf(message);
      seen.push(`start:${id}`);
      if (id === 1) {
        await box.send({ jsonrpc: "2.0", method: "notifications/progress" } as JSONRPCMessage);
        seen.push("progress-sent");
        await hold;
      }
      await box.send({ jsonrpc: "2.0", id, result: {} } as JSONRPCMessage);
    });
    box.onmessage?.(request(1));
    box.onmessage?.(request(2));
    await vi.waitFor(() => expect(seen).toContain("progress-sent"));
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(seen).toEqual(["start:1", "progress-sent"]);
    release();
    await vi.waitFor(() => expect(seen).toEqual(["start:1", "progress-sent", "start:2"]));
  });
});
