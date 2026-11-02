// End-to-end smoke test against a running server, using a throwaway wallet (no funds, no upstream writes).
// Usage: BASE=http://127.0.0.1:3000/mcp npm run smoke
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { TronWeb } = require("tronweb");
const BASE = process.env.BASE ?? "http://127.0.0.1:3000/mcp";
const H = { "content-type": "application/json", accept: "application/json, text/event-stream" };
let id = 0;
const rpc = async (method, params = {}, headers = {}) => {
  const res = await fetch(BASE, { method: "POST", headers: { ...H, ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  return { status: res.status, sid: res.headers.get("mcp-session-id"), body: await res.json() };
};
const call = async (sid, name, args = {}) => (await rpc("tools/call", { name, arguments: args }, { "mcp-session-id": sid })).body.result;

const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } });
const sid = init.sid;
console.log("initialize", init.status, "session", sid?.slice(0, 8), "instructions:", init.body.result.instructions.length, "chars");
const list = await rpc("tools/list", {}, { "mcp-session-id": sid });
console.log("tools", list.body.result.tools.length);

console.log("status(anon)", JSON.stringify((await call(sid, "tronsave_get_session_status")).structuredContent));
console.log("gated(anon)", (await call(sid, "tronsave_get_user_info")).content[0].text);

const tw = new TronWeb({ fullHost: "https://api.trongrid.io" });
const acct = await tw.createAccount();
const { message, timestamp } = (await call(sid, "tronsave_get_sign_message")).structuredContent;
const signature = await tw.trx.signMessageV2(message, acct.privateKey);
const login = await call(sid, "tronsave_login", { signature: `${signature}_${timestamp}` });
console.log("login(hex msg)", login.isError ? login.content[0].text : JSON.stringify(login.structuredContent));
console.log("wallet match", login.structuredContent?.walletAddress === acct.address.base58);

const rawSig = await tw.trx.signMessageV2(String(timestamp), acct.privateKey);
const init2 = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } });
const login2 = await call(init2.sid, "tronsave_login", { signature: `${rawSig}_${timestamp}` });
console.log("login(raw msg)", login2.isError ? login2.content[0].text : "ok " + login2.structuredContent.authMode);

const oldTs = timestamp - 3 * 86400;
const oldSig = await tw.trx.signMessageV2(String(oldTs), acct.privateKey);
const login3 = await call(init2.sid, "tronsave_login", { signature: `${oldSig}_${oldTs}` });
console.log("login(expired)", login3.content[0].text);

console.log("status(sig)", JSON.stringify((await call(sid, "tronsave_get_session_status")).structuredContent));
console.log("create bad addr", (await call(sid, "tronsave_create_order", { orderResourceType: "ENERGY", orderReceiver: "xyz", orderUnitPrice: 1, orderDurationSec: 60, orderResourceAmount: 1, paymentMethod: "internal", paymentPaymentAmount: 1 })).content[0].text.slice(0, 200));
const del = await fetch(BASE, { method: "DELETE", headers: { "mcp-session-id": sid } });
console.log("delete", del.status, "after", (await rpc("tools/list", {}, { "mcp-session-id": sid })).status);
