---
name: velpari-scan-gate
description: SCAN-gate picker UX reference (v2.1) — describes the 5 structured branches + freeform "Type something..." row that velpari's SCAN-gate picker renders. Used by the parent LLM during /velpari-brainstorm to choose which scout scans run. Pattern follows the canonical AskUserQuestion hardening (auto-injected freeform, structured result, cancellation signal).
---

# Velpari SCAN-Gate Picker

A bundled skill that documents the **SCAN-gate picker** for the parent LLM to reference during `/velpari-brainstorm`. Lives at `skills/velpari-scan-gate/SKILL.md` so the agent can find it on demand.

## When this picker fires

After the user confirms the parent's understanding (CONFIRM step), the parent LLM calls:

```
velpari_brainstorm_session({ action: "request-scan-gate" })
```

The handler runs `runScanGatePicker` from `pi-extension/src/stages/brainstorm/scan-gate.ts`. This skill documents the picker UX so the parent LLM can describe it accurately to the user and handle the result correctly.

## The 5 structured branches

The picker is built dynamically based on `getAvailableScanTypes(config, cwd)` — branches for unavailable scans are hidden. With all three scans available, the labels are:

1. `Run all (code + doc + community)` — runs everything; community still needs FR-52 consent
2. `Run code + doc only` — subset (community excluded even when available)
3. `Run community only (web search — FR-52 consent)` — needs FR-52 consent
4. `Adjust (pick per-scan)` — one `ctx.ui.confirm` per available scan
5. `Skip scans (inline research only)` — empty result, no scout dispatch

## The freeform "Type something..." row (AskUserQuestion parity)

The picker **always** appends one more option at the end:

6. `Type something... (freeform — name the scans)` — picks `ctx.ui.input` and lets the developer type comma-separated scan names (e.g. `code, community`)

The freeform row follows Claude Code's AskUserQuestion pattern of auto-injecting a free-text escape. The typed input is:

- Lower-cased
- Trimmed
- Split on commas
- Filtered to the available scan set (unknown names silently dropped)
- Empty input → canonical `cancelled: true` sentinel

## The result shape

The picker returns a rich `ScanGateResult`:

```ts
interface ScanGateResult {
  scans: ScanType[];   // [] = user picked Skip, OR freeform yielded empty
  cancelled: boolean;  // true = user pressed Esc OR freeform was empty
  freeform: boolean;   // true = user typed a custom subset via the freeform row
}
```

The state tool persists `scans` to `state.json:scansSelected` and returns the three flags to the LLM in the snapshot. The parent LLM should distinguish:

- `scans: [...], cancelled: false, freeform: false` — user picked a structured branch
- `scans: [...], cancelled: false, freeform: true` — user typed a custom subset
- `scans: [], cancelled: false, freeform: false` — user picked "Skip scans" (intentional)
- `scans: [], cancelled: true, freeform: false` — user pressed Esc OR freeform was empty (accidental — prompt again)

## Decision handshake (matching edlsh/pi-ask-user)

1. **Gather evidence** — read `files.json` (already done by the state tool), understand what's available
2. **Present the picker** — runScanGatePicker renders the AskUserQuestion-style UX
3. **Wait** for explicit user choice — never assume a default
4. **Confirm** the result via the snapshot's three flags
5. **Proceed** — dispatch scouts for the selected scans

## Hard rules

- **Never skip the picker** — `DEFAULT_SCANS` is frozen empty; there is NO default
- **The freeform row is always present** — even when only `community` is available
- **Unknown scan names are silently dropped** — never error on freeform input
- **Empty freeform is `cancelled: true`** — distinguishes accidental Esc from intentional Skip
- **The picker is config-aware** — a doc-only project never sees "Run code scan"
- **Community scan always requires `ctx.ui.confirm` consent** — regardless of which branch picked it