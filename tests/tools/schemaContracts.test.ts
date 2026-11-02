import { describe, expect, it } from "vitest";
import * as schema from "../../src/tools/definitions/platform/schema";

/**
 * Schema-vs-handler contract tests. The earlier `getSignMessageOutputSchema`
 * shipped without `timestamp` even though the handler returned it; the
 * `userInfoOutputSchema` exposed the wire-level field name `internalAcc`
 * while tool descriptions advertised `internalAccount`. These tests pin
 * down the new shapes so they cannot drift again.
 */

describe("getSignMessageOutputSchema", () => {
    it("requires both `message` and `timestamp`", () => {
        const valid = schema.getSignMessageOutputSchema.safeParse({
            message: "abc123",
            timestamp: 1700000000,
        });
        expect(valid.success).toBe(true);
    });

    it("rejects payload missing `timestamp` (the bug we just fixed)", () => {
        const result = schema.getSignMessageOutputSchema.safeParse({ message: "abc123" });
        expect(result.success).toBe(false);
    });

    it("rejects negative or non-integer `timestamp`", () => {
        expect(
            schema.getSignMessageOutputSchema.safeParse({ message: "abc", timestamp: -1 }).success,
        ).toBe(false);
        expect(
            schema.getSignMessageOutputSchema.safeParse({ message: "abc", timestamp: 1.5 }).success,
        ).toBe(false);
    });
});

describe("userInfoOutputSchema", () => {
    const validPayload = {
        caller: "TXYZ",
        address: "TXYZ",
        balance: "1000000",
        info: null,
        internalAccount: null,
    } as const;

    it("accepts the new `internalAccount` field", () => {
        const result = schema.userInfoOutputSchema.safeParse(validPayload);
        expect(result.success).toBe(true);
    });

    it("accepts a fully populated internal account", () => {
        const result = schema.userInfoOutputSchema.safeParse({
            ...validPayload,
            internalAccount: {
                depositAddress: "TDEPOSIT",
                balance: "0",
                apiKey: "secret",
            },
        });
        expect(result.success).toBe(true);
    });

    it("rejects payload using the legacy wire field name `internalAcc` (now mapped server-side)", () => {
        const result = schema.userInfoOutputSchema.safeParse({
            ...validPayload,
            internalAcc: validPayload.internalAccount,
            internalAccount: undefined,
        });
        expect(result.success).toBe(false);
    });
});

describe("schema dead-code removal (Sprint 6B)", () => {
    it.each([
        "paymentTypeEnum",
        "orderCreateInternalInputSchema",
        "orderFulfillStatusEnum",
        "orderSortFieldEnum",
        "sortByTypeEnum",
        "orderSortInputSchema",
        "energyPriceTableInputSchema",
        "energyPriceTableOutputSchema",
    ])("does not re-export removed orphan `%s`", (name) => {
        expect((schema as unknown as Record<string, unknown>)[name]).toBeUndefined();
    });
});
