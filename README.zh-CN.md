# W Connector —— 商家接入

> **English → [README.md](README.md)**

把你的 API / MCP 工具卖给 AI agent 的接入工具包。自助接入,稳定币(以太坊 / Base / Tron / Solana)结算,平台不持币。

```
buyer agent ──► 你的 shop ──► W Connector ──► Stablelink ──► 你的商户余额
                  (你)              (我们)            (支付)            (你的钱)
```

你得到的:

- **自助申请** —— `/apply.html`,不用销售跟单、不用合同来回签
- **稳定币结算** —— buyer 用 USDC/USDT/WUSD 付,钱进你的 Stablelink 商户账户
- **极简接入** —— 你的 shop 只要 6 个 env,其他(name / tags / agent_url / 签名密钥)启动时从 `GET /merchants/me` 拉
- **平台不持币** —— W Connector 不持有你的钱,也不替你做 KYT
- **Tier-2 凭证隔离**(可选) —— 跑独立的 wcheckout-agent,Stablelink 凭证不出你的进程

## 环境

| | URL |
|---|---|
| **Dev / sandbox** | `https://connector-dev.wcheckout.app` |
| **生产** | `https://connector.wcheckout.app` |

dev 和 prod 凭证完全分开 —— 在 dev 申请通过**不会**自动有 prod 权限。

## 快速开始

```bash
# 1. 申请(dev)
open https://connector-dev.wcheckout.app/apply.html
# (生产同样流程,改成 https://connector.wcheckout.app/apply.html)

# 2. admin 审核通过(1-2 天)后,复制一次性凭证:
#    merchant_id、api_key、gateway_to_merchant_key

# 3. 在 Stablelink(W Connector 走的支付通道)注册商户账号
#    https://stablelink.app —— 单独账号,可与步骤 1 并行
#    集成文档: https://developer.wcheckout.app/7441280m0

# 4. 部署参考 shop
git clone https://github.com/wspn-ai/wconnector-integration.git
cd wconnector-integration/examples/minimal-shop
cp .env.example .env    # 填 CONNECTOR_API_KEY + WCHECKOUT_*

npm install && npm run dev
```

你已经是可被发现的商户了。装了 [wagent-skill](https://github.com/wspn-ai/wagent-skill) 的 AI agent 通过 `/merchants/search` 找到你,买你的工具,调它。

完整步骤 → **[INTEGRATION.zh-CN.md](INTEGRATION.zh-CN.md)** / **[INTEGRATION.md](INTEGRATION.md)**(EN)。

## 仓库里有什么

| 路径 | 内容 |
|---|---|
| **[INTEGRATION.zh-CN.md](INTEGRATION.zh-CN.md)** / [EN](INTEGRATION.md) | 完整接入手册 —— 申请、部署、定义商品、测试 |
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | 架构图、A2A 协议总览、时序图 |
| **[ENV-REFERENCE.md](ENV-REFERENCE.md)** | 每个 shop env 变量的说明 + 安全默认值 |
| **[examples/minimal-shop/](examples/minimal-shop/)** | 一份 ~150 行的 TypeScript shop,克隆改一改就能上 |

## 你需要自己准备的

| 项 | 谁提供 | 备注 |
|---|---|---|
| 一个 HTTPS 公网 URL | 你 | 作为 `agent_url`,不接受自签证书 |
| Stablelink 商户账号 | 你 | <https://stablelink.app> 注册,跟 W Connector 是两个东西 |
| 你的工具实现 | 你 | TypeScript 函数,看 `examples/minimal-shop/src/tools/` |
| `CONNECTOR_API_KEY` | W Connector | 审核通过时给 |
| `gateway_to_merchant_key` | W Connector | 同上 |

## 定价约定

当前网络约定:**一个商品 = 一次工具调用**,价格 **$0.10–$0.60 USD**。你在这个范围内(或外面)自己定。

打包折扣(`calls_per_unit > 1`)协议上支持,但目前参考 shop 都不用 —— 保持简单。

## 结算

Buyer 用稳定币付款 → Stablelink 监听到链上转账 → 触发 webhook 到你 shop 的 `/notify` → 你的 shop 把 "PAID" 中继给 W Connector → W Connector 把订单标 PAID,把买家需要的 bearer token 发给买家用来调你的工具。

钱累积在你的 Stablelink 商户余额里。Off-ramp 走 Stablelink 标准提现流程(平台外)。**W Connector 不抽商品交易抽成。**

## 上生产

预上线 checklist(完整版在 [INTEGRATION.zh-CN.md §5](INTEGRATION.zh-CN.md#5-上生产)):

- [ ] 在生产入口(`https://connector.wcheckout.app/apply.html`)重新申请 —— dev / prod 凭证分开
- [ ] `WCHECKOUT_SANDBOX=false`
- [ ] Stablelink 后台 callback URL 指向生产 shop
- [ ] Stablelink IP 白名单加了生产 shop 出口 IP
- [ ] shop-node 用 PostgreSQL(不用默认 in-memory)
- [ ] 工具函数接 Sentry / 可观测性

## 协议

MIT —— 见 [LICENSE](LICENSE)。

## 相关仓库

- **[wagent-skill](https://github.com/wspn-ai/wagent-skill)** —— buyer 端的 skill(你想本地端到端跑通买方流程的话装这个)
