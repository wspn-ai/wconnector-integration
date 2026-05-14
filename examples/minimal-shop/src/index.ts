/**
 * minimal-shop — reference W Connector merchant entry point.
 *
 * Wires up the four pieces every merchant shop needs:
 *   1. bootstrap()   — fetch identity + signing keys from W Connector
 *   2. agent card    — published to /.well-known/agent.json so W Connector
 *                       and buyers can discover this shop's products + tools
 *   3. /tasks/send   — A2A endpoint buyers call; creates orders in W Connector
 *   4. /v1/tools/X   — actual tool runner, bearer-token gated
 *   5. /notify       — Stablelink payment webhook receiver
 *   6. /push         — W Connector status-update receiver (HMAC verified)
 *
 * For brevity this skeleton uses an in-memory call-token store. Production
 * shops should persist tokens to PostgreSQL — otherwise restarts invalidate
 * all outstanding bearer tokens (paying customers lose access).
 */
import 'dotenv/config'
import * as fs from 'fs'
import * as path from 'path'
import Fastify from 'fastify'
import { bootstrapShopConfig, ResolvedShopConfig } from './bootstrap'
import {
  verifyPush,
  PushVerificationError,
  PUSH_TIMESTAMP_HEADER,
  PUSH_SIGNATURE_HEADER,
} from './push-verify'
import { exampleTool, Tool } from './tools/example-tool'

// ── Tool registry ────────────────────────────────────────────────────
const tools: Map<string, Tool> = new Map([[exampleTool.name, exampleTool]])

// ── Product catalog (loaded from PRODUCTS_FILE) ──────────────────────
interface Product {
  id: number
  name: string
  description: string
  price_usd: number
  stock: number
  delivery: {
    type: 'mcp_call_token'
    tool_name: string
    calls_per_unit: number
    ttl_hours: number
  }
}
const PRODUCTS_FILE = process.env.PRODUCTS_FILE ?? 'products/catalog.json'
const PRODUCTS: Product[] = JSON.parse(fs.readFileSync(path.resolve(PRODUCTS_FILE), 'utf-8'))

// ── In-memory bearer tokens (use PG in production) ───────────────────
interface CallToken {
  token: string
  orderNo: string
  toolName: string
  callsRemaining: number
  expiresAt: number
}
const tokenStore = new Map<string, CallToken>()

function issueToken(orderNo: string, toolName: string, calls: number, ttlHours: number): CallToken {
  const token = 'sk_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  const t: CallToken = {
    token,
    orderNo,
    toolName,
    callsRemaining: calls,
    expiresAt: Date.now() + ttlHours * 3600_000,
  }
  tokenStore.set(token, t)
  return t
}

async function main(): Promise<void> {
  const cfg: ResolvedShopConfig = await bootstrapShopConfig()
  const app = Fastify({ logger: true })

  // raw-body capture for HMAC verification on /push
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    ;(req as { rawBody?: string }).rawBody = body as string
    try { done(null, JSON.parse(body as string)) } catch (err) { done(err as Error, undefined) }
  })

  // ── Health ─────────────────────────────────────────────────────────
  app.get('/health', async (_req, reply) => reply.send({ status: 'ok' }))

  // ── Agent card (A2A) ───────────────────────────────────────────────
  app.get('/.well-known/agent.json', async (_req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    return reply.send({
      name: cfg.name,
      description: cfg.description,
      url: cfg.selfUrl,
      version: '1.0.0',
      capabilities: { streaming: false, pushNotifications: true, stateTransitionHistory: false },
      catalog: {
        products: PRODUCTS.map(p => ({
          id: p.id,
          name: p.name,
          description: p.description,
          price_usd: p.price_usd,
          stock: p.stock,
          delivery: p.delivery,
        })),
      },
      skills: PRODUCTS.map(p => ({
        id: `buy_${p.id}`,
        name: p.name,
        description: p.description,
        tags: cfg.tags,
        examples: [`Buy 1 ${p.name}`],
        metadata: {
          tool_name: p.delivery.tool_name,
          price_usd_per_unit: p.price_usd,
          calls_per_unit: p.delivery.calls_per_unit,
          ttl_hours: p.delivery.ttl_hours,
          tool_endpoint: `${cfg.selfUrl}/v1/tools/${p.delivery.tool_name}`,
          input_schema: tools.get(p.delivery.tool_name)?.inputSchema,
        },
      })),
      defaultInputModes: ['text/plain', 'application/json'],
      defaultOutputModes: ['application/json'],
    })
  })

  // ── /tasks/send (A2A) — purchase intent ───────────────────────────
  //
  // Real implementation has check_payment, refund, status query intents too.
  // This skeleton handles only the "happy path" purchase + delivery.
  app.post<{ Body: { message: { parts: Array<{ type: string; data?: Record<string, unknown> }> } } }>(
    '/tasks/send',
    async (req, reply) => {
      const part = req.body?.message?.parts?.find(p => p.type === 'data')
      const intent = part?.data?.intent
      if (intent === 'purchase') {
        const { product_id, quantity = 1, token: payToken = 'ETH_USDC' } = (part?.data ?? {}) as {
          product_id?: number; quantity?: number; token?: string
        }
        const product = PRODUCTS.find(p => p.id === product_id)
        if (!product) return reply.status(404).send({ error: 'product not found' })

        // Create order in W Connector
        const amount = Math.round(product.price_usd * quantity * 100) / 100
        const orderRes = await fetch(`${cfg.gatewayUrl}/orders`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cfg.connectorApiKey}`,
          },
          body: JSON.stringify({ product_id, quantity, amount_usd: amount, token: payToken, customer_id: 'agent' }),
        })
        const order = await orderRes.json() as { order_no: string; deposit_address?: string }

        // Trigger checkout to get the deposit address
        const checkoutRes = await fetch(`${cfg.gatewayUrl}/orders/${order.order_no}/checkout`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${cfg.connectorApiKey}` },
        })
        const checkout = await checkoutRes.json() as { deposit_address?: string; paying_amount?: string }

        return reply.send({
          state: 'submitted',
          artifacts: [{
            name: 'order',
            parts: [{
              type: 'data',
              data: {
                order_no: order.order_no,
                deposit_address: checkout.deposit_address,
                paying_amount: checkout.paying_amount,
                token: payToken,
              },
            }],
          }],
        })
      }

      if (intent === 'check_payment') {
        const { order_no } = (part?.data ?? {}) as { order_no?: string }
        if (!order_no) return reply.status(400).send({ error: 'order_no required' })
        const oRes = await fetch(`${cfg.gatewayUrl}/orders/${order_no}`, {
          headers: { 'Authorization': `Bearer ${cfg.connectorApiKey}` },
        })
        const o = await oRes.json() as { status?: string; product_id?: number; quantity?: number }
        if (o.status !== 'PAID') return reply.send({ state: 'working', status: o.status })

        const product = PRODUCTS.find(p => p.id === o.product_id)
        if (!product) return reply.status(500).send({ error: 'product missing after PAID' })
        const t = issueToken(order_no, product.delivery.tool_name, product.delivery.calls_per_unit * (o.quantity ?? 1), product.delivery.ttl_hours)
        return reply.send({
          state: 'completed',
          artifacts: [{
            name: 'delivery',
            parts: [{
              type: 'data',
              data: {
                type: 'mcp_call_token',
                tool_name: t.toolName,
                token: t.token,
                calls_remaining: t.callsRemaining,
                expires_at: new Date(t.expiresAt).toISOString(),
                tool_endpoint: `${cfg.selfUrl}/v1/tools/${t.toolName}`,
              },
            }],
          }],
        })
      }

      return reply.status(400).send({ error: `unknown intent: ${intent}` })
    },
  )

  // ── /v1/tools/<name> — bearer-gated tool invocation ────────────────
  app.post<{ Params: { name: string }; Body: Record<string, unknown> }>(
    '/v1/tools/:name',
    async (req, reply) => {
      const auth = req.headers.authorization ?? ''
      if (!auth.startsWith('Bearer ')) return reply.status(401).send({ error: 'bearer required' })
      const token = auth.slice(7)
      const entry = tokenStore.get(token)
      if (!entry) return reply.status(403).send({ error: 'token unknown' })
      if (Date.now() > entry.expiresAt) return reply.status(403).send({ error: 'token expired' })
      if (entry.callsRemaining <= 0) return reply.status(403).send({ error: 'token exhausted' })
      if (entry.toolName !== req.params.name) return reply.status(403).send({ error: 'wrong tool for this token' })

      const tool = tools.get(req.params.name)
      if (!tool) return reply.status(404).send({ error: 'tool not registered' })

      try {
        const result = await tool.invoke(req.body)
        entry.callsRemaining -= 1
        return reply.send({ result, calls_remaining: entry.callsRemaining })
      } catch (err) {
        // Don't decrement on failure — buyer should be able to retry.
        return reply.status(500).send({ error: 'tool failed', message: err instanceof Error ? err.message : String(err) })
      }
    },
  )

  // ── /push — status updates from W Connector (HMAC) ─────────────────
  app.post<{ Body: Record<string, unknown> }>('/push', async (req, reply) => {
    const ts = (req.headers as Record<string, string | undefined>)[PUSH_TIMESTAMP_HEADER]
    const sig = (req.headers as Record<string, string | undefined>)[PUSH_SIGNATURE_HEADER]
    const raw = (req as { rawBody?: string }).rawBody ?? JSON.stringify(req.body)
    try {
      verifyPush(cfg.connectorApiKey, ts, raw, sig)
    } catch (err) {
      if (err instanceof PushVerificationError) {
        req.log.warn(`/push rejected: ${err.message}`)
        return reply.status(401).send({ error: 'invalid signature' })
      }
      throw err
    }
    // Real shop fulfills based on the push (mark delivered, etc.). Skeleton just acks.
    return reply.send({ ok: true })
  })

  // ── /notify — Stablelink webhook receiver ─────────────────────────
  //
  // Real implementation verifies the Stablelink signature using
  // WCHECKOUT_SIGN_KEY, then relays the PAID event to W Connector via
  // POST /orders/:orderNo/stablelink-confirm with the Bearer.
  // Skeleton omits Stablelink signature verification for brevity.
  app.post<{ Body: Record<string, unknown> }>('/notify', async (req, reply) => {
    const evt = req.body as { orderNo?: string; status?: string }
    if (!evt.orderNo || evt.status !== 'PAID') return reply.send({ ok: true, skipped: true })
    const relay = await fetch(`${cfg.gatewayUrl}/orders/${evt.orderNo}/stablelink-confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.connectorApiKey}`,
      },
      body: JSON.stringify({ stablelink_event: evt }),
    })
    return reply.send({ ok: relay.ok })
  })

  await app.listen({ port: cfg.port, host: '0.0.0.0' })
  // eslint-disable-next-line no-console
  console.log(`[minimal-shop] listening on http://0.0.0.0:${cfg.port}`)
  // eslint-disable-next-line no-console
  console.log(`[minimal-shop] agent card → ${cfg.selfUrl}/.well-known/agent.json`)
  // eslint-disable-next-line no-console
  console.log(`[minimal-shop] catalog: ${PRODUCTS.length} product(s)`)
  if (cfg.gatewayReachable) {
    // eslint-disable-next-line no-console
    console.log(`[minimal-shop] bootstrap ok — identity hydrated from ${cfg.gatewayUrl}/merchants/me`)
  } else {
    // eslint-disable-next-line no-console
    console.warn(`[minimal-shop] bootstrap warning — /merchants/me unreachable, using defaults / cache`)
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[minimal-shop] fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
