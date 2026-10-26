import { Context, Layer } from "effect"
import { join, resolve } from "node:path"
import pkg from "../package.json"

export const VERSION: string = pkg.version

const DEFAULT_AGENT_COMMAND =
  'claude -p "$CLOUDAGENTS_PROMPT" --mcp-config "$CLOUDAGENTS_MCP_CONFIG" --dangerously-skip-permissions --output-format stream-json --verbose'

export interface ServerConfig {
  readonly port: number
  readonly host: string
  /** Base URL the agent harness uses to reach this server's MCP endpoint. */
  readonly mcpBaseUrl: string
  readonly dataDir: string
  readonly reposDir: string
  readonly worktreesDir: string
  readonly runsDir: string
  readonly stateFile: string
  /** Shell command run (via `sh -c`) for each agent run, cwd = task worktree. */
  readonly agentCommand: string
  readonly fakeAgent: boolean
}

export class Config extends Context.Tag("cloudagents/Config")<Config, ServerConfig>() {}

const repoRoot = resolve(import.meta.dir, "../../..")

export const loadConfig = (): ServerConfig => {
  const portRaw = process.env.CLOUDAGENTS_PORT ?? "8787"
  const port = Number(portRaw)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`CLOUDAGENTS_PORT must be a valid port, got "${portRaw}"`)
  }
  const host = process.env.CLOUDAGENTS_HOST ?? "127.0.0.1"
  const mcpHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host
  const dataDir = resolve(process.env.CLOUDAGENTS_DATA_DIR ?? join(repoRoot, ".data"))
  const fakeAgent = process.env.CLOUDAGENTS_FAKE_AGENT === "1"
  const agentCommand = fakeAgent
    ? `${shellQuote(process.execPath)} ${shellQuote(join(repoRoot, "packages/server/scripts/fake-agent.ts"))}`
    : (process.env.CLOUDAGENTS_AGENT_COMMAND ?? DEFAULT_AGENT_COMMAND)
  return {
    port,
    host,
    mcpBaseUrl: `http://${mcpHost.includes(":") ? `[${mcpHost}]` : mcpHost}:${port}`,
    dataDir,
    reposDir: join(dataDir, "repos"),
    worktreesDir: join(dataDir, "worktrees"),
    runsDir: join(dataDir, "runs"),
    stateFile: join(dataDir, "state.json"),
    agentCommand,
    fakeAgent,
  }
}

export const ConfigLive = Layer.sync(Config, loadConfig)

const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`
