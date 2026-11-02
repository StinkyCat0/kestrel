/** The custom protocol the control plane uses to hand a finished sign-in back to the desktop app. */
export const CALLBACK_SCHEME = "kestrel-desktop"

/** `kestrel-desktop://auth-callback?session=<id>` -> the session id, or null for anything else. */
export const parseCallback = (value: string): string | null => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== `${CALLBACK_SCHEME}:` || url.hostname !== "auth-callback") return null
  const session = url.searchParams.get("session")
  return session === null || session === "" ? null : session
}

/** The control-plane URL that starts GitHub sign-in and returns through the desktop callback. */
export const loginUrl = (controlUrl: string): string =>
  `${controlUrl.replace(/\/+$/, "")}/auth/github/login?return=${encodeURIComponent("/auth/desktop-callback")}`

/** A same-origin path from `?return=`, never an absolute or protocol-relative URL. */
export const safeLocalPath = (value: string | null): string =>
  value !== null && value.startsWith("/") && !value.startsWith("//") ? value : "/"
