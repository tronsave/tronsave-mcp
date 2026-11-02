import { describe, expect, it } from "vitest";
import { z } from "zod";
import { registerTools } from "../../src/tools";
import { createInternalTools } from "../../src/tools/definitions/internal";
import { createPlatformTools } from "../../src/tools/definitions/platform";
import type { ToolDefinition } from "../../src/tools/definitions/definition_type";
import { TOOL_NAMES } from "../../src/tools/toolNames";

/**
 * The annotation matrix is a stable contract between TronSave and MCP
 * clients/LLMs. Lock the most important rows so any future definition
 * edit must consciously update the test matrix as well.
 */

const noopHandler = async () => ({
    content: [{ type: "text" as const, text: "{}" }],
    structuredContent: {},
    isError: false,
});

const buildPlatformTools = (): ToolDefinition[] =>
    createPlatformTools(
        {
            getSignMessageHandler: noopHandler,
            loginHandler: noopHandler,
            getUserInfoHandler: noopHandler,
            getUserAutoSettingHandler: noopHandler,
            getUserPermissionsHandler: noopHandler,
            estimateBuyEnergyHandler: noopHandler,
            orderDetailHandler: noopHandler,
            ordersListHandler: noopHandler,
            orderBookHandler: noopHandler,
            getMinPriceHandler: noopHandler,
            extendableDelegatesHandler: noopHandler,
            orderCreateHandler: noopHandler,
            orderSellManualHandler: noopHandler,
            orderCancelHandler: noopHandler,
            orderUpdateHandler: noopHandler,
            registerAutoSellHandler: noopHandler,
            updateAutoSellSettingHandler: noopHandler,
            generateApiKeyHandler: noopHandler,
            revokeApiKeyHandler: noopHandler,
            deleteAutoBuySettingHandler: noopHandler,
        } as never,
    );

const buildInternalTools = (): ToolDefinition[] =>
    createInternalTools(
        {
            getInternalAccountHandler: noopHandler,
            getDepositAddressHandler: noopHandler,
            extendRequestHandler: noopHandler,
        } as never,
    );

describe("tool annotations matrix", () => {
    const platformTools = buildPlatformTools();
    const internalTools = buildInternalTools();
    const allTools = [...platformTools, ...internalTools];
    const byName = new Map(allTools.map((t) => [t.name, t] as const));

    it("every tool declares annotations", () => {
        const missing = allTools.filter((t) => !t.annotations).map((t) => t.name);
        expect(missing).toEqual([]);
    });

    it("every tool except local session helpers talks to an external system (openWorldHint=true)", () => {
        const closedWorld = allTools.filter((t) => t.annotations?.openWorldHint !== true);
        expect(closedWorld.map((t) => t.name).sort()).toEqual(
            [TOOL_NAMES.PLATFORM.LOGOUT, TOOL_NAMES.PLATFORM.SESSION_STATUS].sort(),
        );
    });

    it("tools that require a wallet identity are gated as signature-session", () => {
        for (const name of [
            TOOL_NAMES.PLATFORM.ORDER_CANCEL,
            TOOL_NAMES.PLATFORM.ORDER_UPDATE,
            TOOL_NAMES.PLATFORM.ORDER_SELL_MANUAL,
            TOOL_NAMES.PLATFORM.ORDER_DETAIL,
        ]) {
            expect(byName.get(name)?.auth.mode, name).toBe("signature-session");
        }
        expect(byName.get(TOOL_NAMES.PLATFORM.ORDER_CREATE)?.auth.mode).toBe("public");
    });

    it("generate api key never logs its output", () => {
        expect(byName.get(TOOL_NAMES.PLATFORM.GENERATE_API_KEY)?.sensitiveOutput).toBe(true);
    });

    it("every `tronsave_*` cross-reference in any description points to a real tool name", () => {
        const validNames = new Set<string>([
            ...Object.values(TOOL_NAMES.PLATFORM),
            ...Object.values(TOOL_NAMES.INTERNAL),
        ]);
        const referencePattern = /tronsave_[a-z_]+/g;
        const orphans: Array<{ tool: string; reference: string }> = [];

        for (const tool of allTools) {
            const matches = tool.description.match(referencePattern) ?? [];
            for (const match of matches) {
                if (!validNames.has(match)) {
                    orphans.push({ tool: tool.name, reference: match });
                }
            }
        }

        expect(orphans).toEqual([]);
    });

    const expectedReadOnly = [
        TOOL_NAMES.PLATFORM.GET_SIGN_MESSAGE,
        TOOL_NAMES.PLATFORM.SESSION_STATUS,
        TOOL_NAMES.PLATFORM.USER_INFO_GET,
        TOOL_NAMES.PLATFORM.USER_AUTO_SETTING_GET,
        TOOL_NAMES.PLATFORM.USER_PERMISSIONS_GET,
        TOOL_NAMES.PLATFORM.ESTIMATE_BUY_RESOURCE,
        TOOL_NAMES.PLATFORM.ORDER_DETAIL,
        TOOL_NAMES.PLATFORM.LIST_ORDERS,
        TOOL_NAMES.PLATFORM.ORDER_BOOK,
        TOOL_NAMES.PLATFORM.GET_MIN_PRICE,
        TOOL_NAMES.PLATFORM.EXTENDABLE_DELEGATES_GET,
        TOOL_NAMES.INTERNAL.INTERNAL_ACCOUNT_GET,
        TOOL_NAMES.INTERNAL.GET_DEPOSIT_ADDRESS,
    ];

    it.each(expectedReadOnly)("tool %s is annotated read-only and idempotent", (name) => {
        const tool = byName.get(name);
        expect(tool, `missing tool ${name}`).toBeDefined();
        expect(tool!.annotations?.readOnlyHint).toBe(true);
        expect(tool!.annotations?.idempotentHint).toBe(true);
    });

    const expectedDestructive = [
        TOOL_NAMES.PLATFORM.ORDER_SELL_MANUAL,
        TOOL_NAMES.PLATFORM.ORDER_CANCEL,
        TOOL_NAMES.PLATFORM.GENERATE_API_KEY,
        TOOL_NAMES.PLATFORM.REVOKE_API_KEY,
        TOOL_NAMES.PLATFORM.DELETE_AUTO_BUY_SETTING,
    ];

    it.each(expectedDestructive)("tool %s is annotated destructive and not read-only", (name) => {
        const tool = byName.get(name);
        expect(tool, `missing tool ${name}`).toBeDefined();
        expect(tool!.annotations?.destructiveHint).toBe(true);
        expect(tool!.annotations?.readOnlyHint).not.toBe(true);
    });

    it("idempotent destructive tools (cancel/revoke/delete) flip idempotentHint=true", () => {
        const idempotentDestructive = [
            TOOL_NAMES.PLATFORM.ORDER_CANCEL,
            TOOL_NAMES.PLATFORM.REVOKE_API_KEY,
            TOOL_NAMES.PLATFORM.DELETE_AUTO_BUY_SETTING,
        ];
        for (const name of idempotentDestructive) {
            const tool = byName.get(name);
            expect(tool!.annotations?.idempotentHint, `tool ${name}`).toBe(true);
        }
    });

    it("non-idempotent mutating tools (create/update/login) do not claim idempotency", () => {
        const nonIdempotent = [
            TOOL_NAMES.PLATFORM.LOGIN,
            TOOL_NAMES.PLATFORM.ORDER_CREATE,
            TOOL_NAMES.PLATFORM.ORDER_SELL_MANUAL,
            TOOL_NAMES.PLATFORM.ORDER_UPDATE,
            TOOL_NAMES.PLATFORM.REGISTER_AUTO_SELL,
            TOOL_NAMES.PLATFORM.UPDATE_AUTO_SELL_SETTING,
            TOOL_NAMES.PLATFORM.GENERATE_API_KEY,
            TOOL_NAMES.INTERNAL.INTERNAL_EXTEND_REQUEST,
        ];
        for (const name of nonIdempotent) {
            const tool = byName.get(name);
            expect(tool!.annotations?.idempotentHint, `tool ${name}`).not.toBe(true);
        }
    });
});

describe("registerTools forwards annotations to MCP SDK", () => {
    it("passes the annotations object verbatim to server.registerTool", () => {
        const calls: Array<{ name: string; meta: Record<string, unknown> }> = [];
        const server = {
            registerTool: (
                name: string,
                meta: Record<string, unknown>,
                _fn: (args: unknown, extra: unknown) => Promise<unknown>,
            ) => {
                calls.push({ name, meta });
            },
        };
        const tool: ToolDefinition = {
            name: "annotated_tool",
            title: "Annotated Tool",
            description: "desc",
            auth: { mode: "public" },
            annotations: {
                title: "Annotated Tool",
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: true,
            },
            inputSchema: z.object({}),
            outputSchema: z.object({ ok: z.boolean() }),
            handler: noopHandler,
        };

        registerTools(server as never, [tool]);

        expect(calls).toHaveLength(1);
        expect(calls[0]?.meta.annotations).toEqual(tool.annotations);
    });

    it("omits the annotations key when the tool does not declare any", () => {
        const calls: Array<{ name: string; meta: Record<string, unknown> }> = [];
        const server = {
            registerTool: (
                name: string,
                meta: Record<string, unknown>,
                _fn: (args: unknown, extra: unknown) => Promise<unknown>,
            ) => {
                calls.push({ name, meta });
            },
        };
        const tool: ToolDefinition = {
            name: "bare_tool",
            title: "Bare Tool",
            description: "desc",
            auth: { mode: "public" },
            inputSchema: z.object({}),
            outputSchema: z.object({ ok: z.boolean() }),
            handler: noopHandler,
        };

        registerTools(server as never, [tool]);

        expect(calls).toHaveLength(1);
        expect(calls[0]?.meta).not.toHaveProperty("annotations");
    });
});
