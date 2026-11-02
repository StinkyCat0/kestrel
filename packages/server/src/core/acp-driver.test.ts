import { describe, expect, test } from "bun:test"
import type { AgentItem } from "@cloudagents/protocol"
import { makeAcpDriver, type AcpRunInput } from "./acp-driver"

const input = (resumeSession: string | null = null): AcpRunInput => ({
  prompt: "hello",
  provider: "omp",
  resumeSession,
  cwd: "/tmp",
  mcpUrl: "http://127.0.0.1:1/mcp/t",
  mcpToken: "token",
  clientVersion: "test",
})

const harness = (opts: AcpRunInput) => {
  const sent: Array<Record<string, unknown>> = []
  const items: AgentItem[] = []
  const threads: string[] = []
  let done = 0
  const driver = makeAcpDriver(opts, {
    send: (message) => sent.push(message as Record<string, unknown>),
    onThread: (id) => threads.push(id),
    onDone: () => done++,
    onItem: (item) => items.push(item),
  })
  return { driver, sent, items, threads, done: () => done }
}

describe("ACP driver", () => {
  test("initializes, creates a session, streams a message and finishes the turn", () => {
    const h = harness(input())
    h.driver.start()
    expect(h.sent[0]).toMatchObject({ method: "initialize", params: { protocolVersion: 1 } })
    const initialize = h.sent[0] as { id: number }
    h.driver.receive({ jsonrpc: "2.0", id: initialize.id, result: { protocolVersion: 1 } })
    expect(h.sent[1]).toMatchObject({
      method: "session/new",
      params: {
        cwd: "/tmp",
        mcpServers: [
          {
            name: "cloudagents",
            type: "http",
            url: "http://127.0.0.1:1/mcp/t",
            headers: [{ name: "Authorization", value: "Bearer token" }],
          },
        ],
      },
    })
    const session = h.sent[1] as { id: number }
    h.driver.receive({ jsonrpc: "2.0", id: session.id, result: { sessionId: "s1" } })
    expect(h.threads).toEqual(["s1"])
    expect(h.sent[2]).toMatchObject({
      method: "session/prompt",
      params: { sessionId: "s1", prompt: [{ type: "text", text: "hello" }] },
    })

    h.driver.receive({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "s1",
        update: { sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "Hi" } },
      },
    })
    h.driver.receive({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "s1",
        update: { sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: " there" } },
      },
    })
    expect(h.items.at(-1)).toMatchObject({ _tag: "text", id: "acp-text-m1", text: "Hi there" })

    const prompt = h.sent[2] as { id: number }
    h.driver.receive({
      jsonrpc: "2.0",
      id: prompt.id,
      result: { stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 2 } },
    })
    expect(h.driver.outcome()).toEqual({ status: "completed" })
    expect(h.items.at(-1)).toMatchObject({
      _tag: "turn",
      inputTokens: 10,
      outputTokens: 2,
      isError: false,
    })
    expect(h.done()).toBe(1)
  })

  test("loads an existing session, ignores replayed messages and keeps its id", () => {
    const h = harness(input("old-session"))
    h.driver.start()
    const initialize = h.sent[0] as { id: number }
    h.driver.receive({ jsonrpc: "2.0", id: initialize.id, result: { protocolVersion: 1 } })
    expect(h.sent[1]).toMatchObject({ method: "session/load", params: { sessionId: "old-session" } })

    h.driver.receive({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "old-session",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "replayed" } },
      },
    })
    expect(h.items).toHaveLength(0)

    const load = h.sent[1] as { id: number }
    h.driver.receive({ jsonrpc: "2.0", id: load.id, result: { configOptions: [] } })
    expect(h.threads).toEqual(["old-session"])
    expect(h.sent[2]).toMatchObject({ method: "session/prompt", params: { sessionId: "old-session" } })
    expect(h.driver.outcome()).toBeNull()
  })

  test("accepts the allow option of a permission request", () => {
    const h = harness(input())
    h.driver.start()
    h.driver.receive({
      jsonrpc: "2.0",
      id: 99,
      method: "session/request_permission",
      params: {
        sessionId: "s1",
        options: [
          { optionId: "deny", name: "Deny", kind: "reject_once" },
          { optionId: "allow", name: "Allow", kind: "allow_once" },
        ],
      },
    })
    expect(h.sent.at(-1)).toEqual({
      jsonrpc: "2.0",
      id: 99,
      result: { outcome: { outcome: "selected", optionId: "allow" } },
    })
  })

  test("maps tool calls and marks a failed prompt", () => {
    const h = harness(input())
    h.driver.start()
    const initialize = h.sent[0] as { id: number }
    h.driver.receive({ jsonrpc: "2.0", id: initialize.id, result: { protocolVersion: 1 } })
    const session = h.sent[1] as { id: number }
    h.driver.receive({ jsonrpc: "2.0", id: session.id, result: { sessionId: "s1" } })
    h.driver.receive({ jsonrpc: "2.0", method: "session/update", params: { update: {
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      title: "workspace_exec",
      status: "in_progress",
      rawInput: { command: "printf hi" },
    } } })
    expect(h.items[0]).toMatchObject({ _tag: "tool", id: "t1", name: "workspace_exec", status: "running" })
    h.driver.receive({ jsonrpc: "2.0", method: "session/update", params: { update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "hi" } }],
    } } })
    expect(h.items.at(-1)).toMatchObject({ _tag: "tool", id: "t1", status: "ok", output: "hi" })

    const prompt = h.sent[2] as { id: number }
    h.driver.receive({ jsonrpc: "2.0", id: prompt.id, error: { code: -1, message: "boom" } })
    expect(h.driver.outcome()).toEqual({ status: "failed", error: "ACP prompt failed: boom" })
  })
})
