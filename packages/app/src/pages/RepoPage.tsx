import { useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useParams } from "react-router-dom"
import type { Task } from "@cloudagents/protocol"
import { api } from "@/api/client"
import { keys, queries } from "@/api/queries"
import { BoxOfflineBanner } from "@/components/BoxStatus"
import { StatusBadge } from "@/components/StatusBadge"
import { Alert } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AngledCard, AngledCardContent } from "@/components/ui/angled-card"
import { errorText, formatTime } from "@/util"

export function RepoPage() {
  const { repoId = "" } = useParams()
  const queryClient = useQueryClient()
  const repo = useQuery(queries.repo(repoId))
  const tasks = useQuery(queries.repoTasks(repoId))
  const [title, setTitle] = useState("")

  const createTask = useMutation({
    mutationFn: (taskTitle: string) => api.createTask(repoId, { title: taskTitle || undefined }),
                                 onSuccess: (task) => {
                                   queryClient.setQueryData(keys.repoTasks(repoId), (list: readonly Task[] | undefined) => [
                                     task,
                                     ...(list ?? []).filter((t) => t.id !== task.id),
                                   ])
                                   setTitle("")
                                 },
  })

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    createTask.mutate(title.trim())
  }

  const error = createTask.error ?? repo.error ?? tasks.error

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 overflow-auto p-8">
    <div>
    <h1 className="text-2xl font-bold tracking-tight text-white">{repo.data?.name ?? "Repository"}</h1>
    {repo.data && <div className="font-mono text-xs text-muted-foreground mt-1">{repo.data.url}</div>}
    </div>

    <BoxOfflineBanner />

    <form className="flex gap-3 max-w-2xl" onSubmit={submit}>
    <Input
    className="flex-1 bg-white/5 border-white/10 focus:border-white/30 focus:bg-white/10 transition-colors"
    placeholder="Task title (optional)"
    value={title}
    onChange={(e) => setTitle(e.target.value)}
    />
    <Button type="submit" disabled={createTask.isPending} className="bg-white text-black hover:bg-zinc-200">
    {createTask.isPending ? "Creating…" : "New task"}
    </Button>
    </form>

    {error && <Alert className="border-destructive/50 bg-destructive/10 text-destructive">{errorText(error)}</Alert>}

    {tasks.data?.length === 0 && <div className="text-muted-foreground">No tasks yet.</div>}

    {tasks.data && tasks.data.length > 0 && (
      <AngledCard className="p-0 overflow-hidden">
      <Table>
      <TableHeader>
      <TableRow className="border-b border-white/10 hover:bg-transparent">
      <TableHead className="text-muted-foreground font-medium">Status</TableHead>
      <TableHead className="text-muted-foreground font-medium">Title</TableHead>
      <TableHead className="text-muted-foreground font-medium">Branch</TableHead>
      <TableHead className="text-muted-foreground font-medium text-right">Updated</TableHead>
      </TableRow>
      </TableHeader>
      <TableBody>
      {tasks.data.map((task) => (
        <TableRow key={task.id} className="border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors">
        <TableCell>
        <StatusBadge status={task.status} />
        </TableCell>
        <TableCell>
        <Link to={`/tasks/${task.id}`} className="font-medium text-primary hover:underline hover:text-primary/80 transition-colors">
        {task.title}
        </Link>
        </TableCell>
        <TableCell className="font-mono text-xs text-muted-foreground">{task.branch}</TableCell>
        <TableCell className="text-muted-foreground text-right text-sm">{formatTime(task.updatedAt)}</TableCell>
        </TableRow>
      ))}
      </TableBody>
      </Table>
      </AngledCard>
    )}
    </div>
  )
}
