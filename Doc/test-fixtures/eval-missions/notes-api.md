---
slug: notes-api
title: Build a small notes HTTP API
---

# Golden Mission — Small Notes HTTP API

> Fixed golden-mission fixture for the velpari quality evals (Phase C).
> Never generated on the fly — this file is the mission input, committed so
> score meaning stays stable across time.

## Mission

Build a small notes HTTP API.

## Scope Boundaries

- **In scope:** CRUD endpoints — create, read, update, delete a note.
- **Storage:** in-memory or a single local file (no database server).
- **Out of scope:** authentication, multi-user accounts, full-text search, websockets, rate limiting.
- **Runtime:** a single local process; JSON request/response bodies.

## Expected Core Capabilities

Used only as reviewer context — **never** as pass/fail assertions (G3 tolerance).

1. **create** — `POST /notes` stores a note and returns its id.
2. **read** — `GET /notes/:id` returns one note; `GET /notes` lists all.
3. **update** — `PUT`/`PATCH /notes/:id` changes a note's text.
4. **delete** — `DELETE /notes/:id` removes a note.
5. **errors** — unknown ids return a clean 404 with a JSON body.
