# Pi-Velpari

A local Pi extension that adds stage-gated orchestration slash commands for the **pre-production** phase of software work. Mirrors Pi-Senai's discipline model (state-gated runs, working/published copy separation, doctor audit, single-source-of-truth state file) for the upstream half of the lifecycle.

Velpari produces the requirements package that Senai's `/senai-generate-architect` consumes.

```
[setup] → Brainstorm → PRD → RTM → Feasibility → Design (architecture-generator) → Atomic Functions → Pseudocode → Test Plan (test case and test plan) → Development Order → Final Design → Handoff → Senai
```

All 10 stages are required, in this order. Standards aligned with V-Model,
SA/SD, IEEE 12207 / 29148, and PMBOK.

> See [Doc/velpari-sequence.md](Doc/velpari-sequence.md) for the full overview, per-stage inputs, scout pattern, and the 7 sequence nuances (each stage reads all prior artifacts, files.json/profile are global, one-command stage publish via `velpari_stage_publish`, feasibility skip, two approve commands, etc.).

## Install (canonical)

```sh
pi install npm:@adi-mudi/pi-velpari
```

## Local dev

```sh
npm run build              # tsc → dist/pi-extension/src/
npm test                   # unit tests via node --test (~20s, 1200+ tests)
npm run test:coverage      # unit tests + coverage report (Node 22 built-in)
npm run test:e2e           # Tier 1 e2e (requires RUN_E2E=1 + pi on PATH)
npm run test:e2e:tier2    # Tier 2 e2e (requires RUN_LLM_E2E=1 + LLM key)
npm run test:l3            # L3 in-process (currently deferred — Phase 4)
```

**What each proves:**

- `npm test` — unit + integration; no external services.
- `npm run test:coverage` — same, plus a coverage report at `coverage/index.html`. Node 22's built-in `--experimental-test-coverage` is used (no extra deps).
- `npm run test:e2e` — Tier 1 e2e: drives a real `pi --mode rpc` and exercises the doctor module, command registration, stage gates. No LLM key needed.
- `npm run test:e2e:tier2` — Tier 2 e2e: full LLM-driven flows. Gated by `RUN_LLM_E2E=1` + a real provider key. Never in regular CI; run on nightly schedule or manual dispatch.
- `npm run test:l3` — L3 in-process tests via `pi-coding-agent-test` (currently DEFERRED — see Phase 4 in `Doc/testing-guide.md`). Harness kept for future re-probe.

See [`Doc/testing-guide.md`](Doc/testing-guide.md) for the test pyramid (L1/L2/L3/perf), how-to-add recipes, and the CI matrix.

## Architecture sub-life cycle

`/velpari-architecture-generator` runs a discipline prelude before any scout spawns: it loads the project context (PRD, RTM, feasibility, profiles, configs), shows the developer a one-paragraph summary, and asks Proceed / Adjust scope / Pick a different profile. The doctor gate refuses to publish when the developer doesn't confirm.

See [`Doc/velpari-sequence.md`](Doc/velpari-sequence.md) §11 for the full sub-life cycle.

## Standards overlays

Domain overlays bundle extra mandatory sections, conditional scout roles, and doctor check rules. Pick one via `/velpari-configure-standards`.

Bundled overlays:

| ID | Standards | Status |
|---|---|---|
| `none` | RFC 2119 + EARS | Default |
| `medical-device-b` | IEC 62304:2006 + ISO 14971 + ISO 13485 | First real overlay |

Author a new overlay:

1. Copy `skills/standards/overlays/_template/` → `skills/standards/overlays/<your-id>/`
2. Edit `profile.json` (id, standards, sections, extraScouts, doctorChecks)
3. (Optional) Add a scout under `scouts/<role>.md` (role MUST start with `overlay-`)
4. (Optional) Add a doctor check under `doctor/check-overlay.md`
5. Register the overlay in `skills/standards/catalogue.json`

See [`skills/standards/README.md`](skills/standards/README.md) for the full guide.

## ADR mechanism

Every conflict surfaced by the `design-conflict-detector` scout is captured as an Architecture Decision Record in the design doc's `## Architecture Decisions` section. ADRs support supersession chains (`supersedes: "ADR-NNN"`). The handoff payload exports every ADR to Senai.

See [`Doc/velpari-sequence.md`](Doc/velpari-sequence.md) §13 for the ADR format.

## Commands

32 commands total (v1.4.0: + `/velpari-design-logging`, `/velpari-show-logging`). See [`Doc/velpari-sequence.md`](Doc/velpari-sequence.md) §5 for the full list. Quick reference:

| Category | Commands |
|---|---|
| Stage | `/velpari-brainstorm`, `/velpari-prd`, `/velpari-rtm`, `/velpari-feasibility`, `/velpari-architecture-generator`, `/velpari-pseudocode`, `/velpari-testplan`, `/velpari-atomic-function`, `/velpari-development-order`, `/velpari-final-design` |
| Discipline | `/velpari-approve-brainstorm`, `/velpari-prd-approve`, `/velpari-rtm-approve`, `/velpari-feasibility-approve`, `/velpari-architecture-generator-approve`, `/velpari-atomic-function-approve`, `/velpari-pseudocode-approve`, `/velpari-testplan-approve`, `/velpari-development-order-approve`, `/velpari-final-design-approve` (9 per-stage fall-back commands — the normal publish flow is auto-publish via the `velpari_stage_publish` tool), `/velpari-status`, `/velpari-reset`, `/velpari-configure-inputs`, `/velpari-configure-requirements`, `/velpari-configure-standards`, `/velpari-configure-agents`, `/velpari-agents`, `/velpari-generate-sub-agents`, `/velpari-doctor`, `/velpari-handoff`, **`/velpari-design-logging`** (cross-cutting — runs after Design is approved) |
| Wrapper | `/velpari-prd-rtm` |
| View | `/velpari-show-brainstorm`, `/velpari-show-prd`, `/velpari-show-rtm`, `/velpari-show-feasibility`, `/velpari-show-design`, `/velpari-show-pseudocode`, `/velpari-show-testplan`, **`/velpari-show-logging`** |

## Architecture

`pi-extension/src/` follows the official 4-layer architecture: domain → stage-logic → presentation → composition. Each layer has a single concern and a strict dependency direction. See [`pi-extension/src/AGENTS.md`](pi-extension/src/AGENTS.md) for the contributor-facing contract.

## License

MIT — see [`LICENSE`](LICENSE).
