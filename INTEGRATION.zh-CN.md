# W Connector 接入手册

> **English → [INTEGRATION.md](INTEGRATION.md)**
>
> W Connector 自助商户接入 —— 申请、取凭证、部署参考 shop、定义商品、收第一笔款。端到端 ~30 分钟。

---

## 1. W Connector 一句话介绍

W Connector 让任何 HTTPS 服务把 API/MCP 工具暴露给 AI agent,由 agent 用稳定币付费调用。你挂一个商品,buyer agent 发现它,用 USDC/USDT/WUSD 在以太坊/Base/Tron/Solana 上付款,拿到 bearer token 调你的工具。结算资金直接进你的 Stablelink 商户账户。**平台不持币,也不替你做 KYT。**

```
Buyer Agent ──► shop-node ──► W Connector ──► Stablelink ──► 你的商户余额
                  (你)         (我们)                   (支付)            (你的钱)
```

你部署的是 **shop-node**(我们提供的 Node.js 参考实现)。它对外暴露:

- `/.well-known/agent.json` —— A2A agent card(商品目录 + 工具 schema)
- `/tasks/send` —— buyer 调用入口
- `/v1/tools/<tool_name>` —— 你的真正工具(bearer token 鉴权)
- `/notify` —— Stablelink webhook 入口

你不需要自己实现 A2A 协议或订单状态机 —— shop-node 已经做了。**你唯一要写的是工具函数本身。**

## 2. 接入前准备

| 项 | 说明 |
|---|---|
| HTTPS 公网地址 | 作为 `agent_url`,不接受自签证书 |
| 联系邮箱 | 平台审核反馈用 |
| Stablelink 商户账号 | <https://stablelink.app> 自助注册,**可与申请平台并行做** |
| Docker / Node 20+ | 跑 shop-node |
| PostgreSQL(可选)| shop-node 默认 in-memory,正式部署建议 PG |

## 3. 一步步接入(30 分钟)

### 3.1 申请加入平台(5 分钟)

打开 `https://connector-dev.wcheckout.app/apply.html`,填 6 个字段:

| 字段 | 写什么 |
|---|---|
| `name` | 公司 / 项目名(≤80 字符) |
| `email` | 联系邮箱 |
| `agent_url` | 你的 shop A2A endpoint,必须 `https://`(暂时填占位也行,后面可改) |
| `description` | 一句话介绍(≤200 字符) |
| `product_summary` | 卖什么、解决什么(≤500 字符) |
| `callback_url` | Stablelink webhook 推到你的 URL,例如 `https://yourshop.example.com/notify` |

可选:`website` / `contact_x`(你的 X handle)。

提交后会拿到一个 **status URL**(带一次性 token)。**收藏好** —— 后面看审核进度 + 取凭证全靠它。

**限速:** 每 IP 24 小时只能提 3 次申请。

### 3.2 等审核 + 取凭证(1–2 天 → 5 分钟)

审核通过后,你的 status URL 会出现 **"View credentials"** 按钮。点开有 **5 分钟** 内必须复制走的三个秘密:

```
merchant_id              = MCH_XXXXXXXXXXXX
api_key                  = sk_xxxxxxxxxxxxxxxx
gateway_to_merchant_key  = gtm_xxxxxxxxxxxxxxxx
```

- `api_key` —— 你的 shop-node 调 W Connector 用的 Bearer,环境变量名是 `CONNECTOR_API_KEY`
- `gateway_to_merchant_key` —— gateway 推 `tasks/statusUpdate` 给你时,HMAC 签名校验用

**这个页面只显示一次**,关掉就再也看不到了。立即存到 1Password / 你的 secret manager。

### 3.3 注册 Stablelink(5 分钟,可与 3.1/3.2 并行)

去 <https://stablelink.app> 自助注册商户账号。**官方集成文档:** <https://developer.wcheckout.app/7441280m0>。

后台拿到三个凭证:

| 字段 | 用途 |
|---|---|
| `WCHECKOUT_API_KEY` | OAuth client_id |
| `WCHECKOUT_API_SECRET` | OAuth client_secret |
| `WCHECKOUT_SIGN_KEY` | HMAC-SHA512 webhook 签名密钥(**和 API_SECRET 不是同一个**) |

另外还要在 Stablelink 后台做两件事:

1. **填 callback URL** —— 跟 3.1 填的一致(例如 `https://yourshop.example.com/notify`)。
2. **填 IP 白名单** —— 写你 shop-node 的出口 IP。错了就返回 `ip not matched`。

### 3.4 部署 shop-node(10 分钟)

最快路径:克隆参考实现。

```bash
git clone https://github.com/wspn-ai/wconnector-integration.git
cd wconnector-integration/examples/minimal-shop
cp .env.example .env
```

编辑 `.env`:

```bash
# 身份
CONNECTOR_API_KEY=sk_xxxxxxxxxxxxxxxx         # 步骤 3.2 给的
GATEWAY_URL=https://connector-dev.wcheckout.app

# 运行时
SHOP_PORT=8001
PRODUCTS_FILE=products/catalog.json

# Stablelink(W Connector 不持有,留在 shop 侧)
WCHECKOUT_API_KEY=...                          # 步骤 3.3 给的
WCHECKOUT_API_SECRET=...
WCHECKOUT_SIGN_KEY=...
WCHECKOUT_SANDBOX=false                        # demo 阶段填 true 用 dev API
```

启动:

```bash
npm install && npm run build && npm start
```

或 Docker:

```bash
docker build -t my-shop . && docker run -p 8001:8001 --env-file .env my-shop
```

冒烟测试:

```bash
curl https://yourshop.example.com/.well-known/agent.json | jq .name
# → "Your Shop Name"
```

### 3.5 定义商品 + 实现工具(10 分钟)

**商品目录**(`products/your-catalog.json`):

```json
[
  {
    "id": 1001,
    "name": "AML Address Check",
    "description": "单次 OFAC SDN + GoPlus 风险画像筛查",
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

- **按次定价** —— 目前的约定:一个商品 = 一次工具调用,价格落在 **$0.1–$0.6** 区间。不再卖打包(计费简单,跟每次调用的经济模型对齐)。
- `delivery.type: mcp_call_token` —— 目前唯一支持的兑现方式:发 bearer token,buyer 拿去 POST `/v1/tools/<tool_name>` 调用
- `calls_per_unit × quantity` = 这笔订单一共能调多少次。`calls_per_unit: 1` 意味着一个 token 只能调一次。
- `ttl_hours` —— token 有效期

**工具实现**(`shop-node/src/tools/aml-check.ts`):

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
    // 调你已有的 service
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

注册一行(`shop-node/src/tools/registry.ts`):

```typescript
import { amlCheck } from './aml-check'
registry.register(amlCheck)
```

重新 build + 重启。验证 buyer 端能看到:

```bash
curl https://yourshop.example.com/.well-known/agent.json | jq '.skills[] | {id, metadata}'
```

`aml_check` 应出现在 `skills[]` 里,metadata 包含 `input_schema`。

### 3.6 端到端自测(5 分钟)

用 demo buyer skill 跑一笔:

```bash
cd /path/to/agentpaydemo/skill
python3 scripts/buy.py \
  --agent-url "https://yourshop.example.com" \
  --product-id 1001 \
  --quantity 1 \
  --token ETH_USDC \
  --call-body '{"address":"0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"}'
```

成功路径:

1. skill 发 `intent:purchase` 给你的 `/tasks/send`
2. 你的 shop 调 W Connector `/orders` + `/orders/:id/checkout`
3. W Connector → Stablelink → 返回真实 EVM 收款地址
4. skill 链上转账(Sepolia 免费 / 主网真钱)
5. Stablelink webhook → 你的 `/notify`
6. 你转发 → W Connector `/orders/:id/stablelink-confirm`
7. W Connector 翻 PAID,推 `tasks/statusUpdate` 给你的 callback
8. skill `intent:check_payment` → 你发 `delivery` artifact + token
9. skill `POST /v1/tools/aml_check` + Bearer token → 你跑工具 → 返回结果

任何一步出错都会在 skill 终端打印结构化错误。`Recovery:` 提示会指向 `${GATEWAY_URL}/orders/<order_no>`,在那里看订单状态。

## 4. 常见踩坑

| 现象 | 原因 / 解决 |
|---|---|
| `depositAddress: "-1"` | Stablelink 商户后台没启用对应链 × 资产。回 Stablelink 后台开通。 |
| `ip not matched: <ip>` | Stablelink 后台 IP 白名单缺这个 IP。把出口 IP 加白名单或关闭白名单。 |
| `wcheckout returned invalid deposit_address` + 订单 FAILED | 同上。 |
| `Checkout failed: Bad Gateway` | wcheckout-agent / Stablelink 链路异常。看 shop 和 W Connector 日志。 |
| Buyer 找不到你 | `/merchants/search?q=` 没返回你 → 检查 admin 是否真的 approve 了;`MERCHANT_TAGS` 写了关键词没。 |
| `task ... unknown intent` | buyer 用了过期(terminal)的 task_id;让 buyer 重新发 `intent:purchase`。 |
| Stablelink webhook 没到 `/notify` | 检查 callback URL 在 Stablelink 后台填对没;`/notify` 公网可达没。 |
| `wconnector push to merchant ... failed` | 你的 callback URL 没接 / HMAC 验证错。**不致命**,buyer 通过 `intent:check_payment` 拉取兜底。 |

## 5. 上生产

切 URL:

```bash
GATEWAY_URL=https://connector.wcheckout.app
WCHECKOUT_SANDBOX=false
```

然后在生产入口(`https://connector.wcheckout.app/apply.html`)重新申请,拿到生产凭证 —— **dev 和 prod 凭证是分开的**。

上线 checklist:

- [ ] `MERCHANT_AGENT_URL` 是 HTTPS 且公网可达
- [ ] Stablelink 后台的 callback URL 指向生产 shop
- [ ] Stablelink IP 白名单加了生产 shop 出口 IP
- [ ] `WCHECKOUT_SANDBOX=false`
- [ ] 工具函数加了 rate limit 和错误处理
- [ ] `/notify` 和 `/.well-known/agent.json` 用外网 `curl` 能打通
- [ ] shop-node 用 PostgreSQL 持久化订单状态(不要用默认 in-memory)
- [ ] Sentry / 可观测性接入工具函数

## 6. Tier-2:凭证隔离

如果你对合规敏感,不想让平台持有你的 Stablelink 凭证,可以跑独立的 `wcheckout-agent`,在 W Connector 注册它的 URL。W Connector 通过 A2A 把 Stablelink 调用委派给你的 agent:

```
Buyer → Shop → W Connector ──A2A──► 你的 wcheckout-agent ──► Stablelink
                                      (持 wcheckout 凭证)
                                      (W Connector 从来碰不到)
```

具体做法:在 W Connector 注册 merchant 时,额外传 `wcheckout_agent_url=https://your-host/wcheckout`。参考 shop-node 当你设置 `WCHECKOUT_*` env 时,默认就挂了 `/wcheckout`,同一个 shop 镜像直接当 Tier-2 wcheckout-agent 用。

## 7. 文档索引

- **参考 shop 实现** → 本仓库 [`examples/minimal-shop/`](examples/minimal-shop/)
- **架构图** → [`ARCHITECTURE.md`](ARCHITECTURE.md)
- **所有 env 速查** → [`ENV-REFERENCE.md`](ENV-REFERENCE.md)
- **Buyer 端 skill**(想本地跑通买方流程) → [`wagent-skill`](https://github.com/wspn-ai/wagent-skill)

---

