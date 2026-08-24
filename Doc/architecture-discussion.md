# Architecture Discussion

A study-only document. No recommendations are made here. The purpose is to:

1. Catalog architecture patterns from Pi, Senai, and the broader community that are relevant to Velpari's design.
2. List pending decisions about Velpari's own architecture that need to be resolved before code is written.

This doc is a starting point for future architecture conversations. It is **not** a design proposal.

---

## 1. Pi's architecture

Pi is the host runtime that loads Velpari as an extension. Pi's own architecture (per `Pi-Orchestra_v4/.pi/architecture-library/pi-architecture.md`) is a **layered monorepo**:

- **Extension host layer** — loads extensions via `package.json`'s `pi.extensions` field, dispatches slash commands, manages UI state, handles compaction.
- **Tool layer** — built-in tools (file read/write, shell exec, web fetch).
- **Subagent layer** — optional via `pi-interactive-subagents`; manages subagent lifecycle.
- **LLM client layer** — talks to model providers; handles streaming, retries, cancellation.
- **Persistence layer** — session history, run state, doctor reports.

Velpari sits in the **extension host layer** as a peer to other Pi extensions (including Senai). Velpari does not own any other layer; it interacts with Pi's API surface and writes files to the project directory.

**For Velpari:** the layered-monorepo model is the host's concern, not ours. Our architecture sits inside one extension and is bounded by Pi's extension API.

---

## 2. Senai's architecture library

`Pi-Orchestra_v4/.pi/architecture-library/` contains 16 architecture patterns that Senai's architecture factory can match against when generating an architecture for a project. They are listed below by name only — full study is deferred.

| Pattern | Source file |
|---|---|
| Clean architecture | `clean-architecture.md` |
| CQRS | `cqrs.md` |
| Embedded IoT | `embedded-iot.md` |
| Event-driven | `event-driven.md` |
| Google Apps Script | `google-apps-script.md` |
| Hexagonal | `hexagonal.md` |
| Layered | `layered-architecture.md` |
| Microkernel | `microkernel.md` |
| Microservices | `microservices.md` |
| Modular monolith | `modular-monolith.md` |
| Monolith | `monolith.md` |
| Pi-architecture | `pi-architecture.md` (covered in §1) |
| Pipeline | `pipeline.md` |
| PLC SCADA | `plc-scada.md` |
| Serverless | `serverless.md` |
| SOA | `soa.md` |
| Space-based | `space-based.md` |

Senai's architecture factory uses these patterns to generate project-specific architecture agents and skills. The library itself is project-agnostic — it's a reference catalog.

**For Velpari:** these patterns are Senai's input space, not ours. Velpari does not need to study them deeply. The library is referenced because the architecture-discussion doc is the right place to acknowledge it.

---

## 3. Community architecture patterns

A broader survey of common architecture patterns, listed by name. Each is well-documented elsewhere; this section is just an index, not a study.

- **Clean architecture** — separation of concerns via concentric layers (entities, use cases, interface adapters, frameworks).
- **Hexagonal architecture** (ports and adapters) — application core isolated from external concerns via ports (interfaces) and adapters (implementations).
- **CQRS** (Command Query Responsibility Segregation) — separate models for reads and writes.
- **Event-driven architecture** — components communicate via events; loose coupling.
- **Microkernel architecture** — core system + plug-in modules loaded at runtime.
- **Microservices** — independently deployable services, each owning a bounded context.
- **Modular monolith** — single deployment with strong internal module boundaries.
- **Monolith** — single deployment with no enforced module boundaries.
- **Pipeline architecture** — data flows through a sequence of filters/transformers.
- **Serverless** — functions as a service, stateless, event-triggered.
- **SOA** (Service-Oriented Architecture) — services with shared contracts and governance.
- **Space-based architecture** — distributed in-memory data grids + processing units.

**For Velpari:** none of these are direct architectural choices for Velpari itself. Velpari is a single-process extension; it has no deployment unit, no service boundary, no event bus. The patterns are listed because they describe *what Velpari's output helps produce*, not what Velpari is.

---

## 4. Open questions specific to Velpari's own architecture

These are not answered here. They are tracked in §"Pending decisions" below.

1. **How should scout agent files be stored and discovered?** Bundle defaults + project overrides (like Senai)? User-defined in `.pi/velpari/`?
2. **Should the scout agent invocation be a generic helper (`spawnScout(name, input, api)`) or 12 specific functions?** Tradeoff between DRY-ness and explicit-per-stage type safety.
3. **Should the discussion stage's DECISION AGENT (which mutates PRD) be sandboxed differently from the read-only scouts (AF/DO)?** The DECISION AGENT has write side effects; the AF/DO scouts only propose.
4. **Should Velpari keep its own `state.json` schema or piggyback on Senai's?** Currently they are independent. Could share some fields.
5. **Should the per-command gate be a generic `checkDocScope(command, rootDir)` helper or per-command bespoke functions?** Same tradeoff as #2.

---

## 5. Pending decisions

This is the actionable list. Each pending decision should be resolved before it becomes a code requirement. None are blockers for v1.4 doc updates; all are tracked here for future architecture conversations.

### Sub-agent decisions (from `Doc/velpari-sequence.md` §"Sub-agent inventory")

1. **Should sub-agents be configurable per project?** (Senai-style agent config.) — **pending**
2. **Should sub-agents be generated automatically or hand-written?** — **pending**
3. **Where should sub-agent files live?** `.pi/velpari/scouts/` (Velpari-owned) vs `.pi/agents/` (shared with Senai) — **pending**
4. **Should the discussion stage's 4 subagents be merged with the post-pipeline scouts (so all 12 use the same scaffolding)?** — **pending**
5. **How should the discussion stage's `decisionAgent` (which mutates PRD) be sandboxed vs the scout agents (which only read)?** — **pending**

### Velpari-specific decisions (from §4)

6. **How should scout agent files be stored and discovered?** — **pending**
7. **Generic vs specific scout invocation?** — **pending**
8. **DECISION AGENT sandboxing vs read-only scouts?** — **pending**
9. **Independent state.json vs shared with Senai?** — **pending**
10. **Generic gate helper vs per-command gate functions?** — **pending**

### Cross-cutting decisions

11. **How should we handle Senai schema drift long-term?** The handoff test reads Senai's source at test time. Is that robust enough, or should we pin to specific Senai versions? — **pending**
12. **Should Velpari ship its own doctor rules for cross-extension consistency?** (e.g., detect when Senai has changed but Velpari's handoff schema hasn't been updated.) — **pending**

---

## 6. How to use this document

This is a study-only doc. When a pending decision is resolved:

1. Move the decision from §"Pending decisions" to a new §"Resolved decisions" (added when first decision is resolved).
2. Update the relevant spec doc (`PRD.md`, `design.md`, `pseudocode.md`) with the resolution.
3. Add a CHANGELOG entry.
4. Update the per-command sub-sequence in `Doc/velpari-sequence.md` §11 if the resolution affects command behavior.

When a new question arises:

1. Add it to §4 "Open questions".
2. If it becomes a pending decision, add it to §5 "Pending decisions".

When a pattern is studied in depth:

1. Add a new section in §2 or §3 (or expand an existing one) with the study findings.
2. Cite sources.

This doc is meant to grow over time. It is the single source of truth for Velpari's architecture-pending state.
