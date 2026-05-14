# Architecture

How the four parties — buyer agent, your shop, W Connector, Stablelink — fit together. Bilingual (EN top, CN bottom).

## High-level diagram

```
┌─────────────────┐        ┌─────────────────────┐        ┌─────────────────────┐
│  Buyer agent    │        │  Your shop          │        │  W Connector        │
│  (wagent skill) │ A2A  ▶│  (shop-node)        │ HTTP ▶ │                     │
│                 │        │                     │        │  (us)               │
└────────┬────────┘        └─────────┬───────────┘        └──────────┬──────────┘
         │                            │                                │
         │ EVM tx                     │ webhook (PAID)                 │
         │ to deposit address         │                                │
         ▼                            ▼                                ▼
   ┌──────────────┐         ┌──────────────────┐             ┌────────────────┐
   │  Ethereum /  │         │  Stablelink      │             │  Merchant DB   │
   │  Base / Tron │ observes│  payment rail    │             │  Order DB      │
   │  Solana      │ ───────▶│                  │             │                │
   └──────────────┘         └──────────────────┘             └────────────────┘
```

## Roles in one paragraph

- **Buyer agent** — AI (Claude or other) holding the wagent skill. Discovers merchants, sends purchase intents, signs the on-chain payment, calls the tool.
- **Your shop** — your code. Exposes A2A `/tasks/send`, validates input against your tool's schema, relays Stablelink `PAID` events to W Connector, returns the bearer token, eventually runs your tool when called.
- **W Connector** — us. Merchant registry, order state machine, A2A push notifications, suspend/refund admin, no money custody.
- **Stablelink** — payment processor. Watches the chain, generates deposit addresses, fires webhooks on observed transfers. Funds settle in your Stablelink merchant balance.

## Sequence — full purchase + tool call

```
buyer agent       your shop                 W Connector          Stablelink           chain
     │                │                          │                    │                  │
     │ 1. discover    │                          │                    │                  │
     │───────────────▶│                          │                    │                  │
     │ 2. /tasks/send │                          │                    │                  │
     │   intent:      │                          │                    │                  │
     │   purchase    ─┼──────────────────────────▶│                    │                  │
     │                │ 3. POST /orders          │                    │                  │
     │                │ 4. POST /orders/.../checkout                  │                  │
     │                │                          │ 5. createOrder    │                  │
     │                │                          │────────────────────▶                  │
     │                │                          │ 6. deposit_addr   │                  │
     │                │                          │◀───────────────────                   │
     │ 7. deposit_addr│◀─────────────────────────│                    │                  │
     │◀───────────────│                          │                    │                  │
     │ 8. EVM transfer                            │                    │                  │
     │────────────────────────────────────────────────────────────────────────────────────▶
     │                │                          │                    │ 9. observe       │
     │                │                          │                    │◀─────────────────│
     │                │ 10. webhook /notify      │                    │                  │
     │                │◀──────────────────────────────────────────────│                  │
     │                │ 11. POST /orders/.../stablelink-confirm       │                  │
     │                │─────────────────────────▶│                    │                  │
     │                │                          │ 12. order PAID    │                  │
     │ 13. /tasks/send│                          │                    │                  │
     │  intent:        │                         │                    │                  │
     │  check_payment ─┼─────────────────────────▶│                    │                  │
     │                │ 14. delivery artifact    │                    │                  │
     │                │   (bearer token)         │                    │                  │
     │◀───────────────│                          │                    │                  │
     │ 15. POST /v1/tools/<name>                  │                    │                  │
     │   Bearer <token>                          │                    │                  │
     │───────────────▶│                          │                    │                  │
     │                │ 16. invoke tool function                       │                  │
     │ 17. result     │                          │                    │                  │
     │◀───────────────│                          │                    │                  │
```

## Bidirectional auth between shop and W Connector

There are two distinct credential pairs:

| Direction | Credential | Mechanism |
|---|---|---|
| Shop → W Connector (you call us) | `CONNECTOR_API_KEY` | HTTP `Authorization: Bearer …` |
| W Connector → shop (we push to you) | `CONNECTOR_API_KEY` (**same key**) | HMAC-SHA256 of `timestamp+body` in `x-gateway-signature` header |
| W Connector → shop `/wcheckout` (Tier-2 only) | `GATEWAY_TO_MERCHANT_KEY` (separate) | Same HMAC mechanism, different key |

`CONNECTOR_API_KEY` is the master shared secret. `GATEWAY_TO_MERCHANT_KEY` only matters if you opt into Tier-2 wcheckout-agent isolation (see [INTEGRATION.md §6](INTEGRATION.md#6-tier-2-credential-isolation)).

---

# 中文

## 角色一句话总结

- **Buyer agent** —— 装了 wagent skill 的 AI(Claude 之类)。发现商户、发购买意图、签链上付款、调工具。
- **你的 shop** —— 你的代码。暴露 A2A `/tasks/send`,校验工具输入 schema,转发 Stablelink `PAID` 事件给 W Connector,返回 bearer token,被调用时跑你的工具。
- **W Connector** —— 我们。商户注册表、订单状态机、A2A push 通知、suspend / refund admin。**不持币。**
- **Stablelink** —— 支付通道。监听链上、生成收款地址、webhook 通知付款。资金进你的 Stablelink 商户余额。

## 双向认证

shop 和 W Connector 之间是**双向 HMAC**:

| 方向 | 凭证 | 机制 |
|---|---|---|
| Shop → W Connector | `CONNECTOR_API_KEY` | HTTP Bearer |
| W Connector → shop `/push` | `CONNECTOR_API_KEY`(**同一把**) | `timestamp+body` HMAC-SHA256,塞 `x-gateway-signature` |
| W Connector → shop `/wcheckout`(只 Tier-2 用) | `GATEWAY_TO_MERCHANT_KEY`(独立第二把) | 同 HMAC,不同密钥 |

`CONNECTOR_API_KEY` 是主共享密钥。`GATEWAY_TO_MERCHANT_KEY` 只在你启用 Tier-2 凭证隔离时用(见 [INTEGRATION.zh-CN.md §6](INTEGRATION.zh-CN.md#6-tier-2凭证隔离))。
