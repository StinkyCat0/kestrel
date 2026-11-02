import { describe, expect, test } from "bun:test"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { Effect } from "effect"
import { MODEL_PROVIDERS, providerModels, type RelayCredentials } from "@cloudagents/protocol"
import { BROKER_PROVIDERS, brokerEnv, credentialFor, UPSTREAM_BASE, type CredentialBrokerShape } from "./index"
import { handleBroker } from "./handler"

const BASE = "http://127.0.0.1:8787/broker/run-token"

describe("broker provider mapping", () => {
  test("every brokered provider has an upstream and every model provider has a model", () => {
    expect(BROKER_PROVIDERS).toEqual([
      "anthropic",
      "openai",
      "openrouter",
      "zai",
      "deepseek",
      "minimax",
      "moonshot",
    ])
    for (const provider of BROKER_PROVIDERS) {
      expect(UPSTREAM_BASE[provider]).toMatch(/^https:\/\//)
    }
    for (const provider of MODEL_PROVIDERS) {
      expect(providerModels(provider.id).length).toBeGreaterThan(0)
    }
  })

  test("Anthropic keeps its API key env; OpenAI keeps its base URL; gateways use the auth token", () => {
    expect(brokerEnv("anthropic", BASE, "t")).toEqual({
      ANTHROPIC_BASE_URL: `${BASE}/anthropic`,
      ANTHROPIC_API_KEY: "t",
    })
    expect(brokerEnv("openai", BASE, "t")).toEqual({
      OPENAI_BASE_URL: `${BASE}/openai/v1`,
      OPENAI_API_KEY: "t",
    })
    for (const provider of ["openrouter", "zai", "deepseek", "minimax", "moonshot"] as const) {
      expect(brokerEnv(provider, BASE, "t")).toEqual({
        ANTHROPIC_BASE_URL: `${BASE}/${provider}`,
        ANTHROPIC_AUTH_TOKEN: "t",
        ANTHROPIC_API_KEY: "",
      })
    }
  })

  test("gateway requests keep the provider path and carry the key as a bearer token", async () => {
    const seen: Array<{ path: string; headers: Headers }> = []
    const upstream = Bun.serve({
      port: 0,
      fetch(req) {
        seen.push({ path: new URL(req.url).pathname + new URL(req.url).search, headers: req.headers })
        return new Response("ok")
      },
    })
    const previous = UPSTREAM_BASE.openrouter
    UPSTREAM_BASE.openrouter = `http://127.0.0.1:${upstream.port}/api`
    const broker: CredentialBrokerShape = {
      issue: () => Effect.die("unused"),
      revoke: () => Effect.void,
      grantForToken: () => Effect.succeed({ runId: "run", user: "octocat" }),
      onRevoke: () => () => undefined,
      upstreamKey: () => Effect.succeed("real-key"),
    }
    const box = createServer((req, res) => void handleBroker(broker, req, res))
    const listening = Promise.withResolvers<void>()
    box.listen(0, "127.0.0.1", listening.resolve)
    await listening.promise
    const port = (box.address() as AddressInfo).port
    try {
      const response = await fetch(`http://127.0.0.1:${port}/broker/token/openrouter/v1/messages?beta=1`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer client", "x-api-key": "client" },
        body: '{"model":"anthropic/claude-sonnet-5.5"}',
      })
      expect(await response.text()).toBe("ok")
      expect(seen).toHaveLength(1)
      expect(seen[0]?.path).toBe("/api/v1/messages?beta=1")
      expect(seen[0]?.headers.get("authorization")).toBe("Bearer real-key")
      expect(seen[0]?.headers.get("x-api-key")).toBeNull()
    } finally {
      const closed = Promise.withResolvers<void>()
      box.close(() => closed.resolve())
      await closed.promise
      upstream.stop(true)
      UPSTREAM_BASE.openrouter = previous
    }
  })

  test("Anthropic requests inject the key in x-api-key", async () => {
    const seen: Headers[] = []
    const upstream = Bun.serve({
      port: 0,
      fetch(req) {
        seen.push(req.headers)
        return new Response("ok")
      },
    })
    const previous = UPSTREAM_BASE.anthropic
    UPSTREAM_BASE.anthropic = `http://127.0.0.1:${upstream.port}`
    const broker: CredentialBrokerShape = {
      issue: () => Effect.die("unused"),
      revoke: () => Effect.void,
      grantForToken: () => Effect.succeed({ runId: "run", user: "octocat" }),
      onRevoke: () => () => undefined,
      upstreamKey: () => Effect.succeed("real-key"),
    }
    const box = createServer((req, res) => void handleBroker(broker, req, res))
    const listening = Promise.withResolvers<void>()
    box.listen(0, "127.0.0.1", listening.resolve)
    await listening.promise
    const port = (box.address() as AddressInfo).port
    try {
      const response = await fetch(`http://127.0.0.1:${port}/broker/token/anthropic/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer client", "x-api-key": "client" },
        body: "{}",
      })
      expect(await response.text()).toBe("ok")
      expect(seen[0]?.get("x-api-key")).toBe("real-key")
      expect(seen[0]?.get("authorization")).toBeNull()
    } finally {
      const closed = Promise.withResolvers<void>()
      box.close(() => closed.resolve())
      await closed.promise
      upstream.stop(true)
      UPSTREAM_BASE.anthropic = previous
    }
  })

  test("a provider key wins over the legacy flat slots", () => {
    const creds: RelayCredentials = {
      user: "octocat",
      anthropic: "old-anthropic",
      openai: "old-openai",
      providers: { anthropic: "new-anthropic", openrouter: "openrouter-key" },
    }
    expect(credentialFor(creds, "anthropic")).toBe("new-anthropic")
    expect(credentialFor(creds, "openai")).toBe("old-openai")
    expect(credentialFor(creds, "openrouter")).toBe("openrouter-key")
    expect(credentialFor(creds, "deepseek")).toBeNull()
    expect(credentialFor(null, "openai")).toBeNull()
  })
})
