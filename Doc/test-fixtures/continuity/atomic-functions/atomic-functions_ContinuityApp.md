---
artifact: atomic-functions
project: ContinuityApp
version: 1
status: published
stage: analyzing-atomic-functions
run: continuity
created: 2026-09-28T00:00:00.000Z
updated: 2026-09-28T00:00:00.000Z
bump: patch
---

# Atomic Functions — ContinuityApp

## Functions

| AF ID | Name | Signature | Tier | Criticality | SIL | Leaf |
|---|---|---|---|---|---|---|
| AF-01 | addTodo | addTodo(title: string): id | basic | A | none | yes |
| AF-02 | exportCsv | exportCsv(todos: Todo[]): string | basic | A | none | yes |
| AF-03 | syncTodos | syncTodos(local: Todo[]): Promise<void> | basic | A | none | yes |

## Helper Functions

- `loadTodos()` — reads and validates the storage file (helper, not an atomic).

## Change Log

- 2026-09-28: continuity fixture atomic functions.
