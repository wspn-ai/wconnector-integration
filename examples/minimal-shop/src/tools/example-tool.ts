/**
 * Example tool implementation. Replace `invoke()` with your actual API call
 * (Etherscan, OFAC SDN check, OpenAI proxy — whatever you're selling).
 *
 * Contract:
 *  - `name` — must match `delivery.tool_name` in your products catalog.
 *  - `inputSchema` — JSON schema; W Connector publishes this to buyers so
 *    they can construct valid `--call-body` payloads without trial+error.
 *    Buyer's input is validated against this BEFORE payment.
 *  - `invoke(input)` — called once per redeemed bearer token. Throw on
 *    transient failures so the buyer can retry; the bearer token isn't
 *    decremented when invoke throws.
 */
export interface Tool {
  name: string
  inputSchema: Record<string, unknown>
  invoke: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
}

export const exampleTool: Tool = {
  name: 'address_risk_profile',
  inputSchema: {
    type: 'object',
    properties: {
      address: {
        type: 'string',
        pattern: '^0x[a-fA-F0-9]{40}$',
        description: 'EVM address to profile',
      },
    },
    required: ['address'],
    additionalProperties: false,
    examples: [{ address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' }],
  },
  async invoke(input) {
    const addr = String(input.address).toLowerCase()
    // Replace with your real API call. This stub returns a canned response
    // so the integration can be tested without external dependencies.
    return {
      address: addr,
      risk_level: 'low',
      sanctions_hit: false,
      sources: ['ofac_sdn', 'chainabuse'],
      checked_at: new Date().toISOString(),
    }
  },
}
