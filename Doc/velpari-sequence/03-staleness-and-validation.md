# 03 — Staleness & Content Validation

The enforcement core of the finalized sequence. This is how the orchestrator
answers: *"all documents exist from a previous run — but are they still in
sync?"* It exists to make one specific failure impossible:

> Developer updates the PRD, skips the intermediate stages, and proceeds to
> Development Order. The Dev-Order document doesn't contain the new feature.
> Every downstream document quietly disagrees with the PRD.

## The dependency chain (fixed)

Staleness propagates along one fixed chain — the stage order itself. Every
stage reads **all** prior published artifacts, so a republish at position N
potentially affects everything at positions > N.

```text
brainstorm → prd → rtm → feasibility → design → atomic-functions
→ pseudocode → testplan(+test-cases) → development-order → final-design → handoff
```

## Layer 1 — Freshness stamps (hash, in code)

**Mechanism.** Every published artifact records the SHA-256 hashes of its
input artifacts **at publish time**. Stamps live in the artifact's YAML
frontmatter (`inputs:` block) and are mirrored into the freshness manifest
(`.pi/velpari/freshness.json` — see `07-state-and-locking-files.md`).

```yaml
---
artifact: design
project: TodoApp
version: 1.2.0
inputs:
  prd: "sha256:9f2c…"
  rtm: "sha256:41ab…"
  feasibility: "sha256:77e0…"
---
```

**Stale-set computation.** When any artifact republishes, the orchestrator
recomputes: for every downstream artifact, does its recorded input hash still
equal the current input file's hash? No → that artifact is **STALE**. Because
the chain is fixed, the impacted set is computed automatically — no human
judgment needed to *find* the impacted documents. (This generalizes the
existing RTM fingerprint mechanism — PRD source hashes per RTM row — to every
artifact pair in the chain.)

**Blocking points (hard gates):**

1. A stage command refuses to start while any of its inputs is stale.
2. A publish refuses while any upstream artifact is stale.
3. `/velpari-handoff` refuses while **anything** in the chain is stale.

**Resolution per stale artifact** (details in `02-revision-workflows.md`):
**revise** (re-run the stage in update mode) or **re-confirm** ("reviewed, no
impact" + Change Log line + hash re-stamp, via `/velpari-reconfirm`).

**Normalized hashing (A5/D3).** Freshness hashes for newly published or
re-confirmed artifacts exclude the artifact's `## Change Log` section
(manifest entries carry `hashv: 2`). Without this, the mandated re-confirm
Change Log line would itself stale every downstream consumer — an infinite
re-confirm cascade. Legacy manifest entries (no `hashv`) keep whole-file
checking until their next publish or re-confirm, so existing projects are
not mass-staled by the scheme change. Change Log entries are audit
metadata, never artifact substance.

Layer 1 answers: *something upstream changed — which documents are suspect?*

## Layer 2 — ID coverage (deterministic, in code)

Hashes detect *that* a document changed. ID coverage detects *what* is missing.
Every cross-document reference uses append-only IDs, and the checks are exact:

| Check | Rule |
|---|---|
| PRD → RTM | Every FR-N / NFR-N in the PRD has ≥1 RTM row (exists today: fingerprints + MVP coverage). |
| PRD → design | Every FR-N / NFR-N is referenced in the design's traceability. |
| design/AFs → pseudocode | Every AF-N appears in the pseudocode. |
| FR/AFs → test cases | Every test case references FR/NFR/AF ids; every Phase-1 (MVP) id has test coverage. |
| AFs → development order | Every AF-N appears exactly once in the dev-order DAG. |
| Dev-order → final design | Consolidation covers every prior artifact. |

A new PRD feature (FR-27) with no downstream ID reference is a **hard error**,
even if someone carelessly re-stamped hashes. Append-only IDs make this check
cheap: missing id = inconsistency, no ambiguity.

Layer 2 answers: *does every requirement/function appear downstream?*

### Implementation notes (shipped 2026-09-20 — A4 + A6)

The shipped Layer-2 checks (`core/id-coverage.ts`, enforced at stage publish,
doctor, and handoff) apply these refinements to the rules table above:

1. **Legacy tolerance (not-checkable).** A downstream doc with *zero* parseable
   references of the expected kind is a pre-A4-format doc: reported as a
   **warning** everywhere, never blocking. A doc with *some* references is
   enforced fully — missing upstream ids are **errors**.
2. **PRD → design targets tables, not prose.** The check reads the design's
   §1 `Source FRs` column and §5 `NFR ID` / `Source PRD row` columns only.
   §7 Traceability is prose and is never scanned.
3. **Dev-order "exactly once" is split.** A *missing* AF is an **error**; an AF
   appearing *more than once* is a **warning** (a sequencing smell, not
   corruption).
4. **PRD → RTM stays where it is.** That coverage exists twice already
   (RTM fingerprints `orphan`/`unknown-id` + MVP coverage `no-row`) and is
   not re-implemented in the Layer-2 module; unification is a future cleanup.
5. **RTM ↔ test-cases link reconciliation (c8).** The RTM sidecar `tests[]`
   is the requirement↔test link authority; TC `traces[]` is the per-test
   declaration. A doctor cross-check flags links present in exactly one
   sidecar as **warnings** (asymmetric trace, never blocking) and skips when
   either sidecar is absent — see `06-artifact-formats.md`.

## Layer 3 — Semantic propagation (generated sub-agents)

ID coverage proves a document *mentions* FR-27 — not that it actually *handles*
it. Semantic verification is done by **sub-agents, not code**:

1. Each command's generated sub-agent team includes **verifier roles** —
   coverage-checkers, consistency-checkers, and the adversarial reviewer
   (e.g. `design-coverage-checker`, `rtm-coverage-analyzer`,
   `testplan-coverage-tracer`, `<stage>-reviewer`).
2. These agents are **generated per phase with the actual upstream document
   content in their context** (see `05-sub-agent-generation.md`). When the PRD
   gains FR-27, the regenerated design-stage verifier literally knows FR-27's
   text and checks the design addresses it — not just mentions it.
3. Verifier output is a structured verdict
   (`approve | needs-fix | block` + issue list) written to
   `<runDir>/<stage>/scouts/<role>-report.json`.
4. **Agents find issues; code enforces.** The publish gate consumes the
   verdict: `approve` required to publish. The orchestrator never judges
   content itself — it gates on the agents' verdicts.

Layer 3 answers: *is the requirement genuinely addressed downstream?*

## Gate summary — which layer runs where

| Gate | Layer 1 (hash) | Layer 2 (ID coverage) | Layer 3 (semantic) |
|---|---|---|---|
| Stage **start** | required | — | — |
| Stage **publish** | required | required | required (reviewer verdict) |
| `/velpari-doctor` (anytime) | reported | reported | last known verdicts reported |
| `/velpari-handoff` | required (zero stale) | required | future item¹ |

¹ Layer-3 verdict consumption at handoff is NOT implemented (A6 shipped Layer 1
+ Layer 2 there on 2026-09-20). Reviewer verdicts are consumed at stage publish
only; adding them to the handoff gate is a future item.

## Worked example — the scenario this document exists for

1. Developer adds FR-27 to the PRD and republishes (update mode, version bump).
2. Layer 1: RTM, feasibility, design, atomic functions, pseudocode, test plan,
   dev order, final design → all STALE (their recorded PRD hash no longer
   matches).
3. Developer types `/velpari-development-order` anyway.
4. Stage start gate: input `testplan` is stale → **blocked**. The message names
   the earliest stale stage: "RTM is outdated after PRD v1.3. Run `/velpari-rtm`."
5. Developer walks the chain forward: RTM revise (Layer 2 demands an FR-27
   row), feasibility re-confirm, design revise (Layer 2 demands FR-27 in
   traceability; Layer 3 verifier checks it's actually designed), and so on.
6. Only when the whole chain is fresh does dev-order run — and FR-27 is in it,
   because its input artifacts now contain FR-27.

## Self-healing routing

Blocking is never a dead end. Whenever a stale chain is detected, the
orchestrator computes the **earliest stale stage** and names it as the next
command. At every moment there is exactly one correct next command, and the
system says what it is. See `04-brainstorm-and-locking.md` for the full
transition-lock model.

## Community grounding

- **Suspect links (DOORS / Jama / Polarion, IREB CPRE):** the requirements
  industry standard — an upstream change marks every downstream trace link
  *suspect*; each must be individually re-assessed (confirmed or revised)
  before the baseline is clean. Layers 1+2 are exactly this, generalized from
  the RTM to the whole chain. High-assurance standards (DO-178C, ISO 26262)
  mandate it.
- **GitHub Spec Kit `converge`:** a final loop that compares code against
  spec/tasks until no gaps — the same idea as our handoff gate.
- **AWS Kiro spec sync:** requirements.md → design.md → tasks.md re-derived
  on change with human gates — our update-mode revision flow.
- **Build systems (Make/Bazel):** hash the inputs, rebuild the dependents —
  Layer 1 is a document dependency graph with content hashing.
