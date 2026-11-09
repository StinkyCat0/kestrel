import { describe, expect, test } from "bun:test"
import {
  lastDesktopActivity,
  noteDesktopInput,
  noteViewerLeft,
  shouldStopIdleDesktops,
  shouldStopIdleSession,
  type IdleInputClock,
  type IdleTaskQuery,
} from "./idle"

const IDLE_MS = 1_800_000
const NOW = 10_000_000

const quiet = {
  now: NOW,
  runs: 0,
  viewers: 0,
  recordings: 0,
  lastActivityAt: NOW - IDLE_MS,
  activeDesktops: 1,
  idleAfterMs: IDLE_MS,
}

describe("shouldStopIdleDesktops", () => {
  test("a desktop with no work stops exactly when the idle window has passed", () => {
    expect(shouldStopIdleDesktops({ ...quiet, lastActivityAt: NOW - IDLE_MS + 1 })).toBe(false)
    expect(shouldStopIdleDesktops(quiet)).toBe(true)
    expect(shouldStopIdleDesktops({ ...quiet, lastActivityAt: NOW - IDLE_MS - 1 })).toBe(true)
  })

  test("a run, viewer or recording keeps every desktop up", () => {
    expect(shouldStopIdleDesktops({ ...quiet, runs: 1 })).toBe(false)
    expect(shouldStopIdleDesktops({ ...quiet, viewers: 1 })).toBe(false)
    expect(shouldStopIdleDesktops({ ...quiet, recordings: 1 })).toBe(false)
  })

  test("recent activity, no activity ever, no desktop and a disabled window all prevent the stop", () => {
    expect(shouldStopIdleDesktops({ ...quiet, lastActivityAt: NOW - 1 })).toBe(false)
    expect(shouldStopIdleDesktops({ ...quiet, lastActivityAt: null })).toBe(false)
    expect(shouldStopIdleDesktops({ ...quiet, activeDesktops: 0 })).toBe(false)
    expect(shouldStopIdleDesktops({ ...quiet, idleAfterMs: 0 })).toBe(false)
  })
})

describe("desktop activity clock", () => {
  test("the newer of box activity and desktop input is the desktop's last activity", () => {
    expect(lastDesktopActivity({ lastActivityAt: NOW - 10, lastInputAt: NOW - 20 })).toBe(NOW - 10)
    expect(lastDesktopActivity({ lastActivityAt: NOW - 20, lastInputAt: NOW - 10 })).toBe(NOW - 10)
    // A box that has seen no request keeps the desktop's own clock.
    expect(lastDesktopActivity({ lastActivityAt: null, lastInputAt: NOW - 10 })).toBe(NOW - 10)
  })

  test("a desktop input event moves the session's clock", () => {
    const session: IdleInputClock = { lastInputAt: NOW - IDLE_MS }
    noteDesktopInput(session, NOW - 1)
    expect(session.lastInputAt).toBe(NOW - 1)
    expect(lastDesktopActivity({ lastActivityAt: null, lastInputAt: session.lastInputAt })).toBe(NOW - 1)
  })

  test("the last viewer leaving resets the clock, so a long viewing session does not look stale", () => {
    const session: IdleInputClock = { lastInputAt: NOW - IDLE_MS * 2 }
    // Another viewer is still watching: the desktop is not newly active.
    noteViewerLeft(session, 1, NOW - 1)
    expect(session.lastInputAt).toBe(NOW - IDLE_MS * 2)
    // The viewer watched for hours without input, then left; the desktop is active again from that moment.
    noteViewerLeft(session, 0, NOW)
    expect(session.lastInputAt).toBe(NOW)
    const query: IdleTaskQuery = { now: NOW, runs: 0, recordings: 0, lastActivityAt: null, idleAfterMs: IDLE_MS }
    expect(
      shouldStopIdleSession({ ...query, state: "running", viewers: 0, runningApps: 0, lastInputAt: session.lastInputAt }),
    ).toBe(false)
  })
})

describe("shouldStopIdleSession", () => {
  const session = {
    now: NOW,
    state: "running" as const,
    runs: 0,
    viewers: 0,
    recordings: 0,
    runningApps: 0,
    lastActivityAt: NOW - IDLE_MS,
    lastInputAt: NOW - IDLE_MS,
    idleAfterMs: IDLE_MS,
  }

  test("a running desktop idle past the window with no viewer or app stops", () => {
    expect(shouldStopIdleSession(session)).toBe(true)
    expect(shouldStopIdleSession({ ...session, state: "starting" })).toBe(true)
  })

  test("a viewer, a running app, a run or a non-live desktop prevents the stop", () => {
    expect(shouldStopIdleSession({ ...session, viewers: 1 })).toBe(false)
    expect(shouldStopIdleSession({ ...session, runningApps: 1 })).toBe(false)
    expect(shouldStopIdleSession({ ...session, runs: 1 })).toBe(false)
    expect(shouldStopIdleSession({ ...session, state: "failed" })).toBe(false)
    expect(shouldStopIdleSession({ ...session, state: "stopped" })).toBe(false)
  })

  test("input newer than box activity keeps the desktop up", () => {
    expect(shouldStopIdleSession({ ...session, lastInputAt: NOW - 1 })).toBe(false)
    expect(shouldStopIdleSession({ ...session, lastActivityAt: null, lastInputAt: NOW - 1 })).toBe(false)
  })
})
