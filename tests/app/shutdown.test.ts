import { describe, expect, it, vi } from "vitest";
import { registerDisposer, runShutdown } from "../../src/app/shutdown";

describe("shutdown registry", () => {
  it("runs disposers in reverse order", async () => {
    const order: string[] = [];
    registerDisposer(async () => {
      order.push("first");
    });
    registerDisposer(async () => {
      order.push("second");
    });

    await runShutdown();
    expect(order).toEqual(["second", "first"]);
  });

  it("continues when one disposer throws", async () => {
    const sideEffect = vi.fn();
    registerDisposer(async () => {
      throw new Error("boom");
    });
    registerDisposer(async () => {
      sideEffect();
    });

    await runShutdown();
    expect(sideEffect).toHaveBeenCalledOnce();
  });
});
