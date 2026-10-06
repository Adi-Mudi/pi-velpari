---
artifact: pseudocode
project: ContinuityApp
version: 1
status: published
stage: writing-pseudocode
run: continuity
created: 2026-09-28T00:00:00.000Z
updated: 2026-09-28T00:00:00.000Z
bump: patch
---

# Pseudocode — ContinuityApp

## Module: storage

### Block PC-01

- AF: AF-01
- Algorithm:
  1. validate title non-empty, else raise EmptyTitle
  2. id = nextId(todos)
  3. todos.append({ id, title, done: false })
  4. persist(todos)

### Block PC-02

- AF: AF-02
- Algorithm:
  1. header = "id,title,done"
  2. rows = todos.map(csvRow)
  3. return [header, ...rows].join("\n")

### Block PC-03

- AF: AF-03
- Algorithm:
  1. remote = fetchRemote()
  2. merged = mergeByPrecedence(remote, local)
  3. writeBack(merged)

## Complexity Notes

- storage O(1) amortized; sync O(n log n).

## Change Log

- 2026-09-28: continuity fixture pseudocode.
