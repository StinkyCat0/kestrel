import { motion } from "framer-motion"
import { useParams } from "react-router-dom"
import { BoxOfflineBanner } from "@/components/BoxStatus"
import { ChatPanel } from "@/components/ChatPanel"
import { DesktopViewer } from "@/components/DesktopViewer"
import { DiffPanel } from "@/components/DiffPanel"
import { StatusBadge } from "@/components/StatusBadge"
import { Alert } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useTaskState } from "@/hooks/useTaskState"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.1 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 300, damping: 24 }
  },
}

// Shared class for the 45-degree angled glass panels
const angledPanelClass = "rounded-none border border-white/10 bg-card/40 backdrop-blur-xl overflow-hidden [clip-path:polygon(0_0,100%_0,100%_calc(100%_-_16px),calc(100%_-_16px)_100%,0_100%)] hover:border-white/20 transition-all duration-300"

export function TaskPage() {
  const { taskId = "" } = useParams()
  return <TaskView key={taskId} taskId={taskId} />
}

function TaskView({ taskId }: { taskId: string }) {
  const state = useTaskState(taskId)
  const { task } = state

  return (
    <motion.div
    className="flex flex-col h-full w-full overflow-hidden"
    initial="hidden"
    animate="visible"
    variants={containerVariants}
    >
    <motion.div variants={itemVariants} className="px-4 pt-4">
    <BoxOfflineBanner />
    </motion.div>

    <motion.div
    variants={itemVariants}
    className="grid min-h-0 flex-1 grid-cols-[minmax(360px,1fr)_minmax(400px,1.5fr)] gap-4 p-4"
    >
    {/* Left Panel: Chat & Status */}
    <section className={`flex min-h-0 flex-col ${angledPanelClass}`}>
    <header className="flex items-center gap-3 border-b border-white/10 bg-white/5 px-5 py-3">
    <strong className="truncate text-base font-medium text-white">{task?.title ?? "Loading…"}</strong>
    {task && <StatusBadge status={task.status} />}
    {task && (
      <span className="ml-auto truncate font-mono text-xs text-muted-foreground bg-black/30 px-2 py-1 border border-white/5 [clip-path:polygon(0_0,100%_0,100%_calc(100%_-_8px),calc(100%_-_8px)_100%,0_100%)]">
      {task.branch}
      </span>
    )}
    </header>
    {state.error && (
      <Alert className="rounded-none border-x-0 border-t-0 border-destructive/50 bg-destructive/10 text-destructive">
      {state.error}
      </Alert>
    )}
    <div className="flex-1 overflow-hidden">
    <ChatPanel taskId={taskId} messages={state.messages} runs={state.runs} output={state.output} />
    </div>
    </section>

    {/* Right Panel: Desktop / Diff */}
    <section className={`flex min-h-0 flex-col ${angledPanelClass}`}>
    <Tabs defaultValue="desktop" className="flex flex-col h-full">
    <div className="border-b border-white/10 bg-white/5 px-4 py-2">
    <TabsList className="bg-transparent border border-white/10 p-1 h-9">
    <TabsTrigger
    value="desktop"
    className="data-[state=active]:bg-white/10 data-[state=active]:text-white transition-all"
    >
    Desktop
    </TabsTrigger>
    <TabsTrigger
    value="diff"
    className="data-[state=active]:bg-white/10 data-[state=active]:text-white transition-all"
    >
    Diff
    </TabsTrigger>
    </TabsList>
    </div>
    <TabsContent value="desktop" className="flex-1 overflow-hidden m-0 data-[state=active]:flex">
    <DesktopViewer taskId={taskId} />
    </TabsContent>
    <TabsContent value="diff" className="flex-1 overflow-hidden m-0 data-[state=active]:flex">
    <DiffPanel taskId={taskId} />
    </TabsContent>
    </Tabs>
    </section>
    </motion.div>
    </motion.div>
  )
}
