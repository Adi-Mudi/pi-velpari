---
slug: cli-todo
title: Build a CLI todo list manager
---

# Golden Mission — CLI Todo List Manager

> Fixed golden-mission fixture for the velpari quality evals (Phase C).
> Never generated on the fly — this file is the mission input, committed so
> score meaning stays stable across time.

## Mission

Build a CLI todo list manager.

## Scope Boundaries

- **In scope:** four commands — `add`, `list`, `done`, `delete`.
- **Storage:** a single local file (no server, no database engine).
- **Out of scope:** network access, authentication, multi-user sync, GUI/TUI, reminders.
- **Runtime:** a single local process; no background daemon.

## Expected Core Capabilities

Used only as reviewer context — **never** as pass/fail assertions (G3 tolerance).

1. **add** — append a new task with a short description.
2. **list** — print every task with its completion state.
3. **done** — mark one task complete by id.
4. **delete** — remove one task by id.
5. **persist** — tasks survive a process restart via the local file.
