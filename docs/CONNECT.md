# Use TronSave in Claude Code, Cursor and Claude

TronSave lets your AI assistant rent TRON **ENERGY** and **BANDWIDTH** instead of burning TRX on fees:
check live prices, get a quote for any wallet, buy energy, and manage your orders, all from chat.

There is nothing to install. TronSave runs a hosted MCP server, and you connect your app to it with one
URL. This page shows how, step by step. It works today, whether or not TronSave is listed in your app's
marketplace yet.

Also at **https://mcp.tronsave.io/connect**. Developers building their own integration: see the
[integration quickstart](https://mcp.tronsave.io/quickstart).

## Pick a URL

| URL | Use it when |
|---|---|
| `https://mcp.tronsave.io/oauth/mcp` | **Recommended.** Your app opens a TronSave sign-in page the first time; you sign in with a TronSave API key or your TronLink wallet. Everything works. |
| `https://mcp.tronsave.io/mcp` | You only want prices and quotes (no sign-in), or you want to pass an API key in a header (scripts, CI). |
| `https://mcp.tronsave.io/oauth/testnet/mcp` | Trying things out on the **Nile testnet** with test TRX. Nothing real is spent. |

Mainnet and testnet are separate: a sign-in on one does not work on the other.

## Claude Code

1. Add the server (once, available in all your projects):

   ```bash
   claude mcp add --transport http --scope user tronsave https://mcp.tronsave.io/oauth/mcp
   ```

2. Start Claude Code, type `/mcp`, select **tronsave** and choose **Authenticate**. Your browser opens
   the TronSave sign-in page (see [Signing in](#signing-in)). When it says you're connected, go back
   to the terminal. If the browser doesn't open, copy the link Claude Code prints. From a shell you can
   also run `claude mcp login tronsave`.

3. Check it works:

   > Use TronSave to show the current price of energy.

**With an API key instead of the sign-in page** (headless machines, CI):

```bash
claude mcp add --transport http --scope user tronsave https://mcp.tronsave.io/mcp \
  --header "Authorization: ApiKey YOUR_TRONSAVE_API_KEY"
```

Keep keys in the `user` or `local` scope. Never add a key with `--scope project`: that writes it to
`.mcp.json`, which is usually committed to git.

**Remove it:** `claude mcp logout tronsave` then `claude mcp remove tronsave`.

## Cursor

**One click.** With Cursor installed, paste this link into your browser's address bar and confirm the
prompt in Cursor:

```text
cursor://anysphere.cursor-deeplink/mcp/install?name=tronsave&config=eyJ1cmwiOiJodHRwczovL21jcC50cm9uc2F2ZS5pby9vYXV0aC9tY3AifQ==
```

**Or by hand.** Add this to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "tronsave": {
      "url": "https://mcp.tronsave.io/oauth/mcp"
    }
  }
}
```

Then open **Cursor Settings → MCP**, find **tronsave** and use its sign-in/connect button. Cursor opens
the TronSave sign-in page in your browser and returns when you're done. In the Agent chat, try:

> Use TronSave to quote 65,000 energy for 1 hour for my wallet TXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX.

To use an API key instead, point at `https://mcp.tronsave.io/mcp` and add
`"headers": { "Authorization": "ApiKey YOUR_TRONSAVE_API_KEY" }`. Don't commit a project
`.cursor/mcp.json` that contains a key.

## Claude (claude.ai and Claude Desktop)

1. **Settings → Connectors → Add custom connector.** Custom connectors depend on your Claude plan.
2. Name: `TronSave`. URL: `https://mcp.tronsave.io/oauth/mcp`. Click **Add**, then **Connect**.
3. Sign in on the TronSave page. Back in a chat, ask:

   > What does it cost to rent 65,000 energy for 1 hour for TXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX?

Claude asks your permission the first time it uses each TronSave tool. Choose **Allow once** for
anything that buys or changes something.

## Other apps

Any app that supports remote MCP servers over HTTP works with the same URLs: VS Code (Copilot),
Windsurf, ChatGPT developer mode, the OpenAI and Anthropic APIs, and more. Config snippets are in the
[integration quickstart](https://mcp.tronsave.io/quickstart).

## Signing in

The TronSave sign-in page offers two ways:

| Sign in with | What it unlocks | How long it lasts |
|---|---|---|
| **TronSave API key** | Your TronSave internal balance: buy energy from your balance, order history, deposit address | 30 days, then sign in again |
| **TronLink wallet** (desktop extension), or paste a signature from any TRON wallet | Your wallet account: orders, auto-buy and auto-sell settings, notifications, API keys | 24 hours, since TronSave accepts a wallet signature for 24 h |

- You only sign a short timestamp message. TronSave never asks for and never receives your private
  key or seed phrase. **Never paste either into a chat.**
- Prices, quotes and market data need no sign-in at all.
- To disconnect, remove the connector in your app. You can also revoke an API key in TronSave.

## Things to try

- "What's the cheapest energy on TronSave right now?"
- "How much energy does TXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX need for a USDT transfer, and what would it cost?"
- "Buy 130k energy for one day for my wallet with my TronSave balance." (The assistant shows the total
  in TRX and waits for your yes.)
- "Show my open orders and cancel the oldest one."
- "Set up auto-buy: keep my wallet above 100k energy, budget 50 TRX."

## Safety

- Every tool that spends funds or changes settings is marked as a write, so your app asks before
  running it. Orders carry a price cap and duplicate protection, and failed buys are never retried
  automatically.
- Read the plan and the TRX total before you approve. On-chain payments are final.
- New to it? Start on the testnet URL with a Nile wallet and free test TRX.

## Troubleshooting

| You see | Do this |
|---|---|
| The app says the server needs authentication, or tools fail with `401` | Sign in again: `/mcp` → Authenticate in Claude Code, the connect button in Cursor, **Connect** in Claude. |
| `SESSION_REQUIRED` | That tool needs an account. Use the `/oauth/mcp` URL and sign in, or add an API key header. |
| `INVALID_SESSION_TYPE` | That tool needs a wallet sign-in. Disconnect, reconnect, and choose TronLink on the sign-in page. |
| Wallet tools stop working after a day | Wallet sign-ins last 24 hours. Sign in again. |
| `OAUTH_INVALID_TOKEN` mentioning testnet/mainnet | You signed in on the other network. Use the matching URL. |
| The browser never opens for sign-in | Copy the sign-in link your app prints or shows and open it yourself. |

## Help

admin@tronsave.io · Telegram https://t.me/wantingtrx · https://tronsave.io ·
Privacy: https://tronsave.io/privacy-policy
