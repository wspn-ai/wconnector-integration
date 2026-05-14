# W Connector — merchant integration

> **中文版本 → [README.zh-CN.md](README.zh-CN.md)**

Integration kit for **selling your API/MCP tool to AI agents** via the W Connector network. Self-service onboarding, stablecoin settlement on Ethereum/Base/Tron/Solana, no platform custody of your funds.

```
buyer agent ──► your shop ──► W Connector ──► Stablelink ──► your merchant balance
                  (you)            (us)            (payments)         (your money)
```

You get:

- **Self-service application** at `/apply.html` — no sales call, no contract round-trips
- **Stablecoin settlement** — buyers pay USDC/USDT/WUSD; funds land in your Stablelink merchant account
- **Slim integration** — your shop only needs 6 env vars; everything else (name, tags, agent_url, signing keys) hydrates from `GET /merchants/me` at boot
- **No platform custody** — W Connector never holds your funds and doesn't perform KYT on your behalf
- **Tier-2 isolation** (optional) — run your own wcheckout-agent so the platform never sees your Stablelink credentials

## Environments

| | URL |
|---|---|
| **Dev / sandbox** | `https://connector-dev.wcheckout.app` |
| **Production** | `https://connector.wcheckout.app` |

Dev and prod credentials are separate — applying on one does **not** carry over to the other.

## Quick start

```bash
# 1. Apply (dev)
open https://connector-dev.wcheckout.app/apply.html
# (prod is the same flow on https://connector.wcheckout.app/apply.html)

# 2. After admin approves (1-2 days), copy your one-time credentials:
#    merchant_id, api_key, gateway_to_merchant_key

# 3. Sign up at Stablelink (the payment processor W Connector relays through)
#    https://stablelink.app — separate account, can run in parallel with step 1
#    Integration docs: https://developer.wcheckout.app/7441280m0

# 4. Deploy the reference shop
git clone https://github.com/wspn-ai/wconnector-integration.git
cd wconnector-integration/examples/minimal-shop
cp .env.example .env    # fill in CONNECTOR_API_KEY + WCHECKOUT_*

npm install && npm run dev
```

You're now a discoverable merchant. AI agents running the [wagent-skill](https://github.com/wspn-ai/wagent-skill) can find you via `/merchants/search`, purchase your tool, and call it.

Full step-by-step in **[INTEGRATION.md](INTEGRATION.md)** (EN) / **[INTEGRATION.zh-CN.md](INTEGRATION.zh-CN.md)** (中文).

## What's in this repo

| Path | What it is |
|---|---|
| **[INTEGRATION.md](INTEGRATION.md)** / [zh-CN](INTEGRATION.zh-CN.md) | Full integration manual — apply, deploy, define products, test |
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | High-level architecture, A2A protocol overview, sequence diagram |
| **[ENV-REFERENCE.md](ENV-REFERENCE.md)** | Every shop env var with description + safe defaults |
| **[examples/minimal-shop/](examples/minimal-shop/)** | A ~150-line TypeScript shop you can clone and ship |

## What you'll need to provide

| Item | Who provides | Notes |
|---|---|---|
| HTTPS public URL for your shop | You | Becomes your `agent_url`; self-signed certs not accepted |
| Stablelink merchant account | You | Sign up at <https://stablelink.app> — separate from W Connector |
| Your actual tool implementation | You | TypeScript function — see `examples/minimal-shop/src/tools/` |
| `CONNECTOR_API_KEY` | W Connector | Issued at application approval |
| `gateway_to_merchant_key` | W Connector | Same |

## Cost / pricing convention

Current network convention: **one product = one tool call**, priced **$0.10–$0.60 USD**. You set your own prices within (or outside) this range.

Pack discounts (`calls_per_unit > 1`) are technically supported by the protocol but not currently used by reference shops — keeping things simple.

## Settlement

Buyer pays in stablecoin → Stablelink observes the on-chain transfer → fires a webhook to your shop's `/notify` → your shop relays "PAID" to W Connector → W Connector marks the order paid and hands the buyer the bearer token they need to call your tool.

Funds accumulate in your Stablelink merchant balance. Off-ramp via Stablelink's standard withdrawal flow (off-platform). W Connector takes no cut of merchandise sales.

## Going to production

Pre-flight checklist (full version in [INTEGRATION.md §5](INTEGRATION.md#5-going-to-production)):

- [ ] Apply on the prod portal (`https://connector.wcheckout.app/apply.html`) — dev and prod credentials are separate
- [ ] `WCHECKOUT_SANDBOX=false`
- [ ] Stablelink production callback URL pointed at your prod shop
- [ ] Stablelink IP allowlist contains your prod shop egress IP
- [ ] PostgreSQL for shop order state (not in-memory)
- [ ] Sentry / observability on your tool function

## License

MIT — see [LICENSE](LICENSE).

## Related repos

- **[wagent-skill](https://github.com/wspn-ai/wagent-skill)** — the buyer-side skill (so you can test your integration end-to-end without writing a buyer)
