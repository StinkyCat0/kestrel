/*
 * A run whose CLI speaks the Agent Client Protocol (ACP) over stdio: OMP, Pi (through `pi-acp`) and Hermes.
 * The CLI owns its model login; Kestrel's only credentials are the run's MCP token and its tools. ACP streams
 * assistant text, thinking and tool calls as `session/update` notifications; the prompt's result ends the turn.
 */

import type { AgentItem, ModelProvider } from "@cloudagents/protocol"
import type { RunDriver, RunOutcome } from "./run-driver"
import { isRecord } from "./transcript"

export interface AcpRunInput {
  readonly prompt: string
  readonly provider: ModelProvider
  readonly resumeSession: string | null
  readonly cwd: string
  readonly mcpUrl: string
  readonly mcpToken: string
  readonly clientVersion: string
}

export interface AcpIo {
  readonly send: (message: unknown) => void
  readonly onThread: (sessionId: string) => void
  readonly onDone: () => void
  readonly onItem: (item: AgentItem) => void
}

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null)

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null

/** ACP tool-call state names; anything unknown is still running. */
const toolStatus = (status: unknown): "running" | "ok" | "error" => {
  if (status === "completed") return "ok"
  if (status === "failed") return "error"
  return "running"
}

/** Text and diff output in an ACP tool-call content block. */
const contentText = (content: unknown): string => {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) {
    if (isRecord(content)) {
      const text = asString(content.text)
      if (text !== null) return text
      const nested = content.content
      if (nested !== content) return contentText(nested)
    }
    return ""
  }
  const parts: string[] = []
  for (const block of content) {
    if (typeof block === "string") {
      parts.push(block)
    } else if (isRecord(block)) {
      const kind = asString(block.type)
      if (kind === "content") parts.push(contentText(block.content))
      else if (kind === "diff") {
        const path = asString(block.path) ?? "file"
        const before = asString(block.oldText) ?? ""
        const after = asString(block.newText) ?? ""
        parts.push(`--- ${path}\n${before}\n+++ ${path}\n${after}`)
      } else {
        const text = asString(block.text)
        if (text !== null) parts.push(text)
      }
    }
  }
  return parts.filter((part) => part !== "").join("\n")
}

const outputText = (update: Record<string, unknown>): string | null => {
  const content = contentText(update.content)
  if (content !== "") return content
  const raw = update.rawOutput
  if (typeof raw === "string") return raw
  if (raw === undefined || raw === null) return null
  try {
    return JSON.stringify(raw)
  } catch {
    return String(raw)
  }
}

const mcpServers = (input: AcpRunInput): unknown[] => [
  {
    name: "cloudagents",
    type: "http",
    url: input.mcpUrl,
    headers: [{ name: "Authorization", value: `Bearer ${input.mcpToken}` }],
  },
]

export const makeAcpDriver = (input: AcpRunInput, io: AcpIo): RunDriver => {
  let nextId = 1
  let initializeId: number | null = null
  let sessionRequestId: number | null = null
  let promptId: number | null = null
  let sessionId: string | null = null
  let outcome: RunOutcome | null = null
  let cancelling = false
  let done = false
  let replaying = false
  let startedAt = Date.now()
  let costUsd: number | null = null
  let lastUsage: Record<string, unknown> | null = null
  const texts = new Map<string, { id: string; text: string }>()
  const thoughts = new Map<string, { id: string; text: string }>()
  const tools = new Map<string, AgentItem & { _tag: "tool" }>()

  const send = (message: unknown) => io.send(message)

  const finishTurn = (stopReason: string, usage: unknown) => {
    if (done) return
    done = true
    lastUsage = isRecord(usage) ? usage : lastUsage
    const inputTokens = lastUsage === null ? null : asNumber(lastUsage.inputTokens)
    const outputTokens = lastUsage === null ? null : asNumber(lastUsage.outputTokens)
    const interrupted = stopReason === "cancelled" || stopReason === "interrupted" || cancelling
    outcome = interrupted
      ? { status: "interrupted" }
      : stopReason === "end_turn" || stopReason === "max_tokens"
        ? { status: "completed" }
        : { status: "failed", error: `ACP agent stopped: ${stopReason}` }
    io.onItem({
      _tag: "turn",
      id: "turn",
      durationMs: Date.now() - startedAt,
      inputTokens,
      outputTokens,
      costUsd,
      isError: outcome.status === "failed",
    })
    io.onDone()
  }

  const fail = (message: string) => {
    if (outcome !== null) return
    outcome = { status: "failed", error: message }
    io.onDone()
  }

  const request = (method: string, params: unknown): number => {
    const id = nextId++
    send({ jsonrpc: "2.0", id, method, params })
    return id
  }

  const prompt = () => {
    if (sessionId === null) return
    startedAt = Date.now()
    promptId = request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: input.prompt }],
    })
  }

  const newSession = () => {
    sessionRequestId = request("session/new", {
      cwd: input.cwd,
      mcpServers: mcpServers(input),
    })
  }

  const loadSession = () => {
    replaying = true
    sessionRequestId = request("session/load", {
      sessionId: input.resumeSession,
      cwd: input.cwd,
      mcpServers: mcpServers(input),
    })
  }

  const updateText = (kind: "text" | "thinking", update: Record<string, unknown>) => {
    const content = update.content
    const text = isRecord(content) ? asString(content.text) : null
    if (text === null) return
    const messageId = asString(update.messageId) ?? "main"
    const map = kind === "text" ? texts : thoughts
    const existing = map.get(messageId) ?? {
      id: kind === "text" ? `acp-text-${messageId}` : `acp-thought-${messageId}`,
      text: "",
    }
    existing.text += text
    map.set(messageId, existing)
    io.onItem({
      _tag: kind === "text" ? "text" : "thinking",
      id: existing.id,
      parentToolId: null,
      text: existing.text,
    })
  }

  const updateTool = (update: Record<string, unknown>, partial: boolean) => {
    const toolCallId = asString(update.toolCallId)
    if (toolCallId === null) return
    const previous = tools.get(toolCallId)
    const title = asString(update.title) ?? asString(update.kind) ?? previous?.name ?? "tool"
    const rawInput = update.rawInput !== undefined ? update.rawInput : previous?.input
    const output = outputText(update)
    const item: AgentItem & { _tag: "tool" } = {
      _tag: "tool",
      id: toolCallId,
      parentToolId: null,
      name: title,
      input: rawInput ?? null,
      status: partial && update.status === undefined ? (previous?.status ?? "running") : toolStatus(update.status),
      output: output ?? previous?.output ?? null,
    }
    tools.set(toolCallId, item)
    io.onItem(item)
  }

  const handleUpdate = (update: Record<string, unknown>) => {
    const kind = asString(update.sessionUpdate)
    switch (kind) {
      case "agent_message_chunk":
        updateText("text", update)
        return
      case "agent_thought_chunk":
        updateText("thinking", update)
        return
      case "tool_call":
        updateTool(update, false)
        return
      case "tool_call_update":
        updateTool(update, true)
        return
      case "usage_update":
        lastUsage = {
          ...(lastUsage ?? {}),
          inputTokens: asNumber(update.used) ?? lastUsage?.inputTokens,
          ...(isRecord(update.cost) ? { costUsd: asNumber(update.cost.amount) } : {}),
        }
        if (isRecord(update.cost)) costUsd = asNumber(update.cost.amount) ?? costUsd
        return
      default:
        // Session info, plans and available commands do not change the run's items.
        return
    }
  }

  const handleResponse = (message: Record<string, unknown>) => {
    const id = asNumber(message.id)
    if (id === null) return
    const error = isRecord(message.error) ? message.error : null
    if (id === initializeId) {
      if (error !== null) {
        fail(`ACP initialize failed: ${asString(error.message) ?? "unknown error"}`)
        return
      }
      if (input.resumeSession !== null) loadSession()
      else newSession()
      return
    }
    if (id === sessionRequestId) {
      replaying = false
      if (error !== null) {
        // A session id the CLI cannot load (a different cwd, a cleaned-up session) starts a fresh one.
        if (input.resumeSession !== null) {
          newSession()
          return
        }
        fail(`ACP session failed: ${asString(error.message) ?? "unknown error"}`)
        return
      }
      const result = isRecord(message.result) ? message.result : null
      const id = result === null ? null : asString(result.sessionId)
      // `session/load` returns config options, not a new id; the loaded session keeps its id.
      const loaded = id ?? (input.resumeSession !== null ? input.resumeSession : null)
      if (loaded === null) {
        fail("ACP session failed: no sessionId")
        return
      }
      sessionId = loaded
      io.onThread(loaded)
      prompt()
      return
    }
    if (id === promptId) {
      if (error !== null) {
        fail(`ACP prompt failed: ${asString(error.message) ?? "unknown error"}`)
        return
      }
      const result = isRecord(message.result) ? message.result : null
      const stopReason = result === null ? null : asString(result.stopReason)
      finishTurn(stopReason ?? "end_turn", result?.usage)
    }
  }

  const handleAgentRequest = (message: Record<string, unknown>) => {
    const id = message.id
    const method = asString(message.method)
    if (id === undefined || id === null || method === null) return
    if (method === "session/request_permission") {
      const params = isRecord(message.params) ? message.params : {}
      const options = Array.isArray(params.options) ? params.options.filter(isRecord) : []
      const allow =
        options.find((option) => option.kind === "allow_once" || option.kind === "allow_always") ??
        options.find((option) => /allow|approve|yes/i.test(asString(option.name) ?? "")) ??
        options[0]
      const optionId = allow === undefined ? null : asString(allow.optionId)
      send({
        jsonrpc: "2.0",
        id,
        result: { outcome: optionId === null ? { outcome: "cancelled" } : { outcome: "selected", optionId } },
      })
      return
    }
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `kestrel does not implement ${method}` },
    })
  }

  return {
    start: () => {
      initializeId = request("initialize", {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: { name: "kestrel", version: input.clientVersion },
      })
    },
    receive: (message: unknown) => {
      if (!isRecord(message)) return
      if (asString(message.method) !== null) {
        if (message.id !== undefined) handleAgentRequest(message)
        else if (message.method === "session/update") {
          // `session/load` replays the stored conversation before its result; Kestrel already has those messages.
          if (replaying) return
          const params = isRecord(message.params) ? message.params : null
          const update = params === null ? null : params.update
          if (isRecord(update)) handleUpdate(update)
        }
        return
      }
      handleResponse(message)
    },
    steer: () => Promise.resolve(false),
    interrupt: () => {
      if (sessionId === null || done) return false
      cancelling = true
      send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } })
      return true
    },
    close: () => {
      if (outcome !== null) return
      outcome = cancelling ? { status: "interrupted" } : { status: "failed", error: "ACP agent exited before the turn ended" }
    },
    outcome: () => outcome,
  }
}
