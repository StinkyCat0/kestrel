import { Link, Route, Routes } from "react-router-dom"
import { RepoPage } from "./pages/RepoPage"
import { ReposPage } from "./pages/ReposPage"
import { TaskPage } from "./pages/TaskPage"

export function App() {
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          cloudagents
        </Link>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<ReposPage />} />
          <Route path="/repos/:repoId" element={<RepoPage />} />
          <Route path="/tasks/:taskId" element={<TaskPage />} />
          <Route path="*" element={<div className="page muted">Not found.</div>} />
        </Routes>
      </main>
    </div>
  )
}
