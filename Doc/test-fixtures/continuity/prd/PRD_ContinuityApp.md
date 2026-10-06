---
artifact: PRD
project: ContinuityApp
version: 1
status: draft
stage: drafting-prd
run: continuity
created: 2026-09-28T00:00:00.000Z
updated: 2026-09-28T00:00:00.000Z
documentType: PSRS
profile: core-psrs-v1
profileVersion: 1
mission: Continuity dry-run
projectName: ContinuityApp
bump: patch
---

# PRD — ContinuityApp

## Objective

Deliver a deterministic todo CLI that proves the pi-velpari continuity chain:
every stage publishes, advances, and audits clean.

## Problem

Teams lose traceability when tooling silently breaks stage transitions; this
project exists to exercise the full sequence end-to-end.

## System Actors

- Local user (terminal)
- Sync service (Phase 2, out of MVP)

## User Stories

- As a user I can add, list, and complete todos from the terminal.
- As a user I can export my todos as CSV.

## Scope

CLI binary with file-backed storage; sync and GUI are later phases.

## MVP

- Local todo CRUD
- CSV export

## Success Metrics

- Full continuity chain publishes without a manual state edit.
- Doctor reports zero errors after every publish.

## Phases

- Phase 1: local CLI (MVP)
- Phase 2: sync

## Functional Requirements

| ID | Requirement | Priority | Phase | Acceptance | Verification | Status |
|---|---|---|---|---|---|---|
| FR-01 | The system SHALL store todos locally. | must | 1 | stored once | unit test | proposed |
| FR-02 | The system SHALL sync todos across devices. | must | 2 | sync completes | integration test | proposed |
| FR-03 | The system SHALL export todos as CSV. | should | 1 | file downloads | integration test | proposed |

## Non-Functional Requirements

| ID | Category | Requirement | Phase | Verification | Status |
|---|---|---|---|---|---|
| NFR-01 | performance | Sync SHALL complete within 2 seconds. | 1 | load test | proposed |
| NFR-02 | usability | A todo SHALL be addable in under 3 clicks. | 2 | usability review | proposed |

## Data and Interfaces

- Storage: JSON file in `~/.continuityapp/todos.json`.
- Export: RFC 4180 CSV to stdout or file.

## Errors and Edge Cases

- Corrupt storage file → refuse to start with a clear message.
- Empty todo list → export writes only the header row.

## Constraints

- Single-binary CLI, no daemon.
- Must run on Linux arm64.

## Dependencies and Risks

- Node.js runtime only; no external services in Phase 1.

## Out of Scope

- Web UI, mobile clients, real-time collaboration.

## Open Questions

- None blocking; sync protocol decided in Phase 2.

## Acceptance Criteria

- FR-01, FR-03 behaviors covered by automated tests.
- Continuity dry run reaches `handoff-ready`.

## Helper Function Candidates

- `loadTodos()` — read + validate the storage file.
- `exportCsv(todos)` — render RFC 4180 output.

## Glossary

- Todo: a single task record with id, title, done flag.

## Change Log

- 2026-09-28: initial PSRS draft for the continuity dry run.
