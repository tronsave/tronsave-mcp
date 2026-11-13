// Full end-to-end check of the MCP server against TronSave TESTNET (Nile), using a real test wallet.
//
//   TRONSAVE_TESTNET_PRIVATE_KEY=<nile-only key> BASE=http://127.0.0.1:3000/testnet/mcp npm run e2e:testnet
//   add WRITE=1 to run steps that change state (deposit, orders, auto-sell, api key). Deposits
//   DEPOSIT_TRX (default 60) so the orders and the 20 TRX auto-buy budget all fit; needs ~100 Nile TRX.
//
// Refuses to run against a non-testnet endpoint. Prints a PASS/FAIL line per step and writes
// testnet-e2e-report.json (secrets masked). Never use a wallet that holds mainnet funds.
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { TronWeb } = require("tronweb");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000/testnet/mcp";
const FULLNODE = process.env.FULLNODE ?? "https://nile.trongrid.io";
const PRIVATE_KEY = process.env.TRONSAVE_TESTNET_PRIVATE_KEY;
const WRITE = process.env.WRITE === "1";
const DEPOSIT_TRX = Number(process.env.DEPOSIT_TRX ?? 60);

if (!BASE.includes("/testnet/")) {
  console.error(`Refusing to run: BASE must be a testnet endpoint (got ${BASE}).`);
  process.exit(2);
}
if (!PRIVATE_KEY) {
  console.error("TRONSAVE_TESTNET_PRIVATE_KEY is required (a Nile-only test wallet).");
  process.exit(2);
}

const tw = new TronWeb({ fullHost: FULLNODE, privateKey: PRIVATE_KEY });
const WALLET = tw.address.fromPrivateKey(PRIVATE_KEY);
const HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };
const mask = (v) => (typeof v === "string" && v.length > 10 ? `${v.slice(0, 4)}…${v.slice(-3)}` : v);
const results = [];
let rpcId = 0;

const rpc = async (method, params = {}, headers = {}) => {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { ...HEADERS, ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const text = await res.text();
  return { status: res.status, sessionId: res.headers.get("mcp-session-id"), body: text ? JSON.parse(text) : {} };
};

const newSession = async (headers = {}) => {
  const init = await rpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "testnet-e2e", version: "1" } },
    headers,
  );
  if (init.status !== 200 || !init.sessionId) throw new Error(`initialize failed: ${init.status}`);
  await rpc("notifications/initialized", {}, { ...headers, "mcp-session-id": init.sessionId });
  return { id: init.sessionId, headers: { ...headers, "mcp-session-id": init.sessionId }, init: init.body.result };
};

/** Calls a tool; returns { ok, data, error } where data is structuredContent and error the envelope. */
const tool = async (session, name, args = {}) => {
  const { body } = await rpc("tools/call", { name, arguments: args }, session.headers);
  const result = body.result ?? {};
  if (body.error) return { ok: false, error: { code: "JSONRPC", message: body.error.message } };
  if (result.isError) {
    const text = result.content?.[0]?.text ?? "";
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error && typeof parsed.error === "object") return { ok: false, error: parsed.error };
      // `ok()` sets isError when a mutation envelope has success: false, but the body stays the envelope.
      if (parsed && typeof parsed === "object" && parsed.success === false) {
        const code =
          typeof parsed.code === "string" ? parsed.code : typeof parsed.code === "number" ? String(parsed.code) : "REJECTED";
        const message = typeof parsed.message === "string" ? parsed.message : text.slice(0, 300);
        return { ok: false, error: { code, message } };
      }
    } catch {
      return { ok: false, error: { code: "TEXT", message: text.slice(0, 300) } };
    }
    return { ok: false, error: { code: "TEXT", message: text.slice(0, 300) } };
  }
  return { ok: true, data: result.structuredContent };
};

const step = async (name, fn, { write = false } = {}) => {
  if (write && !WRITE) {
    results.push({ step: name, status: "SKIP", note: "set WRITE=1" });
    console.log(`SKIP  ${name} (WRITE=1 to enable)`);
    return undefined;
  }
  const started = Date.now();
  try {
    const value = await fn();
    results.push({ step: name, status: "PASS", ms: Date.now() - started, value });
    console.log(`PASS  ${name}${value !== undefined ? `  ${JSON.stringify(value).slice(0, 220)}` : ""}`);
    return value;
  } catch (error) {
    results.push({ step: name, status: "FAIL", ms: Date.now() - started, error: String(error?.message ?? error) });
    console.log(`FAIL  ${name}  ${String(error?.message ?? error).slice(0, 400)}`);
    return undefined;
  }
};

const expectOk = (r, label) => {
  if (!r.ok) throw new Error(`${label}: ${JSON.stringify(r.error)}`);
  return r.data;
};
const expectCode = (r, code) => {
  if (r.ok || r.error?.code !== code) throw new Error(`expected ${code}, got ${JSON.stringify(r.ok ? r.data : r.error)}`);
  return code;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const signLogin = async (session, signer = PRIVATE_KEY) => {
  const msg = expectOk(await tool(session, "tronsave_get_sign_message"), "sign message");
  const signature = await tw.trx.signMessageV2(msg.message, signer);
  return expectOk(await tool(session, "tronsave_login", { signature: `${signature}_${msg.timestamp}` }), "login");
};

console.log(`Testnet E2E against ${BASE} — wallet ${WALLET} — WRITE=${WRITE}\n`);

// ---------------------------------------------------------------- A. protocol + public tools
const anon = await newSession();
await step("A1 initialize returns instructions", async () => {
  if (!String(anon.init.instructions).includes("tronsave_get_session_status")) throw new Error("no instructions");
  return { server: anon.init.serverInfo };
});
await step("A2 tools/list = 53 tools with output schemas", async () => {
  const { body } = await rpc("tools/list", {}, anon.headers);
  const tools = body.result.tools;
  if (tools.length !== 53 || tools.some((t) => !t.outputSchema)) throw new Error(`got ${tools.length}`);
  return tools.length;
});
await step("A3 session status (anonymous)", async () =>
  expectOk(await tool(anon, "tronsave_get_session_status"), "status"));
const minPrice = await step("A4 get_min_price ENERGY", async () =>
  expectOk(await tool(anon, "tronsave_get_min_price", { resourceType: "ENERGY", buyAmount: 65000, durationSec: 3600 }), "min price"));
await step("A5 list_order_books ENERGY", async () => {
  const d = expectOk(await tool(anon, "tronsave_list_order_books", { resourceType: "ENERGY" }), "order book");
  return { levels: d.orderBook.length, first: d.orderBook[0] };
});
const estimate = await step("A6 estimate_buy_resource 65k ENERGY 1h", async () =>
  expectOk(
    await tool(anon, "tronsave_estimate_buy_resource", { receiver: WALLET, buyResourceAmount: 65000, durationSec: 3600 }),
    "estimate",
  ));
await step("A7 list_orders (public)", async () => {
  const d = expectOk(await tool(anon, "tronsave_list_orders", { limit: 5 }), "orders");
  return { count: d.orders.length };
});
await step("A8 list_extendable_delegates", async () =>
  expectOk(await tool(anon, "tronsave_list_extendable_delegates", { receiver: WALLET, resourceType: "ENERGY" }), "extendable"));
await step("A9 gated tool without login → SESSION_REQUIRED", async () =>
  expectCode(await tool(anon, "tronsave_get_internal_account"), "SESSION_REQUIRED"));
await step("A10 invalid receiver rejected by input schema", async () => {
  const r = await tool(anon, "tronsave_estimate_buy_resource", { receiver: "not-an-address" });
  if (r.ok || !/Input validation/.test(r.error.message)) throw new Error(JSON.stringify(r));
  return "rejected";
});

// ---------------------------------------------------------------- B. wallet signature login
const sig = await newSession();
const login = await step("B1 signature login (hex message)", async () => {
  const d = await signLogin(sig);
  if (d.walletAddress !== WALLET) throw new Error(`wallet mismatch ${d.walletAddress}`);
  return { authMode: d.authMode, hasInternalApiKey: d.hasInternalApiKey, warnings: d.warnings };
});
await step("B2 expired signature rejected", async () => {
  const s = await newSession();
  const old = Math.floor(Date.now() / 1000) - 3 * 86400;
  const signature = await tw.trx.signMessageV2(String(old), PRIVATE_KEY);
  return expectCode(await tool(s, "tronsave_login", { signature: `${signature}_${old}` }), "SIGNATURE_EXPIRED");
});
await step("B3 get_user_info (apiKey masked)", async () => {
  const d = expectOk(await tool(sig, "tronsave_get_user_info"), "user info");
  return { address: d.address, balance: d.balance, internalAccount: d.internalAccount && { ...d.internalAccount, apiKey: mask(d.internalAccount.apiKey) } };
});
await step("B4 get_user_permissions", async () => expectOk(await tool(sig, "tronsave_get_user_permissions"), "permissions"));
await step("B5 get_user_auto_setting", async () => expectOk(await tool(sig, "tronsave_get_user_auto_setting"), "auto setting"));
await step("B6 list_orders isOnlyMyOrder", async () => {
  const d = expectOk(await tool(sig, "tronsave_list_orders", { isOnlyMyOrder: true, limit: 5 }), "my orders");
  return { count: d.orders.length };
});

// ---------------------------------------------------------------- C. API key + internal balance
let apiKey = process.env.TRONSAVE_TESTNET_API_KEY;
if (!apiKey && login && !login.hasInternalApiKey) {
  const gen = await step("C0 generate_api_key (no internal account yet)", async () => {
    const d = expectOk(await tool(sig, "tronsave_generate_api_key"), "generate");
    if (!d.success) throw new Error(d.message);
    apiKey = d.data;
    return { success: d.success, key: mask(d.data) };
  }, { write: true });
  void gen;
}
const keyed = apiKey ? await newSession({ authorization: `ApiKey ${apiKey}` }) : sig;
await step("C1 header/api-key session: get_internal_account", async () => {
  const d = expectOk(await tool(keyed, "tronsave_get_internal_account"), "internal account");
  return { balanceSun: d.balance, depositAddress: d.depositAddress, apiKey: d.apiKey };
});
const deposit = await step("C2 get_deposit_address", async () =>
  expectOk(await tool(keyed, "tronsave_get_deposit_address", { amountTrx: DEPOSIT_TRX }), "deposit"));
await step(`C3 deposit ${DEPOSIT_TRX} TRX on-chain and wait for internal balance`, async () => {
  if (!deposit?.depositAddress) throw new Error("no deposit address");
  const before = Number(expectOk(await tool(keyed, "tronsave_get_internal_account"), "before").balance);
  const tx = await tw.trx.sendTransaction(deposit.depositAddress, DEPOSIT_TRX * 1e6);
  for (let i = 0; i < 24; i += 1) {
    await sleep(5000);
    const now = Number(expectOk(await tool(keyed, "tronsave_get_internal_account"), "after").balance);
    if (now > before) return { txid: tx.txid ?? tx.transaction?.txID, before, now };
  }
  throw new Error("internal balance did not increase within 2 minutes");
}, { write: true });

// ---------------------------------------------------------------- D. orders
const orderArgs = (method) => ({
  orderResourceType: "ENERGY",
  orderReceiver: WALLET,
  orderUnitPrice: estimate?.unitPrice,
  orderDurationSec: estimate?.durationSec ?? 3600,
  orderResourceAmount: 65000,
  paymentMethod: method,
  paymentPaymentAmount: estimate?.estimateTrx,
});
const internalOrder = await step("D1 create_order internal", async () => {
  const d = expectOk(await tool(keyed, "tronsave_create_order", orderArgs("internal")), "create internal");
  if (!d.success) throw new Error(`${d.code} ${d.message}`);
  return d.data;
}, { write: true });
if (internalOrder?.orderId) {
  await step("D2 get_order (verify)", async () => expectOk(await tool(sig, "tronsave_get_order", { id: internalOrder.orderId }), "get order"));
  await step("D3 update_order newPrice (or clean ORDER_CAN_NOT_UPDATE once matched)", async () => {
    const res = await tool(sig, "tronsave_update_order", { orderId: internalOrder.orderId, newPrice: (estimate.unitPrice ?? 60) + 5 });
    // Testnet sellers often fill a fresh order within seconds; a filled order can no longer be re-priced.
    if (!res.ok && /ORDER_CAN_NOT_UPDATE/.test(res.error?.message ?? "")) return { rejected: "ORDER_CAN_NOT_UPDATE" };
    return expectOk(res, "update");
  }, { write: true });
  await step("D4 cancel_order", async () => expectOk(await tool(sig, "tronsave_cancel_order", { orderId: internalOrder.orderId }), "cancel"), { write: true });
  await step("D5 cancel again (idempotency)", async () => expectOk(await tool(sig, "tronsave_cancel_order", { orderId: internalOrder.orderId }), "cancel 2"), { write: true });
}
await step("D6 create_order onchain with wallet-signed payment", async () => {
  const fresh = expectOk(
    await tool(anon, "tronsave_estimate_buy_resource", { receiver: WALLET, buyResourceAmount: 65000, durationSec: 3600 }),
    "estimate",
  );
  const unsigned = await tw.transactionBuilder.sendTrx(fresh.systemDepositAddress, Math.ceil(fresh.estimateTrx), WALLET);
  const signed = await tw.trx.sign(unsigned, PRIVATE_KEY);
  const d = expectOk(
    await tool(anon, "tronsave_create_order", {
      ...orderArgs("onchain"),
      orderUnitPrice: fresh.unitPrice,
      paymentPaymentAmount: Math.ceil(fresh.estimateTrx),
      paymentSignedTx: signed,
    }),
    "create onchain",
  );
  if (!d.success) throw new Error(`${d.code} ${d.message}`);
  return d.data;
}, { write: true });
await step("D7 cancel_order with api-key-only session → INVALID_SESSION_TYPE", async () => {
  if (!apiKey) return "skipped (no api key)";
  return expectCode(await tool(keyed, "tronsave_cancel_order", { orderId: "000000000000000000000000" }), "INVALID_SESSION_TYPE");
});

// ---------------------------------------------------------------- F. market insight tools (public)
await step("F1 get_market_overview", async () => {
  const d = expectOk(await tool(anon, "tronsave_get_market_overview"), "overview");
  if (typeof d.resources?.totalAvailableEnergy !== "number") throw new Error("no energy total");
  return { energy: d.resources.totalAvailableEnergy, pool: d.totalPool, apy: d.apy };
});
await step("F2 get_price_table ENERGY", async () => {
  const d = expectOk(await tool(anon, "tronsave_get_price_table", { resourceType: "ENERGY" }), "price table");
  if (d.prices.length !== d.amounts.length || d.prices[0].length !== d.durations.length) throw new Error("grid shape");
  return { durations: d.durations.length, amounts: d.amounts.length };
});
await step("F3 get_system_info", async () => {
  const d = expectOk(await tool(anon, "tronsave_get_system_info"), "system");
  if (!d.minBuyEnergyAmount || !d.systemDepositAddress) throw new Error("missing fields");
  return { minBuyEnergy: d.minBuyEnergyAmount, usdtEnergy: d.usdtTransferEnergyValue?.value };
});
await step("F4 get_account_resources (any address)", async () => {
  const d = expectOk(await tool(anon, "tronsave_get_account_resources", { address: WALLET }), "resources");
  if (d.address !== WALLET) throw new Error(`address ${d.address}`);
  return { balance: d.balance };
});
await step("F5 suggest_create_order", async () => {
  const d = expectOk(await tool(anon, "tronsave_suggest_create_order", { resourceType: "ENERGY", receiver: WALLET, resourceAmount: 65000, durationSec: 3600, unitPrice: 80 }), "suggest");
  if (!d.suggestions.length) throw new Error("no suggestion");
  return d.suggestions.map((x) => ({ type: x.suggestCreateType, ready: x.readyToFill, payout: x.payout }));
});
await step("F6 list_extendable_receivers", async () =>
  ({ count: expectOk(await tool(anon, "tronsave_list_extendable_receivers", { requester: WALLET }), "receivers").receivers.length }));
await step("F7 insight tools reject bad input", async () => {
  const r = await tool(anon, "tronsave_get_account_resources", { address: "not-an-address" });
  if (r.ok || !/Input validation/.test(r.error.message)) throw new Error(JSON.stringify(r));
  return "rejected";
});

// ---------------------------------------------------------------- G. signature-session insight tools
const sig2 = await newSession();
await signLogin(sig2).catch(() => undefined);
await step("G1 get_seller_stats", async () => {
  const d = expectOk(await tool(sig2, "tronsave_get_seller_stats", { resourceType: "ENERGY", timeFilterBy: "D7" }), "stats");
  return { hasStats: d.stats !== null, chartDays: d.chart.length };
});
await step("G2 list_delegations", async () =>
  ({ count: expectOk(await tool(sig2, "tronsave_list_delegations", { limit: 5 }), "delegations").delegations.length }));
await step("G3 list_auto_buy_settings", async () =>
  ({ count: expectOk(await tool(sig2, "tronsave_list_auto_buy_settings", { limit: 5 }), "auto-buy").settings.length }));
await step("G4 list_notifications", async () => {
  const d = expectOk(await tool(sig2, "tronsave_list_notifications", { limit: 5 }), "notifications");
  return { total: d.total, unread: d.unreadCount };
});
await step("G5 mark_notifications_read (all)", async () =>
  expectOk(await tool(sig2, "tronsave_mark_notifications_read"), "mark read").success, { write: true });
await step("G8 auto-buy rule lifecycle: create → list → pause → delete", async () => {
  // A receiver may hold one active rule: clear leftovers from earlier runs first.
  for (const old of expectOk(await tool(sig2, "tronsave_list_auto_buy_settings", { limit: 10 }), "list auto-buy").settings) {
    if (old.receiver === WALLET) expectOk(await tool(sig2, "tronsave_delete_auto_buy_setting", { id: old.id }), "cleanup");
  }
  const created = expectOk(await tool(sig2, "tronsave_create_auto_buy_setting", {
    resourceType: "ENERGY", receiver: WALLET, unitPrice: String(Math.ceil(minPrice?.minPrice ?? 70)), durationSec: 3600, resourceAmount: 65000,
    thresholdResourceAmount: 100000, limitBudgetInSun: "20000000", limitInOrderCount: 1,
  }), "create auto-buy");
  if (!created.success) throw new Error(created.message);
  const list = expectOk(await tool(sig2, "tronsave_list_auto_buy_settings", { limit: 10 }), "list auto-buy").settings;
  const rule = list.find((r) => r.receiver === WALLET);
  if (!rule) throw new Error("created rule not listed");
  try {
    const upd = expectOk(await tool(sig2, "tronsave_update_auto_buy_setting", { id: rule.id, isActive: false }), "update auto-buy");
    if (!upd.success) throw new Error(upd.message);
    return { id: mask(rule.id), pausedTo: upd.data?.isActive };
  } finally {
    expectOk(await tool(sig2, "tronsave_delete_auto_buy_setting", { id: rule.id }), "delete auto-buy");
  }
}, { write: true });
await step("G6 signature tools gated without login", async () =>
  expectCode(await tool(anon, "tronsave_get_seller_stats", { resourceType: "ENERGY" }), "SESSION_REQUIRED"));
await step("G7 signature tools refuse an api-key-only session", async () => {
  if (!apiKey) return "skipped (no api key)";
  return expectCode(await tool(keyed, "tronsave_list_delegations", {}), "INVALID_SESSION_TYPE");
});

// ---------------------------------------------------------------- I. referral, notifications settings, flash unstake, bulk buy
await step("I1 get_referral", async () => {
  const d = expectOk(await tool(sig2, "tronsave_get_referral", { limit: 5 }), "referral");
  return { totalRef: d.totalRef, referrals: d.referralList?.length ?? 0 };
});
await step("I2 get_telegram_notify_setting", async () =>
  ({ linked: expectOk(await tool(sig2, "tronsave_get_telegram_notify_setting"), "telegram").setting !== null }));
await step("I3 update_telegram_notify_setting is accepted or rejected cleanly", async () => {
  const r = await tool(sig2, "tronsave_update_telegram_notify_setting", {
    buyerFilter: { isEnabled: false, reclaimAlertTime: { isEnabled: false, value: 3600 }, lowResourceAlertEnergy: { isEnabled: false, value: 10000 }, lowResourceAlertBandwidth: { isEnabled: false, value: 500 } },
  });
  return r.ok ? { success: r.data.success, message: r.data.message } : { rejected: r.error.code, message: r.error.message.slice(0, 120) };
}, { write: true });
await step("I4 get_agency_bot", async () => ({ hasBot: expectOk(await tool(sig2, "tronsave_get_agency_bot"), "agency").bot !== null }));
await step("I5 list_internal_transactions", async () => {
  const d = expectOk(await tool(sig2, "tronsave_list_internal_transactions", { limit: 5 }), "internal txs");
  return { balance: d.balance, txs: d.transactions.length };
});
await step("I6 get_flash_unstake_request", async () => ({ has: expectOk(await tool(sig2, "tronsave_get_flash_unstake_request"), "flash request").request !== null }));
await step("I7 list_flash_unstake_orders (available/ongoing/completed)", async () => {
  const out = {};
  for (const kind of ["available", "ongoing", "completed"]) out[kind] = expectOk(await tool(anon, "tronsave_list_flash_unstake_orders", { kind, limit: 3 }), kind).orders.length;
  return out;
});
await step("I8 estimate_flash_unstake: estimate or clean 404", async () => {
  const r = await tool(anon, "tronsave_estimate_flash_unstake", { requester: WALLET });
  return r.ok ? { payout: r.data.payoutAmount } : { code: r.error.code };
});
await step("I9 bulk_create_internal_orders for 2 receivers", async () => {
  const r = await tool(sig2, "tronsave_bulk_create_internal_orders", {
    resourceType: "ENERGY", receivers: [WALLET, "TATT1UzHRikft98bRFqApFTsaSw73ycfoS"], unitPrice: 100, durationSec: 3600, resourceAmount: 64000, paymentAmount: 12800000,
  });
  if (r.ok) return { success: r.data.success, orders: r.data.data?.length, message: r.data.message };
  return { rejected: r.error.code, message: r.error.message.slice(0, 160) };
}, { write: true });

// ---------------------------------------------------------------- H. internal (api-key) tools
await step("H1 internal_order_book", async () => {
  const d = expectOk(await tool(keyed, "tronsave_internal_order_book", { resourceType: "ENERGY" }), "internal book");
  return { levels: d.data?.length ?? null };
});
await step("H2 internal_order_estimate", async () => {
  const d = expectOk(await tool(keyed, "tronsave_internal_order_estimate", { resourceType: "ENERGY", resourceAmount: 65000, durationSec: 3600, receiver: WALLET }), "internal estimate");
  if (!(d.estimateTrx > 0)) throw new Error("no estimate");
  return d;
});
await step("H3 internal_order_history", async () => {
  const d = expectOk(await tool(keyed, "tronsave_internal_order_history", { page: 0, pageSize: 5 }), "history");
  return { count: d.data?.length ?? 0, total: d.total };
});
await step("H4 internal_order_details unknown id → ORDER_NOT_FOUND", async () => {
  const r = await tool(keyed, "tronsave_internal_order_details", { orderId: "000000000000000000000000" });
  if (r.ok || !/ORDER_NOT_FOUND/.test(JSON.stringify(r.error))) throw new Error(JSON.stringify(r));
  return "ORDER_NOT_FOUND";
});
await step("H5 internal_extend_delegates", async () => {
  const d = expectOk(await tool(keyed, "tronsave_internal_extend_delegates", { receiver: WALLET, extendTo: Math.floor(Date.now() / 1000) + 86_400, resourceType: "ENERGY" }), "extend delegates");
  return { delegates: d.extendData?.length ?? 0, isAbleToExtend: d.isAbleToExtend };
});
await step("H6 internal_order_create spends the internal balance (or is rejected cleanly) and is never retried", async () => {
  const r = await tool(keyed, "tronsave_internal_order_create", { resourceType: "ENERGY", resourceAmount: 65000, durationSec: 3600, receiver: WALLET, unitPrice: "SLOW" });
  if (r.ok) return { orderId: r.data.orderId };
  if (!r.error.code || r.error.retryable) throw new Error(JSON.stringify(r.error));
  return { rejected: r.error.code };
}, { write: true });

// ---------------------------------------------------------------- E. session lifecycle
await step("E1 logout clears login", async () => {
  expectOk(await tool(sig, "tronsave_logout"), "logout");
  const s = expectOk(await tool(sig, "tronsave_get_session_status"), "status");
  if (s.authenticated) throw new Error("still authenticated");
  return s.authMode;
});
await step("E2 DELETE session → 404 afterwards", async () => {
  const del = await fetch(BASE, { method: "DELETE", headers: { "mcp-session-id": anon.id } });
  const after = await rpc("tools/list", {}, anon.headers);
  if (del.status !== 200 || after.status !== 404) throw new Error(`${del.status}/${after.status}`);
  return "ok";
});

const summary = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
writeFileSync("testnet-e2e-report.json", JSON.stringify({ base: BASE, wallet: WALLET, write: WRITE, summary, results }, null, 2));
console.log(`\n${JSON.stringify(summary)} — report: testnet-e2e-report.json`);
process.exit(results.some((r) => r.status === "FAIL") ? 1 : 0);
