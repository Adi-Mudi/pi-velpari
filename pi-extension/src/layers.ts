// ============================================================================
// Pi-Velpari layered architecture
// (official Pi extension orchestrator architecture — 4 layers:
//  domain → stage-logic → presentation → composition)
// ============================================================================
//
// This file documents the dependency order between folders in src/.
// It is NOT a re-export barrel: each layer keeps its own per-file
// imports. The composition roots are src/index.ts (wiring only) and
// src/commands/index.ts (registerCommands + per-command wiring).
//
// ------------------------------------------------------------------------
// Layer 0 — Domain primitives (imports nothing else from src/)
// ------------------------------------------------------------------------
//   core/   state, paths, constants, stage-runner, prompt, config,
//           profile, profiles-library, psrs, compaction,
//           agents-generator, generated-manifest, project-context
//           (sub-agent generator core — Phase 2 of /velpari-generate-sub-agents),
//           multiplexer (Phase 2), scan-options (Phase 2),
//           standards-catalogue, standards-overlay,
//           logging-plan (v1.4.0 — /velpari-design-logging discipline command)
//   io/     atomic-write (every fs write goes through here),
//           agents-install
//
// ------------------------------------------------------------------------
// Layer 1 — Stage logic (imports only Layer 0)
// ------------------------------------------------------------------------
//   stages/  one file per stage handler + registry (brainstorm,
//            brainstorm-approve, prd, rtm, prd-rtm, feasibility, design,
//            pseudocode, testplan, atomic-function, development-order)
//   ops/     approve, status, reset, handoff, configure-inputs,
//            configure-requirements/
//            (velpari-local grouping — the official layer map is silent
//            on ops grouping; follows the sibling convention of flat
//            per-concern L1 folders)
//   doctor/  diagnostics: runDoctor, report writer, checks/*
//   view/    read-only display handlers (show-*) — velpari-local, kept
//
// ------------------------------------------------------------------------
// Layer 2 — Presentation (imports Layer 0 + 1)
// ------------------------------------------------------------------------
//   ui/     TUI widgets (velpari-status entry renderer)
//   hooks/  Pi lifecycle event handlers, one file per event
//           (session-start, session-before-compact, resources-discover,
//           session-shutdown)
//
// ------------------------------------------------------------------------
// Layer 3 — Composition root (imports everything below)
// ------------------------------------------------------------------------
//   commands/    25 slash commands, one file per command + index.ts wiring
//   src/index.ts extension entry point (wiring only)
//
// ============================================================================
// Dependency rule: a file in layer N may import from any layer < N.
// Files in the same layer may import each other freely.
// Never import upward. Enforced by test/architecture-alignment.test.ts.
// ============================================================================

export const LAYERS = {
	0: ["core", "io"],
	1: ["stages", "ops", "doctor", "view"],
	2: ["ui", "hooks"],
	3: ["commands"],
} as const;
