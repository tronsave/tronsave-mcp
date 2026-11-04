import z from "zod";
import { tronAddress } from "../shares";

/** Matches GraphQL `EResourceType`. */
export const resourceTypeEnum = z.enum(["ENERGY", "BANDWIDTH"]);

/** Flat tool-facing payment methods for create-order flow. */
export const orderCreatePaymentMethodEnum = z.enum(["onchain", "internal"]);

// -----------------------------------------------------------------------------
// Shared output building blocks (DRY across mutation responses)
// -----------------------------------------------------------------------------

/**
 * GraphQL `IMutationResponse` envelope shared by every TronSave mutation.
 * Always inspect `success` before reading `data` — backend returns
 * `success: false` with a populated `message` for soft failures rather
 * than raising HTTP errors.
 */
const mutationEnvelopeShape = {
    code: z
        .number()
        .int()
        .describe(
            "GraphQL mutation status code (HTTP-like; `0`/`200` indicates success). Always pair with `success` for routing.",
        ),
    success: z
        .boolean()
        .describe(
            "Whether the mutation succeeded at the backend level. Always check this before reading `data`.",
        ),
    message: z
        .string()
        .describe(
            "Human-readable status text. Populated even on success; localized error messages may appear here on failure.",
        ),
} as const;

/** Bare envelope for mutations that return no `data` field (e.g. `deleteAutoBuySetting`). */
const mutationEnvelopeSchema = z.object(mutationEnvelopeShape);

/** Helper: extend the standard envelope with a typed `data` payload. */
const withMutationData = <T extends z.ZodTypeAny>(dataSchema: T) =>
    z.object({ ...mutationEnvelopeShape, data: dataSchema });

// -----------------------------------------------------------------------------
// TRON signed transaction shape (see https://tronweb.network/docu/docs/6.0.x/)
// -----------------------------------------------------------------------------

/**
 * Lowercase hex string (no `0x` prefix). Tron transaction artefacts are
 * raw hex; we permit any non-empty length to stay forward-compatible
 * with future TRON tx shapes (different contract types yield different
 * `raw_data_hex` lengths).
 */
const tronHexString = z.string().regex(/^[0-9a-fA-F]+$/u, "Must be a hex string (no 0x prefix).");

/** Hex transaction id from TronWeb; always 64 chars (32-byte sha256). */
const tronTxId = tronHexString.length(64);

/**
 * Wallet-signed TRON transaction object as produced by TronWeb 6.x
 * (`tronWeb.trx.sign(...)`). Validation is intentionally lenient:
 *
 *  - The four core fields (`txID`, `raw_data`, `raw_data_hex`, `signature`)
 *    are required because TronSave's GraphQL `JSON` scalar relies on
 *    them to dispatch the on-chain leg. Missing any of these means the
 *    payment cannot be settled.
 *  - `raw_data` is intentionally `looseObject` so future contract types
 *    (delegate / undelegate / triggerSmartContract / ...) work without
 *    schema bumps. Required nested fields are limited to the subset
 *    common to every Tron tx type.
 *  - The outer object is also `looseObject` to preserve metadata wallets
 *    sometimes attach (e.g. `visible`, `permission_id`, `signWeight`).
 *
 * The signature is NEVER produced server-side; the user's wallet must
 * have signed this object client-side. Do not fabricate or mutate.
 */
export const tronSignedTxSchema = z
    .looseObject({
        txID: tronTxId.describe("Transaction hash (64 hex chars, lowercase, no `0x` prefix)."),
        raw_data: z
            .looseObject({
                contract: z
                    .array(z.unknown())
                    .min(1)
                    .describe("At least one TRON contract entry; shape varies by contract type."),
                ref_block_bytes: z.string().describe("Reference block bytes (hex)."),
                ref_block_hash: z.string().describe("Reference block hash (hex)."),
                expiration: z.number().int().positive().describe("Tx expiration (Unix epoch ms)."),
                timestamp: z.number().int().positive().describe("Tx timestamp (Unix epoch ms)."),
            })
            .describe("Raw transaction body produced by TronWeb (`raw_data`)."),
        raw_data_hex: tronHexString.describe("Hex-encoded `raw_data` body."),
        signature: z
            .array(tronHexString.min(1))
            .min(1)
            .describe(
                "Wallet signatures over `raw_data_hex`; usually a single hex string (130 chars for 65-byte secp256k1).",
            ),
        visible: z
            .boolean()
            .optional()
            .describe("Whether addresses inside `raw_data.contract` are base58 (`true`) vs hex (`false`)."),
    })
    .describe(
        "TronWeb-shaped signed transaction. Produced client-side by the user's wallet; never fabricate or mutate.",
    );

/**
 * Flat order fields shared by `tronsave_create_order` (maps to GraphQL `OrderInfoInput`).
 * Prefix `order_` avoids nesting and mirrors estimate parameters where possible.
 */
export const orderCreateFlatSharedSchema = z.object({
    orderResourceType: resourceTypeEnum.describe(
        "Resource to buy: ENERGY (smart contracts) or BANDWIDTH (transactions). Must match `tronsave_estimate_buy_resource`.",
    ),
    orderReceiver: tronAddress(
        "TRON base58 address (starts with T) that receives delegated resource. Same as `receiver` passed to `tronsave_estimate_buy_resource`.",
    ),
    orderUnitPrice: z.number().positive().describe(
        "Unit price in SUN per resource unit (NOT TRX). Use `unitPrice` from the latest `tronsave_estimate_buy_resource` for the same receiver, amount, and duration.",
    ),
    orderDurationSec: z.number().int().positive().describe(
        "Delegation duration in seconds. Must match the `durationSec` used in `tronsave_estimate_buy_resource`.",
    ),
    orderResourceAmount: z.number().int().positive().describe(
        "Amount of ENERGY or BANDWIDTH units to purchase. Same as `buyResourceAmount` in estimate when applicable.",
    ),
});

/** Flat create-order input with selectable payment method (`onchain` | `internal`). */
export const orderCreateInputSchema = orderCreateFlatSharedSchema.extend({
    paymentMethod: orderCreatePaymentMethodEnum.describe(
        "Payment method for this order: `onchain` (wallet signed tx) or `internal` (internal balance).",
    ),
    paymentPaymentAmount: z.number().nonnegative().describe(
        "Total payment in SUN (1 TRX = 1e6 SUN). Use `estimateTrx` (SUN) from the latest `tronsave_estimate_buy_resource`.",
    ),
    paymentSignedTx: tronSignedTxSchema
        .optional()
        .describe(
            "Required when `paymentMethod=onchain`: the user's wallet-signed TRX transfer of `paymentPaymentAmount` SUN to `systemDepositAddress` " +
                "(from `tronsave_estimate_buy_resource`), TronWeb shape `{ txID, raw_data, raw_data_hex, signature[] }`. " +
                "Must be produced client-side by the user's wallet; never fabricate or hand-edit.",
        ),
}).superRefine((value, ctx) => {
    if (value.paymentMethod === "onchain" && value.paymentSignedTx === undefined) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["paymentSignedTx"],
            message: "`paymentSignedTx` is required when `paymentMethod` is `onchain`.",
        });
    }
    if (value.paymentMethod !== "onchain" && value.paymentSignedTx !== undefined) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["paymentSignedTx"],
            message: "`paymentSignedTx` is only applicable when `paymentMethod` is `onchain`.",
        });
    }
});

/**
 * Input for REST `POST /v2/estimate-buy-resource`.
 * `requester` is taken from the signature session wallet when present (not passed in tool args).
 */
export const estimateBuyResourceInputSchema = z.object({
    resourceType: resourceTypeEnum.optional().default("ENERGY").describe("Resource type to buy. Default ENERGY."),
    receiver: tronAddress("TRON address that will receive the resource. Strongly recommended: quotes depend on it.").optional(),
    buyResourceAmount: z.number().int().positive().optional().describe("Resource units to buy. Default 100000 for ENERGY and 1000 for BANDWIDTH."),
    unitPrice: z.number().positive().optional().describe("Desired unit price in SUN. Values below the market minimum are raised to the minimum. Omit for the MEDIUM market price."),
    durationSec: z.number().int().positive().optional().describe("Delegation duration in seconds. Default 900 (15 minutes)."),
    allowPartialFill: z.boolean().optional().describe("Allow partial fill of the order."),
    minResourceDelegateRequiredAmount: z.number().nonnegative().optional().describe("Minimum resource amount per matching provider."),
});

/** GraphQL `EstimateBuyResourceResponse` plus TronSave on-chain deposit address for TRX top-ups. */
export const estimateBuyEnergyOutputSchema = z.object({
    systemDepositAddress: z.string().nullable().describe("TronSave deposit address; destination of the signed TRX transfer for `paymentMethod=onchain`."),
    unitPrice: z.number().describe("Quoted unit price in SUN per resource unit → `orderUnitPrice`."),
    durationSec: z.number().describe("Delegation duration in seconds → `orderDurationSec`."),
    estimateTrx: z.number().describe("Estimated total cost in SUN (despite the name; TRX = value / 1e6) → `paymentPaymentAmount`."),
    availableResource: z.number().describe("Resource units currently available at this price; if lower than requested, the order may fill partially."),
});

/** Input for GraphQL `market.orderBook`. */
export const orderBookInputSchema = z.object({
    address: tronAddress("Optional viewer/requester wallet context.").optional(),
    resourceType: resourceTypeEnum.describe("Order-book side to query (`ENERGY` or `BANDWIDTH`)."),
    minDelegateAmount: z.number().optional().describe("Optional minimum delegate amount floor for bucket filtering."),
    durationSec: z.number().optional().describe("Optional delegation duration filter in seconds."),
});

/**
 * Input for GraphQL `Query.market.estimateMinPrice`.
 * Returns the lowest achievable unit price (SUN) for a hypothetical buy of `buyAmount` resource units
 * over `durationSec` seconds; optional `address` scopes the estimate to a viewer/receiver context when supported by the API.
 */
export const getMinPriceInputSchema = z.object({
    address: tronAddress(
        "Optional TRON base58 address (`TronAddress`). When omitted, the server uses anonymous/global market context.",
    ).optional(),
    resourceType: resourceTypeEnum.optional().default("ENERGY").describe("Market leg: `ENERGY` or `BANDWIDTH`. Default ENERGY"),
    buyAmount: z
        .number()
        .positive()
        .optional()
        .describe("Resource amount to price (same units as order book / delegate amounts for that resource type). Default 100000 for ENERGY and 1000 for BANDWIDTH"),
    durationSec: z
        .number()
        .positive()
        .optional()
        .default(900)
        .describe("Delegation window in seconds; must match the duration you plan to use on a real order for comparable quotes. Default 15 minutes"),
});

/** Scalar `Float` from `market.estimateMinPrice` — interpreted as SUN per resource unit alongside other platform price fields. */
export const getMinPriceOutputSchema = z.object({
    minPrice: z
        .number()
        .describe(
            "Estimated minimum unit price in SUN for the given `resourceType`, `buyAmount`, and `durationSec`; align with `tronsave_estimate_buy_resource` and order `unitPrice` conventions (same as GraphQL `market.estimateMinPrice`).",
        ),
});

export const orderBookOutputSchema = z.object({
    orderBook: z.array(
        z.object({
            min: z.number(),
            max: z.number(),
            value: z.number(),
        }),
    ),
});

/**
 * Maps to GraphQL `ExtendAndBuySuggestInput` on `Query.market.extendableDelegates`.
 * Omit the whole object for a plain list of extendable delegate rows; pass all nested
 * numbers when you want the backend to score extend-and-buy scenarios against that hypothetical.
 */
export const extendableDelegatesSuggestDataSchema = z.object({
    /** Unix epoch milliseconds (UTC) for the desired delegation end time; aligns conceptually with internal extend `extendTo`. */
    extendTo: z.number().describe(
        "Target end time for the extended delegation window, as Unix epoch milliseconds (UTC); align with TronSave REST extend flows when comparing suggest windows.",
    ),
    /** Additional resource units (same leg as `resourceType`) to purchase on top of extension, for suggest scoring. */
    extraBuyAmount: z.number().describe(
        "Hypothetical extra ENERGY or BANDWIDTH units to buy beyond simple extension; units match `resourceType`, not SUN.",
    ),
    /** Resource units to extend from existing active delegates in the suggest scenario. */
    extendAmount: z.number().describe(
        "Hypothetical amount of existing delegation to extend (resource units matching `resourceType`).",
    ),
    /** Upper bound on acceptable unit price for the suggested path, in SUN (same convention as order pricing elsewhere). */
    maxPrice: z.number().describe(
        "Maximum unit price in SUN the user is willing to pay for the suggested extend/buy path; used for server-side scoring, not a live order placement by itself.",
    ),
});

/**
 * Platform market discovery for delegates that may be extended for `receiver`.
 * Zod only enforces non-empty `receiver`; a syntactically invalid base58 address may still fail at GraphQL layer.
 */
export const extendableDelegatesInputSchema = z.object({
    requester: z
        .string()
        .optional()
        .describe(
            "Optional TRON base58 address of the viewing/requesting party. When an MCP session is active, the server may still derive identity from auth headers; use this when the API expects an explicit requester string distinct from the receiver.",
        ),
    receiver: tronAddress(
            "TRON base58 address (typically starts with `T`) that currently receives or will receive the delegated resource. This is the primary filter: the response describes delegates relevant to extending that account's delegation.",
        ),
    resourceType: resourceTypeEnum.describe(
        "Which resource market leg to query: `ENERGY` for contract execution headroom, `BANDWIDTH` for transaction bandwidth. Must match how you plan to extend or buy.",
    ),
    suggestData: extendableDelegatesSuggestDataSchema
        .optional()
        .describe(
            "Optional nested scenario for extend-and-buy suggestion scoring. If omitted, the query returns delegate rows without that hypothetical. If provided, supply all four fields together; partial objects are invalid for typical GraphQL input shapes.",
        ),
});

export const extendableDelegatesOutputSchema = z.object({
    extendableDelegates: z
        .object({
            maxExtendAmount: z.number().describe("Largest extendable resource amount (units) aggregated for this query."),
            minExtendRequired: z
                .number()
                .nullable()
                .optional()
                .describe("Minimum resource amount the market requires to treat an extension as valid, if applicable."),
            totalAvailableExtraBuyAmount: z
                .number()
                .nullable()
                .optional()
                .describe("Capacity hint for additional buy amount on top of extension under current market state."),
            overBuyAmount: z.number().nullable().optional().describe("Amount considered in excess of a simple extend-only path when `suggestData` implies extra buy."),
            overBuyPrice: z.number().nullable().optional().describe("Price facet associated with the over-buy leg (SUN-related aggregate; exact semantics from TronSave API)."),
            overBuyAmountAvailable: z.number().nullable().optional().describe("How much of the over-buy amount is currently matchable."),
            overBuyAmountMaxAvailable: z.number().nullable().optional().describe("Upper cap for over-buy availability under current book conditions."),
            data: z
                .array(
                    z.object({
                        amount: z.number().nullable().optional().describe("Delegate amount associated with this row (resource units)."),
                        isExtendable: z
                            .boolean()
                            .nullable()
                            .optional()
                            .describe("Whether this delegate entry can be extended under current rules."),
                        extendPrice: z.number().nullable().optional().describe("Indicative unit price or price component for extending this row (SUN unless API documents otherwise)."),
                        reclaimTime: z.number().nullable().optional().describe("Timestamp related to reclaim/unlock timing when relevant."),
                        minTimeExtendTo: z.number().nullable().optional().describe("Minimum end time boundary required before extension is allowed."),
                        availableExtendAt: z.number().nullable().optional().describe("Earliest time at which extension becomes available for this row."),
                        reason: z.array(z.string()).nullable().optional().describe("Human-readable reasons when extension is blocked or conditional."),
                        availableResource: z.number().nullable().optional().describe("Resource still available from this delegate for matching/extension."),
                    }),
                )
                .nullable()
                .optional()
                .describe("Per-delegator or per-offer rows backing the aggregates above; may be empty when nothing is extendable."),
        })
        .nullable()
        .describe("Null when the market has no payload or GraphQL returned no branch; check tool-level errors for hard failures."),
});

/** Input for GraphQL `Query.order` by id. */
export const orderDetailInputSchema = z.object({
    id: z
        .string()
        .min(1)
        .describe("Target order id (`MObjectId`) to inspect. Use this to confirm current status/price before update, sell, or cancel actions."),
});

/**
 * Input for MCP `tronsave_list_orders`. Mapped server-side to GraphQL `Query.orders`:
 * - `status` → `isMatching`: `ACTIVE` → `true` (still matching), `COMPLETED` → `false` (omit for both).
 * - `isOnlyMyOrder` → sets `myAddress` from the signature session wallet and `isOwner: true` so the API scopes to orders requested by that wallet (requires a signature identity).
 */
export const ordersHistoryInputSchema = z.object({
    offset: z
        .number()
        .int()
        .min(0)
        .max(200)
        .optional()
        .describe("Zero-based row offset for page N (skip first `offset` matches). Omit when starting from the first page."),
    limit: z
        .number()
        .int()
        .positive()
        .min(1)
        .max(10)
        .optional()
        .describe("Maximum rows to return in one call. Prefer modest limits to avoid huge payloads; page with `offset`."),
    status: z
        .enum(["ACTIVE", "COMPLETED"])
        .optional()
        .describe(
            "Lifecycle filter: `ACTIVE` = still matching/open, `COMPLETED` = no longer matching. Omit for both.",
        ),
    resourceType: resourceTypeEnum
        .optional()
        .describe("Restrict to `ENERGY` or `BANDWIDTH` orders; omit for both."),
    isOnlyMyOrder: z
        .boolean()
        .optional()
        .describe(
            "When `true`, only orders requested by the wallet of the current signature identity (signature login or `Signature` header). Api-key-only sessions cannot use this filter.",
        ),
});

const orderPartySchema = z.object({
    address: z.string().describe("TRON base58 address for this party."),
});

/** Shared compact order projection used by both `tronsave_get_order` and `tronsave_list_orders`. */
export const orderCompactSchema = z.object({
    id: z.string().describe("Order id (`MObjectId`); use with `tronsave_get_order` or mutate tools."),
    requester: orderPartySchema.nullable().optional().describe("Requester party when present."),
    receiver: orderPartySchema.describe("Receiver wallet and related party info for the delegation leg."),
    resourceType: resourceTypeEnum.describe("`ENERGY` or `BANDWIDTH`."),
    resourceAmount: z.number().describe("Original resource amount on the order."),
    remainAmount: z.number().describe("Resource not yet consumed or remaining to fulfill."),
    durationSec: z.number().describe("Delegation duration in seconds."),
    isOwner: z.boolean().describe("Whether the list query’s viewer context treats this row as owned by `myAddress`."),
    isMatching: z.boolean().describe("Whether this order matches the viewer/matching filter used in the query."),
    apy: z.number().describe("Annualized yield hint as returned by the API (see TronSave semantics)."),
    unitPrice: z.number().describe("Unit price in SUN."),
    createdAt: z.iso.datetime().describe("Order creation time (ISO-8601)."),
    typeOrder: z.enum(["NORMAL", "FAST", "EXTEND"]).describe("Market order flavor."),
});

export const orderDetailOutputSchema = z.object({
    order: orderCompactSchema.nullable(),
});

export const ordersListOutputSchema = z.object({
    orders: z.array(orderCompactSchema).describe("Matching orders for this page; may be large—use pagination inputs to chunk."),
});

/** GraphQL `OrderCreateResponse` subset returned to MCP clients. */
export const orderCreateOutputSchema = withMutationData(
    z
        .object({
            orderId: z
                .string()
                .describe("Newly created order id (`MObjectId`); pass to `tronsave_get_order` to inspect status."),
        })
        .nullable()
        .optional(),
);

export const orderSellManualInputSchema = z.object({
    orderId: z
        .string()
        .min(1)
        .describe("Target order id (`MObjectId`) to manually fulfill. Should be an order eligible for seller-side manual execution."),
    signedTx: tronSignedTxSchema.describe(
        "Required wallet-signed transaction payload (TronWeb shape: `{ txID, raw_data, raw_data_hex, signature[] }`). " +
            "Must come from client-side signing; never fabricate.",
    ),
    paymentAddress: tronAddress("Optional payout/payment address override when settlement flow requires it.").optional(),
});

export const orderSellManualOutputSchema = z.object({
    ...mutationEnvelopeShape,
    delegatedId: z
        .string()
        .nullable()
        .optional()
        .describe(
            "On-chain delegate id created by the manual sell when the underlying transaction is confirmed; null until confirmation lands.",
        ),
});

export const orderCancelInputSchema = z.object({
    orderId: z
        .string()
        .min(1)
        .describe(
            "Target order id (`MObjectId`) to cancel. Must be an active order owned/authorized by the current session; already-fulfilled or already-cancelled orders are expected to fail.",
        ),
});

export const orderCancelOutputSchema = mutationEnvelopeSchema;

export const orderUpdateInputSchema = z.object({
    orderId: z
        .string()
        .min(1)
        .describe("Target order id (`MObjectId`) to update. Order must still be open and editable."),
    receiver: tronAddress("Optional replacement receiver TRON address.").optional(),
    newPrice: z.number().positive().optional().describe("Optional replacement unit price in SUN per resource unit."),
}).refine((value) => value.receiver !== undefined || value.newPrice !== undefined, {
    message: "Provide at least one update field: `receiver` or `newPrice`.",
    path: ["receiver"],
});

export const orderUpdateOutputSchema = mutationEnvelopeSchema;

/** GraphQL `EPaymentFrequency` on `PaymentConfigInput`. */
export const paymentFrequencyEnum = z.enum(["DAILY", "IMMEDIATE"]);

/** GraphQL `EPaymentMode` on `PaymentConfigInput`. */
export const paymentModeEnum = z.enum(["FIXED", "RANDOM"]);

/** GraphQL `EAutoReclaimType` on `PoolSettingInput`. */
export const autoReclaimTypeEnum = z.enum(["ALL", "ONLY_TRONSAVE"]);

/**
 * GraphQL `PaymentTimeWindowInput` — daily payout window expressed as integer
 * indices the API defines (typically minutes from midnight UTC, `0..1439`).
 * Verify exact unit with TronSave docs before relying on edge values.
 */
export const paymentTimeWindowInputSchema = z.object({
    start: z
        .number()
        .int()
        .nonnegative()
        .describe(
            "Window start as a non-negative GraphQL `Int` (TronSave commonly uses minutes from midnight UTC, `0..1439`).",
        ),
    end: z
        .number()
        .int()
        .nonnegative()
        .describe(
            "Window end as a non-negative GraphQL `Int` (same unit as `start`); end > start is enforced server-side, not by this schema.",
        ),
});

/**
 * GraphQL `PaymentConfigInput` for auto-sell payout scheduling.
 * All fields optional; combine with `poolSetting` / `addOnFeature` as needed.
 */
export const paymentConfigInputSchema = z.object({
    paymentAddress: tronAddress("TRON address that receives payouts.").optional(),
    paymentFrequency: paymentFrequencyEnum.optional().describe("DAILY vs IMMEDIATE settlement rhythm."),
    paymentMode: paymentModeEnum.optional().describe("FIXED vs RANDOM payout mode when applicable."),
    paymentTimeWindow: paymentTimeWindowInputSchema
        .optional()
        .describe("Optional daily time window for scheduled payouts."),
});

/**
 * GraphQL `ResourceInput` — per-resource pool rules under `PoolSettingInput`.
 * Maps to seller auto-delegation constraints (price floor, duration bounds, profit share, etc.).
 */
export const resourcePoolInputSchema = z.object({
    isAcceptExtended: z.boolean().optional().describe("Whether incoming extend-style matches are accepted."),
    maxDelegateDurationSec: z.number().int().optional().describe("Upper bound delegation duration (seconds)."),
    minDelegateDurationSec: z.number().int().optional().describe("Lower bound delegation duration (seconds)."),
    maintainUnDelegate: z.number().optional().describe("Buffer of undelegated resource the seller keeps."),
    minDelegateAmount: z.number().optional().describe("Minimum per-delegation resource amount."),
    minPrice: z.number().optional().describe("Minimum unit price accepted for auto matches."),
    profitShare: z.number().int().optional().describe("Profit share percentage for this resource leg."),
});

/**
 * GraphQL `PoolSettingInput` — energy/bandwidth pools plus reclaim scope for auto sell.
 */
export const poolSettingInputSchema = z.object({
    energy: resourcePoolInputSchema.optional().describe("Auto-sell rules for staked ENERGY; omit to leave ENERGY selling unchanged."),
    bandwidth: resourcePoolInputSchema.optional().describe("Auto-sell rules for staked BANDWIDTH; omit to leave BANDWIDTH selling unchanged."),
    reclaim: autoReclaimTypeEnum
        .optional()
        .describe("Reclaim behaviour: ALL resources vs ONLY_TRONSAVE-managed delegations."),
});

/** GraphQL `AutoStakeInput` inside `AddOnFeatureInput`. */
export const autoStakeInputSchema = z.object({
    minAmount: z.number().describe("Minimum TRX (sun semantics per API) for auto-stake trigger."),
    remainBalance: z.number().describe("TRX balance floor to preserve after staking."),
    resourceStake: resourceTypeEnum.describe("Whether auto-stake targets ENERGY or BANDWIDTH."),
});

/**
 * GraphQL `AddOnFeatureInput` — optional vote / stake / UX flags bundled with auto-sell registration.
 */
export const addOnFeatureInputSchema = z.object({
    vote: z.boolean().optional().describe("Enable vote-related automation when supported."),
    withdrawVote: z.number().optional().describe("GraphQL Float input for withdraw-vote configuration."),
    stake: autoStakeInputSchema.optional().describe("Optional auto-stake policy."),
    suggestSell: z.boolean().optional().describe("Enable suggest-sell UX hints."),
});

/**
 * GraphQL inputs shared by `users.registerAutoSell` and `users.updateAutoSellSetting`.
 * Each root block is optional; pass the sections you intend to set in one call.
 */
export const autoSellSettingMutationInputSchema = z.object({
    paymentConfig: paymentConfigInputSchema
        .optional()
        .describe("Where and how often seller earnings are paid out (address, DAILY/IMMEDIATE, payout window)."),
    poolSetting: poolSettingInputSchema
        .optional()
        .describe("What the wallet sells automatically: per-resource price floor, duration bounds, minimum amount, reserve, and reclaim scope."),
    addOnFeature: addOnFeatureInputSchema
        .optional()
        .describe("Optional extras: voting, auto-stake of idle TRX, suggest-sell hints."),
});

/** GraphQL `UserMutations.registerAutoSell` variables — same object shape as update. */
export const registerAutoSellInputSchema = autoSellSettingMutationInputSchema;

/** GraphQL `UserMutations.updateAutoSellSetting` variables — same object shape as register. */
export const updateAutoSellSettingInputSchema = autoSellSettingMutationInputSchema;

/** GraphQL `RegisterAutoSellResponse` / `UpdateAutoSellSettingResponse` subset exposed to MCP clients. */
export const registerAutoSellOutputSchema = withMutationData(
    z
        .string()
        .describe(
            "Opaque server-defined payload (tx id, setting id, or status text). Treat as identifier-or-message; rely on `message` for human routing.",
        ),
);

/** Same payload shape as {@link registerAutoSellOutputSchema} (`UpdateAutoSellSettingResponse`). */
export const updateAutoSellSettingOutputSchema = registerAutoSellOutputSchema;

/**
 * GraphQL `GenerateApiKeyResponse` / `RevokeApiKeyResponse` — standard mutation envelope with string `data`
 * (new key material or server-defined status payload).
 */
export const userApiKeyMutationOutputSchema = withMutationData(
    z
        .string()
        .describe(
            "For `generateApiKey`: the freshly issued internal API key — treat as SECRET, store securely. " +
                "For `revokeApiKey`: server-defined confirmation string (no key material).",
        ),
);

/** @alias {@link userApiKeyMutationOutputSchema} */
export const generateApiKeyOutputSchema = userApiKeyMutationOutputSchema;

/** @alias {@link userApiKeyMutationOutputSchema} */
export const revokeApiKeyOutputSchema = userApiKeyMutationOutputSchema;

/** GraphQL `UserMutations.deleteAutoBuySetting` — `id` is `MObjectId!`. */
export const deleteAutoBuySettingInputSchema = z.object({
    id: z.string().min(1).describe("Auto-buy setting id (`MObjectId`) to delete."),
});

/** GraphQL `AutoBuyDeleteResponse` (`IMutationResponse`) — no `data` field on this type. */
export const deleteAutoBuySettingOutputSchema = mutationEnvelopeSchema;

export const getSignMessageOutputSchema = z.object({
    message: z
        .string()
        .describe(
            "Hex-encoded nonce message to sign client-side with the user's TRON wallet. " +
                "The signature must be produced over THIS exact message (case-sensitive).",
        ),
    timestamp: z
        .number()
        .int()
        .positive()
        .describe(
            "Unix epoch seconds corresponding to `message`. Pair it with the wallet signature in " +
                "`<signature>_<timestamp>` form when calling `tronsave_login` (signature mode). " +
                "This endpoint is a convenience helper; clients may provide their own timestamp payload as well.",
        ),
});

export const loginInputSchema = z
    .object({
        apiKey: z
            .string()
            .trim()
            .min(1)
            .optional()
            .describe(
                "Raw API key for internal-tools login. Provide EXACTLY ONE of `apiKey` or `signature`.",
            ),
        signature: z
            .string()
            .trim()
            .min(1)
            .optional()
            .describe(
                "Signature token in `signature_timestamp` format (timestamp is the signed message). " +
                    "Provide EXACTLY ONE of `apiKey` or `signature`.",
            ),
    })
    .refine(
        (data) => Boolean(data.apiKey) !== Boolean(data.signature),
        {
            message: "Login requires exactly one of `apiKey` or `signature` (cannot be both, cannot be neither).",
        },
    );

export const loginOutputSchema = z.object({
    sessionId: z.string().describe("The MCP session (`mcp-session-id`) the login is bound to. MCP clients resend it automatically; never pass it as a tool argument."),
    authMode: z.enum(["signature", "api-key"]).describe("Which credential type the session holds."),
    walletAddress: z.string().optional().describe("Wallet recovered from the signature (signature mode only)."),
    hasInternalApiKey: z.boolean().describe("Whether internal-account tools and `paymentMethod=internal` are usable in this session."),
    expiresAt: z.iso.datetime().describe("Session expiry (ISO-8601)."),
    unlocked: z.string().describe("Human-readable summary of the tool groups now available."),
    warnings: z.array(z.string()).optional().describe("Non-fatal issues (e.g. internal API key could not be loaded)."),
});

export const logoutOutputSchema = z.object({
    loggedOut: z.boolean().describe("Always true; the login bound to this MCP session was removed (idempotent)."),
});

export const sessionStatusOutputSchema = z.object({
    authenticated: z.boolean().describe("Whether any credential is active for this request."),
    authMode: z.enum(["none", "api-key", "signature"]).describe("`signature` unlocks wallet tools; `api-key` unlocks internal-account tools."),
    source: z
        .enum(["none", "login", "header", "oauth"])
        .describe("`login` = `tronsave_login` session, `header` = static Authorization header, `oauth` = OAuth sign-in by the client app."),
    network: z.enum(["mainnet", "testnet"]).describe("Network served by this endpoint."),
    walletAddress: z.string().nullable().describe("Wallet of the signature identity, if any."),
    hasInternalApiKey: z.boolean().describe("Whether an internal API key is available for api-key tools."),
    expiresAt: z.iso.datetime().nullable().describe("Login expiry for `source=login`."),
    headerAuthError: z
        .object({ code: z.string(), message: z.string() })
        .optional()
        .describe("Present when header credentials were sent but rejected."),
    availableNow: z.array(z.string()).describe("Tool groups callable with the current auth."),
});

export const userInfoOutputSchema = z.object({
    caller: z.string().describe('TRON base58 address of the caller'),
    address: z.string().describe('TRON base58 address'),
    balance: z.string().describe('Amount in SUN, onchain balance of the address'),
    info: z.object({
        createdBotCount: z.number().describe('Number of bots created by the user'),
        contacts: z.array(z.object({
            type: z.enum(["EMAIL", "PHONE", "TELEGRAM", "WECHAT"]),
            contactId: z.string().describe('Contact id'),
            isActive: z.boolean().describe('Whether the contact is active'),
            isVerify: z.boolean().describe('Whether the contact is verified'),
            username: z.string().describe('Username'),
        })),
        whitelistLevel: z.number().nullable().describe('Whitelist level'),
        userRefCode: z.string().nullable().describe('User ref code'),
        sponsor: z.string().nullable().describe('Sponsor'),
        pendingRefCode: z.string().nullable().describe('Pending ref code'),
        totalRef: z.number().nullable().describe('Total ref'),
        totalPendingRef: z.number().nullable().describe('Total pending ref'),
        totalRefBonus: z.string().nullable().describe('Total ref bonus'),
        remainRefBonus: z.string().nullable().describe('Remain ref bonus'),
        rank: z.number().nullable().describe('Rank')
    }).describe("user information").nullable(),
    internalAccount: z
        .object({
            depositAddress: z
                .string()
                .describe(
                    "TRON base58 deposit address used for depositing TRX to the TronSave internal balance.",
                ),
            balance: z
                .string()
                .describe(
                    "Internal-account balance as a decimal string in SUN (BigInt-safe; TRX = SUN / 1e6).",
                ),
            apiKey: z
                .string()
                .describe(
                    "MASKED internal API key (first/last characters only). The full key is held server-side in the session and is never returned.",
                ),
        })
        .describe("Internal account information; null when the wallet has not provisioned a TronSave internal account yet.")
        .nullable(),
});

/**
 * One row of `autoSettings.permitOperations`. Shared between
 * `userAutoSettingOutputSchema` and `userPermissionsOutputSchema` so a
 * single change here propagates to both tools.
 */
const permitOperationsRowSchema = z.object({
    type: z
        .string()
        .nullable()
        .optional()
        .describe("Permission category as labelled by the backend (e.g. role/scope tag)."),
    id: z
        .number()
        .nullable()
        .optional()
        .describe("Backend-assigned permission row id; null when not yet persisted."),
    permissionName: z
        .string()
        .nullable()
        .optional()
        .describe("Human-readable permission name; meant for display rather than equality checks."),
    operations: z
        .array(z.number())
        .nullable()
        .optional()
        .describe("Numeric operation codes enabled for this row; semantics defined by the backend."),
});

/**
 * Per-resource auto-sell pool snapshot returned for both `energy` and
 * `bandwidth` legs of `userAutoSettings`.
 */
const resourcePoolOutputSchema = z.object({
    isActive: z.boolean().describe("Whether auto-sell is currently active for this resource leg."),
    minPrice: z
        .number()
        .describe("Minimum unit price the seller accepts for auto matches (SUN per resource unit)."),
    minDelegateAmount: z.number().describe("Minimum per-delegation resource amount accepted by auto matches."),
    maintainUnDelegate: z.number().describe("Buffer of undelegated resource the seller keeps reserved."),
    profitShare: z.number().describe("Profit share percentage for this resource leg."),
    minDelegateDurationSec: z.number().describe("Lower bound of accepted delegation duration in seconds."),
    maxDelegateDurationSec: z.number().describe("Upper bound of accepted delegation duration in seconds."),
    isAcceptExtended: z.boolean().describe("Whether incoming extend-style matches are accepted for this leg."),
});

export const userAutoSettingOutputSchema = z.object({
    permitOperations: z
        .array(permitOperationsRowSchema)
        .nullable()
        .optional()
        .describe("Permission rows enabled for this user; null/empty when no automation has been configured."),
    energy: resourcePoolOutputSchema
        .nullable()
        .optional()
        .describe("Energy auto-sell pool snapshot; null when energy automation is disabled."),
    bandwidth: resourcePoolOutputSchema
        .nullable()
        .optional()
        .describe("Bandwidth auto-sell pool snapshot; null when bandwidth automation is disabled."),
    reclaimOnlyTronSave: z
        .boolean()
        .nullable()
        .optional()
        .describe("Reclaim flag — when `true`, only TronSave-managed delegations are reclaimed automatically."),
    vote: z.boolean().nullable().optional().describe("Whether vote-related automation is enabled for the wallet."),
    withdrawVote: z
        .string()
        .nullable()
        .optional()
        .describe("Withdraw-vote configuration as a backend-defined string; semantics from TronSave docs."),
    suggestSell: z.boolean().nullable().optional().describe("Whether suggest-sell UX hints are enabled."),
});

export const userPermissionsOutputSchema = z.object({
    permitOperations: z
        .array(permitOperationsRowSchema)
        .default([])
        .describe("Permission rows enabled for this user; defaults to `[]` when nothing is configured."),
});
