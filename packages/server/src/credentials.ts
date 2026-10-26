import { Context, Effect, Layer, Ref } from "effect"
import type { RelayCredentials } from "@cloudagents/protocol"

/**
 * Latest connection secrets forwarded by the control plane (header `x-cloudagents-credentials`).
 * Host-side only: values here must never be passed into an agent sandbox.
 * Single-user MVP: one slot per box, replaced on every tunnelled request that carries credentials.
 */
export interface CredentialStoreShape {
  readonly get: Effect.Effect<RelayCredentials | null>
  readonly set: (creds: RelayCredentials) => Effect.Effect<void>
}

export class CredentialStore extends Context.Tag("cloudagents/CredentialStore")<CredentialStore, CredentialStoreShape>() {}

export const CredentialStoreLive = Layer.effect(
  CredentialStore,
  Effect.map(Ref.make<RelayCredentials | null>(null), (ref) => ({
    get: Ref.get(ref),
    set: (creds) => Ref.set(ref, creds),
  })),
)
