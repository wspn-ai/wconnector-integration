# W Connector Integration Guide

> **中文版本 → [INTEGRATION.zh-CN.md](INTEGRATION.zh-CN.md)**
>
> Self-service merchant onboarding for W Connector — apply, get credentials, deploy a reference shop, define products, take your first payment. ~30 minutes end-to-end.

---

## 1. What W Connector is, in one paragraph

W Connector lets any HTTPS service expose its API/MCP tool to AI agents who pay in stablecoin. You publish a product, a buyer agent discovers it, pays in USDC/USDT/WUSD on Ethereum/Base/Tron/Solana, gets a bearer token, and calls your tool. Settlement lands in your Stablelink merchant account. **The platform does not hold your funds and does not perform KYT on your behalf.**

```
Buyer Agent ──► shop-node ──► W Connector ──► Stablelink ──► your merchant balance
                  (you)         (us)            (payments)         (your money)
```

You run **shop-node** (a thin Node.js reference implementation we provide). It exposes:
- `/.well-known/agent.json` — your A2A agent card (product catalog + tool schemas)
- `/tasks/send` — A2A endpoint buyers call
- `/v1/tools/<tool_name>` — your actual tool (gated by bearer token)
- `/notify` — Stablelink webhook receiver

You don't need to learn A2A or implement the order lifecycle yourself — shop-node handles all of it. Your only real job is to implement your tool function.

## 2. Prerequisites

| Item | Notes |
|---|---|
| HTTPS public URL | Will become your `agent_url`. Self-signed certs not allowed. |
| Contact email | Platform admin reaches you here for approval feedback. |
| Stablelink merchant account | Sign up at <https://stablelink.app>. Can run in parallel with platform application. |
| Docker or Node.js 20+ | For running shop-node. |
| PostgreSQL (optional) | shop-node defaults to in-memory; production should use PG. |

## 3. Step-by-step (30 minutes)

### 3.1 Apply on the platform (5 min)

Open `https://connector-dev.wcheckout.app/apply.html` and fill 6 fields:

| Field | Description |
|---|---|
| `name` | Your company / project name (≤80 chars) |
| `email` | Contact email |
| `agent_url` | Your shop-node public URL; must be `https://`. Placeholder OK, editable later. |
| `description` | One-line tagline (≤200 chars) |
| `product_summary` | What you sell, what problem it solves (≤500 chars) |
| `callback_url` | Where Stablelink will webhook you, e.g. `https://yourshop.example.com/notify` |

Optional: `website`, `contact_x` (your X handle).

You'll receive a **status URL** with a one-time token. **Bookmark it** — that's how you track approval and retrieve credentials later.

**Rate limit:** 3 applications per IP per 24h.

### 3.2 Wait for approval & retrieve credentials (1–2 days → 5 min)

Once approved, your status URL exposes a **"View credentials"** button. Click it — you have **5 minutes** to copy three secrets:

```
merchant_id              = MCH_XXXXXXXXXXXX
api_key                  = sk_xxxxxxxxxxxxxxxx
gateway_to_merchant_key  = gtm_xxxxxxxxxxxxxxxx
```

- `api_key` → your shop-node uses this as `CONNECTOR_API_KEY` (Bearer when calling W Connector)
- `gateway_to_merchant_key` → used to verify HMAC on `tasks/statusUpdate` pushes from gateway

**The page shows credentials only once.** Store them in 1Password / your secret manager immediately.

### 3.3 Set up Stablelink (5 min, can run in parallel)

Sign up at <https://stablelink.app>. **Official integration docs:** <https://developer.wcheckout.app/7441280m0>.

From your Stablelink dashboard, capture three values:

| Field | Purpose |
|---|---|
| `WCHECKOUT_API_KEY` | OAuth client_id |
| `WCHECKOUT_API_SECRET` | OAuth client_secret |
| `WCHECKOUT_SIGN_KEY` | HMAC-SHA512 webhook signing key (**not the same as API_SECRET**) |

Also:

1. **Set the callback URL** to match what you registered in step 3.1 (e.g. `https://yourshop.example.com/notify`).
2. **Set IP allowlist** to your shop-node egress IP. Wrong IP returns `ip not matched`.

### 3.4 Deploy shop-node (10 min)

Fastest path — clone the reference implementation:

```bash
git clone https://github.com/wspn-ai/wconnector-integration.git
cd wconnector-integration/examples/minimal-shop
cp .env.example .env
```

Edit `.env`:

```bash
# Identity
CONNECTOR_API_KEY=sk_xxxxxxxxxxxxxxxx         # from step 3.2
GATEWAY_URL=https://connector-dev.wcheckout.app

# Runtime
SHOP_PORT=8001
PRODUCTS_FILE=products/catalog.json

# Stablelink (W Connector never sees these — kept shop-side)
WCHECKOUT_API_KEY=...                          # from step 3.3
WCHECKOUT_API_SECRET=...
WCHECKOUT_SIGN_KEY=...
WCHECKOUT_SANDBOX=false                        # true during demo phase to hit dev Stablelink
```

Run:

```bash
npm install && npm run build && npm start
```

Or with Docker:

```bash
docker build -t my-shop . && docker run -p 8001:8001 --env-file .env my-shop
```

Smoke test:

```bash
curl https://yourshop.example.com/.well-known/agent.json | jq .name
# → "Your Shop Name"
```

### 3.5 Define your products and tool (10 min)

**Product catalog** (`products/your-catalog.json`):

```json
[
  {
    "id": 1001,
    "name": "AML Address Check",
    "description": "Single OFAC SDN + GoPlus risk profile screening",
    "price_usd": 0.3,
    "stock": 100000,
    "delivery": {
      "type": "mcp_call_token",
      "tool_name": "aml_check",
      "calls_per_unit": 1,
      "ttl_hours": 24
    }
  }
]
```

- **Per-call pricing** — current convention is one product = one tool call, priced in the **$0.1–$0.6** range. Bulk packs are no longer offered (kept billing simple and matches per-call economics).
- `delivery.type: mcp_call_token` is currently the only supported settlement method: the buyer receives a bearer token they POST against `/v1/tools/<tool_name>`.
- `calls_per_unit × quantity` = total allowed calls per order. With `calls_per_unit: 1` each token is good for one call.
- `ttl_hours` = how long the token stays valid.

**Tool implementation** (`shop-node/src/tools/aml-check.ts`):

```typescript
import { Tool } from './registry'

export const amlCheck: Tool = {
  name: 'aml_check',
  inputSchema: {
    type: 'object',
    properties: {
      address: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' }
    },
    required: ['address'],
    additionalProperties: false,
    examples: [{ address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' }]
  },
  async invoke(input) {
    const r = await fetch('https://your-existing-aml.com/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addr: input.address }),
    })
    if (!r.ok) throw new Error(`upstream ${r.status}`)
    const data = await r.json()
    return {
      address: input.address,
      risk_level: data.risk,
      sanctions_hit: data.ofac_match === true,
      sources: data.sources,
      checked_at: new Date().toISOString(),
    }
  }
}
```

Register it (`shop-node/src/tools/registry.ts`):

```typescript
import { amlCheck } from './aml-check'
registry.register(amlCheck)
```

Rebuild and restart. Verify the buyer side can see it:

```bash
curl https://yourshop.example.com/.well-known/agent.json | jq '.skills[] | {id, metadata}'
```

Your `aml_check` skill should be in the `skills[]` list with its `input_schema` in `metadata`.

### 3.6 End-to-end self-test (5 min)

```bash
cd /path/to/agentpaydemo/skill
python3 scripts/buy.py \
  --agent-url "https://yourshop.example.com" \
  --product-id 1001 \
  --quantity 1 \
  --token ETH_USDC \
  --call-body '{"address":"0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"}'
```

Happy path:

1. Skill sends `intent:purchase` → your `/tasks/send`
2. Your shop calls W Connector `/orders` + `/orders/:id/checkout`
3. W Connector → Stablelink → returns a real EVM deposit address
4. Skill pays on-chain (Sepolia free / mainnet real money)
5. Stablelink webhook → your `/notify`
6. You relay → W Connector `/orders/:id/stablelink-confirm`
7. W Connector flips order to PAID, pushes `tasks/statusUpdate` to your callback
8. Skill polls `intent:check_payment` → you return a `delivery` artifact with the token
9. Skill `POST /v1/tools/aml_check` with the Bearer token → you execute → result returns

Any failure prints a structured error in the skill terminal. The `Recovery:` hint points at `${GATEWAY_URL}/orders/<order_no>` for inspection.

## 4. Common pitfalls

| Symptom | Cause / Fix |
|---|---|
| `depositAddress: "-1"` | Stablelink hasn't enabled that chain × asset on the merchant settings side. Check the Stablelink dashboard. |
| `ip not matched: <ip>` | Add your shop-node egress IP to the Stablelink allowlist, or disable allowlist. |
| `wcheckout returned invalid deposit_address` + order FAILED | Same as above. |
| `Checkout failed: Bad Gateway` | wcheckout-agent / Stablelink path is unhealthy. Check shop and W Connector logs. |
| Buyer can't find you | `/merchants/search?q=...` returns nothing. Confirm admin approved you, and that `MERCHANT_TAGS` contains the keyword. |
| `task ... unknown intent` | Buyer reused a terminal task_id. Ask buyer to send a fresh `intent:purchase`. |
| Stablelink webhook not arriving at `/notify` | Verify the callback URL in Stablelink dashboard matches; ensure `/notify` is publicly reachable. |
| `wconnector push to merchant ... failed` | Your callback URL down or HMAC mismatch. Non-fatal — buyer pulls via `intent:check_payment` as fallback. |

## 5. Going to production

Switch URLs in `.env`:

```bash
GATEWAY_URL=https://connector.wcheckout.app
WCHECKOUT_SANDBOX=false
```

Then re-apply on the prod portal (`https://connector.wcheckout.app/apply.html`) to get production credentials — **dev and prod credentials are separate**.

Pre-prod checklist:

- [ ] `MERCHANT_AGENT_URL` is HTTPS and publicly reachable
- [ ] Stablelink callback URL in prod backend points to your prod shop
- [ ] Stablelink IP allowlist contains prod shop egress IP
- [ ] `WCHECKOUT_SANDBOX=false`
- [ ] Tool function has rate limiting and error handling
- [ ] `/notify` and `/.well-known/agent.json` survive a `curl` from outside your network
- [ ] PostgreSQL for shop-node order state (not the in-memory default)
- [ ] Sentry / observability wired into your tool function

## 6. Tier-2: Credential isolation

If you don't want the platform to hold your Stablelink credentials, you can run a standalone `wcheckout-agent` and register its URL with W Connector. W Connector then delegates Stablelink calls to your agent via A2A:

```
Buyer → Shop → W Connector ──A2A──► your wcheckout-agent ──► Stablelink
                                      (holds wcheckout creds)
                                      (W Connector never touches them)
```

Setup is a one-liner: when registering the merchant, additionally pass `wcheckout_agent_url=https://your-host/wcheckout` to W Connector. The reference shop-node already mounts `/wcheckout` when you set `WCHECKOUT_*` env vars, so the same shop image doubles as a Tier-2 wcheckout-agent.

## 7. Reference index

- **Reference shop implementation** → [`examples/minimal-shop/`](examples/minimal-shop/) in this repo
- **Architecture diagram** → [`ARCHITECTURE.md`](ARCHITECTURE.md)
- **All env vars** → [`ENV-REFERENCE.md`](ENV-REFERENCE.md)
- **Buyer-side skill** (so you can run the buyer half locally) → [`wagent-skill`](https://github.com/wspn-ai/wagent-skill)
