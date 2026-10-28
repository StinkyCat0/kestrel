import { useEffect, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { NavLink, Route, Routes } from "react-router-dom"
import { api, ApiError, onUnauthorized } from "@/api/client"
import { queries } from "@/api/queries"
import { BoxPill } from "@/components/BoxStatus"
import { Alert } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ConnectionsPage } from "@/pages/ConnectionsPage"
import { KestrelIcon, LandingPage } from "@/pages/LandingPage"
import { PricingPage } from "@/pages/PricingPage"
import { RepoPage } from "@/pages/RepoPage"
import { ReposPage } from "@/pages/ReposPage"
import { TaskPage } from "@/pages/TaskPage"
import { errorText } from "@/util"

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
cn(
  "rounded-md px-2.5 py-1 text-muted-foreground transition-colors hover:text-foreground",
   isActive && "bg-secondary text-foreground",
)

export function App() {
  const me = useQuery(queries.me())
  const [expired, setExpired] = useState(false)

  useEffect(() => onUnauthorized(() => setExpired(true)), [])

  const signedOut = expired || (me.error instanceof ApiError && me.error.status === 401)

  // Handle signed-out state routing
  if (signedOut) {
    if (window.location.pathname === "/pricing") {
      return <PricingPage />
    }
    return <LandingPage />
  }

  if (me.isPending) return <div className="p-5 text-muted-foreground flex items-center justify-center h-full">Loading…</div>
    if (me.isError) {
      return (
        <div className="p-5 flex items-center justify-center h-full">
        <Alert className="max-w-md">{errorText(me.error)}</Alert>
        </div>
      )
    }

    return (
      <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-white/10 bg-card/60 backdrop-blur-md px-6">
      {/* Clickable Logo taking user to home screen */}
      <NavLink to="/" className="flex items-center gap-2 font-bold text-lg tracking-tight hover:text-primary transition-colors">
      <KestrelIcon className="w-5 h-5" />
      Kestrel
      </NavLink>
      <nav className="flex gap-1 ml-4">
      <NavLink to="/" end className={navLinkClass}>
      Repos
      </NavLink>
      <NavLink to="/connections" className={navLinkClass}>
      Connections
      </NavLink>
      <NavLink to="/pricing" className={navLinkClass}>
      Pricing
      </NavLink>
      </nav>
      <div className="ml-auto flex items-center gap-3">
      <BoxPill />
      <img className="rounded-full border border-white/10" src={me.data.avatarUrl} alt="" width={24} height={24} />
      <span className="text-sm font-medium text-muted-foreground">{me.data.login}</span>
      <SignOutButton />
      </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col bg-background">
      <Routes>
      <Route path="/" element={<ReposPage />} />
      <Route path="/connections" element={<ConnectionsPage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/repos/:repoId" element={<RepoPage />} />
      <Route path="/tasks/:taskId" element={<TaskPage />} />
      <Route path="*" element={<div className="p-5 text-muted-foreground flex items-center justify-center h-full">Not found.</div>} />
      </Routes>
      </main>
      </div>
    )
}

function SignOutButton() {
  const signOut = useMutation({
    mutationFn: api.logout,
    onSettled: () => window.location.reload(),
  })

  return (
    <Button variant="outline" size="sm" disabled={signOut.isPending} onClick={() => signOut.mutate()} className="border-white/10 hover:bg-white/10">
    Sign out
    </Button>
  )
}
