/**
 * Slim shop bootstrap — fetches the merchant profile from W Connector at boot
 * so the shop only needs CONNECTOR_API_KEY + GATEWAY_URL + Stablelink creds
 * in its env, instead of duplicating name/description/tags/agent_url/
 * gateway_to_merchant_key.
 *
 * Resolution order per field:
 *   1. env var (always wins — useful for dev override / forced staging values)
 *   2. fresh GET /merchants/me response
 *   3. cached profile from disk (when W Connector is briefly unreachable)
 *   4. baked-in default (legacy behavior; only for non-identity fields)
 *
 * If W Connector is reachable, we ALWAYS refresh the cache. The cache only
 * comes into play on cold-start when W Connector is down.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface ShopProfile {
  merchant_id: string
  name: string
  description: string
  tags: string[]
  agent_url: string
  callback_url: string
  gateway_to_merchant_key: string
  wcheckout_agent_url: string | null
  has_wcheckout_creds: boolean
  kind: 'merchant' | 'payment-provider'
  created_at: number
}

export type FieldSource = 'env' | 'gateway' | 'cache' | 'default'

export interface ResolvedShopConfig {
  // Always env (or defaulted) — runtime knobs
  port: number
  gatewayUrl: string
  connectorApiKey: string
  // From bootstrap (or env override) — identity
  merchantId: string | null
  name: string
  description: string
  tags: string[]
  selfUrl: string
  gatewayToMerchantKey: string | null
  wcheckoutAgentUrl: string | null
  // Stablelink — env only, never from W Connector (W Connector never sees these)
  wcheckoutApiKey: string | undefined
  wcheckoutApiSecret: string | undefined
  wcheckoutSignKey: string | undefined
  wcheckoutSandbox: boolean
  // For boot banner — which source each field came from
  sources: Record<string, FieldSource>
  // True if /merchants/me responded with 200 this boot
  gatewayReachable: boolean
}

const DEFAULT_CACHE_PATH = path.join(os.homedir(), '.wshop', 'merchant-profile.json')

function cachePath(): string {
  return process.env.SHOP_CACHE_PATH || DEFAULT_CACHE_PATH
}

export function readCachedProfile(): ShopProfile | null {
  try {
    const raw = fs.readFileSync(cachePath(), 'utf-8')
    const parsed = JSON.parse(raw) as ShopProfile
    if (!parsed || typeof parsed !== 'object') return null
    if (!parsed.merchant_id || !parsed.name) return null
    return parsed
  } catch {
    return null
  }
}

export function writeCachedProfile(p: ShopProfile): void {
  try {
    const dir = path.dirname(cachePath())
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(cachePath(), JSON.stringify(p, null, 2))
  } catch {
    // Cache is best-effort; don't crash boot if home dir is read-only.
  }
}

async function fetchProfile(
  gatewayUrl: string,
  apiKey: string,
  timeoutMs: number,
): Promise<ShopProfile | null | 'auth-failed' | 'suspended'> {
  const url = `${gatewayUrl.replace(/\/$/, '')}/merchants/me`
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: ac.signal,
    })
    if (res.status === 401 || res.status === 403) {
      const body = await res.json().catch(() => ({}))
      if ((body as { error?: string })?.error === 'merchant_suspended') return 'suspended'
      return 'auth-failed'
    }
    if (!res.ok) return null
    return (await res.json()) as ShopProfile
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

interface BootstrapInput {
  /** Override default fetch timeout (ms). Used in tests. */
  fetchTimeoutMs?: number
  /** Inject a custom fetch implementation. Used in tests. */
  fetchImpl?: (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) =>
    Promise<{ status: number; ok: boolean; json: () => Promise<unknown> }>
}

export async function bootstrapShopConfig(input: BootstrapInput = {}): Promise<ResolvedShopConfig> {
  const env = process.env
  const sources: Record<string, FieldSource> = {}

  // Runtime knobs — always env
  const port = parseInt(env.SHOP_PORT ?? '8001', 10)
  const gatewayUrl = env.GATEWAY_URL ?? 'http://localhost:8000'
  const connectorApiKey = env.CONNECTOR_API_KEY ?? ''

  // Bootstrap: try W Connector first (if creds present), fall back to cache.
  let profile: ShopProfile | null = null
  let gatewayReachable = false
  if (connectorApiKey && gatewayUrl) {
    const result = await fetchProfile(gatewayUrl, connectorApiKey, input.fetchTimeoutMs ?? 5000)
    if (result === 'auth-failed') {
      throw new Error(
        '[Shop] /merchants/me returned 401/403 — CONNECTOR_API_KEY does not match any merchant.\n' +
        '       Double-check the key was copied correctly from the credentials view.'
      )
    } else if (result === 'suspended') {
      throw new Error(
        '[Shop] Refusing to boot — merchant is suspended on the W Connector side.\n' +
        '       Contact the W Connector admin to unsuspend.'
      )
    } else if (result) {
      profile = result
      gatewayReachable = true
      writeCachedProfile(result)
    } else {
      // Transient (timeout, 5xx, network): fall back to cache
      profile = readCachedProfile()
    }
  }

  // Resolve each identity field: env > W Connector/cache > default
  const fieldFromGateway = gatewayReachable ? 'gateway' : (profile ? 'cache' : 'default')

  const name = env.MERCHANT_NAME ??
    (profile?.name ?? 'WSPN Shop Agent')
  sources.name = env.MERCHANT_NAME ? 'env' : (profile ? fieldFromGateway : 'default')

  const description = env.MERCHANT_DESCRIPTION ??
    (profile?.description ?? 'Purchase WSPN merchandise with stablecoins')
  sources.description = env.MERCHANT_DESCRIPTION ? 'env' : (profile ? fieldFromGateway : 'default')

  const tagsRaw = env.MERCHANT_TAGS
  const tags = tagsRaw
    ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean)
    : (profile?.tags ?? ['crypto', 'stablecoin', 'wspn', 'hardware', 'sticker'])
  sources.tags = tagsRaw ? 'env' : (profile ? fieldFromGateway : 'default')

  const selfUrl = env.MERCHANT_AGENT_URL ??
    (profile?.agent_url ?? `http://localhost:${port}`)
  sources.selfUrl = env.MERCHANT_AGENT_URL ? 'env' : (profile ? fieldFromGateway : 'default')

  const gatewayToMerchantKey = env.GATEWAY_TO_MERCHANT_KEY ??
    profile?.gateway_to_merchant_key ?? null
  sources.gatewayToMerchantKey = env.GATEWAY_TO_MERCHANT_KEY
    ? 'env'
    : (profile?.gateway_to_merchant_key ? fieldFromGateway : 'default')

  const wcheckoutAgentUrl = profile?.wcheckout_agent_url ?? null

  // Stablelink — env only, never from W Connector
  const wcheckoutApiKey = env.WCHECKOUT_API_KEY
  const wcheckoutApiSecret = env.WCHECKOUT_API_SECRET
  const wcheckoutSignKey = env.WCHECKOUT_SIGN_KEY
  const wcheckoutSandbox = (env.WCHECKOUT_SANDBOX ?? 'true') === 'true'

  return {
    port,
    gatewayUrl,
    connectorApiKey,
    merchantId: profile?.merchant_id ?? null,
    name,
    description,
    tags,
    selfUrl,
    gatewayToMerchantKey,
    wcheckoutAgentUrl,
    wcheckoutApiKey,
    wcheckoutApiSecret,
    wcheckoutSignKey,
    wcheckoutSandbox,
    sources,
    gatewayReachable,
  }
}
