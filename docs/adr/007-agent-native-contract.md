# ADR 007: Agent-native tool contract

## Status

Accepted (2026-10, v1.1.0)

## Context

The server is consumed by LLM agents, not by humans reading API docs. An audit found the contract
was hard for agents to use correctly:

- No server `instructions`; agents had to guess the auth model and units.
- Errors were free text (`safe()` wrapper) or thrown strings; agents could not tell retryable from fatal.
- The SDK validates `structuredContent` against `outputSchema` after the handler ran, so any upstream
  field drift (an extra `null`) turned a **successful** order into a reported failure — an agent would
  then retry and create a duplicate.
- Static-header clients (Claude Code, Cursor, OpenAI, Anthropic API connector) could not authenticate:
  a header API key never satisfied the tool gate.
- API keys were echoed into model context (`get_user_info`) and logged in plain text (`generate_api_key`).
- Docs listed ~15 tools that do not exist.

## Decision

1. **Instructions, resource, prompts.** `src/mcp/agentGuide.ts` is the single source for `initialize.instructions`,
   the `tronsave://guide/agent` resource and `docs/AGENT_GUIDE.md`. Prompts `buy_resource`, `account_overview`.
2. **Error envelope.** Handlers throw `AppError(message, status, code, { retryable, hint })`; `registerTools`
   converts every failure into `isError: true` + `{"error":{code,message,retryable,hint}}` (no `structuredContent`).
   For non-read-only tools, transport-level failures are forced to `retryable: false` with a "verify first" hint.
   Unknown errors are reported as `INTERNAL_ERROR` without internal details.
3. **Relaxed output validation.** Definitions keep precise output schemas (advertised in `tools/list` and used in
   tests); registration passes `relaxOutputSchema(schema)`: every field optional + nullable, unknown keys allowed,
   leaf types unchanged.
4. **Session helpers.** `tronsave_get_session_status` (what is unlocked now) and `tronsave_logout`.
5. **Header auth.** `Authorization: ApiKey|Bearer <key>`, `x-api-key`, and verified `Signature` headers satisfy the gate.
   Rejected header credentials do not break `initialize`/`tools/list`; they surface as the error of the first gated tool.
6. **Secret hygiene.** API keys are masked in outputs; `sensitiveOutput` tools never log bodies.
7. **Docs from code.** `docs/TOOLS.md` and `docs/AGENT_GUIDE.md` are generated (`npm run docs:tools`) and a test fails when stale.

## Consequences

- Tool results are compact JSON (`content[0].text` is no longer pretty-printed) — fewer tokens.
- Clients that parsed thrown-error strings must read the JSON envelope instead.
- Schema drift no longer causes false failures; real type changes still fail and show up in `tronsave_mcp_tool_errors_total`.
