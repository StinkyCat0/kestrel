import type { IncomingMessage, Server } from "node:http"
import type { Duplex } from "node:stream"
import { Effect, Runtime, Schema } from "effect"
import { DesktopInput, type DesktopStatus, type ServerEvent } from "@cloudagents/protocol"
import { WebSocket, WebSocketServer } from "ws"
import { EventHub } from "../core/events"
import { CoreService } from "../core/service"
import { DesktopManager } from "../desktop"

export type WsServices = CoreService | DesktopManager | EventHub

const EVENTS_PATH = /^\/api\/tasks\/([^/]+)\/events$/
const DESKTOP_PATH = /^\/api\/tasks\/([^/]+)\/desktop\/stream$/

/** Close code sent when the task does not exist. */
const CLOSE_NOT_FOUND = 4404
/** Close code sent when the desktop cannot be attached. */
const CLOSE_INTERNAL = 1011

const sendJson = (ws: WebSocket, value: ServerEvent | DesktopStatus) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value))
}

/** Resolves when the socket closes (immediately if it already has). */
const untilClosed = (ws: WebSocket) =>
  Effect.async<void>((resume) => {
    if (ws.readyState === WebSocket.CLOSED) resume(Effect.void)
    else ws.once("close", () => resume(Effect.void))
  })

const closeWith = (ws: WebSocket, code: number, message: string) =>
  Effect.sync(() => ws.close(code, message.slice(0, 120)))

const serveEvents = (ws: WebSocket, taskId: string) =>
  Effect.gen(function* () {
    const core = yield* CoreService
    const hub = yield* EventHub
    const found = yield* core.getTask(taskId).pipe(Effect.either)
    if (found._tag === "Left") {
      return yield* closeWith(ws, CLOSE_NOT_FOUND, found.left.message)
    }
    yield* Effect.acquireUseRelease(
      Effect.sync(() => hub.subscribe(taskId, (event) => sendJson(ws, event))),
      () => untilClosed(ws),
      (unsubscribe) => Effect.sync(unsubscribe),
    )
  })

const serveDesktop = (ws: WebSocket, taskId: string) =>
  Effect.gen(function* () {
    const core = yield* CoreService
    const desktop = yield* DesktopManager
    const runtime = yield* Effect.runtime<WsServices>()
    const fork = Runtime.runFork(runtime)
    const found = yield* core.getTask(taskId).pipe(Effect.either)
    if (found._tag === "Left") {
      return yield* closeWith(ws, CLOSE_NOT_FOUND, found.left.message)
    }

    const decodeInput = Schema.decodeUnknown(Schema.parseJson(DesktopInput))
    const handleInput = (raw: string) =>
      Effect.gen(function* () {
        const event = yield* decodeInput(raw).pipe(Effect.either)
        if (event._tag === "Left") {
          yield* Effect.logWarning(`desktop input rejected: ${event.left.message}`)
          return
        }
        yield* desktop
          .input(taskId, event.right)
          .pipe(Effect.catchAll((e) => Effect.logWarning(`desktop input failed: ${e.message}`)))
      })
    const onMessage = (data: WebSocket.RawData) => {
      fork(handleInput(data.toString()))
    }

    yield* Effect.acquireUseRelease(
      desktop.subscribe(taskId, {
        onStatus: (status) => sendJson(ws, status),
        onMedia: (chunk) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(chunk)
        },
      }),
      () =>
        Effect.gen(function* () {
          ws.on("message", onMessage)
          yield* untilClosed(ws)
        }),
      (unsubscribe) => unsubscribe,
    ).pipe(Effect.catchAll((e) => closeWith(ws, CLOSE_INTERNAL, e.message)))
  })

/**
 * Attaches the WebSocket endpoints to an existing node http server via the upgrade event.
 * Unknown upgrade paths are destroyed.
 */
export const attachWebSockets = (server: Server, runtime: Runtime.Runtime<WsServices>): WebSocketServer => {
  const runFork = Runtime.runFork(runtime)
  const wss = new WebSocketServer({ noServer: true })

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname
    const events = EVENTS_PATH.exec(pathname)
    const desktop = DESKTOP_PATH.exec(pathname)
    const match = events ?? desktop
    if (!match) {
      socket.destroy()
      return
    }
    const taskId = decodeURIComponent(match[1] ?? "")
    wss.handleUpgrade(req, socket, head, (ws) => {
      runFork(events ? serveEvents(ws, taskId) : serveDesktop(ws, taskId))
    })
  })

  return wss
}
