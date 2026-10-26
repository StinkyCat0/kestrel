import { randomUUID } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { DesktopInput, DesktopStatus, TaskStatus } from "@cloudagents/protocol"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { type CallToolResult, isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import { Cause, Effect, Exit } from "effect"
import { z } from "zod"

export interface McpDeps {
  readonly desktop: {
    readonly status: (taskId: string) => Effect.Effect<DesktopStatus, unknown>
    readonly screenshot: (taskId: string) => Effect.Effect<Uint8Array, unknown> // PNG
    readonly input: (taskId: string, event: DesktopInput) => Effect.Effect<void, unknown>
    readonly launch: (taskId: string, command: string) => Effect.Effect<void, unknown>
  }
  readonly workspace: {
    readonly exec: (
      taskId: string,
      command: string,
      timeoutMs: number,
    ) => Effect.Effect<{ exitCode: number; stdout: string; stderr: string }, unknown>
  }
  readonly report: (taskId: string, input: { status: TaskStatus; message: string }) => Effect.Effect<void, unknown>
}

const MAX_OUTPUT_CHARS = 20_000
const MCP_PATH = /^\/mcp\/([^/?#]+)/

const BUTTONS = { left: 1, middle: 2, right: 3 } as const

const describeError = (e: unknown): string => {
  if (typeof e === "object" && e !== null && "message" in e && typeof e.message === "string") return e.message
  if (e instanceof Error) return e.message
  return String(e)
}

/** Runs an Effect, rejecting with the underlying error (not a FiberFailure wrapper). */
const runTool = (effect: Effect.Effect<CallToolResult, unknown>): Promise<CallToolResult> =>
  Effect.runPromiseExit(effect).then((exit) => {
    if (Exit.isSuccess(exit)) return exit.value
    throw Cause.squash(exit.cause)
  })

const text = (value: string): CallToolResult => ({ content: [{ type: "text", text: value }] })

/** Any failure becomes an MCP tool error (isError), never a server crash. */
const guard = (fn: () => Promise<CallToolResult>): Promise<CallToolResult> =>
  fn().catch((e: unknown) => ({
    content: [{ type: "text", text: describeError(e) }],
    isError: true,
  }))

const truncate = (s: string): string =>
  s.length <= MAX_OUTPUT_CHARS ? s : `${s.slice(0, MAX_OUTPUT_CHARS)}\n[truncated ${s.length - MAX_OUTPUT_CHARS} chars]`

const buildServer = (taskId: string, deps: McpDeps): McpServer => {
  const server = new McpServer(
    { name: "cloudagents", version: "0.1.0" },
    {
      instructions:
        "Tools for the task's remote desktop (a virtual X display streamed to the user) and its git worktree. " +
        "Desktop coordinates are pixels with the origin at the top-left; call desktop_screenshot first to see the " +
        "desktop and its size. Use task_report to tell the user when you are done or need input.",
    },
  )

  /** Converts pixel coordinates to the normalized [0,1) coordinates DesktopInput uses. */
  const normalize = (x: number, y: number): Effect.Effect<{ nx: number; ny: number }, unknown> =>
    Effect.gen(function* () {
      const status = yield* deps.desktop.status(taskId)
      if (status.width <= 0 || status.height <= 0) {
        return yield* Effect.fail(new Error("the desktop has no size; it may not be running"))
      }
      if (x < 0 || y < 0 || x >= status.width || y >= status.height) {
        return yield* Effect.fail(new Error(`(${x}, ${y}) is outside the ${status.width} x ${status.height} desktop`))
      }
      return { nx: x / status.width, ny: y / status.height }
    })

  const input = (event: DesktopInput): Effect.Effect<void, unknown> => deps.desktop.input(taskId, event)

  server.registerTool(
    "desktop_screenshot",
    {
      description:
        "Take a screenshot of the task desktop. Returns a PNG image and the desktop size as 'width x height'. " +
        "Coordinates for the other desktop_* tools are pixels within that size.",
    },
    () =>
      guard(() =>
        runTool(
          Effect.gen(function* () {
            const status = yield* deps.desktop.status(taskId)
            const png = yield* deps.desktop.screenshot(taskId)
            const result: CallToolResult = {
              content: [
                { type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" },
                { type: "text", text: `${status.width} x ${status.height}` },
              ],
            }
            return result
          }),
        ),
      ),
  )

  server.registerTool(
    "desktop_mouse_move",
    {
      description: "Move the mouse pointer on the task desktop to pixel (x, y), origin at top-left.",
      inputSchema: {
        x: z.number().describe("Pixel x coordinate, 0 to width-1"),
        y: z.number().describe("Pixel y coordinate, 0 to height-1"),
      },
    },
    ({ x, y }: { x: number; y: number }) =>
      guard(() =>
        runTool(
          Effect.gen(function* () {
            const { nx, ny } = yield* normalize(x, y)
            yield* input({ _tag: "mouse.move", x: nx, y: ny })
            return text(`moved mouse to (${x}, ${y})`)
          }),
        ),
      ),
  )

  server.registerTool(
    "desktop_click",
    {
      description: "Click on the task desktop at pixel (x, y). Moves the pointer there first.",
      inputSchema: {
        x: z.number().describe("Pixel x coordinate, 0 to width-1"),
        y: z.number().describe("Pixel y coordinate, 0 to height-1"),
        button: z.enum(["left", "middle", "right"]).optional().describe("Mouse button, default left"),
        double: z.boolean().optional().describe("Double-click when true, default false"),
      },
    },
    ({ x, y, button, double }: { x: number; y: number; button?: "left" | "middle" | "right"; double?: boolean }) =>
      guard(() =>
        runTool(
          Effect.gen(function* () {
            const buttonName = button ?? "left"
            const buttonId = BUTTONS[buttonName]
            const { nx, ny } = yield* normalize(x, y)
            yield* input({ _tag: "mouse.move", x: nx, y: ny })
            const clicks = double ? 2 : 1
            for (let i = 0; i < clicks; i++) {
              yield* input({ _tag: "mouse.button", x: nx, y: ny, button: buttonId, down: true })
              yield* input({ _tag: "mouse.button", x: nx, y: ny, button: buttonId, down: false })
            }
            return text(`${double ? "double-clicked" : "clicked"} ${buttonName} button at (${x}, ${y})`)
          }),
        ),
      ),
  )

  server.registerTool(
    "desktop_type",
    {
      description: "Type text into whatever has keyboard focus on the task desktop.",
      inputSchema: {
        text: z.string().describe("Text to type"),
      },
    },
    ({ text: value }: { text: string }) =>
      guard(() =>
        runTool(
          Effect.gen(function* () {
            yield* input({ _tag: "text", text: value })
            return text(`typed ${value.length} characters`)
          }),
        ),
      ),
  )

  server.registerTool(
    "desktop_key",
    {
      description:
        "Press and release a key or key combination on the task desktop. Uses xdotool keysym names, " +
        "e.g. 'Return', 'Escape', 'Tab', 'a', 'ctrl+s', 'alt+F4'.",
      inputSchema: {
        key: z.string().describe("xdotool keysym or combination, e.g. 'Return' or 'ctrl+s'"),
      },
    },
    ({ key }) =>
      guard(() =>
        runTool(
          Effect.gen(function* () {
            yield* input({ _tag: "key", key, down: true })
            yield* input({ _tag: "key", key, down: false })
            return text(`pressed ${key}`)
          }),
        ),
      ),
  )

  server.registerTool(
    "desktop_launch",
    {
      description:
        "Launch a GUI or terminal command on the task desktop, detached, so it appears on the desktop " +
        "(e.g. 'firefox', 'xterm'). Does not wait for it to exit.",
      inputSchema: {
        command: z.string().describe("Shell command to launch on the desktop"),
      },
    },
    ({ command }) =>
      guard(() =>
        runTool(
          Effect.gen(function* () {
            yield* deps.desktop.launch(taskId, command)
            return text(`launched: ${command}`)
          }),
        ),
      ),
  )

  server.registerTool(
    "workspace_exec",
    {
      description:
        "Run a shell command in the task's git worktree (the agent's working directory). Returns the exit code, " +
        "stdout and stderr (each truncated to 20000 characters). A non-zero exit code is reported in the output, " +
        "not as a tool error.",
      inputSchema: {
        command: z.string().describe("Shell command, run with sh -c in the worktree"),
        timeoutSec: z.number().positive().optional().describe("Timeout in seconds, default 120"),
      },
    },
    ({ command, timeoutSec }: { command: string; timeoutSec?: number }) =>
      guard(() =>
        runTool(
          Effect.gen(function* () {
            const timeoutMs = Math.round((timeoutSec ?? 120) * 1000)
            const result = yield* deps.workspace.exec(taskId, command, timeoutMs)
            return text(
              `exit code: ${result.exitCode}\n--- stdout ---\n${truncate(result.stdout)}\n` +
                `--- stderr ---\n${truncate(result.stderr)}`,
            )
          }),
        ),
      ),
  )

  server.registerTool(
    "task_report",
    {
      description:
        "Report the task's state to the user. Use 'working' while making progress, 'needs_input' when you need " +
        "an answer from the user, 'done' when the work is complete, or 'failed' if you cannot complete it.",
      inputSchema: {
        status: z.enum(["working", "needs_input", "done", "failed"]).describe("Current task state"),
        message: z.string().describe("Short message for the user"),
      },
    },
    ({ status, message }: { status: "working" | "needs_input" | "done" | "failed"; message: string }) =>
      guard(() =>
        runTool(
          Effect.gen(function* () {
            const mapped: TaskStatus = status === "working" ? "running" : status
            yield* deps.report(taskId, { status: mapped, message })
            return text(`reported ${mapped}`)
          }),
        ),
      ),
  )

  return server
}

const sendJsonRpcError = (res: ServerResponse, status: number, code: number, message: string): void => {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }))
}

type ParsedBody = { ok: true; value: unknown } | { ok: false }

const readJsonBody = (req: IncomingMessage): Promise<ParsedBody> => {
  const { promise, resolve, reject } = Promise.withResolvers<ParsedBody>()
  let data = ""
  req.setEncoding("utf8")
  req.on("data", (chunk: string) => {
    data += chunk
  })
  req.on("end", () => {
    try {
      resolve({ ok: true, value: JSON.parse(data) as unknown })
    } catch {
      resolve({ ok: false })
    }
  })
  req.on("error", reject)
  return promise
}

interface Session {
  readonly taskId: string
  readonly transport: StreamableHTTPServerTransport
}

/**
 * Returns a node http handler for every request whose URL starts with /mcp/<taskId>.
 * Stateful streamable HTTP: one McpServer + transport per session, keyed by Mcp-Session-Id.
 */
export function createMcpHandler(deps: McpDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const sessions = new Map<string, Session>()

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const match = MCP_PATH.exec(req.url ?? "")
    if (!match?.[1]) {
      sendJsonRpcError(res, 404, -32000, "Not found")
      return
    }
    const taskId = decodeURIComponent(match[1])

    const method = req.method ?? "GET"
    if (method !== "POST" && method !== "GET" && method !== "DELETE") {
      res.setHeader("allow", "GET, POST, DELETE")
      sendJsonRpcError(res, 405, -32000, "Method not allowed")
      return
    }

    const header = req.headers["mcp-session-id"]
    const sessionId = Array.isArray(header) ? header[0] : header

    if (sessionId !== undefined) {
      const session = sessions.get(sessionId)
      if (!session || session.taskId !== taskId) {
        sendJsonRpcError(res, 404, -32001, "Session not found")
        return
      }
      if (method === "POST") {
        const body = await readJsonBody(req)
        if (!body.ok) {
          sendJsonRpcError(res, 400, -32700, "Parse error")
          return
        }
        await session.transport.handleRequest(req, res, body.value)
        return
      }
      await session.transport.handleRequest(req, res)
      return
    }

    if (method !== "POST") {
      sendJsonRpcError(res, 400, -32000, "Bad Request: No valid session ID provided")
      return
    }
    const body = await readJsonBody(req)
    if (!body.ok) {
      sendJsonRpcError(res, 400, -32700, "Parse error")
      return
    }
    if (!isInitializeRequest(body.value)) {
      sendJsonRpcError(res, 400, -32000, "Bad Request: No valid session ID provided")
      return
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { taskId, transport })
      },
    })
    transport.onclose = () => {
      if (transport.sessionId !== undefined) sessions.delete(transport.sessionId)
    }
    await buildServer(taskId, deps).connect(transport)
    await transport.handleRequest(req, res, body.value)
  }

  return async (req, res) => {
    try {
      await handle(req, res)
    } catch (e) {
      console.error("[mcp] request failed:", describeError(e))
      if (!res.headersSent) sendJsonRpcError(res, 500, -32603, "Internal server error")
      else res.end()
    }
  }
}
