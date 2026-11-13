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

describe("extendableDelegatesSuggestDataSchema.extendTo", () => {
    const rest = { extraBuyAmount: 1, extendAmount: 1, maxPrice: 1 };

    it("documents Unix epoch seconds, the same unit as internal extendTo", () => {
        const description = schema.extendableDelegatesSuggestDataSchema.shape.extendTo.description ?? "";
        expect(description).toContain("Unix epoch SECONDS");
        expect(description).toContain("now + 86400");
        expect(description).toContain("internal extend tools' `extendTo`");
    });

    it("accepts a whole-second timestamp and the 1e11 boundary", () => {
        const extendTo = Math.floor(Date.now() / 1000) + 86_400;
        expect(schema.extendableDelegatesSuggestDataSchema.safeParse({ ...rest, extendTo }).success).toBe(true);
        expect(schema.extendableDelegatesSuggestDataSchema.safeParse({ ...rest, extendTo: 1e11 }).success).toBe(true);
    });

    it("rejects milliseconds, fractions, and non-positive values", () => {
        const millis = schema.extendableDelegatesSuggestDataSchema.safeParse({ ...rest, extendTo: Date.now() });
        expect(millis.success).toBe(false);
        if (!millis.success) {
            expect(millis.error.issues.map((issue) => issue.message).join(" ")).toMatch(/milliseconds are not accepted/i);
        }
        expect(schema.extendableDelegatesSuggestDataSchema.safeParse({ ...rest, extendTo: 1e11 + 1 }).success).toBe(false);
        expect(schema.extendableDelegatesSuggestDataSchema.safeParse({ ...rest, extendTo: 1.5 }).success).toBe(false);
        expect(schema.extendableDelegatesSuggestDataSchema.safeParse({ ...rest, extendTo: 0 }).success).toBe(false);
        expect(schema.extendableDelegatesSuggestDataSchema.safeParse({ ...rest, extendTo: -86_400 }).success).toBe(false);
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
