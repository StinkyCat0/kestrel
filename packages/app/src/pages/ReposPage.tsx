import { useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "react-router-dom"
import { api } from "@/api/client"
import { keys, queries } from "@/api/queries"
import { BoxOfflineBanner, useBoxOffline } from "@/components/BoxStatus"
import { GithubPicker } from "@/components/GithubPicker"
import { Alert } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { AngledCard, AngledCardContent, AngledCardHeader, AngledCardTitle, AngledCardDescription } from "@/components/ui/angled-card"
import { Input } from "@/components/ui/input"
import { errorText } from "@/util"

export function ReposPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const offline = useBoxOffline()
  const repos = useQuery(queries.repos())
  const [url, setUrl] = useState("")
  const [name, setName] = useState("")

  const addRepo = useMutation({
    mutationFn: api.addRepo,
    onSuccess: (repo) => {
      void queryClient.invalidateQueries({ queryKey: keys.repos })
      navigate(`/repos/${repo.id}`)
    },
  })
  const busy = addRepo.isPending

  function addByUrl(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    addRepo.mutate({ url: url.trim(), name: name.trim() || undefined })
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 overflow-auto p-8">
    <div>
    <h1 className="text-2xl font-bold tracking-tight text-white">Repositories</h1>
    <p className="text-muted-foreground mt-1">Repos cloned onto your agent box.</p>
    </div>

    <BoxOfflineBanner />
    {addRepo.error && <Alert className="border-destructive/50 bg-destructive/10 text-destructive">{errorText(addRepo.error)}</Alert>}

    <AngledCard>
    <AngledCardHeader>
    <AngledCardTitle>Your repositories</AngledCardTitle>
    </AngledCardHeader>
    <AngledCardContent>
    {repos.isPending && <div className="text-muted-foreground">Loading…</div>}
    {repos.error && <Alert>{errorText(repos.error)}</Alert>}
    {repos.data?.length === 0 && <div className="text-muted-foreground">No repositories yet.</div>}
    <ul className="divide-y divide-white/5">
    {repos.data?.map((repo) => (
      <li key={repo.id} className="flex items-baseline gap-3 py-3">
      <Link to={`/repos/${repo.id}`} className="font-medium text-primary hover:underline hover:text-primary/80 transition-colors">
      {repo.name}
      </Link>
      <span className="truncate font-mono text-xs text-muted-foreground">{repo.url}</span>
      </li>
    ))}
    </ul>
    </AngledCardContent>
    </AngledCard>

    <AngledCard>
    <AngledCardHeader>
    <AngledCardTitle>Add from GitHub</AngledCardTitle>
    <AngledCardDescription>Your 100 most recently updated repositories.</AngledCardDescription>
    </AngledCardHeader>
    <AngledCardContent>
    <GithubPicker
    disabled={busy || offline}
    onPick={(repo) => addRepo.mutate({ url: repo.cloneUrl, name: repo.fullName })}
    />
    </AngledCardContent>
    </AngledCard>

    <AngledCard>
    <AngledCardHeader>
    <AngledCardTitle>Add by URL</AngledCardTitle>
    </AngledCardHeader>
    <AngledCardContent>
    <form className="flex flex-wrap gap-3" onSubmit={addByUrl}>
    <Input
    className="min-w-48 flex-1 bg-white/5 border-white/10 focus:border-white/30 focus:bg-white/10 transition-colors"
    type="url"
    required
    placeholder="Git clone URL"
    value={url}
    onChange={(e) => setUrl(e.target.value)}
    />
    <Input
    className="min-w-48 flex-1 bg-white/5 border-white/10 focus:border-white/30 focus:bg-white/10 transition-colors"
    placeholder="Name (optional)"
    value={name}
    onChange={(e) => setName(e.target.value)}
    />
    <Button type="submit" disabled={busy || offline || url.trim() === ""} className="bg-white text-black hover:bg-zinc-200">
    {busy ? "Cloning…" : "Add repo"}
    </Button>
    </form>
    </AngledCardContent>
    </AngledCard>
    </div>
  )
}
