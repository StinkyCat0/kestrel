import { expect, test } from "bun:test"
import { evidenceBranch, evidenceCommentBody, evidencePath } from "./evidence"

test("evidence branch names one pull request and no code branch", () => {
  expect(evidenceBranch(7)).toBe("kestrel-evidence/pr-7")
  expect(evidenceBranch(7)).not.toBe("main")
})

test("evidence paths carry a sanitized task id and a unique capture timestamp", () => {
  expect(evidencePath("task-1", 7, 1_700_000_000_000)).toBe(".kestrel/evidence/task-1/7-1700000000000.png")
  const sanitized = evidencePath("team/../My Task!", 7, 1_700_000_000_000)
  expect(sanitized).toBe(".kestrel/evidence/team-..-My-Task/7-1700000000000.png")
  expect(sanitized.startsWith(".kestrel/evidence/")).toBe(true)
  expect(sanitized.split("/")).not.toContain("..")
  expect(evidencePath("", 7, 1)).toBe(".kestrel/evidence/task/7-1.png")
  expect(evidencePath("task-1", 7.9, -1)).toBe(".kestrel/evidence/task-1/7-0.png")
})

test("the evidence comment shows the blob raw with the caption and provenance", () => {
  const body = evidenceCommentBody({
    caption: "Settings dialog\nopen",
    htmlUrl: "https://github.com/jarenm1/kestrel/blob/kestrel-evidence/pr-7/.kestrel/evidence/task-1/7-1.png",
    taskId: "task-1",
    capturedAt: "2026-11-09T00:00:00.000Z",
  })
  expect(body).toContain(
    "![Settings dialog open](https://github.com/jarenm1/kestrel/blob/kestrel-evidence/pr-7/.kestrel/evidence/task-1/7-1.png?raw=true)",
  )
  expect(body).toContain("task `task-1`")
  expect(body).toContain("captured 2026-11-09T00:00:00.000Z")
  expect(body).not.toContain("\nopen")
})

test("a blank or bracket-bearing caption cannot break the markdown image", () => {
  const blank = evidenceCommentBody({ caption: "  ", htmlUrl: "https://github.com/a/b/blob/x/y.png", taskId: "t", capturedAt: "now" })
  expect(blank.startsWith("![Desktop screenshot](https://github.com/a/b/blob/x/y.png?raw=true)")).toBe(true)

  const bracketed = evidenceCommentBody({ caption: "[draft] fix", htmlUrl: "https://github.com/a/b/blob/x/y.png", taskId: "t", capturedAt: "now" })
  expect(bracketed.startsWith("![\\[draft\\] fix](")).toBe(true)
})
