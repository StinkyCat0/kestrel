import { useEffect, useState } from "react"
import type { ModelProviderInfo } from "@cloudagents/protocol"

/** The CLI a new chat uses. This is a user setting, not part of a model's identity. */
export const HARNESSES = ["claude", "codex", "omp", "pi", "hermes"] as const
export type Harness = (typeof HARNESSES)[number]

export const HARNESS_LABELS: Record<Harness, string> = {
  claude: "Claude Code",
  codex: "Codex",
  omp: "OMP",
  pi: "Pi",
  hermes: "Hermes",
}

const KEY = "kestrel.harness"
const EVENT = "kestrel:harness"

const isHarness = (value: string | null): value is Harness => HARNESSES.includes(value as Harness)

const read = (): Harness => {
  if (typeof localStorage === "undefined") return "claude"
  const stored = localStorage.getItem(KEY)
  return isHarness(stored) ? stored : "claude"
}

/** The harness selected in Settings › Connections. It is shared by every new chat in this browser. */
export function useHarness(): readonly [Harness, (harness: Harness) => void] {
  const [harness, setHarnessState] = useState<Harness>(read)

  useEffect(() => {
    const sync = () => setHarnessState(read())
    window.addEventListener(EVENT, sync)
    window.addEventListener("storage", sync)
    return () => {
      window.removeEventListener(EVENT, sync)
      window.removeEventListener("storage", sync)
    }
  }, [])

  const setHarness = (next: Harness) => {
    localStorage.setItem(KEY, next)
    window.dispatchEvent(new Event(EVENT))
    setHarnessState(next)
  }

  return [harness, setHarness] as const
}

/** Which harness a provider's models run on. Claude-compatible gateways all use Claude Code. */
export const harnessOfProvider = (provider: ModelProviderInfo): Harness => {
  if (provider.harness === "claude") return "claude"
  if (provider.harness === "codex") return "codex"
  return provider.id === "pi" ? "pi" : provider.id === "hermes" ? "hermes" : "omp"
}
