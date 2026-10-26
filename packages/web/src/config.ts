declare global {
  interface Window {
    /** Injected by a future Electron preload script before the page loads. */
    cloudagents?: { serverUrl?: string }
  }
}

const DEFAULT_SERVER_URL = "http://127.0.0.1:8787"

const shellUrl: string | undefined = typeof window === "undefined" ? undefined : window.cloudagents?.serverUrl
const buildUrl: string | undefined = import.meta.env.VITE_CLOUDAGENTS_SERVER

/** HTTP base URL of the cloudagents server, without a trailing slash. */
export const SERVER_URL: string = (shellUrl || buildUrl || DEFAULT_SERVER_URL).replace(/\/+$/, "")

/** WebSocket base URL derived from SERVER_URL (http -> ws, https -> wss). */
export const WS_URL: string = SERVER_URL.replace(/^http/, "ws")
