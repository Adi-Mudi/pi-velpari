# Pi-Velpari Feasibility Study

- **Project:** Pi-Velpari
- **Source PRD:** `Doc/PRD.md` v1.1
- **Source RTM:** `Doc/RTM_Pi-Velpari.md`
- **Date:** 2026-08-24
- **Verdict:** **GO** — proceed with implementation, with one operational caveat (upstream Pi extension API stability).

---

## 1. Executive Summary

Pi-Velpari is feasible to build as a single-developer, open-source Pi extension. The technical patterns are well-understood and already validated by `Pi-Orchestra_v4` (pi-senai). The economic case is strong (zero cost, high ROI). Legal exposure is minimal (MIT license, original code only). The schedule fits inside a 6–9 week solo effort across the planned 7 implementation phases (Phase A through G) plus the current Phase 0 docs-first pass. The operational risks are (1) the stability of the upstream `@mariozechner/pi-coding-agent` extension API surface (mitigated by mirroring Senai's proven patterns and pinning the peer-dependency version range) and (2) the 12 scout agents across 3 stages (4 in discuss + 4 in atomic-function + 4 in development-order), which add LLM round-trip cost and require 30-second timeouts per scout (mitigated by deterministic test fixtures and centralized scout orchestration).

**Verdict: GO.** All five dimensions rate High or Medium. No dimension rates Low. Conditional approval is not required, but the operational caveat (upstream API stability) should be revisited at every minor Pi release.

---

## 2. Technical Feasibility — **HIGH**

### 2.1 Components

| Component | Maturity | Notes |
|---|---|---|
| TypeScript with strict mode | Mature | Industry standard. `tsc` produces ESM to `dist/`. |
| Node.js file I/O for state and artifacts | Mature | `fs/promises` + `path.join` covers all needs. No exotic APIs. |
| Pi extension API (`@mariozechner/pi-coding-agent`) | Mature within this repo | Senai is the reference implementation. Same patterns apply. |
| Interactive multi-turn interview UI | Mature within this repo | Senai's `simple-picker`, `role-picker`, `list-editor` are reusable patterns. |
| Deterministic compaction hook | Mature within this repo | Senai's `compaction.ts` shows the pattern. |
| Stage-gated state machine | Mature pattern | Pure code, no external deps. |
| Doctor audit + secret scan | Mature pattern | Regex-based scanning, deterministic. |
| Handoff schema matching Senai's `architect-inputs.json` | Moderate risk | Schema is fixed in Senai's source; we read it at test time to verify. |

### 2.2 Key risks

1. **Pi extension API edge cases.** Some UI behaviors (truncate-to-width for long picker lines, multi-line confirm dialogs) needed explicit fixes in Senai. Same pitfalls likely apply here. **Mitigation:** copy Senai's UI components verbatim and adapt.
2. **Handoff schema drift.** If Senai changes the `architect-inputs.json` schema, `/velpari-handoff` breaks. **Mitigation:** handoff test reads Senai's `architect-inputs-config.ts` and asserts field names match.
3. **Compaction hook behavior.** Pi may change how `session_before_compact` fires. **Mitigation:** zero-LLM deterministic summary minimizes blast radius — if the hook fires unexpectedly, no harm done.

### 2.3 Conclusion

All components are within state-of-the-art reach. The technical risk is dominated by upstream API surface, which is bounded. **Technical feasibility: HIGH.**

---

## 3. Economic Feasibility — **HIGH**

### 3.1 Costs

| Item | Cost |
|---|---|
| Tooling | $0 — open-source stack (Node, TypeScript, npm, git) |
| Distribution | $0 — public Git repo, MIT license |
| Runtime dependencies | $0 — only peer dep on `@mariozechner/pi-coding-agent` |
| Cloud / hosting | $0 — purely local execution |
| Third-party licenses | $0 — all original code |
| **Total monetary cost** | **$0** |

### 3.2 Time investment (solo developer estimate)

| Phase | Description | Effort |
|---|---|---|
| Phase 0 (current) | 12 docs (v1.1 plan, expanded in v1.2 and v1.3) | ~1 week |
| Phase A | Foundation: package.json, tsconfig, state, commands, doctor, configure, handoff, show stubs, compaction | ~1 week |
| Phase B | First 3 content stages: discuss (with 4-agent pattern), prd, rtm + skills + tests | ~1 week |
| Phase C | Remaining 4 content stages: feasibility, design, pseudocode, testplan + skills + tests + templates | ~1.5 weeks |
| Phase D | Handoff bridge: full implementation + skill + Senai schema round-trip test + optional artifact handling | ~0.5 weeks |
| Phase E | Show commands: full implementation + tests | ~0.5 weeks |
| Phase F | Atomic-function stage: 4 AF scouts, picker, working/published copy, tests | ~1 week |
| Phase G | Development-order stage: 4 DO scouts, ranking merge, picker, tests | ~1 week |
| **Total** | **End-to-end v1.3** | **~7 weeks** |

Buffer for unknowns, refactors, and docs polish: **+1–2 weeks**.

The two post-pipeline stages (Phase F, Phase G) add ~2 weeks. They are recommended but optional — projects can ship v1.0 with the core 9-stage surface and add the optional stages in v1.1+.

### 3.3 ROI

- **Time saved per use:** ~30–60 minutes of structured requirements capture vs. unstructured thinking. Multiplied across many uses, the ROI is positive after the first 5–10 uses.
- **Quality improvement:** traceable artifacts (PRD → RTM → design → tests) catch requirement drift before code is written. The cost of a missed requirement during implementation is hours; the cost of catching it in design is minutes.
- **Reuse:** the published `Doc/` artifacts double as project documentation, eliminating duplicate work later.

### 3.4 Conclusion

Zero monetary cost. Modest time investment for solo dev. Strong ROI after initial implementation. **Economic feasibility: HIGH.**

---

## 4. Legal Feasibility — **HIGH**

### 4.1 License

- Velpari will be released under **MIT**, matching `Pi-Orchestra_v4`.
- MIT is compatible with the only dependency (peer dep on `@mariozechner/pi-coding-agent`, which is also MIT).

### 4.2 Code provenance

- All code in Velpari is original, written specifically for this project.
- No third-party code is copied. Patterns from Senai are reimplemented from scratch (not copy-pasted), respecting MIT's permissive terms.
- Skill markdown files are original.
- Documentation is original.

### 4.3 Data handling

- No user data is collected, stored, or transmitted off-device.
- No telemetry, analytics, or remote calls.
- All state and artifacts remain on the developer's machine.

### 4.4 Conclusion

No legal exposure. **Legal feasibility: HIGH.**

---

## 5. Operational Feasibility — **MEDIUM** (with mitigation)

### 5.1 Maintenance model

- **Single-developer project.** Maintenance, bug fixes, and feature additions are expected from one person familiar with both Velpari and Senai.
- **No support burden.** No users to support, no SLA, no service-level commitments.
- **No infrastructure.** No servers, no databases, no deployment pipelines.

### 5.2 Key risks

1. **Upstream Pi extension API stability.** `@mariozechner/pi-coding-agent` is the host platform. If its extension API changes (function signatures, hook behavior, command registration), Velpari breaks.
   - **Likelihood:** Medium (the extension API is under active development).
   - **Impact:** Medium (would require a code update, but the patterns are well-documented and most changes are additive).
   - **Mitigation:**
     - Pin the peer-dependency version range in `package.json` (e.g., `^1.x`).
     - Mirror Senai's patterns exactly so when Senai updates, Velpari can adopt the same patterns in lockstep.
     - Run `/velpari-doctor` after every Pi upgrade; it surfaces setup drift.

2. **Senai cross-extension compatibility.** `/velpari-handoff` writes a file Senai reads. If Senai's input schema changes, handoff silently breaks.
   - **Likelihood:** Medium (Senai is also under active development).
   - **Impact:** Medium (would require updating both extensions in lockstep, since they live in the same repo).
   - **Mitigation:**
     - Handoff test reads Senai's `architect-inputs-config.ts` at test time and asserts schema compatibility.
     - Both extensions live in the same monorepo (`/mnt/Just_Do_It/02_Devp_Soft/pi-senai`), so coordinated updates are feasible.

3. **Schema migration.** When `state.json` or `files.json` evolves, existing runs become unloadable.
   - **Likelihood:** Low for v1.x (schemas are stable within a major version).
   - **Impact:** Low (a corrupted state file is recoverable via `/velpari-reset`; published `Doc/` artifacts are unaffected).
   - **Mitigation:** PRD §6 declares schema stability within v1.x. Migration tooling is out of scope for v1.x (PRD §7).

4. **Single point of failure.** If the single maintainer steps away, the project goes unmaintained.
   - **Likelihood:** Real but unbounded.
   - **Impact:** Low (the project is open-source; anyone can fork).
   - **Mitigation:** Clear `AGENTS.md` and `README.md` lower the barrier to new contributors.

### 5.3 Conclusion

Operational risk is real but bounded. Two caveats to watch:

1. **Upstream API stability.** The `@mariozechner/pi-coding-agent` extension API is under active development.
2. **Scout agent complexity.** 12 scout agents (4 in discuss + 4 in atomic-function + 4 in development-order) add LLM round-trip cost and failure surface. Each scout has a 30-second timeout (per `pseudocode.md:spawnSubagent`).

Both caveats are bounded: API stability is mitigated by mirroring Senai's patterns; scout complexity is mitigated by deterministic fixtures and centralized orchestration. **Operational feasibility: MEDIUM**, raised to effectively HIGH with the documented mitigations.

---

## 6. Schedule Feasibility — **MEDIUM**

### 6.1 Phased plan (per `pi_velpari_commands_plan_20260824_0924_v1.1.md`)

| Phase | Effort | Dependencies |
|---|---|---|
| Phase 0 (docs first) | ~1 week | None — in progress |
| Phase A (foundation) | ~1 week | Phase 0 complete |
| Phase B (first 3 stages) | ~1 week | Phase A complete |
| Phase C (last 4 stages) | ~1.5 weeks | Phase B complete |
| Phase D (handoff) | ~0.5 weeks | Phase A complete (parallel with B/C possible) |
| Phase E (show) | ~0.5 weeks | Phase A complete (parallel with B/C possible) |
| **Total critical path** | **~5 weeks** | — |
| **With parallelization (D, E alongside B, C)** | **~4.5 weeks** | — |
| **Buffer** | **+1–2 weeks** | — |

### 6.2 Risks to schedule

1. **Solo developer availability.** If the maintainer has competing priorities, phases stretch. **Mitigation:** each phase ends at a runnable checkpoint, so partial completion is still useful.
2. **Skill markdown iteration.** Each stage's skill markdown will need iteration to get the LLM to behave correctly under the zero-hallucination rule. **Mitigation:** Phase B tests the first 3 skills; lessons inform Phase C skills.
3. **LLM-dependent brittleness.** Stage behavior depends on LLM cooperation. Unexpected outputs can require prompt iteration. **Mitigation:** deterministic file paths and JSON shapes make failures reproducible; iteration is local to one stage.

### 6.3 Conclusion

Schedule fits comfortably in a 5–7 week solo window. Phases are independent checkpoints, so partial progress is recoverable. **Schedule feasibility: MEDIUM** (effective HIGH with buffer).

---

## 7. Dimension Summary

| Dimension | Rating | Key risk | Mitigation |
|---|---|---|---|
| Technical | HIGH | UI edge cases, handoff schema drift | Copy Senai patterns; handoff test reads Senai source |
| Economic | HIGH | Solo-dev time investment | Phased checkpoints; ROI after 5–10 uses |
| Legal | HIGH | None material | MIT, original code, no telemetry |
| Operational | MEDIUM | Upstream Pi API stability | Pin peer dep, mirror Senai, run doctor after upgrades |
| Schedule | MEDIUM | Solo-dev availability, prompt iteration | Independent phase checkpoints |

**Overall: GO.** No dimension is Low. The two Medium ratings have clear, low-cost mitigations.

---

## 8. Recommendations

1. **Proceed with implementation** in the order specified by the plan: Phase A (foundation) → Phase B (first 3 stages) → Phase C (last 4 stages) → Phase D (handoff) → Phase E (show) → Phase F (atomic-function) → Phase G (development-order).
2. **Lock the peer-dependency range** at `^1.x` for `@mariozechner/pi-coding-agent` to avoid surprise breakage from upstream API changes.
3. **Add a CI smoke check** that runs `/velpari-doctor` against a fixture run and fails if any error is reported. Doctor is the canary for both upstream and Senai-side breakage.
4. **Treat Senai as a sibling dependency.** When Senai updates, audit `/velpari-handoff` against the new schema in the same commit.
5. **Document the upstream API assumption list** in `AGENTS.md` so future maintainers know which Pi APIs Velpari depends on.
6. **Centralize scout orchestration.** All 12 scout agents should share a single spawn helper with timeout handling and JSON parsing — already designed this way in `pseudocode.md:spawnSubagent`.
7. **Make optional stages truly optional.** Both `/velpari-atomic-function` and `/velpari-development-order` must work without being required for handoff. Doctor should remind the user at the `planned-tests → handoff-ready` transition that the optional stages exist.

---

## 9. Sign-off

This feasibility study is approved as part of the v1.1 docs-first scope. Implementation phases (A–E) may proceed once the user gives the execution approval per the plan.

*This document is consumed by `Doc/design.md` (constraints inform the architecture) and the acceptance criteria in `Doc/PRD.md` §9.*
