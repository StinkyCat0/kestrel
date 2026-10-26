import { Schema } from "effect"

/**
 * Control-plane API served by the Worker itself (not relayed to the box).
 * All `/api/*` paths not listed here are relayed to the agent box.
 * Requests authenticate with the `session` cookie set by the GitHub OAuth callback;
 * unauthenticated `/api/*` requests get 401 `{ _tag: "Unauthorized", message }`.
 */
export const ControlPaths = {
  /** GET: redirect to GitHub OAuth (sign-in). Query `?return=/path` optional. */
  login: "/auth/github/login",
  /** GET: OAuth callback for sign-in. */
  loginCallback: "/auth/github/callback",
  /** POST: clears the session; 204. */
  logout: "/auth/logout",
  /** GET: redirect to the provider's OAuth consent to add/refresh a connection. */
  connectOAuth: (provider: string) => `/auth/connect/${provider}`,
  /** GET: OAuth callback for connections. */
  connectCallback: (provider: string) => `/auth/connect/${provider}/callback`,
  /** GET -> Me, 401 when signed out. */
  me: "/api/me",
  /** GET -> Connection[] */
  connections: "/api/connections",
  /** PUT { apiKey } for api-key providers -> Connection; DELETE -> 204. */
  connection: (provider: string) => `/api/connections/${provider}`,
  /** GET -> GithubRepo[] for the signed-in user's GitHub connection. */
  githubRepos: "/api/github/repos",
  /** GET -> BoxStatus */
  box: "/api/box",
} as const

export const Me = Schema.Struct({
  login: Schema.String,
  name: Schema.NullOr(Schema.String),
  avatarUrl: Schema.String,
})
export type Me = typeof Me.Type

export const ConnectionKind = Schema.Literal("oauth", "apikey")
export type ConnectionKind = typeof ConnectionKind.Type

export const Connection = Schema.Struct({
  provider: Schema.String, // "github" | "anthropic" | "openai"
  label: Schema.String, // display name
  kind: ConnectionKind,
  connected: Schema.Boolean,
  /** Account or key hint when connected, e.g. GitHub login or "sk-…a1b2". */
  account: Schema.NullOr(Schema.String),
  /** OAuth providers: false when the Worker lacks client id/secret for it. */
  available: Schema.Boolean,
})
export type Connection = typeof Connection.Type

export const PutApiKeyBody = Schema.Struct({ apiKey: Schema.String.pipe(Schema.minLength(8)) })
export type PutApiKeyBody = typeof PutApiKeyBody.Type

export const GithubRepo = Schema.Struct({
  fullName: Schema.String, // "owner/name"
  cloneUrl: Schema.String, // https clone URL
  private: Schema.Boolean,
  defaultBranch: Schema.String,
  updatedAt: Schema.String,
})
export type GithubRepo = typeof GithubRepo.Type

export const BoxStatus = Schema.Struct({
  online: Schema.Boolean,
  connectedAt: Schema.NullOr(Schema.String),
  boxVersion: Schema.NullOr(Schema.String),
})
export type BoxStatus = typeof BoxStatus.Type
