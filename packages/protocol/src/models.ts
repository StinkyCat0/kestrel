import { Schema } from "effect"

/**
 * Model families the box runs. Anthropic models run through Claude Code, OpenAI models through codex; every other
 * provider exposes an Anthropic Messages endpoint and runs through Claude Code too (see `harness` below).
 */
export const ModelProvider = Schema.Literal(
  "anthropic",
  "openai",
  "openrouter",
  "zai",
  "deepseek",
  "minimax",
  "moonshot",
)
export type ModelProvider = typeof ModelProvider.Type

/** The CLI that runs a provider's models. */
export const AgentHarness = Schema.Literal("claude", "codex")
export type AgentHarness = typeof AgentHarness.Type

/**
 * Thinking level: Claude Code's `--effort`, codex's `model_reasoning_effort`. Each model supports its own subset
 * (`ModelInfo.efforts`); `SendMessageBody` rejects a level the chosen model does not support.
 */
export const AgentEffort = Schema.Literal("none", "low", "medium", "high", "xhigh", "max")
export type AgentEffort = typeof AgentEffort.Type

export const EFFORT_LABELS: Record<AgentEffort, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
}

/** Model id passed to the provider's CLI (`claude --model`, the Codex app-server thread's `model`). */
export const AgentModel = Schema.Literal(
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
  "claude-fable-5",
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-opus-4-5",
  "claude-haiku-4-5",
  "gpt-6-astra",
  "gpt-6.1-sol",
  "gpt-6.1-terra",
  "gpt-6-luna",
  "gpt-6-sol",
  "anthropic/claude-fable-5.1",
  "anthropic/claude-opus-5.5",
  "anthropic/claude-sonnet-5.5",
  "anthropic/claude-haiku-5.5",
  "glm-5.3[1m]",
  "glm-5.3-flash[1m]",
  "deepseek-flash[1m]",
  "deepseek-v4-pro",
  "MiniMax-M3.1-Flash[1m]",
  "kimi-k3.1-pro",
  "kimi-k3[1m]",
  "kimi-k2.7-code",
)
export type AgentModel = typeof AgentModel.Type

export interface ModelInfo {
  readonly id: AgentModel
  readonly provider: ModelProvider
  /** Display name; the id is never shown. */
  readonly name: string
  /** Thinking levels the model accepts, lowest first. Empty: the model takes no thinking level. */
  readonly efforts: readonly AgentEffort[]
  /** In the chat model picker until the user edits the provider's list on the connections page. */
  readonly shownByDefault: boolean
}

const CLAUDE_ALL: readonly AgentEffort[] = ["low", "medium", "high", "xhigh", "max"]
const CLAUDE_NO_XHIGH: readonly AgentEffort[] = ["low", "medium", "high", "max"]
const GPT_FROM_LOW: readonly AgentEffort[] = ["low", "medium", "high", "xhigh", "max"]
const GPT_FROM_NONE: readonly AgentEffort[] = ["none", "low", "medium", "high", "xhigh", "max"]

/**
 * Every model the box can run, in picker order (newest first within a provider). Effort support follows Claude
 * Code's model configuration docs, OpenAI's model pages, and each third-party provider's Claude Code guide.
 * Providers without a documented effort scale list none, so the picker offers no unsupported control.
 */
export const AGENT_MODELS: readonly ModelInfo[] = [
  { id: "claude-fable-5-1", provider: "anthropic", name: "Claude Fable 5.1", efforts: CLAUDE_ALL, shownByDefault: true },
  { id: "claude-opus-5-5", provider: "anthropic", name: "Claude Opus 5.5", efforts: CLAUDE_ALL, shownByDefault: true },
  { id: "claude-sonnet-5-5", provider: "anthropic", name: "Claude Sonnet 5.5", efforts: CLAUDE_ALL, shownByDefault: true },
  { id: "claude-haiku-5-5", provider: "anthropic", name: "Claude Haiku 5.5", efforts: CLAUDE_ALL, shownByDefault: true },
  { id: "claude-fable-5", provider: "anthropic", name: "Claude Fable 5", efforts: CLAUDE_ALL, shownByDefault: false },
  { id: "claude-opus-5", provider: "anthropic", name: "Claude Opus 5", efforts: CLAUDE_ALL, shownByDefault: false },
  { id: "claude-sonnet-5", provider: "anthropic", name: "Claude Sonnet 5", efforts: CLAUDE_ALL, shownByDefault: false },
  { id: "claude-opus-4-8", provider: "anthropic", name: "Claude Opus 4.8", efforts: CLAUDE_ALL, shownByDefault: false },
  { id: "claude-opus-4-7", provider: "anthropic", name: "Claude Opus 4.7", efforts: CLAUDE_ALL, shownByDefault: false },
  { id: "claude-opus-4-6", provider: "anthropic", name: "Claude Opus 4.6", efforts: CLAUDE_NO_XHIGH, shownByDefault: false },
  { id: "claude-sonnet-4-6", provider: "anthropic", name: "Claude Sonnet 4.6", efforts: CLAUDE_NO_XHIGH, shownByDefault: false },
  { id: "claude-opus-4-5", provider: "anthropic", name: "Claude Opus 4.5", efforts: [], shownByDefault: false },
  { id: "claude-haiku-4-5", provider: "anthropic", name: "Claude Haiku 4.5", efforts: [], shownByDefault: false },
  { id: "gpt-6-astra", provider: "openai", name: "GPT-6 Astra", efforts: GPT_FROM_LOW, shownByDefault: true },
  { id: "gpt-6.1-sol", provider: "openai", name: "GPT-6.1 Sol", efforts: GPT_FROM_LOW, shownByDefault: true },
  { id: "gpt-6.1-terra", provider: "openai", name: "GPT-6.1 Terra", efforts: GPT_FROM_NONE, shownByDefault: true },
  { id: "gpt-6-luna", provider: "openai", name: "GPT-6 Luna", efforts: GPT_FROM_NONE, shownByDefault: true },
  { id: "gpt-6-sol", provider: "openai", name: "GPT-6 Sol", efforts: GPT_FROM_NONE, shownByDefault: false },
  // OpenRouter's Anthropic skin only guarantees Claude Code compatibility for Anthropic first-party models.
  { id: "anthropic/claude-opus-5.5", provider: "openrouter", name: "Claude Opus 5.5", efforts: CLAUDE_ALL, shownByDefault: true },
  { id: "anthropic/claude-sonnet-5.5", provider: "openrouter", name: "Claude Sonnet 5.5", efforts: CLAUDE_ALL, shownByDefault: true },
  { id: "anthropic/claude-fable-5.1", provider: "openrouter", name: "Claude Fable 5.1", efforts: CLAUDE_ALL, shownByDefault: false },
  { id: "anthropic/claude-haiku-5.5", provider: "openrouter", name: "Claude Haiku 5.5", efforts: CLAUDE_ALL, shownByDefault: false },
  { id: "glm-5.3[1m]", provider: "zai", name: "GLM-5.3", efforts: [], shownByDefault: true },
  { id: "glm-5.3-flash[1m]", provider: "zai", name: "GLM-5.3 Flash", efforts: [], shownByDefault: false },
  { id: "deepseek-flash[1m]", provider: "deepseek", name: "DeepSeek Flash", efforts: CLAUDE_NO_XHIGH, shownByDefault: true },
  { id: "deepseek-v4-pro", provider: "deepseek", name: "DeepSeek V4 Pro", efforts: CLAUDE_NO_XHIGH, shownByDefault: false },
  { id: "MiniMax-M3.1-Flash[1m]", provider: "minimax", name: "MiniMax M3.1 Flash", efforts: CLAUDE_ALL, shownByDefault: true },
  { id: "kimi-k3.1-pro", provider: "moonshot", name: "Kimi K3.1 Pro", efforts: CLAUDE_NO_XHIGH, shownByDefault: true },
  { id: "kimi-k3[1m]", provider: "moonshot", name: "Kimi K3", efforts: CLAUDE_NO_XHIGH, shownByDefault: false },
  { id: "kimi-k2.7-code", provider: "moonshot", name: "Kimi K2.7 Code", efforts: [], shownByDefault: false },
]

export interface ModelProviderInfo {
  readonly id: ModelProvider
  readonly name: string
  /** The CLI every model of this provider runs through. */
  readonly harness: AgentHarness
  /** `Connection.provider` ids that give the box access to this provider's models: an API key or a CLI login. */
  readonly connections: readonly string[]
}

export const MODEL_PROVIDERS: readonly ModelProviderInfo[] = [
  { id: "anthropic", name: "Anthropic", harness: "claude", connections: ["anthropic", "claude-cli"] },
  { id: "openai", name: "OpenAI", harness: "codex", connections: ["openai", "codex-cli"] },
  { id: "openrouter", name: "OpenRouter", harness: "claude", connections: ["openrouter"] },
  { id: "zai", name: "Z.ai", harness: "claude", connections: ["zai"] },
  { id: "deepseek", name: "DeepSeek", harness: "claude", connections: ["deepseek"] },
  { id: "minimax", name: "MiniMax", harness: "claude", connections: ["minimax"] },
  { id: "moonshot", name: "Kimi (Moonshot AI)", harness: "claude", connections: ["moonshot"] },
]

/** The provider a message without a model runs on: the box's default harness. */
export const DEFAULT_MODEL_PROVIDER: ModelProvider = "anthropic"

export const modelInfo = (id: AgentModel): ModelInfo => {
  const info = AGENT_MODELS.find((m) => m.id === id)
  if (info === undefined) throw new Error(`model ${id} is missing from AGENT_MODELS`)
  return info
}

export const providerInfo = (id: ModelProvider): ModelProviderInfo => {
  const info = MODEL_PROVIDERS.find((p) => p.id === id)
  if (info === undefined) throw new Error(`provider ${id} is missing from MODEL_PROVIDERS`)
  return info
}

/** The CLI that runs a provider's models. */
export const providerHarness = (id: ModelProvider): AgentHarness => providerInfo(id).harness

export const providerModels = (provider: ModelProvider): readonly ModelInfo[] =>
  AGENT_MODELS.filter((m) => m.provider === provider)

/** The model a run of `provider` uses when the message names none: its first default-shown model, else its first. */
export const defaultModelOf = (provider: ModelProvider): ModelInfo | undefined =>
  providerModels(provider).find((m) => m.shownByDefault) ?? providerModels(provider)[0]

/** Providers with at least one connected connection, in `MODEL_PROVIDERS` order. */
export const connectedModelProviders = (
  connections: ReadonlyArray<{ readonly provider: string; readonly connected: boolean }>,
): readonly ModelProviderInfo[] =>
  MODEL_PROVIDERS.filter((p) => connections.some((c) => c.connected && p.connections.includes(c.provider)))

/**
 * The provider's models in the chat picker, in catalog order. `chosen` is the user's saved list for the provider
 * (from the connections page), or null before they edited it.
 */
export const shownModels = (provider: ModelProvider, chosen: ReadonlyArray<AgentModel> | null): readonly ModelInfo[] =>
  providerModels(provider).filter((m) => (chosen === null ? m.shownByDefault : chosen.includes(m.id)))
