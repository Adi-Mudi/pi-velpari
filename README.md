# Pi-Velpari

A local Pi extension that adds stage-gated orchestration slash commands for the **pre-production** phase of software work. Mirrors Pi-Senai's discipline model (state-gated runs, working/published copy separation, doctor audit, single-source-of-truth state file) for the upstream half of the lifecycle.

Velpari produces the requirements package that Senai's `/senai-generate-architect` consumes.

```
[setup] → Brainstorm → PRD → RTM → Feasibility → Design (architecture-generator) → Atomic Functions → Pseudocode → Test Plan (test case and test plan) → Development Order → Final Design → Handoff → Senai
```

All 10 stages are required, in this order. Standards aligned with V-Model,
SA/SD, IEEE 12207 / 29148, and PMBOK.

> See [Doc/velpari-sequence/](Doc/velpari-sequence/README.md) for the full overview, per-stage inputs, scout pattern, and the 7 sequence nuances (each stage reads all prior artifacts, files.json/profile are global, one-command stage publish via `velpari_stage_publish`, feasibility skip, two approve commands, etc.).

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

## Terminal multiplexers

Velpari's scouts run as **visible sub-agents in panes**, so a run requires an active terminal multiplexer. Supported: **zellij / tmux / wezterm / cmux / herdr**. Velpari only *detects* the multiplexer and hard-fails a stage command when none is present; the panes themselves are opened by the runtime plugin `pi-interactive-subagents` (installed once — see the tech stack in [`AGENTS.md`](AGENTS.md)). Override detection for wrappers and tests with `PI_SUBAGENT_MUX`.

### herdr

herdr is detected as the 5th multiplexer from the env vars it injects into managed panes (`HERDR_ENV=1`, `HERDR_PANE_ID`).

1. **Prerequisite: herdr ≥ 0.9.0** (validated against stable 0.9.3). Below 0.9.0 `herdr agent prompt --wait` can complete on an unrelated state transition — the property the scout wait depends on. Install or upgrade from [herdr.dev](https://herdr.dev); check with `herdr --version`.
2. **Install the pi integration:** `herdr integration install pi`. herdr then restores the pi session after a server restart and reports pi's agent state.
3. **Install a herdr-capable subagents plugin.** Upstream `pi-interactive-subagents` supports cmux/tmux/zellij/WezTerm only, so the multiplexer gate would pass while scouts still cannot spawn. Use the fork that carries the herdr backend:

   ```sh
   pi install github.com:Adi-Mudi/pi-interactive-subagents
   ```

   > **PLACEHOLDER `<HERDR_PLUGIN_VERSION>`** — replace with the fork's published version/tag once that backend lands. Path decision: [`Doc/herdr-plugin-strategy.md`](Doc/herdr-plugin-strategy.md) §3.

4. **Confirm readiness:** `/velpari-doctor` reports a `Herdr (integration readiness)` section covering the version floor, the pi integration, and a capability probe for the herdr backend. The section warns only — it never blocks. Per-project floor pin: `files.json` → `velpari.herdrMinVersion`; per-shell override: `PI_VELPARI_HERDR_MIN_VERSION`.

### Known limitations

1. **herdr is pre-1.0.** CLI and flag churn is expected. The version floor is a single constant, and it is overridable at runtime (step 4 above) without rebuilding velpari.
2. **Nested tmux is detected as tmux.** herdr is checked **last** in the detection chain and does not inspect a tmux running inside one of its panes, so tmux-inside-herdr reports `tmux` and scouts spawn through tmux. This is deliberate: the detected multiplexer is the provider the panes are opened through.
3. **Windows has no CI coverage.** herdr's Windows support is preview-only, so the herdr CI job runs on `ubuntu-latest` + `macos-latest` only. Windows is untested, not blocked.

## Architecture sub-life cycle

`/velpari-architecture-generator` runs a discipline prelude before any scout spawns: it loads the project context (PRD, RTM, feasibility, profiles, configs), shows the developer a one-paragraph summary, and asks Proceed / Adjust scope / Pick a different profile. The doctor gate refuses to publish when the developer doesn't confirm.

See [`Doc/velpari-sequence/01-first-run-sequence.md`](Doc/velpari-sequence/01-first-run-sequence.md) for the full sub-life cycle.

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

See [`Doc/velpari-sequence/06-artifact-formats.md`](Doc/velpari-sequence/06-artifact-formats.md) for the ADR format.

## Commands

52 commands total. See [`Doc/velpari-sequence/08-command-reference.md`](Doc/velpari-sequence/08-command-reference.md) for the full list. Quick reference:

> **Publish is DB-only by default (Phase 11, Q3):** approve writes store rows + the YAML export beside `Doc/store/<project>/index.db` + a git commit — nothing to `Doc/`; opt back into markdown write-alongside with `files.json` `"velpari": {"markdownWrites": true}`. A legacy project imports once via `/velpari-migrate-store --dry-run` → `--execute`.

| Category | Commands |
|---|---|
| Stage | `/velpari-brainstorm`, `/velpari-prd`, `/velpari-rtm`, `/velpari-feasibility`, `/velpari-architecture-generator`, `/velpari-pseudocode`, `/velpari-testplan`, `/velpari-atomic-function`, `/velpari-development-order`, `/velpari-final-design` |
| Discipline | `/velpari-approve-brainstorm`, `/velpari-prd-approve`, `/velpari-rtm-approve`, `/velpari-feasibility-approve`, `/velpari-architecture-generator-approve`, `/velpari-atomic-function-approve`, `/velpari-pseudocode-approve`, `/velpari-testplan-approve`, `/velpari-development-order-approve`, `/velpari-final-design-approve` (9 per-stage fall-back commands — the normal publish flow is auto-publish via the `velpari_stage_publish` tool), `/velpari-status`, `/velpari-reset`, `/velpari-configure-inputs`, `/velpari-configure-requirements`, `/velpari-configure-standards`, `/velpari-configure-agents`, `/velpari-agents`, `/velpari-generate-sub-agents`, `/velpari-doctor`, `/velpari-handoff`, **`/velpari-design-logging`** (cross-cutting — runs after Design is approved), `/velpari-db-reset`, `/velpari-freeze`, `/velpari-tombstone`, `/velpari-rollback`, `/velpari-retention-prune`, `/velpari-merge-back`, `/velpari-revision-status` |
| Wrapper | `/velpari-prd-rtm` |
| View | `/velpari-show-brainstorm`, `/velpari-show-prd`, `/velpari-show-rtm`, `/velpari-show-feasibility`, `/velpari-show-design`, `/velpari-show-pseudocode`, `/velpari-show-testplan`, **`/velpari-show-logging`** |
| Ops / store | `/velpari-reconfirm`, `/velpari-backfill`, `/velpari-portfolio`, `/velpari-migrate-store`, `/velpari-export` |

### Versioning, locking & recovery (Phases 1–7)

- **Revisions & freeze (N4/F7):** every publish creates an immutable snapshot revision; `/velpari-freeze` freezes an artifact at handoff with a typed reason (a frozen artifact refuses publish, supersession and tombstone), `/velpari-tombstone` withdraws a revision, `/velpari-rollback` restores content as a new revision.
- **Backups (N9–N11):** the store auto-snapshots (`VACUUM INTO`) at publish / `/velpari-db-reset` / `/velpari-migrate-store` into gitignored `Backup/velpari/<project>/` with a `manifest.jsonl`, pruned keep-last-N FIFO; restore goes through `skills/db-store-merge-runbook.md`.
- **Retention (N7):** `/velpari-retention-prune` deletes superseded revisions beyond `velpari.retention.revisions` (keep-last-N) — confirmed and audited; head and baselined revisions are never pruned.
- **Revision status (v1.2):** `/velpari-revision-status` views a revision's F16 status and restores withdrawn → published (typed reason + confirmation, audited). Withdrawal stays on `/velpari-tombstone`; `superseded` is system-owned (set only by a new publish).
- **Enforcement (N5/N6/N8/N14):** run binding ties `state.json` to a git worktree/branch; a gate blocks commands from the wrong tree; an upstream-moved notice surfaces each turn; the doctor reports a worktree removed mid-run.
- **Hash-chain (N15):** `audit_ledger` / `tx_log` rows are hash-chained and verified end-to-end by `/velpari-doctor`.
- **Execution lanes (N16):** dev-order work is ranked into DAG-derived execution lanes (integration plan + lock rules), carried in the working copy, store kinds and handoff payload.

### Upgrade behaviors (Phases A–F — N17–N33)

- **Session gate (N18):** a session whose worktree/branch does not match the plan header is hard-stopped at start (no changes made); the `tool_call` hook denies edit/write on mismatch.
- **Doctor v2 + preflight (N22/N23):** commands start with a fast preflight; the doctor's "Fix all" flow is confirm-gated (batched repair → re-run → the original command continues). Errors block; warnings are report-only (N24-15).
- **Soft-lock (N19/N20):** a revision consumed downstream is content-locked — later content writes (incl. `/velpari-reconfirm`'s Change Log append) refuse; status updates stay audited.
- **Semver bump gate (N27):** publish validates the declared `bump:` (MAJOR = id/structure change, MINOR = additions, PATCH = wording) against the classified change; DB-rendered kinds compare store renders.
- **Excalidraw canvas (N31):** design/export flows offer "push diagram to canvas" when the local MCP server is reachable — launcher pinned `mcp-excalidraw-server@2.0.0` (never `@latest`); Mermaid stays the source of truth with graceful fallback.
- **`velpari.maxWorktrees` (N32):** supersedes `velpari.maxLanes`; the lane cap resolves `maxWorktrees` → `maxLanes` → 4 (worktree cap default 3).
- **`testing.runner` (N33):** `files.json` key selecting local vs CI test runs (`npm run test:scope`); the full gate runs in CI.

### Sub-agent generator (v2)

`/velpari-generate-sub-agents` generates project-specific sub-agents for the current pipeline phase (auto-detected from run state; `--phase N` overrides with 1–4). See [`Doc/velpari-sequence/05-sub-agent-generation.md`](Doc/velpari-sequence/05-sub-agent-generation.md) for the full design.

## Brainstorm v1.x — dynamic community / official / industrial / standard-practice scan

v1.x adds two new state-tool actions to the `velpari_brainstorm_session` tool so the parent LLM can dynamically add scans and dispatch `web-search-agent` during the DISCUSS loop when the developer mentions any external source:

| Action | Purpose |
|---|---|
| `request-extra-scan` | Re-opens the SCAN picker for scans not yet opted-in at the upfront gate. Community consent (FR-52) preserved. |
| `confirm-web-dispatch` | Per-dispatch consent (`ctx.ui.confirm`) for a single web call. Audit-trail entry appended to `state.json:webDispatchConfirmations`. |

When the developer says *check the community patterns* / *find the official docs* / *look up IEEE 754* / *what's the standard practice for…* during DISCUSS, the parent LLM calls `request-extra-scan` (if community isn't opted in yet), then `confirm-web-dispatch` immediately before each `subagent()` for `web-search-agent`. There are **no caps** during brainstorm — the developer decides when to stop. FR-52 role anchor unchanged: `web-search-agent` runs only for `scanType: "community"`.

## Brainstorm v3 — persistent sub-agent sessions (AUTOMATIC SPAWN at step 1)

Starting with v3, the brainstorm opens **2 persistent sub-agent sessions immediately after the command fires** (step 1 — before the UNDERSTAND loop):

| Pane (right column) | Agent | Session handle | Tools | Topic scope |
|---|---|---|---|---|
| row 1 | `web-research` | `web` | `read, websearch, fetchurl` | web / community / official docs / standards |
| row 2 | `doc-code-analyst` | `doc-code` | `read, grep, glob, ls` | existing PRD / RTM / source code |

Both sessions stay alive across the whole brainstorm (right-column multiplexer panes). The parent LLM routes each user message in the DISCUSS loop:

- Web/community/docs topic → `subagent({ session: "web", prompt: <msg> })`
- Doc/code topic → `subagent({ session: "doc-code", prompt: <msg> })`
- Both topics → 2 parallel calls (different sessions, allowed)
- General/meta → parent answers directly

On `/velpari-approve-brainstorm`, the handler fires a graceful close (sends a prompt asking the LLM to `subagent_interrupt` on both panes + call `close-sessions`) and clears `state.activeSubagents`. The legacy v2.1 SCAN-gate picker remains as a fallback path for users who prefer the one-shot ephemeral scout flow.

FR-52 web-research role anchor: `web-research` (the v3 name) is rejected for non-community sessions by the dispatcher, same as `web-search-agent` was in v1.x.

## Architecture

`pi-extension/src/` follows the official 4-layer architecture: domain → stage-logic → presentation → composition. Each layer has a single concern and a strict dependency direction. See [`pi-extension/src/AGENTS.md`](pi-extension/src/AGENTS.md) for the contributor-facing contract.

## License

MIT — see [`LICENSE`](LICENSE).
