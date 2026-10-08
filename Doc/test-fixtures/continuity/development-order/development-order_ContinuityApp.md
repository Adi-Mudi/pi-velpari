---
artifact: development-order
project: ContinuityApp
version: 1
status: published
stage: ordering-development
run: continuity
created: 2026-09-28T00:00:00.000Z
updated: 2026-09-28T00:00:00.000Z
bump: patch
---

# Development Order — ContinuityApp

## Order

1. Step S-1 (storage): implement addTodo — AFs: AF-01
2. Step S-2 (export): implement exportCsv — depends on S-1 — AFs: AF-02
3. Step S-3 (sync): implement syncTodos — depends on S-1 — AFs: AF-03

## Rationale

Storage first (foundation), then export and sync in parallel lanes.

## Change Log

- 2026-09-28: continuity fixture development order.
