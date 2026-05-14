# minimal-shop — reference W Connector merchant

A ~250-line TypeScript implementation of a W Connector merchant shop. Clone, fill `.env`, run `npm install && npm run dev`, you're a discoverable merchant.

This is **a deliberately minimal teaching example**. For the production reference with full A2A protocol, refund handling, audit logging, etc., see `shop-node/` in the main W Connector repo.

## What it does

- Mounts `/.well-known/agent.json` — A2A agent card published to W Connector's registry
- Mounts `/tasks/send` — accepts buyer purchase intents, creates orders in W Connector via Bearer auth
- Mounts `/notify` — receives Stablelink payment webhooks, relays "PAID" to W Connector
- Mounts `/push` — receives status updates from W Connector (HMAC-verified)
- Mounts `/v1/tools/<tool_name>` — runs the actual tool function for buyers holding a valid bearer token
- Bootstraps identity from `GET /merchants/me` (no `MERCHANT_NAME`/`AGENT_URL` env vars needed)

## File map

```
minimal-shop/
├── README.md            ← you're here
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── index.ts         ← entry point, route wiring
│   ├── bootstrap.ts     ← /merchants/me fetch + disk cache
│   ├── push-verify.ts   ← HMAC signature check for W Connector → shop pushes
│   └── tools/
│       └── example-tool.ts   ← implements the actual tool function
└── products/
    └── catalog.json     ← which SKUs this shop sells
```

## Setup

```bash
git clone https://github.com/wspn-ai/wconnector-integration.git
cd wconnector-integration/examples/minimal-shop
cp .env.example .env
# Fill in CONNECTOR_API_KEY, GATEWAY_URL, WCHECKOUT_*
npm install
npm run dev
```

`GATEWAY_URL` should be:
- **`https://connector-dev.wcheckout.app`** for testing
- **`https://connector.wcheckout.app`** for production

Stablelink (`WCHECKOUT_*` values) — sign up at <https://stablelink.app> and follow the integration docs at <https://developer.wcheckout.app/7441280m0>.

Once running, run a smoke test from outside:

```bash
curl http://localhost:8001/.well-known/agent.json | jq .name
curl http://localhost:8001/health
```

If you've also tunneled `localhost:8001` to a public HTTPS URL (ngrok, Cloudflare Tunnel), W Connector should find you via `/merchants/search` within a minute.

## Customizing

1. **Edit `products/catalog.json`** — add your SKUs (id, name, price_usd, tool_name).
2. **Edit `src/tools/example-tool.ts`** — replace with your actual API call. Keep the input/output shape consistent with what your `catalog.json` advertises.
3. **Restart** — `npm run dev` picks up changes.

That's it. No protocol code to write — A2A, payment relay, and HMAC verification are all in this skeleton.

## Going to production

See the parent repo's [INTEGRATION.md §5](../../INTEGRATION.md#5-going-to-production) pre-prod checklist.
