# 06 — Artifact Formats

Plain Markdown alone is not sufficient for large-scale projects — but neither
is JSON everywhere. The finalized strategy: **different formats per document
kind**, each chosen for who reads it (humans, agents, machines). Everything
stays human-readable and agent-readable.

## The three rules

1. **Sidecar = source of truth; rendered view is never hand-edited.**
   Where a structured sidecar exists, the Markdown is *rendered from it* at
   publish time and can never drift from the data (the RTM pattern, generalized).
2. **YAML for structured data humans may open.** YAML is the community's
   human-readable structured format (OpenAPI, Kubernetes, GitHub Actions) —
   a superset of JSON that reads naturally. JSON is reserved for files no
   human should ever need to read.
3. **Markdown stays the narrative format.** Humans and LLM agents both read
   it natively. Machine-checkable metadata rides in its YAML frontmatter.

## Format per artifact kind

| Artifact | Format | Source of truth | Rendered view |
|---|---|---|---|
| Brainstorm notes | Markdown + YAML frontmatter | the `.md` itself (narrative + decision ledger) | — |
| PRD | Markdown + YAML frontmatter (version, ids, status columns, input hashes) | the `.md` (tables are machine-parsed for validation) | — |
| RTM | **YAML sidecar** (rows, links, fingerprints, phase) | `RTM_<project>.yaml` | `RTM_<project>.md` rendered at publish |
| Feasibility | Markdown + frontmatter + **YAML decision record** (verdict, language, reuse %, spike results) | `.md` + decision `.yaml` | — |
| Architecture design | Markdown + YAML frontmatter; ADRs as structured records in the decisions section | the `.md` | — |
| Atomic functions | **YAML sidecar** (tier schema fields per AF) | `atomic-functions_<project>.yaml` | rendered `.md` |
| Pseudocode | Markdown + frontmatter | the `.md` (structured per-AF blocks) | — |
| Test plan / test cases | test plan: Markdown + frontmatter; test cases: **YAML sidecar** (ids → requirement/AF refs) | `test-cases_<project>.yaml` | rendered `.md` |
| Development order | **YAML sidecar** (dependency DAG — cycle-detectable, topologically validatable) | `development-order_<project>.yaml` | rendered `.md` |
| Final design | Markdown + frontmatter | the `.md` | — |
| Diagrams (all docs) | **Mermaid** blocks | in the host document | rendered by viewers |
| Logging plan | Markdown + frontmatter | the `.md` | — |

## Internal machine files (JSON — never hand-edited)

| File | Purpose |
|---|---|
| `.pi/velpari/state.json` | Run state (config-sized — see `07-state-and-locking-files.md`) |
| `.pi/velpari/freshness.json` | Freshness manifest (input-hash stamps per artifact) |
| `.pi/velpari/generated-manifest.json` | Sub-agent generator drift manifest |
| `.pi/velpari/.lock/` | Run lock |
| `.pi/senai/architect-inputs.json` | Handoff package (Senai's schema) |
| Scout reports `<role>-report.json` | Agent verdicts/findings in run folders |

## Why YAML over JSON for sidecars

1. Humans review diffs of these files — YAML reads naturally; JSON punishes
   nesting and forbids comments.
2. Agents handle both equally well — no agent cost.
3. The RTM already proves the sidecar pattern works (validate → render →
   fingerprints); switching its sidecar from JSON to YAML is a format
   migration, not a design change (see `09-migration-notes.md`).
4. Industry precedent: OpenAPI/AsyncAPI (YAML spec → rendered docs),
   JSON Schema (YAML-authored), SPDX/CycloneDX SBOMs, JUnit/SARIF (test and
   analysis results are machine formats rendered for humans).

## What this buys

1. **Exact validation.** The 20-section PSRS check, RFC-2119 wording check,
   tier-schema check, DAG cycle check, and ID-coverage checks
   (`03-staleness-and-validation.md` Layer 2) run against structured data,
   not Markdown table parsing.
2. **Cheap freshness stamps.** Hashing a sidecar is cleaner than hashing
   rendered Markdown (Layer 1).
3. **No drift.** Rendered views regenerate at publish; there is one truth.
4. **Scale.** Large projects get queryable, diffable, scriptable artifacts —
   the reason the community moved specs to structured formats in the first
   place.

## Community grounding

- **OpenAPI / AsyncAPI / Kubernetes / GitHub Actions:** YAML as the
  human+machine structured standard.
- **NIST OSCAL:** even government machine-standards keep a human-editable
  Markdown/YAML layer over the formal model.
- **Docs-as-code (VS Code, Kong, GitLab):** docs in git, reviewed like code,
  metadata in frontmatter, generated views from structured sources.
- **Linux kernel:** reStructuredText+Sphinx — structured source, rendered
  output; the same source-of-truth vs rendered-view split.

## Implementation notes (B3 — shipped 2026-09-21)

- **YAML package (D1).** The `yaml` package (`^2`) is the one runtime
  dependency, imported only by L0 data modules (`core/yaml-data.ts` is the
  sole `parse`/`stringify` call site; every other module consumes plain
  data). Strict parse returns line/column-numbered errors; stringify runs
  with `lineWidth: 0` so long strings are never folded.
- **Registry-driven publish (D3).** `ops/sidecar-registry.ts:
  SIDECAR_REGISTRY` maps artifact kind → { detect, parse+validate, diff,
  render, sidecarName, baseline loader }. `ops/approve.ts` runs one
  generalized loop: the LLM authors the sidecar + a markdown preview;
  approve hard-blocks on a missing/invalid sidecar (D6), diffs against the
  published baseline (append-only ids + version bump), then RE-RENDERS the
  published markdown from the data.
- **RTM dual-read (D4).** Reads prefer `RTM_<project>.yaml` with legacy
  `.json` fallback at every hardcoded site (the YAML parser accepts JSON);
  writes are always `.yaml`; legacy `.json` files are never deleted.
- **Feasibility decision record (D9).** The sole code-generated sidecar:
  `Doc/feasibility/feasibility-decision_<project>.yaml` is serialized from
  `state.feasibilitySession` at publish time BEFORE
  `clearFeasibilitySession` runs (fields: verdict, selectedLanguage,
  selectedBy, languageCandidates, spikeResults, reuseSummary, recordedAt),
  and joins the study's freshness `extraPaths`.
- **Dev-order DAG (D8).** `development-order_<project>.yaml` carries
  `steps[]` of `{ id: DO-N, module, afs[], dependsOn[] }`; validation
  resolves every `dependsOn` reference, proves acyclicity via three-color
  DFS, and requires the listed order to already satisfy the dependencies.
- **Id-coverage sidecar-first (D7).** AF ids come from the AF sidecar when
  present (af→pseudocode, af→dev-order); downstream refs come from the
  test-cases sidecar `traces` and dev-order sidecar `afs` when present;
  markdown scraping remains the fallback (legacy not-checkable unchanged).
- **Freshness semantics (D5).** Sidecars join their own artifact's
  `extraPaths` only; downstream declared inputs keep hashing the rendered
  markdown. Switching the hash target to sidecars is a deferred cleanup.
- **Requirement↔test link authority (c8 — shipped 2026-09-21).** The RTM
  sidecar `rows[].tests[]` is the authoritative record of which tests verify
  which requirement; the test-cases sidecar `traces[]` is the per-test
  declaration. A doctor cross-check
  (`doctor/checks/trace-link-consistency.ts`) reconciles the two: a link
  present in exactly one sidecar is a **warning** (asymmetric trace —
  reconcile at the next RTM/testplan revise), and the check skips with an
  info when either sidecar is absent (legacy) or invalid (the per-artifact
  checks own that error). AF-N traces are excluded — they have no RTM row
  counterpart.
