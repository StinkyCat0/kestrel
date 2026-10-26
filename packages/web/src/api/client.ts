import { Effect, Either, Schema } from "effect"
import {
  CreateRepoBody,
  CreateTaskBody,
  DesktopStatus,
  DiffResponse,
  Message,
  Paths,
  Repo,
  Run,
  SendMessageResponse,
  Task,
} from "@cloudagents/protocol"
import { SERVER_URL } from "../config"

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = "ApiError"
  }
}

function errorMessage(text: string, fallback: string): string {
  try {
    const body: unknown = JSON.parse(text)
    if (typeof body === "object" && body !== null && "message" in body && typeof body.message === "string") {
      return body.message
    }
  } catch {
    // Body is not JSON; fall through to raw text.
  }
  return text || fallback
}

const request = <A, I>(
  schema: Schema.Schema<A, I>,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Effect.Effect<A, ApiError> =>
  Effect.gen(function* () {
    const res = yield* Effect.tryPromise({
      try: () =>
        fetch(SERVER_URL + path, {
          method,
          headers: body === undefined ? undefined : { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      catch: (e) => new ApiError(0, `Cannot reach server at ${SERVER_URL}: ${String(e)}`),
    })
    const text = yield* Effect.tryPromise({
      try: () => res.text(),
      catch: (e) => new ApiError(res.status, String(e)),
    })
    if (!res.ok) {
      return yield* Effect.fail(new ApiError(res.status, errorMessage(text, res.statusText)))
    }
    const json = yield* Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: () => new ApiError(res.status, "Server returned invalid JSON"),
    })
    return yield* Schema.decodeUnknown(schema)(json).pipe(
      Effect.mapError((e) => new ApiError(res.status, `Unexpected response shape: ${e.message}`)),
    )
  })

const run = <A>(effect: Effect.Effect<A, ApiError>): Promise<A> =>
  Effect.runPromise(Effect.either(effect)).then((result) => {
    if (Either.isLeft(result)) throw result.left
    return result.right
  })

export const api = {
  listRepos: () => run(request(Schema.Array(Repo), "GET", Paths.repos)),
  addRepo: (body: CreateRepoBody) => run(request(Repo, "POST", Paths.repos, body)),
  getRepo: (repoId: string) => run(request(Repo, "GET", Paths.repo(repoId))),
  listRepoTasks: (repoId: string) => run(request(Schema.Array(Task), "GET", Paths.repoTasks(repoId))),
  createTask: (repoId: string, body: CreateTaskBody) => run(request(Task, "POST", Paths.repoTasks(repoId), body)),
  getTask: (taskId: string) => run(request(Task, "GET", Paths.task(taskId))),
  listMessages: (taskId: string) => run(request(Schema.Array(Message), "GET", Paths.taskMessages(taskId))),
  sendMessage: (taskId: string, text: string) =>
    run(request(SendMessageResponse, "POST", Paths.taskMessages(taskId), { text })),
  listRuns: (taskId: string) => run(request(Schema.Array(Run), "GET", Paths.taskRuns(taskId))),
  cancelRun: (runId: string) => run(request(Run, "POST", Paths.runCancel(runId))),
  getDiff: (taskId: string) => run(request(DiffResponse, "GET", Paths.taskDiff(taskId))),
  getDesktop: (taskId: string) => run(request(DesktopStatus, "GET", Paths.taskDesktop(taskId))),
  startDesktop: (taskId: string) => run(request(DesktopStatus, "POST", Paths.taskDesktop(taskId))),
  stopDesktop: (taskId: string) =>
    run(Effect.asVoid(request(Schema.Unknown, "DELETE", Paths.taskDesktop(taskId)))),
}
