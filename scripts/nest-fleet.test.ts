import { describe, expect, test } from "bun:test"
import { boxNameFor, hostFor, parseDeleteOptions, parseSyncOptions, parseUsers } from "./nest-fleet"

const syncArgs = [
  "--users",
  "alice,bob",
  "--domain",
  "nest.example.com",
  "--cookie",
  "session-value",
]

describe("nest fleet naming", () => {
  test("makes a DNS label and host per user", () => {
    const name = boxNameFor("Alice_1")
    expect(name).toMatch(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/)
    expect(name.length).toBeLessThanOrEqual(50)
    expect(hostFor("alice", "nest.example.com")).toBe(`${boxNameFor("alice")}.nest.example.com`)
  })

  test("keeps sanitized collisions distinct", () => {
    expect(boxNameFor("a_b")).not.toBe(boxNameFor("a-b"))
  })

  test("reads comma, newline and commented user lists", () => {
    expect(parseUsers("alice, bob\n# skip\ncarol\n")).toEqual(["alice", "bob", "carol"])
  })
})

describe("nest fleet options", () => {
  test("accepts a sync with users, domain and cookie", () => {
    const options = parseSyncOptions(syncArgs)
    expect(options.users).toEqual(["alice", "bob"])
    expect(options.domain).toBe("nest.example.com")
    expect(options.cookie).toBe("session=session-value")
    expect(options.controlUrl).toBe("https://app.kestrel-agent.com")
    expect(options.apply).toBe(false)
  })

  test("requires a domain, users and a cookie", () => {
    expect(() => parseSyncOptions(["--users", "alice", "--domain", "nest.example.com"])).toThrow("--cookie")
    expect(() => parseSyncOptions(["--users", "alice", "--cookie", "x"])).toThrow("--domain")
    expect(() => parseSyncOptions(["--domain", "nest.example.com", "--cookie", "x"])).toThrow("--users")
  })

  test("parses delete options", () => {
    const options = parseDeleteOptions(["--users", "alice", "--cookie", "x", "--purge"])
    expect(options.users).toEqual(["alice"])
    expect(options.purge).toBe(true)
    expect(options.namespace).toBe("kestrel-nest")
  })
})
