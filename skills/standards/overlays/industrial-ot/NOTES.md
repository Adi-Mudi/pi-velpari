# Industrial OT — IEC 61508 SIL + IEC 62443 Research Notes

> Authoring notes for `industrial-ot`. Captures what the overlay
> enforces, why, and the standards it references. Not normative for
> IEC 61508 or IEC 62443 themselves — see the official standards for
> authoritative text.

## Safety Integrity Levels (IEC 61508 §4)

| SIL | Probability of dangerous failure per hour (PFH) | Risk reduction |
|---|---|---|
| 1 | 10⁻⁶ to 10⁻⁵ | Low |
| 2 | 10⁻⁷ to 10⁻⁶ | Low–medium |
| 3 | 10⁻⁸ to 10⁻⁷ | Medium–high |
| 4 | 10⁻⁹ to 10⁻⁸ | High |

A safety-related function's required SIL is derived from the hazard
analysis (HAZOP). The overlay enforces the SIL documentation but does
not pick the SIL — that decision lives in the HAZOP table and the
risk graph output.

## Functional safety lifecycle (IEC 61508 §5)

The overlay mirrors the IEC 61508 lifecycle through its required
sections:

| Phase | Standard | Overlay section |
|---|---|---|
| Concept | §5.2 | (brainstorm, not overlay) |
| Scope | §5.2.4 | PRD §Scope |
| Hazard & risk analysis | §5.2.6 | PRD §Hazard and Operability Study |
| Overall safety requirements | §5.2.7 | PRD §Safety Integrity Level Classification |
| Safety requirements allocation | §5.2.8 | Design §SIL Decomposition |
| Overall operation, maintenance, modification | §5.2.10 | (operations, not overlay) |
| Overall safety validation | §5.2.11 | Testplan §SIL Verification Coverage |
| Functional safety assessment | §5.2.12 | Testplan §FMEA Verification |

## Safety instrumented system (SIS) architecture

A SIS is a separate, independent system that takes the process to a
safe state when the BPCS (Basic Process Control System) fails. The
overlay enforces that:

1. The SIS is **separate** from the BPCS (different hardware, different
   software, different power)
2. The SIS has its **own sensor → logic solver → final element** chain
3. The SIL applies **per safety instrumented function (SIF)**, not per
   system
4. Proof testing has a documented interval (per IEC 61508 §5.2.10)

## Cybersecurity zones and conduits (IEC 62443)

IEC 62443 models an industrial network as **zones** (groups of assets
sharing a security policy) connected by **conduits** (the controlled
paths between zones). The overlay captures:

- Zone inventory (zone ID, purpose, security level target)
- Conduit inventory (zone A → zone B, allowed protocols, authentication)
- Security Level Target (SL-T) per zone (1 / 2 / 3 / 4)
- Foundational Requirements (FR) per IEC 62443-3-3: Identification &
  authentication, Use control, System integrity, Data confidentiality,
  Restricted data flow, Timely response to events, Resource availability

## SIL decomposition

When the same safety function is implemented by redundant subsystems,
SIL can be "decomposed" (e.g., SIL 3 → two SIL 2 subsystems). The
overlay requires the decomposition to be:

1. Documented (which subsystems implement the function)
2. Cross-checked (no common-cause failure between subsystems)
3. Proven (independent failure detection in each subsystem)

## Failure mode analysis

The overlay requires analysis of three failure categories:

| Category | Meaning | Detection |
|---|---|---|
| Single-point failure | Failure not detected by redundancy | Proof test |
| Common-cause failure | Both subsystems fail the same way | Diversity analysis |
| Dangerous undetected failure | Failure that puts the system in a hazardous state without warning | Diagnostic coverage |

The `design-sil-analyzer` scout flags any module that lacks at least
one failure-mode entry in the FMEA table.

## What the overlay does NOT enforce

- Hardware SIL qualification (separate process — IEC 61508 §7)
- Operations & maintenance lifecycle (handled outside Velpari)
- EMC / EMI compliance (IEC 61000, not in overlay scope)
- Mechanical safety (ISO 13849-1, separate overlay candidate)
- Hazard analysis methodology details (FMEA, FTA, HAZOP are inputs
  to the overlay, not outputs)

## Standards referenced

- **IEC 61508:2010** — Functional safety of E/E/PE systems
- **IEC 62443-3-3:2013** — Industrial communication networks — Network
  and system security — Part 3-3: System security requirements and
  security levels
- **IEC 61131-3:2013** — Programmable controllers — Part 3: Programming
  languages (reference for PLC coding style, not enforced by overlay)

## Future versions

- v1.1 — add `## Mechanical Safety` overlay cross-reference (ISO 13849-1)
- v1.2 — add `## HAZOP Methodology` section (force choice of FMEA / FTA / HAZOP)
- v2.0 — split into `industrial-ot-sil2`, `industrial-ot-sil3`, `industrial-ot-sil4`
