#!/usr/bin/env bun
/**
 * Starts the local stack, signs in the dev user, and opens the desktop app against it.
 *
 * This is the local way to see the desktop shell with every provider: the app runs against the dev Worker (which has
 * the provider catalog) instead of production. The app uses a separate user-data directory, so its dev session and
 * window state do not touch a production desktop install.
 */
import { spawn, spawnSync } from "node:child_process"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const desktop = join(root, "packages", "desktop")
const electronBin = join(desktop, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron")
const slot = process.env.KESTREL_DEV_SLOT ?? "7"
const env = {
  ...process.env,
  KESTREL_DEV_SLOT: slot,
  CLOUDAGENTS_FAKE_AGENT: process.env.CLOUDAGENTS_FAKE_AGENT ?? "1",
}

const stack = spawn("bun", ["run", "dev"], {
  cwd: root,
  env,
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
})

const ports = Promise.withResolvers<{ app: number; worker: number }>()
let output = ""
const consume = (chunk: Buffer) => {
  const text = chunk.toString("utf8")
  process.stdout.write(text)
  output += text
  const match = /dev: ports: app (\d+), worker (\d+), box \d+/.exec(output)
  if (match?.[1] !== undefined && match[2] !== undefined) {
    ports.resolve({ app: Number(match[1]), worker: Number(match[2]) })
  }
}
stack.stdout.on("data", consume)
stack.stderr.on("data", consume)

const timeout = setTimeout(() => ports.reject(new Error("the dev stack did not report its ports in time")), 120_000)

const stop = () => {
  try {
    if (stack.pid !== undefined) process.kill(-stack.pid, "SIGTERM")
  } catch {
    // already gone
  }
}

try {
  const { app, worker } = await ports.promise
  clearTimeout(timeout)

  const built = spawnSync("bun", ["run", "build"], {
    cwd: desktop,
    env,
    stdio: "inherit",
  })
  if (built.status !== 0) throw new Error("the desktop build failed")

  const login = await fetch(`http://localhost:${app}/auth/dev-login`, { redirect: "manual" })
  const setCookie = login.headers.get("set-cookie") ?? ""
  const session = /(?:^|;\s*)session=([^;]+)/.exec(setCookie)?.[1]
  if (session === undefined) throw new Error("the dev stack did not return a session; is DEV_SESSION_LOGIN set?")

  console.log(`\ndesktop: dev Worker http://127.0.0.1:${worker}`)
  const appProcess = spawn(
    electronBin,
    [".", "--no-sandbox", `--user-data-dir=${join(root, ".data-dev", "desktop")}`],
    {
      cwd: desktop,
      env: { ...env, KESTREL_CONTROL_URL: `http://127.0.0.1:${worker}`, KESTREL_DESKTOP_DEV_SESSION: session },
      stdio: "inherit",
    },
  )

  const forward = () => {
    appProcess.kill()
    stop()
  }
  process.on("SIGINT", forward)
  process.on("SIGTERM", forward)
  await new Promise<void>((resolve) => appProcess.once("exit", () => resolve()))
} finally {
  clearTimeout(timeout)
  stop()
}
