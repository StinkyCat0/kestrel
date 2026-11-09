import type { DesktopState } from "@cloudagents/protocol"

/**
 * True when a box's desktops may stop for inactivity: at least one is up, nothing on the box is running, and the last
 * activity is at least `idleAfterMs` old. `idleAfterMs` of 0 disables the stop, and a desktop that has recorded no
 * activity since it started (`lastActivityAt` null) is never stopped.
 */
export const shouldStopIdleDesktops = (input: {
  readonly now: number
  readonly runs: number
  readonly viewers: number
  readonly recordings: number
  readonly lastActivityAt: number | null
  readonly activeDesktops: number
  readonly idleAfterMs: number
}): boolean =>
  input.idleAfterMs > 0 &&
  input.activeDesktops > 0 &&
  input.runs === 0 &&
  input.viewers === 0 &&
  input.recordings === 0 &&
  input.lastActivityAt !== null &&
  input.now - input.lastActivityAt >= input.idleAfterMs

/** The per-desktop clock: the last input event the desktop received, and when its last viewer left. */
export interface IdleInputClock {
  lastInputAt: number
}

/**
 * Records desktop input on the session clock. `ActivityTracker` sees HTTP requests and stream messages, but not the
 * input that drives a desktop (WebRTC data channels, `streamInput`), and a viewer leaving is the end of activity too:
 * both are noted here.
 */
export const noteDesktopInput = (clock: IdleInputClock, now: number): void => {
  clock.lastInputAt = now
}

/**
 * Records the end of a viewing session as activity: after the last viewer leaves, the idle window starts from then, so
 * hours of watching without input do not make the desktop look idle the moment it is closed. Departed viewers do not
 * move the clock, so a second viewer leaving shortly after does not extend it again.
 */
export const noteViewerLeft = (clock: IdleInputClock, viewers: number, now: number): void => {
  if (viewers === 0) clock.lastInputAt = now
}

/** When the desktop was last used, from the box's activity and the session's own input clock. */
export const lastDesktopActivity = (input: {
  readonly lastActivityAt: number | null
  readonly lastInputAt: number
}): number | null => (input.lastActivityAt === null ? input.lastInputAt : Math.max(input.lastActivityAt, input.lastInputAt))

/**
 * True when one session may stop for inactivity. On top of `shouldStopIdleDesktops`, the session must be live, have no
 * viewer attached and no agent-launched app still running: a running app may still be rendering even though no viewer
 * is watching, so it is left alone. The caller passes the session's exact viewer count (`sinks.size`).
 */
export const shouldStopIdleSession = (input: {
  readonly now: number
  readonly state: DesktopState
  readonly runs: number
  readonly viewers: number
  readonly recordings: number
  readonly runningApps: number
  readonly lastActivityAt: number | null
  readonly lastInputAt: number
  readonly idleAfterMs: number
}): boolean => {
  if (input.state !== "starting" && input.state !== "running") return false
  if (input.runningApps > 0) return false
  return shouldStopIdleDesktops({
    now: input.now,
    runs: input.runs,
    viewers: input.viewers,
    recordings: input.recordings,
    activeDesktops: 1,
    lastActivityAt: lastDesktopActivity(input),
    idleAfterMs: input.idleAfterMs,
  })
}

/** What the idle stop loop knows about the box; the manager adds each session's own state. */
export interface IdleTaskQuery {
  readonly now: number
  readonly runs: number
  readonly recordings: number
  readonly lastActivityAt: number | null
  readonly idleAfterMs: number
}
