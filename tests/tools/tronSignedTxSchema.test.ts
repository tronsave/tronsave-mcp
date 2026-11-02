import { describe, expect, it } from "vitest";
import {
    orderCreateInputSchema,
    orderSellManualInputSchema,
    tronSignedTxSchema,
} from "../../src/tools/definitions/platform/schema";

/**
 * `tronSignedTxSchema` shape mirrors TronWeb 6.x `tronWeb.trx.sign(...)`
 * output. We accept any extra metadata wallets sometimes attach
 * (`visible`, `permission_id`, ...) but reject payloads missing core
 * fields, malformed hex, or non-array signatures so the TronSave
 * GraphQL `JSON` scalar receives only well-formed input.
 */

const validSignedTx = () => ({
    txID: "a".repeat(64),
    raw_data: {
        contract: [{ type: "TransferContract" }],
        ref_block_bytes: "abcd",
        ref_block_hash: "0123456789abcdef",
        expiration: 1700000000000,
        timestamp: 1700000000000 - 1000,
        fee_limit: 150_000_000,
    },
    raw_data_hex: "deadbeef00",
    signature: ["b".repeat(130)],
    visible: false,
});

describe("tronSignedTxSchema", () => {
    it("accepts a fully populated TronWeb-shaped signed tx", () => {
        const result = tronSignedTxSchema.safeParse(validSignedTx());
        expect(result.success).toBe(true);
    });

    it("preserves extra wallet metadata (loose object)", () => {
        const result = tronSignedTxSchema.safeParse({
            ...validSignedTx(),
            permission_id: 0,
            signWeight: { permission: { id: 0 } },
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect((result.data as Record<string, unknown>).permission_id).toBe(0);
        }
    });

    it.each([
        ["txID", { txID: "short" }],
        ["txID", { txID: "g".repeat(64) }],
        ["raw_data_hex", { raw_data_hex: "not-hex!" }],
        ["signature", { signature: "not-an-array" }],
    ])("rejects malformed `%s`", (_field, override) => {
        const result = tronSignedTxSchema.safeParse({
            ...validSignedTx(),
            ...override,
        });
        expect(result.success).toBe(false);
    });

    it.each(["txID", "raw_data", "raw_data_hex", "signature"])(
        "rejects payload missing `%s`",
        (field) => {
            const tx = validSignedTx() as Record<string, unknown>;
            delete tx[field];
            expect(tronSignedTxSchema.safeParse(tx).success).toBe(false);
        },
    );

    it("rejects empty signature array", () => {
        const result = tronSignedTxSchema.safeParse({
            ...validSignedTx(),
            signature: [],
        });
        expect(result.success).toBe(false);
    });

    it("rejects raw_data with empty contract array", () => {
        const tx = validSignedTx();
        tx.raw_data.contract = [];
        expect(tronSignedTxSchema.safeParse(tx).success).toBe(false);
    });
});

describe("orderCreateInputSchema integration with tronSignedTxSchema", () => {
    const baseOrder = {
        orderResourceType: "ENERGY" as const,
        orderReceiver: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        orderUnitPrice: 100,
        orderDurationSec: 900,
        orderResourceAmount: 100_000,
        paymentPaymentAmount: 0,
    };

    it("accepts onchain order with valid signed tx", () => {
        const result = orderCreateInputSchema.safeParse({
            ...baseOrder,
            paymentMethod: "onchain",
            paymentSignedTx: validSignedTx(),
        });
        expect(result.success).toBe(true);
    });

    it("rejects onchain order with malformed signed tx", () => {
        const result = orderCreateInputSchema.safeParse({
            ...baseOrder,
            paymentMethod: "onchain",
            paymentSignedTx: { txID: "not-hex" },
        });
        expect(result.success).toBe(false);
    });

    it("still rejects onchain order missing paymentSignedTx (existing superRefine)", () => {
        const result = orderCreateInputSchema.safeParse({
            ...baseOrder,
            paymentMethod: "onchain",
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(
                result.error.issues.some((issue) =>
                    issue.path.includes("paymentSignedTx"),
                ),
            ).toBe(true);
        }
    });

    it("rejects removed `pending` payment method", () => {
        const result = orderCreateInputSchema.safeParse({ ...baseOrder, paymentMethod: "pending" });
        expect(result.success).toBe(false);
    });

    it("rejects malformed receiver address", () => {
        const result = orderCreateInputSchema.safeParse({
            ...baseOrder,
            orderReceiver: "not-a-tron-address",
            paymentMethod: "internal",
        });
        expect(result.success).toBe(false);
    });

    it("accepts internal order without signed tx", () => {
        for (const method of ["internal"] as const) {
            const result = orderCreateInputSchema.safeParse({
                ...baseOrder,
                paymentMethod: method,
            });
            expect(result.success, `paymentMethod=${method}`).toBe(true);
        }
    });
});

describe("orderSellManualInputSchema integration with tronSignedTxSchema", () => {
    it("accepts well-formed signed tx", () => {
        const result = orderSellManualInputSchema.safeParse({
            orderId: "abc123",
            signedTx: validSignedTx(),
        });
        expect(result.success).toBe(true);
    });

    it("rejects malformed signed tx", () => {
        const result = orderSellManualInputSchema.safeParse({
            orderId: "abc123",
            signedTx: "not-an-object",
        });
        expect(result.success).toBe(false);
    });
});
