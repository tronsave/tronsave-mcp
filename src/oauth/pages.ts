import type { Network } from "../config/constants";

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** JSON safe to inline inside a <script> element. */
const scriptJson = (value: unknown): string => JSON.stringify(value).replace(/</g, "\\u003c");

export interface SignInPageInput {
  requestId: string;
  clientName: string;
  redirectHost: string;
  network: Network;
  signMessage: { message: string; timestamp: number };
  nonce: string;
  error?: string;
}

const STYLE = `
:root{--bg:#f6f7f9;--card:#fff;--text:#14171c;--muted:#5d6673;--line:#dfe3e8;--accent:#c4281c;--accent-text:#fff;--warn-bg:#fff4e5;--warn:#8a4b00;--err-bg:#fdecea;--err:#a1260d}
@media (prefers-color-scheme:dark){:root{--bg:#101215;--card:#181b20;--text:#eef1f4;--muted:#9aa4b0;--line:#2b3038;--accent:#e2483b;--warn-bg:#2d2412;--warn:#f0c27a;--err-bg:#33191a;--err:#f2a39a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:440px;margin:40px auto;padding:0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px;margin-bottom:16px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:0 0 12px}p{margin:0 0 12px;color:var(--muted)}
.badge{display:inline-block;font-size:12px;padding:2px 8px;border-radius:99px;border:1px solid var(--line);color:var(--muted)}
.warn{background:var(--warn-bg);color:var(--warn);border-radius:8px;padding:10px 12px;margin:12px 0;font-size:14px}
.error{background:var(--err-bg);color:var(--err);border-radius:8px;padding:10px 12px;margin:0 0 16px;font-size:14px}
label{display:block;font-size:13px;color:var(--muted);margin:0 0 6px}
input{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--text);font:inherit;margin-bottom:12px}
button{width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--line);font:inherit;cursor:pointer;background:transparent;color:var(--text)}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-text)}
details{margin-top:12px}summary{cursor:pointer;color:var(--muted);font-size:13px}
.deny{background:none;border:none;color:var(--muted);text-decoration:underline;width:auto;padding:0}
small{color:var(--muted)}
`;

/** OAuth sign-in & consent page: links a TronSave API key or a TRON wallet to the requesting client. */
export const renderSignInPage = (input: SignInPageInput): string => {
  const client = escapeHtml(input.clientName);
  const host = escapeHtml(input.redirectHost);
  const requestId = escapeHtml(input.requestId);
  const networkLabel = input.network === "testnet" ? "Nile testnet" : "TRON mainnet";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect TronSave</title><style>${STYLE}</style></head>
<body><main>
<div class="card">
  <h1>Connect TronSave</h1>
  <p><strong>${client}</strong> wants to use your TronSave account. <span class="badge">${networkLabel}</span></p>
  <p>After you sign in you will be sent back to <strong>${host}</strong>. It will be able to read your account and place, change or cancel orders — your AI assistant asks you before each one.</p>
  <div class="warn">TronSave never asks for your private key or seed phrase. Only connect apps you trust.</div>
</div>
${input.error ? `<div class="error" role="alert">${escapeHtml(input.error)}</div>` : ""}
<div class="card">
  <h2>Sign in with your TRON wallet</h2>
  <p>Signs a one-time message in TronLink. Unlocks orders, auto-sell and account settings.</p>
  <form method="post" action="/oauth/signin" id="wallet-form">
    <input type="hidden" name="request_id" value="${requestId}">
    <input type="hidden" name="method" value="wallet">
    <input type="hidden" name="signature" id="signature">
    <button type="button" class="primary" id="tronlink">Connect TronLink</button>
    <details><summary>Other wallet? Paste a signature</summary>
      <p><small>Sign this exact message with your wallet (signMessageV2): <code id="msg"></code>, then paste <code>&lt;signature&gt;_<span id="ts"></span></code>.</small></p>
      <label for="manual">Signature token</label>
      <input id="manual" autocomplete="off" spellcheck="false" placeholder="0x…_1761200000">
      <button type="button" id="manual-submit">Continue</button>
    </details>
  </form>
</div>
<div class="card">
  <h2>Sign in with an API key</h2>
  <p>Unlocks your TronSave internal balance, deposits and balance-paid orders.</p>
  <form method="post" action="/oauth/signin">
    <input type="hidden" name="request_id" value="${requestId}">
    <input type="hidden" name="method" value="apikey">
    <label for="api_key">TronSave API key</label>
    <input id="api_key" name="api_key" type="password" autocomplete="off" required>
    <button type="submit" class="primary">Continue</button>
  </form>
</div>
<form method="post" action="/oauth/signin" style="text-align:center">
  <input type="hidden" name="request_id" value="${requestId}">
  <input type="hidden" name="method" value="deny">
  <button type="submit" class="deny">Cancel and go back</button>
</form>
</main>
<script nonce="${escapeHtml(input.nonce)}">
(function () {
  var sign = ${scriptJson(input.signMessage)};
  var form = document.getElementById("wallet-form");
  document.getElementById("msg").textContent = sign.message;
  document.getElementById("ts").textContent = String(sign.timestamp);
  function submit(token) { document.getElementById("signature").value = token; form.submit(); }
  document.getElementById("manual-submit").addEventListener("click", function () {
    var value = document.getElementById("manual").value.trim();
    if (value) submit(value.indexOf("_") > 0 ? value : value + "_" + sign.timestamp);
  });
  document.getElementById("tronlink").addEventListener("click", async function () {
    var button = this;
    try {
      if (!window.tronLink) { alert("TronLink is not installed. Install it or paste a signature below."); return; }
      button.disabled = true; button.textContent = "Waiting for TronLink…";
      await window.tronLink.request({ method: "tron_requestAccounts" });
      var tw = window.tronLink.tronWeb || window.tronWeb;
      var signature = await tw.trx.signMessageV2(sign.message);
      submit(signature + "_" + sign.timestamp);
    } catch (e) {
      button.disabled = false; button.textContent = "Connect TronLink";
      alert("Signing was cancelled or failed: " + (e && e.message ? e.message : e));
    }
  });
})();
</script>
</body></html>`;
};
