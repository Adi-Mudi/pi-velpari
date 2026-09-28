# Brainstorm Notes — Continuity dry run

## Mission

Run the pi-velpari post-rollout continuity dry-run against the shipped
sequence: a todo CLI with sync must publish every stage end-to-end without a
single manual state edit outside the documented workarounds.

## Interview Answers

- Q: Scope? A: CLI todo app with file-backed storage first, sync later (Phase 2).
- Q: Tier? A: ISO/IEC 29110 Basic, IEC 62304 class A, no SIL.
- Q: Runner? A: node --test.

## Scout Proposals

- code: no existing codebase — greenfield fixture.
- doc: no external documents — brainstorm notes are the sole seed.
- community: skipped (Tier-1 deterministic run, no web consent).

## Decision Summary

| Question | State | Outcome |
|---|---|---|
| — | agreed | no open decisions; deterministic fixture |

<!-- pi-velpari decisions:start -->
<!-- pi-velpari decisions:end -->

## Agreed

- Build the todo CLI with local storage and a CSV export.
- Keep the run deterministic: no LLM scouts, mock ctx/pi surfaces only.

## Not wanted

- Web search and community scans (consent not granted for the dry run).
- Reuse scan / spikes (decision: build, language: typescript).

## Open

- None. All questions are terminal.
