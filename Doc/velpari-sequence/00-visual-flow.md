# 00 — Visual Flow (Diagram Atlas)

The whole finalized pi_velpari sequence, visually. Every diagram is a view of
the spec — where behavior is defined in words, the caption names the document
that owns it. If a diagram and a spec doc ever disagree, the spec doc wins
(and the diagram is a defect).

Contents:
1. Master end-to-end flow → defined in `README.md`, `01-first-run-sequence.md`
2. Per-stage rhythm → defined in `README.md`
3. First-run strict sequence → defined in `01-first-run-sequence.md`
4. Revision modes 1/2/3 → defined in `02-revision-workflows.md`
5. Staleness cascade → defined in `03-staleness-and-validation.md`
6. Dynamic transition lock → defined in `04-brainstorm-and-locking.md`
7. 3-layer validation gate → defined in `03-staleness-and-validation.md`, `05-sub-agent-generation.md`

---

## 1. Master end-to-end flow

The whole pre-production pipeline: setup, four [generate agents → phase]
blocks, final validation, handoff to Senai.

```text
┌───────────────────────────────────────────────────────────────┐
│ ONE-TIME SETUP (empty-project safe)                           │
│ configure-inputs → (opt) configure-requirements / -standards  │
└──────────────────────────────┬────────────────────────────────┘
                               ▼
        ┌──────────────────────────────────────────┐
        │ GENERATE PHASE 1 AGENTS → doctor validate │
        │ (mission + files.json + tech resources)   │
        └─────────────────────┬────────────────────┘
                              ▼
        ╔══════════════════════════════════════════╗
        ║ PHASE 1 — DISCOVERY                      ║
        ║ brainstorm → approve-brainstorm          ║
        ║ → Doc/brainstorm/brainstorm-<topic>.md   ║
        ╚═════════════════════╦════════════════════╝
                              ▼
        ┌──────────────────────────────────────────┐
        │ GENERATE PHASE 2 AGENTS → doctor validate │
        │ (published brainstorm notes only)         │
        └─────────────────────┬────────────────────┘
                              ▼
        ╔══════════════════════════════════════════╗
        ║ PHASE 2 — REQUIREMENTS                   ║
        ║ prd → approve ──────────────────────┐    ║
        ║ rtm → approve ──────────────────────┤    ║
        ║ feasibility → approve ──────────────┘    ║
        ║ → Doc/requirements/, Doc/feasibility/    ║
        ╚═════════════════════╦════════════════════╝
                              ▼
        ┌──────────────────────────────────────────┐
        │ GENERATE PHASE 3 AGENTS → doctor validate │
        │ (published PRD+RTM+feasibility)           │
        └─────────────────────┬────────────────────┘
                              ▼
        ╔══════════════════════════════════════════╗
        ║ PHASE 3 — DESIGN                         ║
        ║ architecture-generator → approve ────┐   ║
        ║ atomic-function → approve ───────────┤   ║
        ║ pseudocode → approve ────────────────┘   ║
        ║ → Doc/design/, Doc/atomic-functions/,    ║
        ║   Doc/pseudocode/                        ║
        ╚═════════════════════╦════════════════════╝
                              ▼
        ┌──────────────────────────────────────────┐
        │ GENERATE PHASE 4 AGENTS → doctor validate │
        │ (published design+AF+pseudocode)          │
        └─────────────────────┬────────────────────┘
                              ▼
        ╔══════════════════════════════════════════╗
        ║ PHASE 4 — VALIDATION & HANDOFF           ║
        ║ testplan → approve ──────────────────┐   ║
        ║ development-order → approve ─────────┤   ║
        ║ final-design → approve ──────────────┘   ║
        ║ → Doc/tests/, Doc/development-order/,    ║
        ║   Doc/design/final-design_<proj>.md      ║
        ╚═════════════════════╦════════════════════╝
                              ▼
        ┌──────────────────────────────────────────┐
        │ FINAL: /velpari-doctor (zero stale       │
        │ required) → /velpari-handoff             │
        │ → .pi/senai/architect-inputs.json        │
        └─────────────────────┬────────────────────┘
                              ▼
                  ┌───────────────────────┐
                  │ SENAI — PRODUCTION    │
                  │ (out of scope)        │
                  └───────────────────────┘
```

---

## 2. Per-stage rhythm

Every stage, every run: the same 5 beats. No auto-chains — the developer
types each next command by hand.

```text
   ┌─────────┐     ┌─────────┐     ┌──────────┐     ┌──────────┐     ┌────────┐
   │ 1. RUN  │────▶│ 2. DRAFT│────▶│3. PREVIEW│────▶│4. PUBLISH│────▶│5. NEXT │
   └─────────┘     └─────────┘     └──────────┘     └──────────┘     └────────┘
   transition      working copy    developer       publish gate     one correct
   lock: legal?    in run folder   says yes/fix    + L1/L2/L3       next command
   inputs fresh?   (writes locked  ────────────▶    + doctor audit  named; typed
   scouts spawn    to that folder)      │           atomic write    by hand
                                        │ no        to Doc/
                                        ▼
                                   fix draft ──▶ back to PREVIEW
```

Publish path detail:

```text
preview-yes → velpari_stage_publish tool (or /velpari-<stage>-approve fallback)
   1. revision gate (append-only IDs, version bump, Change Log)
   2. artifact gate (L1 hash + L2 ID coverage + L3 reviewer verdict)
   3. atomic write to Doc/
   4. full doctor audit — errors OR warnings ⇒ nothing publishes
   5. advanceStage + Next: hint
```

---

## 3. First-run strict sequence

All 10 stages with their gates. On a first run: no skips, ever. Resume across
sessions happens only at approved boundaries.

```text
setup
  │  /velpari-brainstorm
  ▼
[brainstorming] ──/velpari-approve-brainstorm──▶ [brainstormed]
  │  /velpari-prd
  ▼
[drafting-prd] ──approve──▶ [drafted-prd]
  │  /velpari-rtm
  ▼
[building-rtm] ──approve──▶ [built-rtm]
  │  /velpari-feasibility                    ◀── mandatory on first runs
  ▼
[analyzing-feasibility] ──approve──▶ [analyzed-feasibility]
  │  /velpari-architecture-generator
  ▼
[designing] ──approve──▶ [designed]
  │  /velpari-atomic-function
  ▼
[analyzing-atomic-functions] ──approve──▶ [analyzed-atomic-functions]
  │  /velpari-pseudocode
  ▼
[writing-pseudocode] ──approve──▶ [wrote-pseudocode]
  │  /velpari-testplan
  ▼
[planning-tests] ──approve──▶ [planned-tests]
  │  /velpari-development-order
  ▼
[ordering-development] ──approve──▶ [ordered-development]
  │  /velpari-final-design
  ▼
[finalizing-design] ──approve──▶ [finalized-design]
  │  /velpari-handoff
  ▼
[handoff-ready] ──────────────▶ SENAI

Crossing any ──approve── gate out of order ⇒ hard block naming the
correct command. (Transitions mirror constants.ts:STAGE_TRANSITIONS.)
```

---

## 4. Revision modes 1 / 2 / 3

```text
MODE 1 — Full sequence (first run)                strict, no skips
═══════════════════════════════════════════════════════════════════════
brainstorm → prd → rtm → feasibility → design → af → pseudo →
testplan → dev-order → final-design → handoff


MODE 2 — Partial restart + full forward pass      broad change
═══════════════════════════════════════════════════════════════════════
brainstorm (change mode) → approve ⇒ ALL downstream stale
  → prd (update) → rtm (update) → feasibility (update) →
    design (update) → af (update) → pseudo (update) →
    testplan (update) → dev-order (update) → final-design (update)
  → handoff


MODE 3 — Partial restart + continue mid-chain     focused change
═══════════════════════════════════════════════════════════════════════
brainstorm (change mode) → approve ⇒ stale-set computed
  → prd (update) → rtm (update)
  → feasibility … FRESH? ──yes──▶ SKIP (jump allowed over fresh stages)
         │
         no
         ▼
     revise OR re-confirm
  → design (update) → … forward, revise-or-reconfirm per stale stage …
  → handoff

RULE: you may skip stages. You may not skip staleness.
```

---

## 5. Staleness cascade

What happens when one artifact republishes. Example: PRD v1.3 publishes.

```text
PRD republished (v1.3)
        │
        ▼  orchestrator recomputes input hashes over the fixed chain
┌─────────────────────────────────────────────────────────────┐
│ artifact     recorded prd-hash    current prd-hash   state  │
│ rtm          sha256:A             sha256:B           STALE  │
│ feasibility  sha256:A             sha256:B           STALE  │
│ design       sha256:A             sha256:B           STALE  │
│ atomic-fns   (via design)                            STALE  │
│ pseudocode   (via design/af)                         STALE  │
│ testplan     (via pseudo)                            STALE  │
│ dev-order    (via testplan)                          STALE  │
│ final-design (via all)                               STALE  │
└─────────────────────────────────────────────────────────────┘
        │
        ▼  developer types /velpari-development-order
┌─────────────────────────────────────────────────────────────┐
│ BLOCKED: "RTM is outdated after PRD v1.3. Run /velpari-rtm."│
│ (earliest stale stage named — self-healing routing)         │
└─────────────────────────────────────────────────────────────┘
        │
        ▼  per stale artifact, developer picks one path:
   ┌───────────────────┐     ┌────────────────────────────────┐
   │ REVISE            │     │ RE-CONFIRM                     │
   │ re-run stage in   │     │ "reviewed, no impact" +        │
   │ update mode       │     │ Change Log line + re-stamp     │
   └───────────────────┘     └────────────────────────────────┘
        │
        ▼  chain fully fresh again
┌─────────────────────────────────────────────────────────────┐
│ /velpari-handoff UNBLOCKED (requires: zero stale)           │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. Dynamic transition lock

The legal-command set is computed on every command from:
(current stage, freshness map, brainstorm-open flag).

```text
                    ┌──────────────────────────────┐
                    │         NORMAL STATE          │
                    │ allowed:                      │
                    │  • next stage(s) with PRESENT │
                    │    + FRESH inputs             │
                    │  • /velpari-brainstorm        │
                    │  • discipline/view commands   │
                    │ blocked: everything else      │
                    │  (+ correct command named)    │
                    └───────┬──────────────▲────────┘
              /velpari-brainstorm          │ brainstorm closed /
                            │              │ approved (staleness
                            ▼              │ recomputed)
                    ┌──────────────────────────────┐
                    │      BRAINSTORM-OPEN STATE    │
                    │ exactly TWO DOORS:            │
                    │                               │
                    │  door 1: CONTINUE current     │
                    │          stage (discussion    │
                    │          feeds the draft)     │
                    │                               │
                    │  door 2: RESTART at PRD       │
                    │          (/velpari-prd — the  │
                    │          change path forward) │
                    │                               │
                    │ locked: all other stage       │
                    │ commands ("Brainstorm open —  │
                    │ continue <stage> or restart   │
                    │ at /velpari-prd")             │
                    └──────────────────────────────┘

Self-healing: any wrong command ⇒ block message names the single correct
next command (earliest stale stage / only legal transition). The developer
can never reach a dead end.
```

---

## 7. 3-layer validation gate

Which checks run at which gate, and who performs them.

```text
STAGE START                        PUBLISH
─────────────                      ─────────────────────────────────────┐
┌────────────────┐                 ┌──────────────────────────────────┐ │
│ L1 hash        │                 │ L1 hash freshness (code)         │ │
│ inputs fresh?  │                 │ L2 ID coverage (code):           │ │
│                │                 │   FR/NFR → RTM, design           │ │
│ stale ⇒ BLOCK, │                 │   AF → pseudocode                │ │
│ earliest stale │                 │   FR/AF → test-cases             │ │
│ stage named    │                 │   AF → dev-order DAG             │ │
└────────────────┘                 │ L3 semantic (generated verifier  │ │
                                   │   sub-agents): reviewer verdict  │ │
                                   │   approve | needs-fix | block    │ │
                                   │        │                         │ │
                                   │        ▼ all pass                │ │
                                   │   atomic write to Doc/           │ │
                                   │   + full doctor audit            │ │
                                   └──────────────────────────────────┘ │
                                                                       │
/velpari-handoff:  L1 zero-stale + L2 complete                 ◀───┘
                   (L3 verdict consumption at handoff = documented
                    future item — see 03; Senai sees nothing until
                    both shipped layers pass)

Layer owners: L1/L2 = code (cheap, deterministic). L3 = sub-agents
(find issues) + code (enforces verdicts). See 03 + 05.
```
