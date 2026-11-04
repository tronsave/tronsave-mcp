import z from "zod";
import {
    orderCreateFlatSharedSchema,
    orderCreateOutputSchema,
    orderCreateInputSchema,
} from "../../definitions/platform/schema";
import { AppError } from "../../../utils/errors";
import { stripUndefinedDeep } from "../../../utils/object";

/**
 * GraphQL mutation payload shape for `orders.create` (root `data` from HTTP).
 */
export type OrderCreateMutationData = {
    orders?: {
        create?: {
            code: number;
            success: boolean;
            message: string;
            data?: {
                orderId: string;
            } | null;
        };
    };
};

type OrderCreateFlatSharedParsed = z.infer<typeof orderCreateFlatSharedSchema>;
type OrderCreateParsed = z.infer<typeof orderCreateInputSchema>;
type OrderCreateToolOutput = z.infer<typeof orderCreateOutputSchema>;

export type OrderCreatePaymentType = "ONCHAIN" | "INTERNAL";

/**
 * Shared input shape consumed by flat order-create tools.
 */
type OrderCreateFlatInput = OrderCreateFlatSharedParsed & {
    paymentPaymentAmount: number;
    paymentSignedTx?: unknown;
};

/**
 * Adapter between flat MCP order-create tool params and GraphQL mutation contracts.
 */
export class OrderCreateAdapter {
    /**
     * Convert validated flat tool input into GraphQL variables for `orders.create`.
     */
    public toVariablesFromFlat(
        parsed: OrderCreateFlatInput,
        paymentType: OrderCreatePaymentType,
    ): Record<string, unknown> {
        const normalizedSignedTx = this.normalizeSignedTx(parsed.paymentSignedTx);

        const orderInfo = this.stripUndefinedDeep({
            resourceType: parsed.orderResourceType,
            receiver: parsed.orderReceiver,
            unitPrice: parsed.orderUnitPrice,
            durationSec: parsed.orderDurationSec,
            resourceAmount: parsed.orderResourceAmount,
        });

        const paymentMethod = this.stripUndefinedDeep({
            paymentType,
            paymentAmount: parsed.paymentPaymentAmount,
            signedTx: normalizedSignedTx,
        });

        const variables: Record<string, unknown> = {
            orderInfo,
            paymentMethod,
        };

        return variables;
    }

    /**
     * Parse GraphQL root payload into MCP tool output.
     */
    public toToolOutput(data: OrderCreateMutationData): OrderCreateToolOutput {
        const payload = data.orders?.create;
        if (!payload) {
            throw new AppError("GraphQL response missing orders.create", 502, "ORDER_CREATE_EMPTY");
        }
        return payload;
    }

    /**
     * Public helper for unified create-order input.
     */
    public toVariablesFromUnifiedInput(
        parsed: OrderCreateParsed,
        paymentType: OrderCreatePaymentType,
    ): Record<string, unknown> {
        return this.toVariablesFromFlat(parsed, paymentType);
    }

    private stripUndefinedDeep(value: unknown): unknown {
        return stripUndefinedDeep(value);
    }

    /**
     * Signed tx can be an object or JSON string. Normalize to object when possible.
     */
    private normalizeSignedTx(signedTx: unknown): unknown {
        if (signedTx === undefined || signedTx === null) {
            return signedTx;
        }

        if (typeof signedTx !== "string") {
            return signedTx;
        }

        const trimmedSignedTx = signedTx.trim();
        if (!trimmedSignedTx) {
            return signedTx;
        }

        try {
            const parsedSignedTx: unknown = JSON.parse(trimmedSignedTx);
            if (parsedSignedTx !== null && typeof parsedSignedTx === "object") {
                return parsedSignedTx;
            }
            throw new AppError(
                "Invalid payment.signedTx: JSON string must decode to an object",
                400,
                "INVALID_SIGNED_TX",
            );
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError("Invalid payment.signedTx: failed to parse JSON string", 400, "INVALID_SIGNED_TX");
        }
    }
}
