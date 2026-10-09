# Herdr Plugin Strategy + Feasibility

Status: **decision recorded 2026-10-09** — Phase 2 of the herdr integration initiative.
This document gates Phase 4 (plugin backend) and Phase 5 (supervision) in the master plan.

## 1. Summary

| Question | Decision |
|---|---|
| Pane-spawning path | **Fork `pi-interactive-subagents` + a thin herdr backend** (option a); contribute the same backend upstream in parallel (option b). Reject a new `pi-herdr-subagents` plugin as the primary path (option c). |
| herdr version floor | **herdr ≥ 0.9.0** (validated against stable 0.9.3). |
| License | **herdr is Apache-2.0** — the AGPL-3.0 claim is stale; no copyleft obligation. |
| Phase 5 (state-aware supervision) | **NO-GO** as a separate velpari phase; if ever needed, implement it in the plugin. |
| Feasibility | **Feasible** — all four scout primitives exist; one constant to maintain. |

## 2. Scope

Velpari only *detects* the multiplexer. Visible scout panes are spawned by the runtime
plugin `pi-interactive-subagents`; velpari references it textually and never imports it.
This document decides which herdr-capable provider carries that role, and on what terms.

## 3. Pane-spawning path

### 3.1 Options

- **(a) Fork** `pi-interactive-subagents` and add a herdr backend module alongside the
  existing cmux / tmux / zellij / wezterm backends. Keeps the package name and the
  `subagent*` tool contract.
- **(b) Upstream PR** into `HazAT/pi-interactive-subagents`.
- **(c) New `pi-herdr-subagents` plugin** — a herdr-native re-implementation.

### 3.2 Comparison

| Criterion | (a) Fork | (b) Upstream PR | (c) New plugin |
|---|---|---|---|
| Preserves velpari's contract (package name, `subagent*` tools, doctor check) | Yes | Yes (if merged) | No — forces doctor + text-ref rework |
| Time-to-working | Short (one bounded module; open PR #57 is a near-complete patch) | Unbounded (maintainer-gated) | Longest (full lifecycle surface) |
| Maintenance cost | Medium (rebase on upstream; herdr churn) | Lowest | Highest |
| Release/publish path | Same as today (`pi install`) | Native upstream npm | New package + scope |
| Upstream acceptance odds | n/a | Low | n/a |
| Duplicates existing work | No | No | Yes — herdr providers already published |

Evidence on upstream odds: two herdr pull requests to `HazAT/pi-interactive-subagents`
(#32, closed unmerged; #57, open since 2026-06-25 with 12 👍, still unmerged). A merged
upstream backend remains desirable but cannot be the schedule.

Evidence on existing work: `@maplezzk/pi-interactive-subagents` v3.16.4 (MIT) already ships
a herdr backend; `modem-dev/pi-herdr-subagents` (MIT) is a herdr-native provider.

### 3.3 Decision

Take **(a)** as the primary path and run **(b)** as a no-regret parallel contribution.
**Reject (c)** as the primary path because it duplicates shipped plugins and would require
velpari to change its doctor check and its provider assumptions for no functional gain.

### 3.4 Backend shape (input to Phase 4)

- split: `herdr pane split [<pane>] --direction right --no-focus` → `.result.pane.pane_id`
- start: `herdr agent start <name> --kind pi --pane <id> [--timeout MS]`
- prompt-wait: `herdr agent prompt <name> "<task>" --wait --until done --until idle --timeout MS`
- read: `herdr agent read <name> --source recent-unwrapped --lines N` (or `pane read`)
- interrupt: `herdr agent send-keys <name> esc`
- fallback: `herdr pane run <pane> "<cmd>"` (atomic text + Enter)
- safety: never close foreign panes; never stop the server.

## 4. CLI/socket surface validation

| Scout need | herdr command | Notes |
|---|---|---|
| split | `pane split … --no-focus` | new pane id in `.result.pane.pane_id` |
| start | `agent start … --kind pi --pane <id>` | returns after detection is ready; needs an idle shell pane |
| prompt-wait | `agent prompt … --wait --timeout MS` | atomic submit + Enter then wait; blocked → `agent_blocked` |
| read | `agent read … --source recent-unwrapped --lines N` | plain text; long reads of full-screen agents need idle |
| interrupt | `agent send-keys … esc` | turn-level interrupt |
| fallback | `pane run <pane> "<cmd>"` | atomic submit when not driving a recognized agent |

### 4.1 Version floor

**Minimum: herdr ≥ 0.9.0** (validated against stable 0.9.3).

- 0.7.5 introduced the agent facade (`agent start` / `prompt` / `send-keys` / `wait`).
- 0.8.2 hardened `agent start` readiness and `pane read` / `pane wait-output` flag parsing.
- 0.9.0 made `agent prompt` atomic and tightened `--wait` to require observed
  working/blocked activity (#3506/#3685). **This is the property the scout wait depends
  on** — below 0.9.0 a wait can complete on an unrelated state transition.

If Phase 4 uses argv-backed plugin panes instead of `agent start`, the hard minimum is
0.8.2 (first release with split plugin panes), but 0.9.0 still governs. **Phase 3's
version-floor constant should be `0.9.0`.**

## 5. License resolution

**herdr is licensed under the Apache License, Version 2.0.** Verified against the actual
`LICENSE` file in `herdrdev/herdr` (GitHub license API: path `LICENSE`, 11357 bytes) and
confirmed by the changelog: 0.8.0 — *"Relicensed Herdr from AGPL-3.0-or-later to
Apache-2.0."* The AGPL-3.0 claim found in one third-party review is **stale** (a
pre-August-2026 snapshot). No copyleft obligation applies to calling the herdr CLI or to
a fork.

Related licenses: velpari is MIT (`LICENSE`, `package.json`); upstream
`pi-interactive-subagents` is MIT. A MIT fork that keeps the upstream notice is fine.

## 6. Phase 5 judgment — state-aware supervision

**NO-GO.** Velpari's boundary is to never spawn agents and to own no lifecycle machinery;
the provider plugin owns spawning, waiting, and result steering. Velpari polling herdr
`blocked/working/done` would duplicate that responsibility, couple velpari to a herdr-only
pre-1.0 state API that already changes between releases (see the 0.9.2 breaking change),
and buy little — the plugin steers results back and reports honest lifecycle, and herdr's
sidebar already surfaces state to the user.

**Flip condition:** if a concrete gap appears (e.g. blocked-scout early detection during a
brainstorm scan), implement it in the plugin (Phase 4), not in velpari. Skipping Phase 5
frees a Batch-2 worktree slot.

## 7. Feasibility verdict

**Feasible.** All four scout primitives (split / start / prompt-wait / read) exist as
stable herdr CLI commands with JSON responses and documented IDs; the version floor is a
single constant; the license is permissive.

| Risk | Mitigation |
|---|---|
| herdr pre-1.0 churn | version floor (0.9.0) + canary CI in Phase 4 |
| fork drift from upstream | keep the herdr backend isolated in one module; track upstream releases |
| upstream PR never merges | treat upstream as upside only; the fork does not depend on it |

## 8. Handoff to later phases

- **Phase 4 (plugin backend):** build the herdr backend per §3.4; own the plugin-repo CI
  (contract tests vs pinned herdr + canary vs latest); minimum herdr 0.9.0.
- **Phase 5:** skipped — no work.
- **Phase 3 (doctor):** set the version-floor constant to `0.9.0`.
- **Phase 8 (release):** reference this decision in the release notes.

## 9. Sources

- herdr docs: `herdr.dev/docs/agents`, `/docs/socket-api`, `/docs/cli-reference`,
  `/docs/agent-automation`.
- herdr changelog (`herdrdev/herdr` `CHANGELOG.md`): 0.7.5, 0.8.0, 0.8.2, 0.9.0, 0.9.2.
- herdr LICENSE (`herdrdev/herdr`, Apache-2.0).
- HazAT/pi-interactive-subagents README + issues #32, #57.
- `@maplezzk/pi-interactive-subagents` v3.16.4; `modem-dev/pi-herdr-subagents` README.
