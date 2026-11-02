// Imported first by `src/stdio.ts`, before `config/env` parses `process.env`.
process.env.MCP_TRANSPORT = "stdio";
// A local stdio server serves one client, so it needs no Redis unless one is configured.
process.env.REDIS_URL ??= "memory";
