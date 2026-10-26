import { useEffect, useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router-dom"
import type { Repo } from "@cloudagents/protocol"
import { api } from "../api/client"
import { errorText } from "../util"

export function ReposPage() {
  const navigate = useNavigate()
  const [repos, setRepos] = useState<readonly Repo[] | null>(null)
  const [url, setUrl] = useState("")
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    api.listRepos().then(
      (list) => {
        if (active) setRepos(list)
      },
      (e: unknown) => {
        if (active) setError(errorText(e))
      },
    )
    return () => {
      active = false
    }
  }, [])

  async function addRepo(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const repo = await api.addRepo({ url: url.trim(), name: name.trim() || undefined })
      navigate(`/repos/${repo.id}`)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <h1>Repositories</h1>
      <form className="row-form" onSubmit={(e) => void addRepo(e)}>
        <input
          type="url"
          required
          placeholder="Git clone URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" disabled={busy || url.trim() === ""}>
          {busy ? "Cloning…" : "Add repo"}
        </button>
      </form>
      {error && <div className="error">{error}</div>}
      {repos === null && !error && <div className="muted">Loading…</div>}
      {repos?.length === 0 && <div className="muted">No repositories yet.</div>}
      <ul className="list">
        {repos?.map((repo) => (
          <li key={repo.id}>
            <Link to={`/repos/${repo.id}`}>{repo.name}</Link>
            <span className="muted mono">{repo.url}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
