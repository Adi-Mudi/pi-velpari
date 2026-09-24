# Velpari Sequence — Finalized Specification

Status: **finalized 2026-09-20** — this folder is the single source of truth for the
pi_velpari (pre-production) sequence. It is the *target specification*: the code is
upgraded to match it afterward (sequence first, code second). Deltas between this
spec and the current implementation are listed in `09-migration-notes.md`.

Scope: Velpari covers **pre-production only**. Production and post-production belong
to Senai. Velpari ends by handing a validated requirements package to Senai.

## Reading order

| # | Document | What it defines |
|---|---|---|
| — | `README.md` (this file) | Master flow, stage rhythm, decision map |
| 0 | `00-visual-flow.md` | Diagram atlas — the whole sequence visually |
| 1 | `01-first-run-sequence.md` | Strict first-time workflow, all 10 stages, transition table |
| 2 | `02-revision-workflows.md` | The 3 execution modes for updates/upgrades |
| 3 | `03-staleness-and-validation.md` | Freshness stamps, stale-set, 3-layer content validation |
| 4 | `04-brainstorm-and-locking.md` | Brainstorm-anytime, dynamic transition lock, self-healing |
| 5 | `05-sub-agent-generation.md` | Per-phase dynamic sub-agent generation |
| 6 | `06-artifact-formats.md` | Per-kind artifact format strategy |
| 7 | `07-state-and-locking-files.md` | Control files in `.pi/velpari/`, config-sized rule |
| 8 | `08-command-reference.md` | Full command surface + transitions |
| 9 | `09-migration-notes.md` | Deltas vs current implementation (bridge to code work) |

## The 4 phases (finalized)

| Phase | Name | Stages | Question it answers |
|---|---|---|---|
| 1 | **Discovery** | Brainstorm | What are we really building? |
| 2 | **Requirements** | PRD → RTM → Feasibility | What exactly must it do, and is it viable? |
| 3 | **Design** | Architecture → Atomic Functions → Pseudocode | How will we build it? |
| 4 | **Validation & Handoff** | Test Plan → Development Order → Final Design → Handoff | Prove it, order it, ship the spec |

Feasibility stays inside Phase 2 (finalized). On first runs it is mandatory; on
revision runs the staleness system decides whether it must be re-run — no separate
phase, no bent rules.

> **Phase 11 (Q3) reading note:** each `PUBLISH: Doc/…` line in the diagram
> below names the store kind a stage publishes. The default publish is
> DB-only — the store DB under `Doc/store/<project>/` (+ the YAML export
> beside it) is the source and `Doc/` markdown is written only for legacy
> projects or with `"velpari": {"markdownWrites": true}` in `files.json`.
> Read `PUBLISH:` as "the artifact lands in the store; this is its view path"
> (`/velpari-export` + the `show` commands render it on demand).

## Master end-to-end flow

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ ONE-TIME SETUP (first run; works on an empty project)                   │
│ /velpari-configure-inputs → (optional) configure-requirements,          │
│ configure-standards, configure-agents                                   │
└─────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ GENERATE PHASE 1 AGENTS → doctor validate                               │
│ Input: mission + files.json + technology resources (no artifacts yet)   │
└─────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
╔═════════════════════════════════════════════════════════════════════════╗
║ PHASE 1 — DISCOVERY                                                     ║
║ /velpari-brainstorm → /velpari-approve-brainstorm                       ║
║ PUBLISH: Doc/brainstorm/brainstorm-<topic>.md                           ║
╚═════════════════════════════════════════════════════════════════════════╝
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ GENERATE PHASE 2 AGENTS → doctor validate                               │
│ Input: PUBLISHED brainstorm notes (Doc/ only) + files.json              │
└─────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
╔═════════════════════════════════════════════════════════════════════════╗
║ PHASE 2 — REQUIREMENTS                                                  ║
║ /velpari-prd → approve        PUBLISH: Doc/requirements/PRD_<proj>.md   ║
║ /velpari-rtm → approve        PUBLISH: Doc/requirements/RTM_<proj>.md   ║
║ /velpari-feasibility → approve                                          ║
║        PUBLISH: Doc/feasibility/feasibility-study_<proj>.md             ║
╚═════════════════════════════════════════════════════════════════════════╝
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ GENERATE PHASE 3 AGENTS → doctor validate                               │
│ Input: PUBLISHED PRD + RTM + feasibility (language now known)           │
└─────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
╔═════════════════════════════════════════════════════════════════════════╗
║ PHASE 3 — DESIGN                                                        ║
║ /velpari-architecture-generator → approve                               ║
║        PUBLISH: Doc/design/design_<proj>.md                             ║
║ /velpari-atomic-function → approve                                      ║
║        PUBLISH: Doc/atomic-functions/atomic-functions_<proj>.md         ║
║ /velpari-pseudocode → approve                                           ║
║        PUBLISH: Doc/pseudocode/pseudocode_<proj>.md                     ║
╚═════════════════════════════════════════════════════════════════════════╝
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ GENERATE PHASE 4 AGENTS → doctor validate                               │
│ Input: PUBLISHED design + atomic-functions + pseudocode (+ all earlier) │
└─────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
╔═════════════════════════════════════════════════════════════════════════╗
║ PHASE 4 — VALIDATION & HANDOFF                                          ║
║ /velpari-testplan → approve                                             ║
║        PUBLISH: Doc/tests/test-plan_<proj>.md + test-cases_<proj>.md    ║
║ /velpari-development-order → approve                                    ║
║        PUBLISH: Doc/development-order/development-order_<proj>.md       ║
║ /velpari-final-design → approve                                         ║
║        PUBLISH: Doc/design/final-design_<proj>.md                       ║
╚═════════════════════════════════════════════════════════════════════════╝
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ FINAL VALIDATION + HANDOFF                                              │
│ /velpari-doctor full audit (incl. staleness: nothing stale allowed)     │
│ /velpari-handoff → .pi/senai/architect-inputs.json                      │
└─────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
                ┌───────────────────────────────┐
                │ PRODUCTION — SENAI (out of    │
                │ pi_velpari scope)             │
                └───────────────────────────────┘
```

## The per-stage rhythm (every stage, every run)

1. **RUN** — stage command validates the transition lock (correct stage? inputs
   present and fresh?) and spawns its sub-agent team (scouts + verifier/reviewer).
2. **DRAFT** — working copy written to `.IDE_Plans/velpari/runs/<run-id>/<stage>/`.
   Writes outside the run folder are hard-blocked while a draft is open.
3. **PREVIEW** — the draft is shown to the developer: yes / fix.
4. **PUBLISH** — the publish tool (or per-stage `/velpari-<stage>-approve` fallback)
   runs: publish gate (incl. content validation layers) → atomic write to `Doc/` →
   full doctor audit. Errors OR warnings = nothing publishes, stage does not advance.
5. **NEXT** — the orchestrator surfaces the single correct next command. The
   developer types it by hand. No auto-chains, ever.

## Locked decisions → where they are defined

| Locked decision | Defined in |
|---|---|
| 4 phases, 10 stages, feasibility inside Phase 2 | this file, `01` |
| First-run strict sequence, cross-session resume | `01` |
| 3 execution modes; skip stages, never skip staleness | `02` |
| Freshness stamps + stale-set + revise-or-reconfirm | `03` |
| 3-layer content validation (hash / ID coverage / semantic agents) | `03`, `05` |
| Brainstorm anytime; two-door lock; self-healing routing | `04` |
| Per-phase dynamic sub-agent generation (published-only inputs) | `05` |
| Per-kind formats (Markdown+frontmatter / YAML sidecar / internal JSON / Mermaid) | `06` |
| Lock + state in `.pi/velpari/`, config-sized control files | `07` |
| Command surface + transition table | `08` |
| Sequence first, code second | `09` |
