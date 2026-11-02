import { useSearchParams } from "react-router-dom"
import { ControlPaths } from "@cloudagents/protocol"
import { KestrelMark } from "@/components/KestrelMark"
import { Button } from "@/components/ui/button"
import { SERVER_URL } from "@/config"
import { APP_HOME } from "@/routes"

/** Only allow same-origin paths, so a crafted `?return=` cannot redirect off-site after login. */
function safeReturn(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null
  return value
}

export function LoginPage() {
  const [searchParams] = useSearchParams()
  const returnPath = safeReturn(searchParams.get("return")) ?? APP_HOME
  const loginUrl = `${SERVER_URL}${ControlPaths.login}?return=${encodeURIComponent(returnPath)}`

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-[radial-gradient(ellipse_at_center,rgb(255_255_255/0.05),transparent_60%)] p-6 text-center">
      {/* The glow sits on a wrapper: a filter on the masked element itself would be clipped by the mask. */}
      <div className="drop-shadow-[0_0_24px_rgb(255_255_255/0.25)]">
        <KestrelMark className="h-16" />
      </div>
      <h1 className="sr-only">Kestrel</h1>
      <p className="max-w-md text-muted-foreground">
        Run your own agent harness in a sandboxed cloud box with a live desktop.
      </p>
      <div className="flex flex-col items-center gap-3">
        <Button asChild size="lg">
          <a href={loginUrl}>Sign in with GitHub</a>
        </Button>
        {/* Local stacks run with DEV_SESSION_LOGIN and usually no GitHub OAuth app; GitHub sign-in answers NotConfigured. */}
        {import.meta.env.DEV && (
          <Button asChild variant="soft" size="sm">
            <a href={`${SERVER_URL}/auth/dev-login?return=${encodeURIComponent(returnPath)}`}>Dev sign in</a>
          </Button>
        )}
      </div>
    </div>
  )
}
