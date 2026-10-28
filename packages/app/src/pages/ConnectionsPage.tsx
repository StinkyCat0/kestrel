import { useEffect, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CliProvider, ControlPaths, type CliLoginStart, type Connection } from "@cloudagents/protocol"
import { Schema } from "effect"
import { api } from "@/api/client"
import { keys, queries } from "@/api/queries"
import { Alert } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AngledCard, AngledCardContent } from "@/components/ui/angled-card"
import { Input } from "@/components/ui/input"
import { SERVER_URL } from "@/config"
import { errorText } from "@/util"

const MIN_API_KEY_LENGTH = 8
const CLI_POLL_MS = 3000

export function ConnectionsPage() {
  const connections = useQuery(queries.connections())

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 overflow-auto p-8">
    <div>
    <h1 className="text-2xl font-bold tracking-tight text-white">Connections</h1>
    <p className="text-muted-foreground mt-1">Accounts and keys Kestrel uses on your behalf.</p>
    </div>

    {connections.error && <Alert className="border-destructive/50 bg-destructive/10 text-destructive">{errorText(connections.error)}</Alert>}
    {connections.isPending && <div className="text-muted-foreground">Loading…</div>}

    {connections.data && (
      <AngledCard className="p-0 overflow-hidden">
      <AngledCardContent className="divide-y divide-white/5 px-0 py-0">
      {connections.data.map((connection) =>
        connection.kind === "cli" && Schema.is(CliProvider)(connection.provider) ? (
          <CliConnectionRow key={connection.provider} connection={connection} provider={connection.provider} />
        ) : (
          <ConnectionRow key={connection.provider} connection={connection} />
        ),
      )}
      </AngledCardContent>
      </AngledCard>
    )}
    </div>
  )
}

function ConnectionRow({ connection }: { connection: Connection }) {
  const queryClient = useQueryClient()
  const [apiKey, setApiKey] = useState("")
  const onSuccess = () => void queryClient.invalidateQueries({ queryKey: keys.connections })

  const save = useMutation({
    mutationFn: (key: string) => api.putApiKey(connection.provider, { apiKey: key }),
                           onSuccess: () => {
                             setApiKey("")
                             onSuccess()
                           },
  })
  const disconnect = useMutation({ mutationFn: () => api.deleteConnection(connection.provider), onSuccess })
  const busy = save.isPending || disconnect.isPending
  const error = save.error ?? disconnect.error

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    save.mutate(apiKey.trim())
  }

  return (
    <div className="flex flex-col gap-2.5 px-6 py-5">
    <ConnectionHeader label={connection.label} connected={connection.connected} account={connection.account} />
    {connection.kind === "oauth" ? (
      connection.available ? (
        <Button asChild variant="outline" className="w-fit border-white/10 bg-white/5 hover:bg-white/10 hover:text-white">
        <a href={SERVER_URL + ControlPaths.connectOAuth(connection.provider)}>
        {connection.connected ? "Reconnect" : "Connect"}
        </a>
        </Button>
      ) : (
        <div className="text-muted-foreground">needs server config</div>
      )
    ) : (
      <form className="flex flex-wrap gap-3" onSubmit={submit}>
      <Input
      className="max-w-sm bg-white/5 border-white/10 focus:border-white/30 focus:bg-white/10 transition-colors"
      type="password"
      autoComplete="off"
      placeholder={connection.connected ? "Replace API key" : "API key"}
      value={apiKey}
      onChange={(e) => setApiKey(e.target.value)}
      />
      <Button type="submit" disabled={busy || apiKey.trim().length < MIN_API_KEY_LENGTH} className="bg-white text-black hover:bg-zinc-200">
      Save
      </Button>
      {connection.connected && (
        <Button type="button" variant="outline" disabled={busy} onClick={() => disconnect.mutate()} className="border-white/10 bg-white/5 hover:bg-white/10">
        Disconnect
        </Button>
      )}
      </form>
    )}
    {error && <Alert className="border-destructive/50 bg-destructive/10 text-destructive">{errorText(error)}</Alert>}
    </div>
  )
}

function ConnectionHeader({ label, connected, account }: { label: string; connected: boolean; account?: string | null }) {
  return (
    <div className="flex items-center gap-3">
    <strong className="text-white">{label}</strong>
    <Badge variant={connected ? "success" : "neutral"} className="text-xs">{connected ? "connected" : "not connected"}</Badge>
    {connected && account && <span className="font-mono text-xs text-muted-foreground">{account}</span>}
    </div>
  )
}

function CliConnectionRow({ connection, provider }: { connection: Connection; provider: CliProvider }) {
  const queryClient = useQueryClient()
  const [login, setLogin] = useState<CliLoginStart | null>(null)
  const [expired, setExpired] = useState(false)
  const [code, setCode] = useState("")
  const refresh = () => void queryClient.invalidateQueries({ queryKey: keys.connections })

  const start = useMutation({
    mutationFn: () => api.cliLoginStart(provider),
                            onSuccess: (next) => {
                              submitCode.reset()
                              logout.reset()
                              setLogin(next)
                              setExpired(false)
                              setCode("")
                            },
  })
  const submitCode = useMutation({
    mutationFn: (value: string) => api.cliLoginCode(provider, { code: value }),
                                 onSuccess: (status) => {
                                   if (status.loggedIn) {
                                     setLogin(null)
                                     setCode("")
                                   }
                                   refresh()
                                 },
  })
  const logout = useMutation({
    mutationFn: () => api.cliLogout(provider),
                             onSuccess: () => {
                               setLogin(null)
                               refresh()
                             },
  })
  const busy = start.isPending || submitCode.isPending || logout.isPending
  const error = start.error ?? submitCode.error ?? logout.error

  useEffect(() => {
    if (connection.connected) setLogin(null)
  }, [connection.connected])

  useEffect(() => {
    if (!login) return
      const id = setTimeout(() => setExpired(true), Math.max(0, Date.parse(login.expiresAt) - Date.now()))
      return () => clearTimeout(id)
  }, [login])

  const polling = login?.provider === "codex-cli" && !expired && !connection.connected
  useEffect(() => {
    if (!polling) return
      const id = setInterval(() => void queryClient.invalidateQueries({ queryKey: keys.connections }), CLI_POLL_MS)
      return () => clearInterval(id)
  }, [polling, queryClient])

  function cancel() {
    start.reset()
    submitCode.reset()
    logout.reset()
    setLogin(null)
    setCode("")
  }

  function body() {
    if (!connection.available) {
      return (
        <>
        <p className="text-muted-foreground">Agent box is offline.</p>
        <Button variant="outline" className="w-fit border-white/10 bg-white/5 hover:bg-white/10" onClick={refresh}>
        Check again
        </Button>
        </>
      )
    }
    if (connection.connected) {
      return (
        <>
        <p className="text-muted-foreground">
        {connection.account ? `Signed in as ${connection.account}` : "Signed in"}
        </p>
        <Button
        variant="outline"
        className="w-fit border-white/10 bg-white/5 hover:bg-white/10"
        disabled={busy}
        onClick={() => {
          if (window.confirm("Disconnect this subscription? Agent runs will stop using it.")) logout.mutate()
        }}
        >
        Disconnect
        </Button>
        </>
      )
    }
    if (login && expired) {
      return (
        <>
        <p className="text-muted-foreground">This sign-in expired.</p>
        <Button className="w-fit bg-white text-black hover:bg-zinc-200" disabled={busy} onClick={() => start.mutate()}>
        Try again
        </Button>
        </>
      )
    }
    if (login?.needsCode) {
      return (
        <>
        <Button asChild variant="outline" className="w-fit border-white/10 bg-white/5 hover:bg-white/10">
        <a href={login.url} target="_blank" rel="noopener noreferrer">
        Open sign-in page
        </a>
        </Button>
        <p className="text-muted-foreground">Sign in on Anthropic's page, then paste the code it shows you.</p>
        <form
        className="flex flex-wrap gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          submitCode.mutate(code.trim())
        }}
        >
        <Input
        className="max-w-xs bg-white/5 border-white/10 focus:border-white/30 focus:bg-white/10 transition-colors"
        autoComplete="off"
        placeholder="Code"
        aria-label="Code from the Claude sign-in page"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        />
        <Button type="submit" disabled={busy || code.trim().length === 0} className="bg-white text-black hover:bg-zinc-200">
        Submit code
        </Button>
        <Button type="button" variant="outline" onClick={cancel} className="border-white/10 bg-white/5 hover:bg-white/10">
        Cancel
        </Button>
        </form>
        </>
      )
    }
    if (login) {
      return (
        <>
        <Button asChild variant="outline" className="w-fit border-white/10 bg-white/5 hover:bg-white/10">
        <a href={login.url} target="_blank" rel="noopener noreferrer">
        Open sign-in page
        </a>
        </Button>
        <p className="text-muted-foreground">Enter this code on the OpenAI page:</p>
        <div className="flex items-center gap-3">
        <code className="font-mono text-lg font-semibold tracking-widest text-white">{login.userCode}</code>
        <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(login.userCode ?? "")} className="border-white/10 bg-white/5 hover:bg-white/10">
        Copy
        </Button>
        <Button variant="ghost" size="sm" onClick={cancel} className="hover:bg-white/10 hover:text-white">
        Cancel
        </Button>
        </div>
        <p className="text-xs text-muted-foreground">Waiting for you to approve the sign-in…</p>
        </>
      )
    }
    return (
      <>
      <p className="text-muted-foreground">
      {provider === "claude-cli" ? "Use your own Claude Pro or Max subscription." : "Use your own ChatGPT subscription."}
      </p>
      <Button className="w-fit bg-white text-black hover:bg-zinc-200" disabled={busy} onClick={() => start.mutate()}>
      Connect
      </Button>
      </>
    )
  }

  return (
    <div className="flex flex-col gap-2.5 px-6 py-5">
    <ConnectionHeader label={connection.label} connected={connection.connected} />
    <div className="flex flex-col gap-3">{body()}</div>
    {error && <Alert className="border-destructive/50 bg-destructive/10 text-destructive">{errorText(error)}</Alert>}
    </div>
  )
}
