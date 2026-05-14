# Env reference — shop side

Every environment variable a W Connector merchant shop reads. Bilingual (EN top, CN bottom).

> **Stablelink integration docs (official):** <https://developer.wcheckout.app/7441280m0>

## Environments

| | URL |
|---|---|
| W Connector dev / sandbox | `https://connector-dev.wcheckout.app` |
| W Connector production | `https://connector.wcheckout.app` |

## Required

| Variable | Description | Source |
|---|---|---|
| `CONNECTOR_API_KEY` | Bearer credential. Identifies your shop to W Connector AND is used (as HMAC key) to verify pushes from W Connector. **Treat as a secret.** | W Connector application approval (one-time page) |
| `GATEWAY_URL` | W Connector URL. Dev: `https://connector-dev.wcheckout.app`. Prod: `https://connector.wcheckout.app`. | Hardcoded per environment |
| `WCHECKOUT_API_KEY` | Stablelink OAuth `client_id`. | Stablelink dashboard |
| `WCHECKOUT_API_SECRET` | Stablelink OAuth `client_secret`. **Different from sign key.** | Stablelink dashboard |
| `WCHECKOUT_SIGN_KEY` | Stablelink HMAC-SHA512 webhook signing key. **Different from api_secret.** | Stablelink dashboard |

## Strongly recommended

| Variable | Default | Description |
|---|---|---|
| `WCHECKOUT_SANDBOX` | `true` | `true` → Stablelink dev API; `false` → prod. **Must be `false` in production**. |
| `SHOP_PORT` | `8001` | Local TCP port shop-node listens on. |
| `PRODUCTS_FILE` | `products/all.json` | Path to your product catalog JSON. |

## Optional (everything below this line is auto-fetched from `/merchants/me` at boot — set in env only to force-override)

| Variable | Description |
|---|---|
| `MERCHANT_NAME` | Display name in the merchant directory. Defaults to the value you applied with. |
| `MERCHANT_DESCRIPTION` | One-line tagline. |
| `MERCHANT_TAGS` | Comma-separated keywords. Used by `/merchants/search?q=...`. |
| `MERCHANT_AGENT_URL` | Your public HTTPS URL. **Must be reachable from the public internet** (otherwise buyers' purchases will fail). |
| `GATEWAY_TO_MERCHANT_KEY` | Only meaningful if you opt into Tier-2 wcheckout-agent isolation. Pulled from `/merchants/me` by default. |

## First-time bootstrap (one-shot)

| Variable | Description |
|---|---|
| `ADMIN_API_KEY` | If set, shop-node will call `POST /merchants/register` once at startup using this bearer, then print the resulting `CONNECTOR_API_KEY` for you to copy into `.env`. Production deployments should **never** set this. |

## Resilience / cache

| Variable | Default | Description |
|---|---|---|
| `SHOP_CACHE_PATH` | `~/.wshop/merchant-profile.json` | Where the fetched-from-W-Connector profile is cached. Used as fallback when `/merchants/me` is briefly unreachable on next boot. |

## Example `.env`

```bash
# Identity
CONNECTOR_API_KEY=sk_xxxxxxxxxxxxxxxx
GATEWAY_URL=https://connector-dev.wcheckout.app

# Runtime
SHOP_PORT=8001
PRODUCTS_FILE=products/all.json

# Stablelink
WCHECKOUT_API_KEY=...
WCHECKOUT_API_SECRET=...
WCHECKOUT_SIGN_KEY=...
WCHECKOUT_SANDBOX=false
```

Six lines. That's it. The rest hydrates from `/merchants/me`.

---

# 中文

## 必填

| 变量 | 说明 | 来源 |
|---|---|---|
| `CONNECTOR_API_KEY` | Bearer 凭证。shop 调 W Connector 用,也是 W Connector push 给你时的 HMAC 密钥。**当成 secret 管。** | 申请审核通过的一次性页面 |
| `GATEWAY_URL` | W Connector 地址。dev:`https://connector-dev.wcheckout.app`。prod:`https://connector.wcheckout.app`。 | 每个环境硬编码 |
| `WCHECKOUT_API_KEY` | Stablelink OAuth `client_id`。 | Stablelink 后台 |
| `WCHECKOUT_API_SECRET` | Stablelink OAuth `client_secret`。**和 sign key 不是同一个**。 | Stablelink 后台 |
| `WCHECKOUT_SIGN_KEY` | Stablelink HMAC-SHA512 webhook 签名密钥。**和 api_secret 不是同一个**。 | Stablelink 后台 |

## 强烈建议

| 变量 | 默认 | 说明 |
|---|---|---|
| `WCHECKOUT_SANDBOX` | `true` | `true` → dev Stablelink API,`false` → prod。**生产必须 `false`**。 |
| `SHOP_PORT` | `8001` | shop-node 本地监听端口 |
| `PRODUCTS_FILE` | `products/all.json` | 商品目录 JSON 路径 |

## 可选(下面这些都会在启动时从 `/merchants/me` 自动拉,只有在 env 里显式 set 才会强制覆盖)

| 变量 | 说明 |
|---|---|
| `MERCHANT_NAME` | 商户目录里显示的名字。默认用你申请时填的 |
| `MERCHANT_DESCRIPTION` | 一句话简介 |
| `MERCHANT_TAGS` | 逗号分隔的标签。`/merchants/search?q=...` 用 |
| `MERCHANT_AGENT_URL` | 你的公网 HTTPS URL。**必须公网可达**(不然 buyer 付款全失败) |
| `GATEWAY_TO_MERCHANT_KEY` | 只在你启用 Tier-2 wcheckout-agent 凭证隔离时有意义。默认从 `/merchants/me` 拉 |

## 首次启动(一次性)

| 变量 | 说明 |
|---|---|
| `ADMIN_API_KEY` | 如果填了,shop-node 启动时会用这个 bearer 调 `POST /merchants/register` 一次,然后把返回的 `CONNECTOR_API_KEY` 打到日志让你复制到 `.env`。生产部署**绝不能**填 |

## 容灾 / 缓存

| 变量 | 默认 | 说明 |
|---|---|---|
| `SHOP_CACHE_PATH` | `~/.wshop/merchant-profile.json` | 从 W Connector 拉的 profile 缓存在哪。下次启动时 `/merchants/me` 暂时不通就用这个兜底 |

## `.env` 示例

```bash
# 身份
CONNECTOR_API_KEY=sk_xxxxxxxxxxxxxxxx
GATEWAY_URL=https://connector-dev.wcheckout.app

# 运行时
SHOP_PORT=8001
PRODUCTS_FILE=products/all.json

# Stablelink
WCHECKOUT_API_KEY=...
WCHECKOUT_API_SECRET=...
WCHECKOUT_SIGN_KEY=...
WCHECKOUT_SANDBOX=false
```

6 行,完事。其他都从 `/merchants/me` 拉。
