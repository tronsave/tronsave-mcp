import { describe, expect, it } from "vitest";
import { loginInputSchema } from "../../src/tools/definitions/platform/schema";

/**
 * `loginInputSchema` is an XOR contract: clients MUST provide exactly one of
 * `apiKey` or `signature`. The schema enforces this via `.refine()` so
 * downstream handlers can rely on at least one field being present and
 * never both. The runtime defensive checks in `auth.ts` are intentionally
 * kept as defense-in-depth and are not exercised here.
 */
describe("loginInputSchema XOR contract", () => {
    it("accepts apiKey-only input", () => {
        const result = loginInputSchema.safeParse({ apiKey: "raw-key" });
        expect(result.success).toBe(true);
    });

    it("accepts signature-only input", () => {
        const result = loginInputSchema.safeParse({ signature: "abc_1700000000000" });
        expect(result.success).toBe(true);
    });

    it("rejects when both apiKey and signature are provided", () => {
        const result = loginInputSchema.safeParse({
            apiKey: "raw-key",
            signature: "abc_1700000000000",
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0]?.message).toMatch(/exactly one/i);
        }
    });

    it("rejects when neither apiKey nor signature is provided", () => {
        const result = loginInputSchema.safeParse({});
        expect(result.success).toBe(false);
    });

    it("trims and rejects empty/whitespace apiKey", () => {
        const result = loginInputSchema.safeParse({ apiKey: "   " });
        expect(result.success).toBe(false);
    });

    it("trims and rejects empty/whitespace signature", () => {
        const result = loginInputSchema.safeParse({ signature: " " });
        expect(result.success).toBe(false);
    });

    it("rejects non-string apiKey", () => {
        const result = loginInputSchema.safeParse({ apiKey: 12345 });
        expect(result.success).toBe(false);
    });

    it("rejects non-string signature", () => {
        const result = loginInputSchema.safeParse({ signature: null });
        expect(result.success).toBe(false);
    });
});
